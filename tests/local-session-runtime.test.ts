import { expect, it, vi } from 'vitest'
import { HandoffDenied, LocalSessionCoordinator } from '../src/local-session-coordinator.js'
import { LocalSessionOwnership } from '../src/local-session-ownership.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalSessionRuntime from '../src/local-session-runtime.js'
import { DshRemoteError } from '../src/dsh-remote/errors.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { DshNativeTransport } from '../src/dsh-remote/native-transport.js'
import { controlFrames } from '../src/local-session-control.js'

it('reads a discovered journal past a departed peer without recovering its executor, but still permits explicit queued sends', async () => {
  const owner = { owner: 'departed', epoch: 1, phase: 'active' }, acquire = vi.fn(async () => {})
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    instance: 'current', lifetime: new AbortController(), accountId: '42', incoming: new AsyncLocalStorage(), carriers: new Map(),
    start: async () => {}, authorize: async () => {}, discover: async () => true, acquire,
    ctx: { get: () => ({ isDiscovered: () => true }) },
    ownership: { address: () => 'original', read: () => owner, peer: () => undefined },
    coordinator: { requestPeer: async (_peer: string, body: any) => { if (body.native.mode === 'close') return {}; throw new DshRemoteError('RUNTIME_OFFLINE', 'exited', true) } },
    native: { request: vi.fn(async () => ({ items: [{ type: 'snapshot', cursor: 32 }] })) },
  })
  const body = { mode: 'pull', streamRef: 'read', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'old' } } } } }
  const signal = new AbortController().signal
  await runtime.recoverChannel('original', 'old', body, signal)
  expect(await runtime.carrier({ runtimeRef: 'original', sessionRef: 'old', body }, signal)).toMatchObject({ items: [{ cursor: 32 }] })
  // Subsequent pulls carry no endpoint: they must not be sent back to the departed peer.
  expect(await runtime.carrier({ runtimeRef: 'original', sessionRef: 'old', body: { mode: 'pull', streamRef: 'read' } }, signal)).toMatchObject({ items: [{ cursor: 32 }] })
  expect(await runtime.carrier({ runtimeRef: 'original', sessionRef: 'old', body: { mode: 'close', streamRef: 'read' } }, signal)).toBeDefined()
  expect((runtime as any).native.request).toHaveBeenCalledTimes(3)
  expect((runtime as any).carriers.size).toBe(0)
  const next = vi.fn(async () => (async function* () { yield { type: 'snapshot', cursor: 32 } })())
  const stream = await runtime.stream({ namespace: 'session', method: 'follow', args: body.payload.args }, next)
  const frames = []; for await (const frame of stream) frames.push(frame)
  expect(frames).toEqual([{ type: 'snapshot', cursor: 32 }]); expect(next).toHaveBeenCalledOnce()
  expect(acquire).not.toHaveBeenCalled()
  await runtime.recoverChannel('original', 'old', { operation: 'session.prompt', session_ref: 'old', mode: 'queue' }, signal)
  expect(acquire).toHaveBeenCalledOnce()
})

it('keeps named blank creation under native workspace and preset validation instead of forwarding it as an existing-session command', async () => {
  const authorize = vi.fn(async () => {})
  const requestPeer = vi.fn(), command = vi.fn()
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    instance: 'new', lifetime: new AbortController(), incoming: new AsyncLocalStorage(),
    start: async () => {}, authorize, registry: { command },
    ownership: { address: () => undefined, read: () => ({ owner: 'exited', epoch: 1, phase: 'active' }) }, coordinator: { requestPeer },
  })
  const next = vi.fn(async () => ({ sessionId: 'blank', agentPreset: 'recorded' }))
  expect(await runtime.invoke({ namespace: 'session', method: 'create', args: { request: { sessionId: 'blank', workspaceId: 'local-workspace', agentPreset: 'recorded' } } }, next)).toEqual({ sessionId: 'blank', agentPreset: 'recorded' })
  expect(authorize).toHaveBeenCalledOnce(); expect(next).toHaveBeenCalledOnce()
  expect(requestPeer).not.toHaveBeenCalled(); expect(command).not.toHaveBeenCalled()
})

it('publishes the executor after activation without delaying local sends on cloud I/O', async () => {
  const order: string[] = []
  let rejectPublication!: (error: Error) => void
  const publishExecution = vi.fn(() => {
    order.push('publish')
    return new Promise<void>((_, reject) => { rejectPublication = reject })
  })
  const warn = vi.fn()
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    lifetime: new AbortController(), cloudValue: { publishExecution },
    ctx: { logger: { warn }, get: () => ({ resolveAgent: async () => { order.push('activate'); return {} } }) },
    coordinator: { acquire: async (_id: string, activate: () => Promise<unknown>) => { await activate(); return 'handle' } },
  })
  expect(await (runtime as any).acquire('shared', new AbortController().signal)).toBe('handle')
  expect(order).toEqual(['activate', 'publish'])
  expect(publishExecution).toHaveBeenCalledExactlyOnceWith('shared', expect.any(AbortSignal))
  rejectPublication(new Error('offline'))
  await Promise.resolve()
  expect(warn).toHaveBeenCalledOnce()
})

it.each(['local', 'peer', 'incoming'])('ends an accepted %s follow on handoff so the native client can reopen its snapshot', async origin => {
  let owner = { owner: origin === 'incoming' ? 'local' : origin, epoch: 1, phase: 'active' }
  const lifetime = new AbortController()
  const request = { namespace: 'session', method: 'follow', args: { request: { address: { kind: 'session', sessionId: 'shared' } } } }
  const next = vi.fn(async (current = request as typeof request & { signal?: AbortSignal }) => ({
    async *[Symbol.asyncIterator]() {
      yield { type: 'snapshot', cursor: 0 }
      await new Promise<void>(resolve => current.signal!.addEventListener('abort', () => resolve(), { once: true }))
    },
  }))
  let pulled = false
  const requestPeer = vi.fn(async (_owner: string, body: Record<string, any>, signal: AbortSignal) => {
    if (body.native.mode === 'close') return { done: true }
    if (!pulled) { pulled = true; return { items: [{ type: 'snapshot', cursor: 0 }] } }
    if (origin === 'peer') throw new DshRemoteError('REMOTE_NOT_FOUND', 'release started', true)
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    instance: 'local', lifetime, incoming: { getStore: () => origin === 'incoming' },
    start: async () => {}, authorize: async () => {},
    ownership: { address: () => undefined, read: () => owner }, coordinator: { requestPeer },
  })
  const stream = (await runtime.stream(request, next))[Symbol.asyncIterator]()
  try {
    expect(await stream.next()).toEqual({ value: { type: 'snapshot', cursor: 0 }, done: false })
    const pending = stream.next()
    if (origin !== 'peer') owner = { ...owner, phase: 'released' }
    expect(await pending).toEqual({ value: undefined, done: true })
    if (origin === 'peer') expect(requestPeer).toHaveBeenLastCalledWith('peer', expect.objectContaining({ native: { mode: 'close', streamRef: expect.any(String) } }), expect.any(AbortSignal))
  } finally { lifetime.abort(); await stream.return?.() }
})

it('forwards a burst to the busy local owner without waiting for its model turns to finish', async () => {
  const requestPeer = vi.fn(async (_owner: string, body: any) => ({ ok: true, value: { accepted: true, id: body.native.payload.args.request.requestId } }))
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    instance: 'B', lifetime: new AbortController(), incoming: { getStore: () => false },
    start: async () => {}, authorize: async () => {}, acquire: vi.fn(async () => { throw new HandoffDenied() }),
    ownership: { address: () => undefined, read: () => ({ owner: 'A', epoch: 3, phase: 'active' }) }, coordinator: { requestPeer },
  })
  const next = vi.fn()
  const results = await Promise.all(['1', '2', '3'].map(requestId => runtime.invoke({ namespace: 'session', method: 'prompt',
    args: { request: { sessionId: 'shared', requestId, mode: 'queue' } } }, next)))
  expect(results).toEqual(['1', '2', '3'].map(id => ({ accepted: true, id })))
  expect(requestPeer.mock.calls.map(([, body]) => body.native.payload.args.request.requestId)).toEqual(['1', '2', '3'])
  expect(next).not.toHaveBeenCalled()
})

it('fences session-channel commands to the local writer and original session without acquiring execution', async () => {
  let owner = { owner: 'A', epoch: 7, phase: 'active' }
  const receive = vi.fn(async () => ({ ok: true }))
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    instance: 'A', start: async () => {}, authorize: async () => {}, receive,
    ownership: { address: (id: string) => id === 'session-one' ? 'origin-runtime' : undefined, read: () => owner },
  })
  const signal = new AbortController().signal
  const command = { mode: 'call', endpoint: 'session/prompt', payload: { args: { request: { sessionId: 'session-one', mode: 'queue' } } } }
  expect(await runtime.channelRequest('origin-runtime', 'session-one', command, signal)).toEqual({ ok: true })
  expect(receive).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session-one', epoch: 7, native: command }, signal)
  await expect(runtime.channelRequest('other-origin', 'session-one', command, signal)).rejects.toMatchObject({ code: 'SESSION_STATE_CHANGED' })
  await expect(runtime.channelRequest('origin-runtime', 'session-one', { ...command, payload: { args: { request: { sessionId: 'other-session' } } } }, signal)).rejects.toMatchObject({ code: 'REMOTE_REQUEST_INVALID' })
  owner = { owner: 'B', epoch: 8, phase: 'active' }
  await expect(runtime.channelRequest('origin-runtime', 'session-one', command, signal)).rejects.toMatchObject({ code: 'SESSION_STATE_CHANGED' })
  expect(receive).toHaveBeenCalledOnce()
})

function controlCarrierFixture() {
  let owner = { owner: 'B', epoch: 1, phase: 'active' }
  const lifetime = new AbortController()
  const runtimes = new Map<string, LocalSessionRuntime>()
  const sources = new Map<string, { push(frame: Record<string, unknown>): void; fail(error: unknown): void; disposed: ReturnType<typeof vi.fn> }>()
  const command = vi.fn(() => { throw new Error('observation cannot issue a command') })
  const transports: DshNativeTransport[] = []
  for (const instance of ['A', 'B']) {
    const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
      instance, lifetime, accountId: 'account', carriers: new Map(), incoming: new AsyncLocalStorage(),
      start: async () => {}, authorize: async () => {}, acquire: command,
      ctx: { get: () => undefined, arkmeData: { accountScope: { start: async () => {} } } },
      ownership: { address: () => undefined, read: () => owner, address: () => 'canonical' },
      controls: { stream: (open: (signal: AbortSignal) => Promise<AsyncIterable<unknown>>, signal: AbortSignal) => open(signal) },
      coordinator: { requestPeer: (peer: string, body: object, signal: AbortSignal) => (runtimes.get(peer) as any).receive(body, signal) },
    })
    const transport = new DshNativeTransport({ wireStream: { open: async (endpoint: string, payload: any, _uplink: AsyncIterable<unknown>, _peer: unknown, signal: AbortSignal) => {
      expect(endpoint).toBe('session/control')
      expect(payload.args).toEqual({})
      return runtime.stream({ namespace: 'session', method: 'control', args: payload.args, signal }, async current =>
        controlFrames(current?.signal ?? signal, (push, fail) => {
          const disposed = vi.fn()
          sources.set(instance, { push, fail, disposed })
          push({ type: 'baseline', value: { queues: { shared: instance === 'A' ? [{ id: 'queued-after-handoff' }] : [] }, jobs: {}, projections: {} } })
          return disposed
        }))
    } } }, { createSharedFetchHandler: command })
    Object.assign(runtime, { native: transport })
    runtimes.set(instance, runtime); transports.push(transport)
  }
  const pull = (streamRef: string, opening = false) => runtimes.get('A')!.carrier({
    runtimeRef: 'canonical', sessionRef: 'shared', body: { mode: 'pull', streamRef,
      ...(opening ? { endpoint: 'session/control', payload: { args: {} } } : {}) },
  }, lifetime.signal)
  return { pull, sources, command, handoff: () => { owner = { owner: 'A', epoch: 2, phase: 'active' } },
    close: () => { lifetime.abort(); for (const transport of transports) transport.close() } }
}

it('wakes a pending peer control on handoff and reopens with the new complete queue baseline', async () => {
  const f = controlCarrierFixture()
  try {
    expect(await f.pull('old', true)).toMatchObject({ items: [{ type: 'baseline', value: { queues: { shared: [] } } }] })
    const pending = f.pull('old')
    await delay(0)
    f.handoff()
    expect(await Promise.race([pending, delay(750, 'stalled')])).toMatchObject({ items: [], done: true })
    expect(f.sources.get('B')!.disposed).toHaveBeenCalledOnce()
    expect(await f.pull('fresh', true)).toMatchObject({ items: [{ type: 'baseline', value: { queues: { shared: [{ id: 'queued-after-handoff' }] } } }] })
    const next = f.pull('fresh')
    f.sources.get('A')!.push({ type: 'queue', sessionId: 'shared', items: [{ id: 'next-queued-message' }] })
    expect(await next).toMatchObject({ items: [{ type: 'queue', sessionId: 'shared', items: [{ id: 'next-queued-message' }] }] })
    expect(f.command).not.toHaveBeenCalled()
  } finally { f.close() }
})

it.each([false, true])('propagates an unknown peer control error before owner cancellation (handoff=%s)', async handoff => {
  const f = controlCarrierFixture()
  try {
    await f.pull('control', true)
    const pending = f.pull('control')
    await delay(0)
    const error = new Error('source projection failed')
    const assertion = expect(pending).rejects.toBe(error)
    if (handoff) f.handoff()
    f.sources.get('B')!.fail(error)
    await assertion
    expect(f.command).not.toHaveBeenCalled()
  } finally { f.close() }
})

it.each(['follow', 'control'])('reopens only %s observations after an IPC timeout without taking execution', async method => {
  const lifetime = new AbortController(), timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  let pulls = 0
  const requestPeer = vi.fn(async (_owner: string, body: any) => {
    if (body.native.mode === 'close') return { done: true }
    if (++pulls === 1 || pulls === 3) throw timeout
    return { items: [{ type: method === 'follow' ? 'snapshot' : 'baseline', cursor: 4 }] }
  })
  const acquire = vi.fn()
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    instance: 'A', lifetime, incoming: { getStore: () => ({ sessionId: 'shared' }) },
    start: async () => {}, authorize: async () => {}, acquire,
    ownership: { address: () => undefined, read: () => ({ owner: 'B', epoch: 2, phase: 'active' }) }, coordinator: { requestPeer },
  })
  const request = { namespace: 'session', method, args: method === 'follow' ? { request: { address: { kind: 'session', sessionId: 'shared' } } } : {} }
  const stream = (await runtime.stream(request, vi.fn()))[Symbol.asyncIterator]()
  try {
    expect((await stream.next()).value.type).toBe(method === 'follow' ? 'snapshot' : 'baseline')
    expect(await stream.next()).toEqual({ done: true, value: undefined })
    expect(pulls).toBe(3)
    expect(acquire).not.toHaveBeenCalled()
    expect(requestPeer.mock.calls.every(([, body]) => ['pull', 'close'].includes(body.native.mode))).toBe(true)
  } finally { lifetime.abort(); await stream.return?.() }
})

it('does not retry a timed-out write through the observation recovery path', async () => {
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  const requestPeer = vi.fn(async () => { throw timeout })
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    instance: 'A', lifetime: new AbortController(), incoming: { getStore: () => false },
    start: async () => {}, authorize: async () => {}, acquire: vi.fn(async () => { throw new HandoffDenied() }),
    ownership: { address: () => undefined, read: () => ({ owner: 'B', epoch: 2, phase: 'active' }) }, coordinator: { requestPeer },
  })
  await expect(runtime.invoke({ namespace: 'session', method: 'prompt', args: { request: { sessionId: 'shared', mode: 'queue', requestId: 'once' } } }, vi.fn())).rejects.toBe(timeout)
  expect(requestPeer).toHaveBeenCalledOnce()
})


it.each(['missing', 'refused'])('recovers a cold canonical session after its %s owner exits, without a local page opening it', async state => {
  let owner = { sessionId: 'cold', conversationRef: 'conversation', owner: 'old-process', epoch: 1, phase: 'active', target: null, transfer: null }
  const requestPeer = vi.fn(async () => { throw new DshRemoteError('RUNTIME_OFFLINE', 'listener gone', true) })
  const acquire = vi.fn(async (_id, _signal, expected) => { expect(expected).toEqual(owner); owner = { ...owner, owner: 'current', epoch: 2 } })
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    instance: 'current', lifetime: new AbortController(), start: async () => {}, authorize: async () => {}, acquire, discover: async () => true,
    ownership: { address: () => 'canonical', read: () => owner, peer: () => state === 'refused' ? { instance: 'old-process' } : undefined },
    coordinator: { requestPeer },
  })
  const body = { mode: 'call', endpoint: 'session/prompt', payload: { args: { request: { sessionId: 'cold', mode: 'queue' } } } }
  await runtime.recoverChannel('canonical', 'cold', body, new AbortController().signal)
  expect(acquire).toHaveBeenCalledOnce()
  expect(runtime.channelEpoch('canonical', 'cold')).toBe(2)
  expect(requestPeer).toHaveBeenCalledTimes(state === 'refused' ? 1 : 0)
  if (state === 'refused') expect(requestPeer).toHaveBeenCalledWith('old-process', expect.objectContaining({ sessionId: 'cold', epoch: 1, native: { mode: 'close', streamRef: expect.any(String) } }), expect.any(AbortSignal))
})


it.each(['alive', 'timeout', 'unknown', 'changed', 'cancelled', 'wrong-address', 'wrong-session'].flatMap(state => ['prompt', 'typed-prompt'].map(entry => [state, entry])))('does not recover a %s peer via %s', async (state, entry) => {
  const owner = { sessionId: 'cold', conversationRef: 'conversation', owner: 'old-process', epoch: 1, phase: 'active', target: null, transfer: null }
  const signal = new AbortController()
  if (state === 'cancelled') signal.abort()
  const requestPeer = vi.fn(async () => {
    if (state === 'timeout') throw new DOMException('timeout', 'TimeoutError')
    if (state === 'unknown') throw new TypeError('fetch failed')
    if (state === 'changed') throw new DshRemoteError('REMOTE_NOT_FOUND', 'changed', true)
    return { done: true }
  })
  const acquire = vi.fn()
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    instance: 'current', lifetime: new AbortController(), start: async () => {}, authorize: async () => {}, acquire,
    discover: async (runtime: string) => runtime === 'canonical', ownership: { address: () => 'canonical', read: () => owner, peer: () => ({ instance: 'old-process' }) }, coordinator: { requestPeer },
  })
  const sessionId = state === 'wrong-session' ? 'other' : 'cold'
  const body = entry === 'typed-prompt' ? { operation: 'session.prompt', session_ref: sessionId, mode: 'queue' } : entry === 'prompt'
    ? { mode: 'call', endpoint: 'session/prompt', payload: { args: { request: { sessionId, mode: 'queue', requestId: 'once' } } } }
    : { mode: 'pull', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId } } } } }
  const outcome = runtime.recoverChannel(state === 'wrong-address' ? 'foreign' : 'canonical', 'cold', body, signal.signal)
  if (['timeout', 'unknown', 'changed', 'cancelled'].includes(state)) await expect(outcome).rejects.toBeDefined()
  else await outcome
  expect(acquire).not.toHaveBeenCalled()
  expect(requestPeer).toHaveBeenCalledTimes(['wrong-address', 'wrong-session', 'cancelled'].includes(state) ? 0 : 1)
})

it.each(['steer', 'invalid'])('does not acquire a cold writer for a typed prompt in %s mode', async mode => {
  const acquire = vi.fn(), requestPeer = vi.fn()
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    instance: 'current', start: async () => {}, authorize: async () => {}, acquire,
    ownership: { address: () => 'canonical', read: () => ({ owner: 'old-process', epoch: 1, phase: 'active' }), peer: () => undefined },
    coordinator: { requestPeer },
  })
  await runtime.recoverChannel('canonical', 'cold', { operation: 'session.prompt', session_ref: 'cold', mode }, new AbortController().signal)
  expect(acquire).not.toHaveBeenCalled(); expect(requestPeer).not.toHaveBeenCalled()
})

it.each(['missing', 'refused'].flatMap(state => ['native', 'typed', 'prompt', 'typed-prompt'].map(entry => [state, entry])))('uses real private discovery and fenced acquisition for a %s cold owner via %s', async (state, entry) => {
  const root = mkdtempSync(join(tmpdir(), 'arkme-cold-observer-')), scope = { accountId: '3016', environment: 'test' as const }
  const store = new LocalSessionOwnership(root, scope)
  const id = SessionId('cold'), initial = store.register(id, 'exited')
  store.bindAddress(id, 'canonical')
  if (state === 'refused') {
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    await new Promise<void>(resolve => server.close(() => resolve()))
    store.publishPeer({ instance: 'exited', port, token: 'a'.repeat(64) })
  }
  const handle = { agent: { id }, dispose: vi.fn() }
  const registry = { coordinate: vi.fn(), acquireOwned: vi.fn(async (_id: string, commit: () => void, activate: () => Promise<unknown>) => {
    await activate(); commit(); return handle
  }) }
  const resolveAgent = vi.fn(async () => ({})), publishExecution = vi.fn(async () => {})
  const coordinator = new LocalSessionCoordinator({ ownership: store, registry: registry as any, instance: 'current', scope, authorize: async () => {} })
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    instance: 'current', lifetime: new AbortController(), start: async () => {}, authorize: async () => {},
    ownership: store, coordinator, cloudValue: { publishExecution }, ctx: { get: (name: string) => name === 'arkmeLocalHistory' ? { stat: async () => ({}), isDiscovered: () => false } : { resolveAgent }, logger: { warn: vi.fn() } },
  })
  try {
    await coordinator.start()
    await runtime.recoverChannel('canonical', 'cold', entry === 'typed-prompt' ? { operation: 'session.prompt', session_ref: 'cold', mode: 'queue' }
      : entry === 'prompt' ? { mode: 'call', endpoint: 'session/prompt', payload: { args: { request: { sessionId: 'cold', mode: 'queue', requestId: 'once' } } } }
      : entry === 'typed' ? { operation: 'session.history', session_ref: 'cold' }
      : { mode: 'pull', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'cold' } } } } }, AbortSignal.timeout(2000))
    const sending = entry === 'prompt' || entry === 'typed-prompt'
    expect(store.read(id)).toMatchObject({ owner: sending ? 'current' : 'exited', epoch: sending ? 2 : 1, conversationRef: initial.conversationRef })
    expect(store.address(id)).toBe('canonical')
    if (sending) expect(store.peer('exited')).toBeUndefined()
    expect(resolveAgent).toHaveBeenCalledTimes(sending ? 1 : 0)
    expect(registry.acquireOwned).toHaveBeenCalledTimes(sending ? 1 : 0)
    expect(publishExecution).toHaveBeenCalledTimes(sending ? 1 : 0)
  } finally { await coordinator.close(); store.close(); rmSync(root, { recursive: true }) }
})

it('resolves bare and canonical mark targets through a readonly journal without claiming execution', async () => {
  const event = { seq: 8, time: 1, type: 'user/message', surfaceOp: 'append', data: { id: 'message', role: 'user', content: [{ type: 'text', text: '原始文字' }], source: { kind: 'user' } } }
  const close = vi.fn(async () => {}), read = vi.fn(async () => ({ events: [event] })), open = vi.fn(async () => ({ read, close }))
  const acquire = vi.fn()
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    instance: 'current', start: async () => {}, authorize: async () => {}, discover: async () => true, acquire,
    ownership: { address: () => 'original', read: () => undefined },
    cloudValue: { repairHost: () => ({ generation: 2 }), ownsSession: () => false },
    ctx: { get: () => ({ open }) },
  })
  const target = { sessionRef: 'old', eventSeq: 8, role: 'user' as const }, signal = new AbortController().signal
  expect(await runtime.resolveAnnotationTarget(target, signal)).toEqual({ ...target, runtimeRef: 'original' })
  expect(runtime.sessionAccess('original', 'old')).toMatchObject({ readHistory: true, annotate: true, execution: 'unclaimed', submit: 'handoff' })
  expect(await runtime.annotationSource(target, signal)).toMatchObject({ runtimeRef: 'original', canonical: '原始文字', writable: false })
  expect(open).toHaveBeenCalledExactlyOnceWith('old', 'read', { signal })
  expect(close).toHaveBeenCalledOnce(); expect(acquire).not.toHaveBeenCalled()
  await expect(runtime.resolveAnnotationTarget({ ...target, runtimeRef: 'wrong' }, signal)).rejects.toMatchObject({ code: 'REMOTE_PROJECTION_CONFLICT' })
})

it('permits account-authorized close after an epoch changes while keeping stale pulls fenced', async () => {
  const authorize = vi.fn(async () => {}), native = { request: vi.fn(async () => ({ done: true })) }
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype), {
    authorize, accountId: '42', instance: 'old', lifetime: new AbortController(), incoming: new AsyncLocalStorage(), native,
    ownership: { read: () => ({ owner: 'new', epoch: 2, phase: 'active' }) },
  }) as any
  const body = { sessionId: 'session', epoch: 1, native: { mode: 'close', streamRef: 'old-stream' } }
  expect(await runtime.receive(body, new AbortController().signal)).toEqual({ done: true })
  await expect(runtime.receive({ ...body, native: { ...body.native, mode: 'pull' } }, new AbortController().signal)).rejects.toThrow('执行权已改变')
  authorize.mockRejectedValueOnce(new Error('account rejected'))
  await expect(runtime.receive(body, new AbortController().signal)).rejects.toThrow('account rejected')
  expect(native.request).toHaveBeenCalledOnce()
})


it.each(['native', 'typed', 'history', 'follow'])('only explicit %s input claims a verified unclaimed local session', async entry => {
  const acquire = vi.fn(async () => {})
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype), {
    instance: 'current', start: async () => {}, authorize: async () => {}, acquire,
    ctx: { get: () => ({ stat: async () => ({}), isDiscovered: () => true }) },
    ownership: { address: () => 'original', read: () => undefined },
  })
  const body = entry === 'typed' ? { operation: 'session.prompt', session_ref: 'old', mode: 'queue' }
    : entry === 'history' ? { operation: 'session.history', session_ref: 'old' }
    : entry === 'follow' ? { mode: 'pull', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'old' } } } } }
    : { mode: 'call', endpoint: 'session/prompt', payload: { args: { request: { sessionId: 'old', mode: 'queue' } } } }
  await runtime.recoverChannel('original', 'old', body, new AbortController().signal)
  expect(acquire).toHaveBeenCalledTimes(['native', 'typed'].includes(entry) ? 1 : 0)
})


it('flushes live continued history before handing it to the sole cloud repair queue', async () => {
  let release!: () => void
  const enqueue = vi.fn(async () => {}), live = {}, flush = vi.fn(() => new Promise<boolean>(resolve => { release = () => resolve(true) }))
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    authorize: vi.fn(async () => {}), ownership: { address: () => 'original' }, repair: { enqueue },
    ctx: { get: (name: string) => name === 'sessions' ? { get: () => live, flush } : { isDiscovered: () => true } },
  })
  const captured = runtime.captureHistory('continued', new AbortController().signal)
  await vi.waitFor(() => expect(flush).toHaveBeenCalledWith(live))
  expect(enqueue).not.toHaveBeenCalled(); release()
  await expect(captured).resolves.toBe(true)
  expect(enqueue).toHaveBeenCalledWith('original', 'continued')
})

it('mounts a retained canonical address before serving a cold remote read after restart', async () => {
  const discover = vi.fn(async () => true), acquire = vi.fn()
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    start: async () => {}, authorize: async () => {}, discover, acquire,
    ownership: { address: () => 'original', read: () => undefined },
  })
  const signal = new AbortController().signal
  await runtime.recoverChannel('original', 'old', { operation: 'session.model.get', session_ref: 'old' }, signal)
  expect(discover).toHaveBeenCalledWith('original', 'old', signal)
  expect(acquire).not.toHaveBeenCalled()
})

it('uses the same canonical address for legacy discovery, handoff routing and repair without changing writer epoch', async () => {
  const { LocalSessionIdentity } = await import('../src/local-session-identity.js')
  const root = mkdtempSync(join(tmpdir(), 'arkme-alias-owner-')), store = new LocalSessionOwnership(root, { environment: 'prod', accountId: '42' })
  store.bindAddress('session', 'old'); const writer = store.register('session', 'peer')
  const identities = new LocalSessionIdentity({ post: vi.fn() })
  identities.observe({ canonical_identity: true, runtime_ref: 'canonical', session_ref: 'session', deduplicated_runtime_refs: ['old'] })
  const discover = vi.fn(async identity => identity.previousRuntimeRefs?.includes('old')), enqueue = vi.fn(async () => {})
  const runtime = Object.assign(Object.create(LocalSessionRuntime.prototype) as LocalSessionRuntime, {
    start: async () => {}, authorize: async () => {}, accountId: '42', config: { environment: 'prod' }, identities,
    ownership: store, repair: { enqueue }, ctx: { get: () => ({ stat: async () => undefined, discover, isDiscovered: () => true }), logger: { warn: vi.fn() } },
  })
  try {
    expect(await runtime.discover('canonical', 'session', new AbortController().signal)).toBe(true)
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({ runtimeRef: 'canonical', previousRuntimeRefs: ['old'], accountId: '42' }), expect.any(AbortSignal), false)
    expect(runtime.hasSession('old', 'session')).toBe(true); expect(runtime.channelEpoch('canonical', 'session')).toBe(-1)
    expect(store.address('session')).toBe('canonical'); expect(store.read('session')).toEqual(writer)
    expect(enqueue).toHaveBeenCalledWith('canonical', 'session')
    expect(() => store.canonicalizeAddress('session', 'unrelated', [])).toThrow('冲突')
  } finally { identities.close(); store.close(); rmSync(root, { recursive: true }) }
})

 it('preserves native writer refusal instead of reporting unrelated model or workspace failure', async () => {
  const error = Object.assign(new Error('writer held'), { code: 'session/writer-held' })
  const publishExecution = vi.fn()
  const runtime = {
    coordinator: { acquire: (_id: string, activate: () => Promise<void>) => activate() },
    ctx: { get: () => ({ resolveAgent: async () => ({ error }) }) },
    cloud: { publishExecution },
  }
  await expect((LocalSessionRuntime.prototype as any).acquire.call(runtime, 'same', new AbortController().signal)).rejects.toBe(error)
  expect(publishExecution).not.toHaveBeenCalled()
})
