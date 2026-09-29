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
it('retries an account-owned session handed to another executor without admitting foreign or missing sessions', async () => {
  const f = fixture()
  const request = { mode: 'pull', streamRef: 'handoff', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'moved' } } } } }
  for (const account of ['3016', 'other', undefined]) {
    await expect(f.relay.request(request, { ...f.scope, ownerAccountId: async () => account })).rejects.toMatchObject(
      account === '3016' ? { code: 'SESSION_STATE_CHANGED', retryable: true } : { code: 'REMOTE_NOT_FOUND', retryable: false },
    )
  }
  expect(f.open).not.toHaveBeenCalled()
  expect(f.fetch).not.toHaveBeenCalled()
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

it('keeps an established native lease beyond the first pull deadline and cancels only its active pull', async () => {
  vi.useFakeTimers()
  const f = fixture([{ type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } }])
  const first = f.relay.request({ mode: 'pull', streamRef: 'long-lived', endpoint: 'session/control', payload: { args: {} } }, f.scope)
  await vi.advanceTimersByTimeAsync(3)
  await expect(first).resolves.toMatchObject({ items: [{ type: 'baseline' }] })
  // The completed request's 30s deadline must not own this live subscription.
  await vi.advanceTimersByTimeAsync(30_000)
  f.controller.abort(new Error('completed request expired'))
  expect(f.open.mock.calls[0]![2].aborted).toBe(false)
  const active = new AbortController()
  for (let i = 0; i < 2; i++) {
    const renewed = f.relay.request({ mode: 'pull', streamRef: 'long-lived' }, { ...f.scope, signal: active.signal })
    await vi.advanceTimersByTimeAsync(20_001)
    await expect(renewed).resolves.toEqual({ items: [] })
  }
  expect(f.open.mock.calls[0]![2].aborted).toBe(false)
  const next = f.relay.request({ mode: 'pull', streamRef: 'long-lived' }, { ...f.scope, signal: active.signal })
  const cancelled = expect(next).rejects.toThrow('active pull cancelled')
  await vi.advanceTimersByTimeAsync(1)
  active.abort(new Error('active pull cancelled'))
  await cancelled
  expect(f.open).toHaveBeenCalledOnce()
  expect(f.open.mock.calls[0]![2].aborted).toBe(true)
})

it('still expires idle native leases and closes a source whose opening request is cancelled', async () => {
  vi.useFakeTimers()
  const f = fixture([{ type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } }])
  const first = f.relay.request({ mode: 'pull', streamRef: 'idle', endpoint: 'session/control', payload: { args: {} } }, f.scope)
  await vi.advanceTimersByTimeAsync(3); await first
  await vi.advanceTimersByTimeAsync(45_001)
  expect(f.open.mock.calls[0]![2].aborted).toBe(true)
  const opening = fixture()
  opening.open.mockImplementation(async (_endpoint, _payload, signal) => {
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    signal.throwIfAborted()
    return { async *[Symbol.asyncIterator]() {} }
  })
  const pending = opening.relay.request({ mode: 'pull', streamRef: 'opening', endpoint: 'session/control', payload: { args: {} } }, opening.scope)
  const aborted = expect(pending).rejects.toThrow('opening cancelled')
  await vi.advanceTimersByTimeAsync(1)
  opening.controller.abort(new Error('opening cancelled'))
  await aborted
})

it('does not let a cancelled old pull release its replacement with the same stream ref', async () => {
  vi.useFakeTimers()
  const f = fixture([{ type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } }])
  let finishOld!: (value: IteratorResult<unknown>) => void
  f.open.mockImplementationOnce(async () => {
    let initial = true
    return { [Symbol.asyncIterator]: () => ({
      next: () => initial ? (initial = false, Promise.resolve({ done: false as const, value: { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } } }))
        : new Promise<IteratorResult<unknown>>(resolve => { finishOld = resolve }),
      return: async () => ({ done: true as const, value: undefined }),
    }) }
  })
  const body = { mode: 'pull', streamRef: 'reused', endpoint: 'session/control', payload: { args: {} } }
  const first = f.relay.request(body, f.scope)
  await vi.advanceTimersByTimeAsync(3); await first
  const active = new AbortController()
  const old = f.relay.request({ mode: 'pull', streamRef: 'reused' }, { ...f.scope, signal: active.signal })
  const cancelled = expect(old).rejects.toThrow('old cancelled')
  await vi.advanceTimersByTimeAsync(1)
  active.abort(new Error('old cancelled'))
  const replacement = f.relay.request(body, f.scope)
  await vi.advanceTimersByTimeAsync(3); await replacement
  finishOld({ done: true, value: undefined }); await cancelled
  expect(f.open).toHaveBeenCalledTimes(2)
  expect(f.open.mock.calls[1]![2].aborted).toBe(false)
})

it.each([1, 2, 4, 8])('shares one native history page for %i concurrent authorized observers', async observers => {
  const snapshot = { type: 'snapshot', cursor: 10, records: [{ type: 'event', event: { seq: 10, type: 'turn/start' } }], hasMore: true }
  const older = { records: Array.from({ length: 10 }, (_, seq) => ({ type: 'event', event: { seq, type: seq % 2 ? 'assistant/message' : 'turn/start' } })), hasMore: false }
  const f = fixture([snapshot], { ok: true, value: older })
  const results = await Promise.all(Array.from({ length: observers }, (_, i) => f.relay.request({ mode: 'pull', streamRef: `observer-${i}`, endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'mine' } } } } }, f.scope)))
  console.log(JSON.stringify({ workload: 'native-follow-page', observers, nativePages: f.fetch.mock.calls.length, nativeStreams: f.open.mock.calls.length }))
  expect(f.fetch).toHaveBeenCalledOnce()
  expect(f.open).toHaveBeenCalledTimes(observers)
  expect(results.every(value => JSON.stringify(value) === JSON.stringify(results[0]))).toBe(true)
})

it('separates page scopes and cursors, detaches a reader, and closes outstanding native reads', async () => {
  const page = { records: [], hasMore: false }, f = fixture([], { ok: true, value: page })
  const signals: AbortSignal[] = [], resolve: Array<() => void> = []
  f.fetch.mockImplementation(async (request: Request) => {
    signals.push(request.signal)
    await new Promise<void>((yes, no) => { resolve.push(yes); request.signal.addEventListener('abort', () => no(request.signal.reason), { once: true }) })
    return Response.json({ result: { ok: true, value: page } })
  })
  const body = (throughSeq = 20) => ({ mode: 'call', endpoint: 'session/page', payload: { args: { request: { address: { kind: 'session', sessionId: 'mine' }, throughSeq } } } })
  const departing = new AbortController()
  const first = f.relay.request(body(), { ...f.scope, signal: departing.signal }).catch(error => error)
  const second = f.relay.request(body(), f.scope)
  const otherAccount = f.relay.request(body(), { ...f.scope, accountId: 'other' })
  const otherCursor = f.relay.request(body(21), f.scope)
  await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(3))
  departing.abort(new Error('departed'))
  expect(await first).toMatchObject({ message: 'departed' })
  expect(signals.every(signal => !signal.aborted)).toBe(true)
  resolve.splice(0).forEach(yes => yes())
  await Promise.all([second, otherAccount, otherCursor])
  const fresh = f.relay.request(body(), f.scope).catch(error => error)
  await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(4))
  f.relay.close()
  expect(await fresh).toMatchObject({ name: 'AbortError' })
  expect(signals[3]!.aborted).toBe(true)
  expect((f.relay as any).historyReads.flights.size).toBe(0)
})
