import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeLocalMarks } from '../../src/services/native-local-marks.js'
import { LocalMessageMarkStore } from '../../src/local-message-marks.js'
import { quoteSourceContent, type ArkmeMessageQuote } from '../../src/message-quote.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).reverse().forEach(cleanup => cleanup()))
const source = JSON.stringify(['dsh-native', 11, 'arkme:source:session'])
const text = '前缀重点后缀'
const ref = (value = text, session = source) => JSON.stringify([session, 'assistant:1', value])
const anchor: ArkmeMessageQuote = { version: 1, projection: 'arkme-text-v1', start: 2, end: 4, text: '重点', prefix: '前缀', suffix: '后缀',
  sourceDigest: createHash('sha256').update(quoteSourceContent({ title: '', textContent: text, textFormat: 'plain' })).digest('hex') }
function fixture(path = ':memory:', environment = 'test') {
  const db = new DatabaseSync(path)
  const store = new LocalMessageMarkStore(db, work => { db.exec('BEGIN IMMEDIATE'); try { work(); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error } })
  const runtime = new ServiceRuntime({ environment } as ArkmeServiceConfig, {} as ArkmeSessionStore, { messageMarks: store } as StateStore)
  const session = { userId: 11, accessToken: 'test', refreshToken: 'refresh' }
  vi.spyOn(runtime, 'requireSession').mockResolvedValue(session)
  vi.spyOn(runtime, 'accountScopedSession').mockResolvedValue(session)
  let closed = false; const close = () => { if (!closed) { db.close(); closed = true } }; cleanups.push(close)
  return { runtime, service: new NativeLocalMarks(runtime), close }
}
it('restores the same highlight after SQLite and service restart, then persists cancellation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-mark-')); cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'state.sqlite'), first = fixture(path)
  const added = await first.service.change(source, ref(), { kind: 'add', operationId: 'mark', anchor }); first.close()
  const second = fixture(path)
  expect((await second.service.list(source, [ref()]))[0]!.snapshot.items).toEqual(added.items)
  await second.service.change(source, ref(), { kind: 'remove', operationId: 'remove', annotationId: added.items[0]!.id }); second.close()
  expect((await fixture(path).service.list(source, [ref()]))[0]!.snapshot.items).toEqual([])
})
it('isolates source sessions and environments and rejects account swaps', async () => {
  const f = fixture()
  await f.service.change(source, ref(), { kind: 'add', operationId: 'mark', anchor })
  const other = JSON.stringify(['dsh-native', 11, 'different-source:session'])
  expect((await f.service.list(other, [ref(text, other)]))[0]!.snapshot.items).toEqual([])
  const prod = new NativeLocalMarks({ ...f.runtime, config: { environment: 'prod' }, requireSession: f.runtime.requireSession, accountScopedSession: f.runtime.accountScopedSession } as ServiceRuntime)
  expect((await prod.list(source, [ref()]))[0]!.snapshot.items).toEqual([])
  await expect(f.service.list(other, [ref()])).rejects.toMatchObject({ httpStatus: 403 })
  vi.mocked(f.runtime.accountScopedSession).mockResolvedValue(undefined)
  await expect(f.service.change(source, ref(), { kind: 'add', operationId: 'race', anchor })).rejects.toMatchObject({ code: 'native-local-mark-account-changed' })
})
it('validates exact anchors and marks changed content stale instead of guessing', async () => {
  const { service } = fixture()
  await expect(service.change(source, ref(), { kind: 'add', operationId: 'bad', anchor: { ...anchor, start: 0 } })).rejects.toMatchObject({ httpStatus: 409 })
  await service.change(source, ref(), { kind: 'add', operationId: 'ok', anchor })
  expect((await service.list(source, [ref('重点已改变')]))[0]!.snapshot.items[0]!.state).toBe('stale')
})
it('bounds inputs, rejects a different account and reports disk errors honestly', async () => {
  const { service, runtime } = fixture()
  await expect(service.list(source, [ref('x'.repeat(300_001))])).rejects.toMatchObject({ httpStatus: 403 })
  await expect(service.capabilities(JSON.stringify(['dsh-native', 12, 'session']))).rejects.toMatchObject({ httpStatus: 403 })
  vi.spyOn(runtime.stateStore.messageMarks!, 'change').mockImplementation(() => { throw new Error('disk full') })
  await expect(service.change(source, ref(), { kind: 'add', operationId: 'failed', anchor })).rejects.toMatchObject({ code: 'native-local-mark-save-failed' })
})
