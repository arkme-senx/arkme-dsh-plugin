import { afterEach, expect, it, vi } from 'vitest'
import { DshCloudNativeTransport } from '../src/dsh-remote/cloud-native-transport.js'

const history = { mode: 'pull', streamRef: 'history', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'empty' } } } } }
function fixture() {
  const post = vi.fn(async (path: string): Promise<Record<string, unknown>> => {
    if (path.endsWith('/sessions/list')) return { items: [{ session_ref: 'empty', title: '空会话', blank: true, source_updated_at: 10 }] }
    if (path.endsWith('/session-events/list')) return { entries: [], complete: true }
    if (path.endsWith('/session-turn-objects/list')) return { items: null, committed_turn_count: 0, has_more: false }
    throw new Error(path)
  })
  const cloud = new DshCloudNativeTransport({ post })
  const call = (body = history, id = 'account:runtime:stream', signal = new AbortController().signal) => cloud.call('runtime', body, id, signal)
  return { cloud, call, post }
}
afterEach(() => vi.useRealTimers())
it('opens a verified empty cloud session in the native renderer without contacting the source', async () => {
  const f = fixture()
  expect(await f.call()).toMatchObject({ items: [{ type: 'snapshot', cursor: -1, records: [], hasMore: false, assistantStream: { revision: 0 }, projections: { values: { title: '空会话' } } }] })
  expect(f.post).toHaveBeenCalledTimes(3)
  f.cloud.close()
})
it('never treats invalid turn indexes, old raw events, missing ownership, or a server failure as empty history', async () => {
  const f = fixture(), post = f.post.getMockImplementation()!
  f.post.mockImplementation(async path => path.endsWith('/session-turn-objects/list') ? { items: [{ object_ref: 'history' }] } : post(path))
  await expect(f.call()).rejects.toMatchObject({ code: 'REMOTE_INVALID_RESPONSE' })
  f.post.mockImplementation(async path => path.endsWith('/session-events/list') ? { entries: [{ event: { seq: 0, time: 1, type: 'user/message', data: {} } }] } : post(path))
  await expect(f.call()).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
  f.post.mockRejectedValue(new Error('server unavailable'))
  await expect(f.call()).rejects.toThrow('server unavailable')
  f.post.mockResolvedValue({ items: [] })
  await expect(f.call()).rejects.toMatchObject({ code: 'REMOTE_NOT_FOUND' })
  expect(f.cloud.has('account:runtime:stream')).toBe(false)
})
it('bounds cloud subscriptions, prevents a polling loop, and cancels pending reads on close', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const opening = { mode: 'pull', endpoint: '$events', payload: { args: {} } } as never
  await f.call(opening)
  const controller = new AbortController()
  const next = f.call({ mode: 'pull' } as never, undefined, controller.signal)
  await expect(f.call({ mode: 'pull' } as never)).rejects.toMatchObject({ code: 'REMOTE_REQUEST_INVALID' })
  expect(f.post).not.toHaveBeenCalled()
  const cancelled = expect(next).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort(); await cancelled
  const pending = f.call({ mode: 'pull' } as never)
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  f.cloud.close(); await rejected
  for (let i = 0; i < 64; i++) await f.call(opening, String(i))
  await expect(f.call(opening, 'overflow')).rejects.toMatchObject({ code: 'RUNTIME_LIMIT_REACHED' })
  await vi.advanceTimersByTimeAsync(46_000)
  await f.call(opening, 'new')
  expect(f.cloud.has('0')).toBe(false)
  await expect(f.call({ mode: 'pull' } as never, '0')).rejects.toMatchObject({ code: 'REMOTE_NOT_FOUND', retryable: true })
  f.cloud.close()
})
it('rejects execution and arbitrary APIs in cloud mode', async () => {
  const f = fixture()
  for (const endpoint of ['session/prompt', 'session/rename', 'commands/execute']) {
    await expect(f.call({ mode: 'call', endpoint, payload: { args: {} } } as never)).rejects.toMatchObject({ code: 'RUNTIME_OFFLINE' })
  }
  expect(f.post).not.toHaveBeenCalled()
})

it('rechecks a previously empty cache instead of hiding newly uploaded server history', async () => {
  const f = fixture(), post = f.post.getMockImplementation()!
  f.post.mockImplementation(async path => path.endsWith('/session-turn-objects/list') ? { items: [{ object_ref: 'new-history' }] } : post(path))
  const cache = { key: () => 'owned-key', store: { snapshot: () => ({ cursor: -1 }), page: vi.fn(() => ({ records: [], hasMore: false })), write: vi.fn() } }
  await expect(f.cloud.call('runtime', history, 'stream', new AbortController().signal, cache)).rejects.toMatchObject({ code: 'REMOTE_INVALID_RESPONSE' })
  expect(cache.store.page).not.toHaveBeenCalled()
})
