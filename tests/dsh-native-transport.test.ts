import { afterEach, expect, it, vi } from 'vitest'
import { DshNativeTransport } from '../src/dsh-remote/native-transport.js'
import { parseDshRemoteRequest } from '../src/dsh-remote/protocol-v1.js'

const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.useRealTimers() })
function fixture(frames: unknown[] = [], result: unknown = { ok: true, value: { accepted: true } }) {
  const controller = new AbortController()
  const owned = vi.fn(async (ids: string[]) => new Set(ids.filter(id => id === 'mine')))
  const close = vi.fn(), fetch = vi.fn(async () => Response.json({ result }))
  const open = vi.fn(async (_endpoint, _payload, signal: AbortSignal) => ({ async *[Symbol.asyncIterator]() { try { yield* frames; await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }) }) } finally { close() } } }))
  const relay = new DshNativeTransport({ invoke: vi.fn(), stream: vi.fn(), wireStream: { open } }, { createSharedFetchHandler: () => ({ fetch }) })
  cleanups.push(() => relay.close())
  return { relay, scope: { accountId: '3016', createSessionId: 'new-session', claim: vi.fn(async () => {}), signal: controller.signal, owned }, controller, fetch, open, close }
}
it('forwards native journal snapshots unchanged and cancels the actual source iterator', async () => {
  const snapshot = { type: 'snapshot', cursor: 5, header: { id: 'mine' }, records: [{ event: { type: 'assistant/message', seq: 5, surfaceOp: 'append', data: { content: [{ type: 'text', text: '原生正文' }] } } }], projections: { asOfSeq: 5, values: { unknownFutureProjection: true } } }
  const f = fixture([snapshot])
  expect(await f.relay.request({ mode: 'pull', streamRef: 'stream-0001', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'mine' }, assistantStream: true } } } }, f.scope)).toEqual({ items: [snapshot] })
  await f.relay.request({ mode: 'close', streamRef: 'stream-0001' }, f.scope)
  await vi.waitFor(() => expect(f.close).toHaveBeenCalledOnce())
})
it('rejects foreign sessions and privileged services before native dispatch', async () => {
  const f = fixture()
  for (const [endpoint, args] of [['session/prompt', { request: { sessionId: 'foreign' } }], ['credentials/set', { ref: 'api-key', value: 'x' }], ['settings/get', {}], ['commands/execute', { agent: 'foreign' }]] as const) {
    await expect(f.relay.request({ mode: 'call', endpoint, payload: { args } }, f.scope)).rejects.toMatchObject({ code: expect.stringMatching(/REMOTE_NOT_FOUND|CAPABILITY_UNSUPPORTED/) })
  }
  expect(f.fetch).not.toHaveBeenCalled()
  await f.relay.request({ mode: 'call', endpoint: 'session/prompt', payload: { args: { request: { sessionId: 'mine', content: [] } } } }, f.scope)
  expect(f.fetch).toHaveBeenCalledOnce()
})
it('filters session lists, control baselines and workspace snapshots at the source', async () => {
  const f = fixture([], { ok: true, value: { items: [{ sessionId: 'mine' }, { sessionId: 'foreign' }] } })
  expect(await f.relay.request({ mode: 'call', endpoint: 'session/list', payload: { args: { _request: {} } } }, f.scope)).toEqual({ ok: true, value: { items: [{ sessionId: 'mine' }] } })
  const c = fixture([{ type: 'baseline', value: { queues: { mine: [], foreign: ['secret'] }, jobs: { foreign: ['secret'] }, projections: { mine: { asOfSeq: 1 } } } }])
  expect(await c.relay.request({ mode: 'pull', streamRef: 'control-001', endpoint: 'session/control', payload: { args: {} } }, c.scope)).toEqual({ items: [{ type: 'baseline', value: { queues: { mine: [] }, jobs: {}, projections: { mine: { asOfSeq: 1 } } } }] })
  const w = fixture([{ type: 'baseline', value: { items: [{ workspaceId: 'w', sessionIds: ['mine', 'foreign'] }, { workspaceId: 'private', path: 'secret', sessionIds: ['foreign'] }], archivedSessionIds: ['mine', 'foreign'] } }])
  expect(await w.relay.request({ mode: 'pull', streamRef: 'workspace-001', endpoint: 'workspace/follow', payload: { args: {} } }, w.scope)).toEqual({ items: [{ type: 'baseline', value: { items: [{ workspaceId: 'w', sessionIds: ['mine'] }], archivedSessionIds: ['mine'] } }] })
})
it('delegates foreign waterfalls and binds replies to the owned native event generation', async () => {
  const f = fixture([{ type: 'ready', clientId: 'client', host: { home: '/home' } }, { type: 'waterfall', eventId: 'foreign-event', agentId: 'foreign', event: 'approval/request' }, { type: 'waterfall', eventId: 'mine-event', agentId: 'mine', event: 'user-questions/request' }])
  expect(await f.relay.request({ mode: 'pull', streamRef: 'events-0001', endpoint: '$events', payload: { args: {} } }, f.scope)).toMatchObject({ items: [{ type: 'ready' }, { eventId: 'mine-event' }] })
  expect(JSON.parse(await f.fetch.mock.calls[0]![0].text()).payload.args.outcome).toEqual({ kind: 'next' })
  await expect(f.relay.request({ mode: 'call', endpoint: '$events/result', payload: { args: { clientId: 'client', eventId: 'foreign-event' } } }, f.scope)).rejects.toMatchObject({ code: 'REMOTE_NOT_FOUND' })
  await expect(f.relay.request({ mode: 'call', endpoint: '$events/result', payload: { args: { clientId: 'client', eventId: 'mine-event', outcome: { kind: 'next' } } } }, f.scope)).resolves.toMatchObject({ ok: true })
})
it('rejects stale accounts and closes native subscriptions', async () => {
  const f = fixture([{ type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } }])
  await f.relay.request({ mode: 'pull', streamRef: 'control-001', endpoint: 'session/control', payload: { args: {} } }, f.scope)
  await expect(f.relay.request({ mode: 'pull', streamRef: 'control-001' }, { ...f.scope, accountId: 'other' })).rejects.toMatchObject({ code: 'REMOTE_REQUEST_INVALID' })
  f.relay.close()
  await vi.waitFor(() => expect(f.close).toHaveBeenCalledOnce())
  await expect(f.relay.request({ mode: 'pull', streamRef: 'control-001' }, f.scope)).rejects.toMatchObject({ code: 'REMOTE_NOT_FOUND', retryable: true })
  f.controller.abort()
  await expect(f.relay.request({ mode: 'call', endpoint: 'session/list', payload: { args: {} } }, f.scope)).rejects.toThrow()
})
it('validates native envelopes before accepting the transport operation', () => {
  const base = { protocol: 'dsh.remote', protocol_major: 1, kind: 'request', request_ref: 'native-0001', host_generation: 1, issued_at: 1000, execute_before: 2000, operation: 'session.native' }
  const parse = (body: unknown) => parseDshRemoteRequest({ ...base, body }, { expectedHostGeneration: 1, nowMillis: 1000 })
  expect(parse({ mode: 'call', endpoint: 'session/list', payload: { args: {} } }).operation).toBe('session.native')
  for (const body of [{ mode: 'unsafe' }, { mode: 'pull', streamRef: 'x' }, { mode: 'call', endpoint: '../credentials', payload: { args: {} } }, { mode: 'call', endpoint: 'session/list', payload: {} }]) expect(() => parse(body)).toThrow()
})

it('reserves native creations before publication and rejects failed ownership claims without creating', async () => {
  const f = fixture()
  await f.relay.request({ mode: 'call', endpoint: 'session/create', payload: { args: { request: { workspaceId: 'workspace' } } } }, f.scope)
  expect(f.scope.claim).toHaveBeenCalledWith('new-session')
  expect(f.scope.claim.mock.invocationCallOrder[0]).toBeLessThan(f.fetch.mock.invocationCallOrder[0]!)
  expect(JSON.parse(await f.fetch.mock.calls[0]![0].text()).payload.args.request.sessionId).toBe('new-session')
  f.scope.claim.mockRejectedValueOnce(new Error('account changed'))
  await expect(f.relay.request({ mode: 'call', endpoint: 'session/create', payload: { args: { request: {} } } }, f.scope)).rejects.toThrow('account changed')
  expect(f.fetch).toHaveBeenCalledOnce()
})

it('cuts source follow and older pages at five real turns and sends only the cached-tail delta', async () => {
  const records = Array.from({ length: 42 }, (_, seq) => ({ type: 'event', event: { seq, type: seq % 6 === 0 ? 'turn/start' : 'assistant/message', data: {} } }))
  const snapshot = { type: 'snapshot', cursor: 41, records, hasMore: false }
  const f = fixture([snapshot])
  const result = await f.relay.request({ mode: 'pull', streamRef: 'five-turns', endpoint: 'session/follow', afterSeq: 35, payload: { args: { request: { address: { kind: 'session', sessionId: 'mine' } } } } }, f.scope)
  expect(result).toEqual({ items: [{ ...snapshot, records: records.slice(36), hasMore: true }] })
  const page = fixture([], { ok: true, value: { records, hasMore: false } })
  expect(await page.relay.request({ mode: 'call', endpoint: 'session/page', payload: { args: { request: { address: { kind: 'session', sessionId: 'mine' }, throughSeq: 41 } } } }, page.scope)).toEqual({ ok: true, value: { records: records.slice(12), hasMore: true } })
})
it('validates history resume cursors without accepting them on writes or unrelated streams', () => {
  const base = { protocol: 'dsh.remote', protocol_major: 1, kind: 'request', request_ref: 'resume-request', host_generation: 1, issued_at: 1000, execute_before: 2000, operation: 'session.native' }
  const body = { mode: 'pull', endpoint: 'session/follow', streamRef: 'resume-stream', payload: { args: {} }, afterSeq: 10 }
  const parse = (value: unknown) => parseDshRemoteRequest({ ...base, body: value }, { expectedHostGeneration: 1, nowMillis: 1000 })
  expect(parse(body).body.afterSeq).toBe(10)
  for (const invalid of [-2, 0.5, '10', Number.MAX_SAFE_INTEGER + 1]) expect(() => parse({ ...body, afterSeq: invalid })).toThrow()
  expect(() => parse({ ...body, mode: 'call', endpoint: 'session/prompt' })).toThrow()
})
