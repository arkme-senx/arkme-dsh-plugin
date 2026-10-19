import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { LocalMessageMarkStore } from '../src/local-message-marks.js'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
const anchor = { version: 1, projection: 'arkme-text-v1', sourceDigest: 'a'.repeat(64), start: 0, end: 2, text: '重点', prefix: '', suffix: '' } as const
const dirs: string[] = [], databases: DatabaseSync[] = []
const add = (operationId = 'add') => ({ kind: 'add' as const, operationId, anchor })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'arkme-local-marks-')); dirs.push(directory)
  const db = new DatabaseSync(join(directory, 'test.sqlite')); databases.push(db)
  const store = new LocalMessageMarkStore(db, work => { db.exec('BEGIN IMMEDIATE'); try { work(); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error } })
  return { db, store }
}
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
it('persists marks and removals across real client database reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arkme-local-marks-reopen-')); dirs.push(dir)
  const state = new ArkmeStateStore(dir)
  let database = new ArkmeLocalDatabase(dir, state)
  try {
    const first = database.messageMarks.change('prod:42:self', 'note', 42, anchor.sourceDigest, add())
    database.close(); database = new ArkmeLocalDatabase(dir, state)
    expect(database.messageMarks.read('prod:42:self', 'note', 42, anchor.sourceDigest)).toEqual(first)
    database.messageMarks.change('prod:42:self', 'note', 42, anchor.sourceDigest, { kind: 'remove', operationId: 'remove', annotationId: first.items[0]!.id })
    database.close(); database = new ArkmeLocalDatabase(dir, state)
    expect(database.messageMarks.read('prod:42:self', 'note', 42, anchor.sourceDigest).items).toEqual([])
  } finally { database.close() }
})
it('isolates environment, viewer, conversation and message occurrences', () => {
  const { store } = fixture(); store.change('prod:42:chat:A', 'record:relation1', 42, anchor.sourceDigest, add())
  for (const scope of ['test:42:chat:A', 'prod:43:chat:A', 'prod:42:chat:B', 'prod:42:self']) expect(store.read(scope, 'record:relation1', 42, anchor.sourceDigest).items).toEqual([])
  expect(store.read('prod:42:chat:A', 'record:relation2', 42, anchor.sourceDigest).items).toEqual([])
})
it('deduplicates ranges and operation retries without resurrecting a later removal', () => {
  const { store } = fixture(), read = () => store.read('scope', 'note', 42, anchor.sourceDigest)
  const first = store.change('scope', 'note', 42, anchor.sourceDigest, add())
  expect(store.change('scope', 'note', 42, anchor.sourceDigest, add())).toEqual(first)
  store.change('scope', 'note', 42, anchor.sourceDigest, add('duplicate'))
  expect(read().items).toHaveLength(1)
  store.change('scope', 'note', 42, anchor.sourceDigest, { kind: 'remove', operationId: 'remove', annotationId: first.items[0]!.id })
  expect(store.change('scope', 'note', 42, anchor.sourceDigest, add()).items).toEqual([])
  expect(() => store.change('scope', 'note', 42, anchor.sourceDigest, { kind: 'remove', operationId: 'add', annotationId: 'different' })).toThrow('操作已变化')
})
it('never moves marks to changed text or destroys the original anchors', () => {
  const { store } = fixture(); store.change('scope', 'note', 42, anchor.sourceDigest, add())
  expect(store.read('scope', 'note', 42, 'b'.repeat(64)).items[0]).toMatchObject({ state: 'stale', anchor })
  expect(store.read('scope', 'note', 42, anchor.sourceDigest).items[0]?.state).toBe('available')
})
it('preserves corrupt data and rolls back the operation receipt', () => {
  const { store, db } = fixture()
  db.prepare('INSERT INTO local_message_marks VALUES(?,?,?)').run('scope', 'note', 'broken')
  expect(() => store.change('scope', 'note', 42, anchor.sourceDigest, add())).toThrow('原数据已保留')
  expect(db.prepare('SELECT payload FROM local_message_marks').get()).toEqual({ payload: 'broken' })
  expect(db.prepare('SELECT COUNT(*) n FROM local_message_mark_operations').get()).toEqual({ n: 0 })
})
it('rolls back snapshot if receipt storage fails, allowing a safe retry', () => {
  const { store, db } = fixture()
  db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON local_message_mark_operations BEGIN SELECT RAISE(ABORT,'disk failure'); END")
  expect(() => store.change('scope', 'note', 42, anchor.sourceDigest, add())).toThrow('disk failure')
  expect(store.read('scope', 'note', 42, anchor.sourceDigest).items).toEqual([])
  db.exec('DROP TRIGGER fail_receipt')
  expect(store.change('scope', 'note', 42, anchor.sourceDigest, add()).items).toHaveLength(1)
})
it('reads current data inside each write transaction so independent windows do not lose marks', () => {
  const { store, db } = fixture()
  const another = new LocalMessageMarkStore(db, work => { db.exec('BEGIN IMMEDIATE'); try { work(); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e } })
  store.change('scope', 'note', 42, anchor.sourceDigest, add())
  another.change('scope', 'note', 42, anchor.sourceDigest, { ...add('second'), anchor: { ...anchor, start: 2, end: 4 } })
  expect(store.read('scope', 'note', 42, anchor.sourceDigest).items).toHaveLength(2)
})
