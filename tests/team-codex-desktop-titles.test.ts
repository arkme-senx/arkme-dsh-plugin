import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { TeamCodexDesktopTitleReader } from '../src/team-codex-desktop-titles.js'

const roots: string[] = [], databases: DatabaseSync[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const session = 'task_current_123'
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'codex-titles-')); roots.push(home)
  const key = createHash('sha256').update(realpathSync(home)).digest('hex')
  const reader = new TeamCodexDesktopTitleReader(home)
  const database = (named = true) => {
    const db = new DatabaseSync(join(home, 'state_5.sqlite')); databases.push(db)
    db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE threads(id TEXT PRIMARY KEY,title TEXT${named ? ',name TEXT' : ''})`)
    return db
  }
  const index = (rows: unknown[]) => writeFileSync(join(home, 'session_index.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  return { home, key, reader, database, index, read: () => reader.read(key, [session]) }
}
const entry = (name: string, at = '2026-09-30T10:00:00Z', id = session) => ({ id, thread_name: name, updated_at: at })

describe('read-only native Codex display names', () => {
  it('uses name, not first-prompt title, and observes rename in a live WAL without modifying sources', () => {
    const f = fixture(), db = f.database()
    db.prepare('INSERT INTO threads VALUES(?,?,?)').run(session, '# Files mentioned by the user:', '完善录音板块前端优化')
    db.prepare('INSERT INTO threads VALUES(?,?,?)').run('unbound_task', 'private', '不应同步')
    f.index([entry('过期索引名称')])
    const paths = ['state_5.sqlite', 'state_5.sqlite-wal', 'session_index.jsonl'].map(file => join(f.home, file))
    const before = paths.map(path => readFileSync(path))
    expect([...f.read()]).toEqual([[session, '完善录音板块前端优化']])
    expect(paths.map(path => readFileSync(path))).toEqual(before)
    db.prepare('UPDATE threads SET name=? WHERE id=?').run('我刚重命名的任务 📝', session)
    expect(f.read().get(session)).toBe('我刚重命名的任务 📝')
    expect(f.read().size).toBe(1)
  })
  it('uses the latest index rename for older schemas without name, never raw title', () => {
    const f = fixture(), db = f.database(false)
    db.prepare('INSERT INTO threads VALUES(?,?)').run(session, '这是一条长长的原始需求')
    expect(f.read().size).toBe(0)
    f.index([entry('最新标题', '2026-09-30T12:00:00Z'), entry('旧标题'), entry('其他任务', undefined, 'unbound_task')])
    expect([...f.read()]).toEqual([[session, '最新标题']])
  })
  it('reads a name-only index without creating a missing database', () => {
    const f = fixture(); f.index([entry('任务名称')])
    expect(f.read().get(session)).toBe('任务名称')
    expect(() => readFileSync(join(f.home, 'state_5.sqlite'))).toThrow()
  })
  it('ignores invalid IDs, empty names, oversized names and wrong configuration roots', () => {
    const f = fixture(), db = f.database()
    db.prepare('INSERT INTO threads VALUES(?,?,?)').run(session, '不要使用正文', '   ')
    expect(f.read().size).toBe(0)
    db.prepare('UPDATE threads SET name=?').run('字'.repeat(20000))
    expect(f.read().size).toBe(0)
    db.prepare('UPDATE threads SET name=?').run('正常标题')
    expect(f.reader.read('0'.repeat(64), [session]).size).toBe(0)
    expect(f.reader.read(f.key, ["bad' OR 1=1 --"]).size).toBe(0)
    expect(f.reader.read(f.key, []).size).toBe(0)
  })
  it('does not roll back to a stale index when database format is unknown or corrupt', () => {
    const f = fixture(); f.index([entry('过期标题')])
    writeFileSync(join(f.home, 'state_5.sqlite'), 'corrupt')
    expect(f.read().size).toBe(0)
  })
  it('does not accept a partial index append or an oversized index', () => {
    const f = fixture(); f.index([entry('旧标题')])
    writeFileSync(join(f.home, 'session_index.jsonl'), JSON.stringify(entry('旧标题')) + '\n{"id":')
    expect(f.read().size).toBe(0)
    writeFileSync(join(f.home, 'session_index.jsonl'), 'x'.repeat(8 * 1024 * 1024 + 1))
    expect(f.read().size).toBe(0)
  })
  it.each(['state_5.sqlite', 'session_index.jsonl', 'state_5.sqlite-wal', 'state_5.sqlite-shm'])('rejects linked source %s', file => {
    const f = fixture()
    if (file.includes('-')) f.database()
    const target = join(f.home, 'target'); writeFileSync(target, JSON.stringify(entry('不能读取')))
    rmSync(join(f.home, file), { force: true }); symlinkSync(target, join(f.home, file))
    expect(f.read().size).toBe(0)
  })
})
