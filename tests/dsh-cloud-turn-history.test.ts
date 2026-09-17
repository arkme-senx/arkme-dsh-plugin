import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { readCloudTurnHistory } from '../src/dsh-remote/cloud-turn-history.js'
import { DshCloudNativeTransport } from '../src/dsh-remote/cloud-native-transport.js'
import { DshNativeHistoryCache } from '../src/dsh-remote/native-history-cache.js'
import type { NativeHistoryRecord } from '../src/dsh-remote/native-history.js'

// The plugin's development peer is older than the native desktop runtime.
// These spies verify delegation; the installed rc2 validators are checked separately.
vi.mock('@deepseek-ai/dsh-session/surface', () => ({
  validateSurfaceMetadata: vi.fn((event: any) => {
    if (['user/message', 'assistant/message', 'tool/result'].includes(event.type) && !event.surfaceOp) throw new Error('missing surface marker')
  }),
  validateSessionEventData: vi.fn(),
}))
const identity = { runtime_ref: 'runtime', session_ref: 'session' }
const cleanups: Array<() => void> = []
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); cleanups.splice(0).reverse().forEach(fn => fn()) })
const record = (entry: any): NativeHistoryRecord => ({ type: 'event', event: entry.event })
function turn(start: number) {
  const events = ['turn/start', 'user/message', 'assistant/message', 'turn/end'].map((type, offset) => ({
    event: { type, seq: start + offset, time: 1, data: type === 'user/message'
      ? { source: { kind: 'user' }, role: 'user', content: [{ type: 'text', text: `question ${start}` }] }
      : type === 'assistant/message' ? { message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] } } : {},
    ...(type.endsWith('/message') ? { surfaceOp: 'append' } : {}) },
  }))
  const value = { schema: 'dsh.turn.v1', turn: { turn_ref: `turn-${start}`, start_seq: start, end_seq: start + 3, status: 'completed' }, presentation: { version: 1, nodes: [] }, events, integrity: { event_count: 4 } }
  const bytes = gzipSync(JSON.stringify(value))
  const index = { ...value.turn, object_ref: `object-${start}`, event_count: 4, compressed_bytes: bytes.length, content_sha256: createHash('sha256').update(bytes).digest('hex') }
  return { value, bytes, index }
}
function fixture(starts: number[] = [0]) {
  const objects = starts.map(turn).reverse()
  const post = vi.fn(async (path: string, body: any): Promise<Record<string, unknown>> => {
    if (path.endsWith('/sessions/list')) return { items: [{ session_ref: 'session', title: '远端会话', history_storage_version: 'oss_turn_v1', source_updated_at: 1 }] }
    if (path.endsWith('/session-events/list')) return { entries: [], complete: true }
    if (path.endsWith('/session-turn-objects/list')) {
      const offset = Number(body.cursor ?? 0), items = objects.slice(offset, offset + body.limit).map(o => o.index)
      const more = offset + items.length < objects.length
      return { items, has_more: more, ...(more ? { next_cursor: String(offset + items.length) } : {}) }
    }
    if (path.endsWith('/session-turn-objects/read')) return { object_ref: body.object_ref, download_url: `https://history.example/${body.object_ref}`, expires_at: Date.now() + 60_000 }
    throw new Error(path)
  })
  const fetcher = vi.fn(async (url: URL | string) => {
    const item = objects.find(o => new URL(String(url)).pathname === `/${o.index.object_ref}`)!
    return new Response(item.bytes, { headers: { 'content-length': String(item.bytes.length) } })
  })
  vi.stubGlobal('fetch', fetcher)
  const cloud = new DshCloudNativeTransport({ post })
  cleanups.push(() => cloud.close())
  const body = { mode: 'pull', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'session' } } } } }
  const read = (before?: number, signal = new AbortController().signal) => readCloudTurnHistory({ post }, identity, signal, before, record)
  return { objects, post, fetcher, cloud, body, read }
}

it('reads exactly five native turns and uses seq bounds to select older objects', async () => {
  const f = fixture(Array.from({ length: 12 }, (_, i) => i * 4))
  const first = await f.read()
  expect(first).toEqual({ records: f.objects.slice(0, 5).reverse().flatMap(o => o.value.events.map(record)), hasMore: true })
  expect(f.fetcher).toHaveBeenCalledTimes(5)
  const older = await f.read(28)
  expect(older?.records.map(r => r.event.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 8))
  expect(f.fetcher).toHaveBeenCalledTimes(10)
  expect(f.fetcher.mock.calls[0]?.[0]).toBeInstanceOf(URL)
  const last = await f.read(8)
  expect(last?.hasMore).toBe(false)
  expect(last?.records).toHaveLength(8)
})

it('scans only metadata when the requested older page is beyond the first index page', async () => {
  const f = fixture(Array.from({ length: 110 }, (_, i) => i * 4))
  const value = await f.read(16)
  expect(value?.records.at(-1)?.event.seq).toBe(15)
  expect(f.post.mock.calls.filter(([path]) => path.endsWith('/list'))).toHaveLength(2)
  expect(f.fetcher).toHaveBeenCalledTimes(4)
})

it('opens native cloud snapshots, persists older pages and reuses SQLite after reopening', async () => {
  const f = fixture(Array.from({ length: 7 }, (_, i) => i * 4))
  const directory = mkdtempSync(join(tmpdir(), 'cloud native history '))
  cleanups.push(() => rmSync(directory, { force: true, recursive: true }))
  let store = new DshNativeHistoryCache(directory)
  cleanups.push(() => store.close())
  const key = DshNativeHistoryCache.key('3016', 'runtime', { kind: 'session', sessionId: 'session' })
  const cache = () => ({ store, key: () => key })
  const opened = await f.cloud.call('runtime', f.body, 'open', new AbortController().signal, cache()) as any
  expect(opened.items[0]).toMatchObject({ cursor: 27, assistantStream: { revision: 0 }, hasMore: true })
  expect(opened.items[0].records.map((r: any) => r.event.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 8))
  const older = { mode: 'call', endpoint: 'session/page', payload: { args: { request: { address: { kind: 'session', sessionId: 'session' }, throughSeq: 27, beforeSeq: 8 } } } }
  expect(await f.cloud.call('runtime', older, 'older', new AbortController().signal, cache())).toMatchObject({ ok: true, value: { hasMore: false } })
  const downloads = f.fetcher.mock.calls.length
  store.close(); store = new DshNativeHistoryCache(directory)
  await f.cloud.call('runtime', older, 'cached', new AbortController().signal, cache())
  expect(f.fetcher).toHaveBeenCalledTimes(downloads)
})

it('merges the raw tail and between-turn records without renumbering or overwriting conflicts', async () => {
  const f = fixture([0, 5]), original = f.post.getMockImplementation()!
  const raw = [4, 9].map(seq => ({ event: { seq, time: 1, type: 'session/config', data: {} } }))
  f.post.mockImplementation(async (path, body) => path.endsWith('/session-events/list') ? { entries: raw.filter(e => body.before_seq === undefined || e.event.seq < body.before_seq) } : original(path, body))
  const result = await f.cloud.call('runtime', f.body, 'stream', new AbortController().signal) as any
  expect(result.items[0].records.map((r: any) => r.event.seq)).toEqual(Array.from({ length: 10 }, (_, i) => i))
  f.post.mockImplementation(async (path, body) => path.endsWith('/session-events/list') ? { entries: [f.objects[1]!.value.events[0], { event: { seq: 1, time: 1, type: 'turn/end', data: {} } }] } : original(path, body))
  await expect(f.cloud.call('runtime', f.body, 'conflict', new AbortController().signal)).rejects.toMatchObject({ code: 'REMOTE_PROJECTION_CONFLICT' })
})

it('honors throughSeq even when beforeSeq is newer and does not persist signed grants', async () => {
  const f = fixture([0, 4, 8])
  const result = await f.cloud.call('runtime', { mode: 'call', endpoint: 'session/page', payload: { args: { request: { address: { kind: 'session', sessionId: 'session' }, throughSeq: 3, beforeSeq: 50 } } } }, 'bounded', new AbortController().signal) as any
  expect(result.value.records.map((r: any) => r.event.seq)).toEqual([0, 1, 2, 3])
  expect(JSON.stringify(result)).not.toMatch(/history.example|download_url|content_sha256/)
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})

it.each(['digest', 'size', 'schema', 'count', 'range', 'gap'])('rejects %s corruption instead of displaying empty history', async kind => {
  const f = fixture(), item = f.objects[0]!
  if (kind === 'digest') item.index.content_sha256 = '0'.repeat(64)
  else if (kind === 'size') item.index.compressed_bytes++
  else {
    if (kind === 'schema') item.value.schema = 'wrong'
    if (kind === 'count') item.value.integrity.event_count++
    if (kind === 'range') item.value.turn.end_seq++
    if (kind === 'gap') item.value.events[1]!.event.seq++
    item.bytes = gzipSync(JSON.stringify(item.value))
    item.index.compressed_bytes = item.bytes.length
    item.index.content_sha256 = createHash('sha256').update(item.bytes).digest('hex')
  }
  await expect(f.read()).rejects.toThrow()
})

it('checks native surface metadata only after reading the actual cloud events', async () => {
  const f = fixture(), item = f.objects[0]!
  delete item.value.events[1]!.event.surfaceOp
  item.bytes = gzipSync(JSON.stringify(item.value)); item.index.compressed_bytes = item.bytes.length
  item.index.content_sha256 = createHash('sha256').update(item.bytes).digest('hex')
  await expect(f.cloud.call('runtime', f.body, 'invalid', new AbortController().signal)).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
  expect(f.fetcher).toHaveBeenCalledOnce()
})

it('does not let unsupported old raw entries outside the requested five turns hide valid cloud history', async () => {
  const f = fixture([4, 8, 12, 16, 20]), original = f.post.getMockImplementation()!
  f.post.mockImplementation(async (path, body) => path.endsWith('/session-events/list')
    ? { entries: [{ event: { seq: 1, time: 1, type: 'user/message', data: {} } }] } : original(path, body))
  const result = await f.cloud.call('runtime', f.body, 'five-valid', new AbortController().signal) as any
  expect(result.items[0].records).toHaveLength(20)
  expect(result.items[0].records[0].event.seq).toBe(4)
})

it('rejects unsafe or expired grants before downloading and sends no account credentials', async () => {
  for (const override of [{ download_url: 'http://history.example/file' }, { download_url: 'https://user:password@history.example/file' }, { expires_at: 1 }, { download_headers: { Authorization: 'secret' } }]) {
    const f = fixture(), original = f.post.getMockImplementation()!
    f.post.mockImplementation(async (path, body) => ({ ...await original(path, body), ...(path.endsWith('/read') ? override : {}) }))
    await expect(f.read()).rejects.toThrow()
    expect(f.fetcher).not.toHaveBeenCalled()
  }
  const f = fixture(); await f.read()
  const options = (f.fetcher.mock.calls[0] as any)[1]
  expect(options).toMatchObject({ redirect: 'error', credentials: 'omit', method: 'GET' })
  expect(options.headers.get('authorization')).toBeNull()
})

it('aborts downloads when the consumer leaves and never writes a partial snapshot', async () => {
  const f = fixture(), controller = new AbortController()
  f.fetcher.mockImplementation((_url, options?: any) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    controller.abort(new DOMException('cancelled', 'AbortError'))
  }))
  const cache = { key: () => 'key', store: { snapshot: () => undefined, page: () => undefined, write: vi.fn() } }
  await expect(f.cloud.call('runtime', f.body, 'cancel', controller.signal, cache)).rejects.toMatchObject({ name: 'AbortError' })
  expect(cache.store.write).not.toHaveBeenCalled()
  expect(f.cloud.has('cancel')).toBe(false)
})

it('fails closed on missing ownership, incomplete journals and repeated index cursors', async () => {
  const foreign = fixture(), original = foreign.post.getMockImplementation()!
  foreign.post.mockImplementation(async (path, body) => path.endsWith('/sessions/list') ? { items: [] } : original(path, body))
  await expect(foreign.cloud.call('runtime', foreign.body, 'foreign', new AbortController().signal)).rejects.toMatchObject({ code: 'REMOTE_NOT_FOUND' })
  expect(foreign.fetcher).not.toHaveBeenCalled()
  const gap = fixture([0, 5])
  await expect(gap.cloud.call('runtime', gap.body, 'gap', new AbortController().signal)).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
  const repeated = fixture([8]), source = repeated.post.getMockImplementation()!
  repeated.post.mockImplementation(async (path, body) => path.endsWith('/list') ? { items: [repeated.objects[0]!.index], has_more: true, next_cursor: 'same' } : source(path, body))
  await expect(repeated.read(4)).rejects.toMatchObject({ code: 'REMOTE_INVALID_RESPONSE' })
})

it('bounds decompression and rejects oversized indexes before downloading', async () => {
  const oversized = fixture()
  oversized.objects[0]!.index.compressed_bytes = 64 * 1024 * 1024 + 1
  await expect(oversized.read()).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
  expect(oversized.fetcher).not.toHaveBeenCalled()
  const bomb = fixture(), item = bomb.objects[0]!
  item.bytes = gzipSync(Buffer.alloc(64 * 1024 * 1024 + 1, 32))
  item.index.compressed_bytes = item.bytes.length
  item.index.content_sha256 = createHash('sha256').update(item.bytes).digest('hex')
  await expect(bomb.read()).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
})

it('reports download failures and cancels a stalled cloud request after its deadline', async () => {
  const failed = fixture()
  failed.fetcher.mockResolvedValue(new Response('unavailable', { status: 503 }))
  await expect(failed.read()).rejects.toMatchObject({ code: 'REMOTE_NETWORK_UNAVAILABLE' })
  const stalled = fixture(), controller = new AbortController()
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
  stalled.fetcher.mockImplementation((_url, options?: any) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    controller.abort(new DOMException('timeout', 'TimeoutError'))
  }))
  try {
    await expect(stalled.cloud.call('runtime', stalled.body, 'timeout', new AbortController().signal)).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(timeout).toHaveBeenCalledWith(30_000)
    expect(stalled.cloud.has('timeout')).toBe(false)
  } finally { timeout.mockRestore() }
})
