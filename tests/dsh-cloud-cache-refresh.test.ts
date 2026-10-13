import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { DshCloudNativeTransport } from '../src/dsh-remote/cloud-native-transport.js'
import { DshNativeHistoryCache } from '../src/dsh-remote/native-history-cache.js'
import type { NativeHistoryRecord } from '../src/dsh-remote/native-history.js'

// Native format compatibility is exercised by the official-runtime acceptance.
// Here keep the workload deterministic and count actual SQLite event mutations.
vi.mock('@deepseek-ai/dsh-session/surface', () => ({ validateSurfaceMetadata: vi.fn(), validateSessionEventData: vi.fn() }))
const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).reverse().forEach(fn => fn()))
const turns = (count: number): NativeHistoryRecord[] => Array.from({ length: count * 6 }, (_, seq) => ({
  type: 'event', event: { seq, time: seq + 1, type: ['turn/start', 'user/message', 'assistant/message', 'tool/result', 'assistant/message', 'turn/end'][seq % 6]!, data: { text: `original-${seq}` } },
}))

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'cloud cache refresh '))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const store = new DshNativeHistoryCache(directory)
  cleanups.push(() => store.close())
  const db = new DatabaseSync(join(directory, 'native-history.sqlite3'))
  cleanups.push(() => db.close())
  db.exec(`CREATE TABLE mutations (kind TEXT PRIMARY KEY, count INTEGER NOT NULL);
    INSERT INTO mutations VALUES ('insert',0),('update',0),('delete',0);
    CREATE TRIGGER count_insert AFTER INSERT ON events BEGIN UPDATE mutations SET count=count+1 WHERE kind='insert'; END;
    CREATE TRIGGER count_update AFTER UPDATE ON events BEGIN UPDATE mutations SET count=count+1 WHERE kind='update'; END;
    CREATE TRIGGER count_delete AFTER DELETE ON events BEGIN UPDATE mutations SET count=count+1 WHERE kind='delete'; END;`)
  const state = { records: turns(10), generation: 'generation-1', title: 'original', updated: 1, owned: true }
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith('/sessions/metadata')) return {
      runtime_ref: 'canonical', session_ref: state.owned ? 'session' : 'foreign', deduplicated_runtime_refs: ['retired'],
      history_revision: state.generation, title: state.title, created_at: 1, source_updated_at: state.updated,
      last_event_seq: state.records.length - 1, projection_as_of_seq: state.records.length - 1,
    }
    if (path.endsWith('/session-events/list')) {
      const end = Math.min(state.records.length, Number(body.before_seq ?? state.records.length)), start = Math.max(0, end - 100)
      return { entries: state.records.slice(start, end).map(({ event }) => ({ event })), ...(start > 0 ? { next_cursor: start } : {}) }
    }
    if (path.endsWith('/session-turn-objects/list')) return { items: [], has_more: false }
    throw Error(path)
  })
  const cloud = new DshCloudNativeTransport({ post }, async () => {})
  cleanups.push(() => cloud.close())
  const key = DshNativeHistoryCache.key('account', 'retired', { kind: 'session', sessionId: 'session' })
  const body = { mode: 'pull', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'session' } } } } }
  const cache = { store, key: () => key }
  const call = (id: string, request = body) => cloud.call('retired', request, id, new AbortController().signal, cache)
  const open = (id: string) => call(id)
  const poll = (id: string) => call(id, { mode: 'pull' } as typeof body)
  const reset = () => { post.mockClear(); db.exec('UPDATE mutations SET count=0') }
  const counts = () => Object.fromEntries(db.prepare('SELECT kind,count FROM mutations').all().map(r => [r.kind, Number(r.count)]))
  const persisted = () => db.prepare('SELECT payload FROM events WHERE session=? ORDER BY seq').all(key).map(r => JSON.parse(String(r.payload)))
  return { state, post, store, key, open, poll, reset, counts, persisted, cloud, call }
}

it('warm opens and unchanged polling do not rewrite cached events or snapshots', async () => {
  const f = fixture(); await f.open('first'); f.cloud.release('first')
  const original = f.store.snapshot(f.key), write = vi.spyOn(f.store, 'write')
  f.reset(); await f.open('warm'); await f.poll('warm')
  expect(f.post.mock.calls.map(([path]) => path)).toEqual(Array(2).fill('/api/v1/dsh-remote/sessions/metadata'))
  expect(write).not.toHaveBeenCalled()
  expect(f.counts()).toEqual({ insert: 0, update: 0, delete: 0 })
  expect(f.store.snapshot(f.key)).toEqual(original)
})

it('four windows share persisted content and a rename changes metadata without downloading or deleting history', async () => {
  const f = fixture(); await f.open('seed'); f.store.write(f.key, f.state.records); f.cloud.release('seed')
  await Promise.all(Array.from({ length: 4 }, (_, i) => f.open(`window-${i}`)))
  const before = f.persisted(), write = vi.spyOn(f.store, 'write')
  f.reset(); f.state.title = 'renamed'; f.state.updated++
  const frames = await Promise.all(Array.from({ length: 4 }, (_, i) => f.poll(`window-${i}`)))
  expect(f.post.mock.calls).toHaveLength(4)
  expect(f.post.mock.calls.every(([path]) => path.endsWith('/sessions/metadata'))).toBe(true)
  expect(write).toHaveBeenCalledExactlyOnceWith(f.key, [], expect.objectContaining({ projections: { asOfSeq: 59, values: { title: 'renamed' } } }))
  for (const frame of frames) expect(frame).toMatchObject({ items: [{ projections: { values: { title: 'renamed' } } }] })
  expect(f.counts()).toEqual({ insert: 0, update: 0, delete: 0 }); expect(f.persisted()).toEqual(before)
  f.reset(); write.mockClear(); f.state.updated++
  for (let round = 0; round < 20; round++) await Promise.all(Array.from({ length: 4 }, (_, i) => f.poll(`window-${i}`)))
  expect(f.post.mock.calls).toHaveLength(80); expect(write).not.toHaveBeenCalled()
  expect(f.counts()).toEqual({ insert: 0, update: 0, delete: 0 })
  for (let i = 0; i < 4; i++) f.cloud.release(`window-${i}`)
  expect(Array.from({ length: 4 }, (_, i) => f.cloud.has(`window-${i}`))).toEqual([false, false, false, false])
})

it('appends only new events while retaining all cached older pages in the same generation', async () => {
  const f = fixture(); await f.open('active'); f.store.write(f.key, f.state.records)
  f.reset(); f.state.records = turns(11)
  await f.poll('active')
  expect(f.counts()).toEqual({ insert: 6, update: 0, delete: 0 })
  expect(f.persisted()).toEqual(f.state.records)
  expect(f.store.page(f.key, 65, 30)?.records).toEqual(f.state.records.slice(0, 30))
  f.reset(); await f.poll('active'); expect(f.counts()).toEqual({ insert: 0, update: 0, delete: 0 })
})

it('migration generations still remove all stale cached events before publishing replacement history', async () => {
  const f = fixture(); await f.open('active'); f.store.write(f.key, f.state.records)
  f.reset(); f.state.generation = 'migrated'; f.state.records = turns(10).map(r => ({ ...r, event: { ...r.event, data: { text: `replaced-${r.event.seq}` } } }))
  await f.poll('active')
  expect(f.counts()).toEqual({ insert: 30, update: 0, delete: 60 })
  expect(f.persisted()).toEqual(f.state.records.slice(30)); expect(f.store.page(f.key, 59, 30)).toBeUndefined()
})

it('unversioned and previous-format caches get one verified replacement, then become warm', async () => {
  for (const legacyRevision of [undefined, JSON.stringify(['generation-1', null, 59, 59, null, null, null, 1, 'original'])]) {
    const f = fixture(); f.store.write(f.key, turns(11), { cursor: 65, cloudRevision: legacyRevision })
    f.reset(); await f.open('upgrade')
    expect(f.counts()).toEqual({ insert: 30, update: 0, delete: 66 })
    expect(f.persisted()).toEqual(f.state.records.slice(30))
    f.cloud.release('upgrade'); f.reset(); await f.open('warm')
    expect(f.post.mock.calls).toHaveLength(1); expect(f.counts()).toEqual({ insert: 0, update: 0, delete: 0 })
  }
})

it('same-generation rewinds still discard events beyond the authoritative cursor', async () => {
  const f = fixture(); await f.open('active'); f.store.write(f.key, f.state.records)
  f.reset(); f.state.records = turns(2); await f.poll('active')
  expect(f.counts()).toEqual({ insert: 12, update: 0, delete: 60 }); expect(f.persisted()).toEqual(f.state.records)
})

it('warm cache never bypasses account ownership validation', async () => {
  const f = fixture(); await f.open('active'); f.state.owned = false; f.reset()
  await expect(f.poll('active')).rejects.toMatchObject({ code: 'REMOTE_NOT_FOUND' })
  expect(f.counts()).toEqual({ insert: 0, update: 0, delete: 0 })
})
