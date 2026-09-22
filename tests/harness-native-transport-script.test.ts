import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { harnessNativeTransportScript } from '../src/harness-native-transport-script.js'

const disposers: Array<() => void> = []
afterEach(() => disposers.splice(0).forEach(fn => fn()))

function fixture(search = '?arkme-harness-embed=1') {
  const attributes = new Map<string, string>([['data-arkme-account-id', '3016']])
  const listeners = new Map<string, () => void>()
  const window = { location: { search, href: 'http://localhost:3000/arkme-self/harness' }, frameElement: { parentElement: {
    getAttribute: (key: string) => attributes.get(key), setAttribute: (key: string, value: string) => attributes.set(key, value),
  } }, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn) } as any
  const fetch = vi.fn(async (url: string | URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    return Response.json(String(url).startsWith('/arkme') ? { ok: true, value: { ok: true, value: {}, sourceWritable: true } }
      : { type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { items: [{ sessionId: 'local' }] } } })
  })
  const wire = vi.fn(async (params: any) => ({ ok: true, value: params.body.mode === 'close' ? { done: true } : {
    items: params.body.endpoint === '$events' ? [{ type: 'ready', clientId: 'remote-client', host: { home: 'C:/' } }]
      : params.body.endpoint === 'session/control' ? [{ type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } }]
        : params.body.endpoint === 'session/follow' ? [{ type: 'snapshot', header: { id: 'same' }, cursor: -1, records: [] }] : [], done: true,
  } }))
  const sockets: Socket[] = []
  class Socket {
    static OPEN = 1
    readyState = 1
    onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (event: { data: string }) => void
    frames: any[] = []
    constructor(readonly url: string | URL) { sockets.push(this) }
    send(text: string) {
      const frame = JSON.parse(text); this.frames.push(frame)
      if (frame.params) void wire(frame.params).then(result => this.receive({ id: frame.id, ...result }))
      else if (frame.type === 'open') this.receive({ type: 'item', streamId: frame.streamId, value: frame.endpoint === '$events'
        ? { type: 'ready', clientId: 'local-client', host: { home: '/local' } } : { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } } })
    }
    receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
    close() { this.readyState = 3; this.onclose?.() }
  }
  let nextId = 0
  runInNewContext(harnessNativeTransportScript('/arkme-self/api'), { window, Error, WebSocket: Socket, DOMException, URLSearchParams, URL, AbortController, AbortSignal, structuredClone, setTimeout, clearTimeout, fetch, Response, crypto: { randomUUID: () => `request-${++nextId}` } })
  disposers.push(() => listeners.get('pagehide')?.())
  const hooks = window.__DSH_TRANSPORT__
  const rpc = async (method: string, args: object) => (await hooks.fetch(new URL(`http://localhost:3000/api/${method}`), { body: JSON.stringify({ rpcId: 'rpc', method, payload: { args } }) })).json()
  const row = (runtimeRef = 'windows', extra = {}) => ({ runtimeRef, sessionRef: 'same', title: runtimeRef, updatedAt: 42, running: false, blank: false, local: false, presence: 'online', capabilities: ['session.native'], ...extra })
  return { window, attributes, fetch, wire, sockets, listeners, rpc, row, hooks, directory: window.__ARKME_NATIVE_DIRECTORY__ }
}
it('leaves non-embedded pages untouched', () => expect(fixture('').hooks).toBeUndefined())
it('merges account rows with native local rows and publishes add/update/delete through the native event stream', async () => {
  const f = fixture(), abort = new AbortController()
  const stream = f.hooks.openStream('$events', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  expect((await stream.next()).value.clientId).toBe('local-client')
  f.directory.publish([f.row(), f.row('linux'), f.row('archived', { archived: true }), f.row('child', { origin: 'subagent' })])
  expect((await stream.next()).value).toMatchObject({ event: 'api-session/added', args: [{ sessionId: 'arkme:windows:same', updatedAt: 42 }] })
  expect((await stream.next()).value.args[0].sessionId).toBe('arkme:linux:same')
  const list = await f.rpc('session/list', { _request: {} })
  expect(list.result.value.items.map((row: any) => row.sessionId)).toEqual(['local', 'arkme:windows:same', 'arkme:linux:same'])
  f.directory.publish([f.row('windows', { title: 'renamed' })])
  expect((await stream.next()).value).toMatchObject({ event: 'api-session/removed', args: ['arkme:linux:same'] })
  expect((await stream.next()).value.args[0].projections.values.title).toBe('renamed')
  await stream.return(); expect(f.sockets[0]!.frames.at(-1).type).toBe('cancel')
})
it('updates native running state on account start/end changes without affecting another source or duplicating unchanged snapshots', async () => {
  const f = fixture(), abort = new AbortController()
  const stream = f.hooks.openStream('$events', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  await stream.next()
  const other = f.row('linux'), local = f.row('local', { local: true })
  f.directory.publish([f.row('mac'), other, local])
  expect((await stream.next()).value).toMatchObject({ event: 'api-session/added', args: [{ sessionId: 'arkme:mac:same', running: false }] })
  expect((await stream.next()).value).toMatchObject({ event: 'api-session/added', args: [{ sessionId: 'arkme:linux:same', running: false }] })

  const active = f.row('mac', { running: true })
  f.directory.publish([active, other, { ...local, running: true }])
  expect((await stream.next()).value).toEqual({ type: 'emit', event: 'api-session/status', args: ['arkme:mac:same', true] })
  f.directory.publish([active, other, local])

  const completed = f.row('mac', { title: 'Untitled session', projectionAsOfSeq: 23 })
  f.directory.publish([completed, other, local])
  expect((await stream.next()).value).toMatchObject({ event: 'api-session/added', args: [{ sessionId: 'arkme:mac:same', running: false, projections: { asOfSeq: 23 } }] })
  expect((await stream.next()).value).toEqual({ type: 'emit', event: 'api-session/status', args: ['arkme:mac:same', false] })
  const list = await f.rpc('session/list', { _request: {} })
  expect(list.result.value.items.slice(1).map((row: any) => [row.sessionId, row.running])).toEqual([
    ['arkme:mac:same', false], ['arkme:linux:same', false],
  ])
  f.directory.publish([completed, other, local])
  f.directory.publish([other, local])
  expect((await stream.next()).value).toEqual({ type: 'emit', event: 'api-session/removed', args: ['arkme:mac:same'] })
  await stream.return()
})
it('updates activity through the native activity event and keeps unchanged directories silent', async () => {
  const f = fixture(), abort = new AbortController()
  const stream = f.hooks.openStream('$events', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  await stream.next()
  const other = f.row('linux')
  f.directory.publish([f.row('windows', { blank: true }), other])
  await stream.next(); await stream.next()
  const active = f.row('windows', { title: '555', updatedAt: 100, projectionAsOfSeq: 18 })
  f.directory.publish([active, other])
  expect((await stream.next()).value).toMatchObject({ event: 'api-session/added', args: [{ blank: false, projections: { values: { title: '555' } } }] })
  expect((await stream.next()).value).toEqual({ type: 'emit', event: 'api-session/activity', args: ['arkme:windows:same', 100] })
  f.directory.publish([active, other])
  f.directory.publish([other])
  expect((await stream.next()).value).toEqual({ type: 'emit', event: 'api-session/removed', args: ['arkme:windows:same'] })
  await stream.return()
})
it('routes writes by the addressed session, preserving text and in-flight target across selection changes', async () => {
  const f = fixture()
  f.directory.publish([f.row(), f.row('linux')]); f.directory.select('arkme:windows:same')
  const result = f.rpc('session/prompt', { request: { sessionId: 'arkme:windows:same', text: 'arkme:linux:same' } })
  f.directory.select('arkme:linux:same'); await result
  expect(JSON.parse(String(f.fetch.mock.calls[0]![1].body))).toMatchObject({ params: { runtimeRef: 'windows', body: { payload: { args: { request: { sessionId: 'same', text: 'arkme:linux:same' } } } } } })
  expect(f.attributes.get('data-arkme-source-writable')).toBe('true')
  await expect(f.rpc('session/prompt', { agent: 'arkme:windows:same', request: { sessionId: 'arkme:linux:same' } })).rejects.toThrow('跨实例')
  await expect(f.rpc('session/prompt', { agent: 'local', request: { sessionId: 'arkme:linux:same' } })).rejects.toThrow('跨实例')
  const calls = f.fetch.mock.calls.length
  const unsupported = await f.rpc('session/selectModel', { request: { sessionId: 'arkme:windows:same', model: 'local-model' } })
  expect(unsupported.result.ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(calls)
})
it('routes native history with exact source identity, one remote socket and unchanged source events', async () => {
  const f = fixture(), signal = new AbortController().signal
  f.wire.mockImplementation(async (params: any) => ({ ok: true, value: params.body.endpoint === 'session/follow' ? {
    items: [{ type: 'snapshot', header: { id: 'same' }, records: [{ type: 'event', event: { seq: 7, data: { text: 'same', sessionId: 'same' } } }] }], done: true,
  } : { items: [], done: true } }) as any)
  const stream = f.hooks.openStream('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'arkme:windows:same' } } } }, signal)[Symbol.asyncIterator]()
  expect((await stream.next()).value).toMatchObject({ header: { id: 'arkme:windows:same' }, records: [{ event: { seq: 7, data: { sessionId: 'same' } } }] })
  expect(f.wire.mock.calls.find(([p]) => p.body.endpoint === 'session/follow')![0]).toMatchObject({ runtimeRef: 'windows', body: { payload: { args: { request: { address: { sessionId: 'same' } } } } } })
  expect(f.sockets).toHaveLength(1); expect(f.fetch).not.toHaveBeenCalled()
  await stream.return(); f.listeners.get('pagehide')!(); expect(f.sockets[0]!.readyState).toBe(3)
})
it('keeps offline state scoped to the selected source and releases blocked streams on account disposal', async () => {
  const f = fixture()
  f.directory.publish([f.row('windows', { presence: 'offline' }), f.row('linux')])
  f.directory.select('arkme:windows:same'); expect(f.attributes.get('data-arkme-source-writable')).toBe('false')
  f.directory.select('local'); expect(f.attributes.get('data-arkme-source-writable')).toBe('true')
  f.wire.mockImplementation(() => new Promise(() => {}))
  const stream = f.hooks.openStream('session/follow', { args: { request: { address: { sessionId: 'arkme:windows:same' } } } }, new AbortController().signal)[Symbol.asyncIterator]()
  const result = stream.next(); f.listeners.get('pagehide')!()
  await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  expect(f.sockets.every(socket => socket.readyState === 3)).toBe(true)
})
it('replays source control values after local baselines without replacing another source state', async () => {
  const f = fixture(), abort = new AbortController()
  f.wire.mockImplementation(async (params: any) => ({ ok: true, value: { items: params.body.endpoint === 'session/control' ? [{
    type: 'baseline', value: { queues: { same: [{ id: 'queued' }] }, jobs: {}, projections: { same: { asOfSeq: 7, values: { modelSelection: { next: { model: 'source-model' } } } } } },
  }] : params.body.endpoint === 'session/follow' ? [{ type: 'snapshot', header: { id: 'same' }, records: [] }] : [], done: true } }) as any)
  const history = f.hooks.openStream('session/follow', { args: { request: { address: { sessionId: 'arkme:windows:same' } } } }, abort.signal)[Symbol.asyncIterator]()
  await history.next()
  const openControl = () => f.hooks.openStream('session/control', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  let control = openControl()
  expect((await control.next()).value.type).toBe('baseline')
  expect((await control.next()).value).toMatchObject({ type: 'queue', sessionId: 'arkme:windows:same', items: [{ id: 'queued' }] })
  expect((await control.next()).value).toMatchObject({ type: 'projection', sessionId: 'arkme:windows:same', key: 'modelSelection', seq: 7 })
  await control.return(); control = openControl()
  expect((await control.next()).value.type).toBe('baseline')
  expect((await control.next()).value.items[0].id).toBe('queued')
  await control.next(); await history.return()
  expect((await control.next()).value).toMatchObject({ type: 'queue', items: [] })
  await control.return()
})
it('returns interactive responses to the source event generation instead of the local client', async () => {
  const f = fixture(), abort = new AbortController()
  f.wire.mockImplementation(async (params: any) => ({ ok: true, value: { items: params.body.endpoint === '$events' ? [
    { type: 'ready', clientId: 'source-client', host: { home: 'C:/' } },
    { type: 'waterfall', event: 'question/ask', eventId: 'ask-1', agentId: 'same', request: { text: 'same' } },
  ] : params.body.endpoint === 'session/follow' ? [{ type: 'snapshot', header: { id: 'same' }, records: [] }] : [], done: true } }) as any)
  const events = f.hooks.openStream('$events', { args: {} }, abort.signal)[Symbol.asyncIterator](); await events.next()
  const history = f.hooks.openStream('session/follow', { args: { request: { address: { sessionId: 'arkme:windows:same' } } } }, abort.signal)[Symbol.asyncIterator](); await history.next()
  const question = (await events.next()).value
  expect(question).toMatchObject({ eventId: 'arkme:windows:ask-1', agentId: 'arkme:windows:same', request: { text: 'same' } })
  await f.rpc('$events/result', { clientId: 'local-client', eventId: question.eventId, outcome: { kind: 'next' } })
  expect(JSON.parse(String(f.fetch.mock.calls[0]![1].body))).toMatchObject({ params: { runtimeRef: 'windows', body: { payload: { args: { eventId: 'ask-1', clientId: 'source-client' } } } } })
  await history.return(); await events.return()
})
it('reopens only current local streams after carrier loss and keeps local RPC payloads unchanged', async () => {
  const f = fixture(), abort = new AbortController()
  const first = f.hooks.openStream('$events', { args: {} }, abort.signal)[Symbol.asyncIterator](); await first.next()
  const oldId = f.sockets[0]!.frames[0].streamId
  f.sockets[0]!.close()
  await expect(first.next()).rejects.toThrow('本机连接已断开')
  const next = f.hooks.openStream('$events', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  expect((await next.next()).value.clientId).toBe('local-client')
  expect(f.sockets[1]!.frames.filter(frame => frame.type === 'open').map(frame => frame.streamId)).not.toContain(oldId)
  await f.rpc('session/prompt', { request: { sessionId: 'local', content: [{ text: 'arkme:windows:same' }] } })
  expect(String(f.fetch.mock.calls[0]![0])).toBe('http://localhost:3000/api/session/prompt')
  expect(JSON.parse(String(f.fetch.mock.calls[0]![1].body)).payload.args.request.content).toEqual([{ text: 'arkme:windows:same' }])
  await next.return()
})

it('marks a follow carrier loss for the official DSH stream generation recovery', async () => {
  const f = fixture(), abort = new AbortController()
  const original = f.wire.getMockImplementation()!
  f.wire.mockImplementation(async params => {
    if (params.body.endpoint === 'session/follow') return { ok: true, value: { items: [{ type: 'snapshot', header: { id: 'same' }, cursor: -1, records: [] }] } } as any
    if (params.body.mode === 'pull' && !params.body.endpoint) return await new Promise(() => {})
    return original(params)
  })
  const stream = f.hooks.openStream('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'arkme:windows:same' } } } }, abort.signal)[Symbol.asyncIterator]()
  expect((await stream.next()).value.type).toBe('snapshot')
  const waiting = stream.next().then(() => undefined, (error: any) => error)
  await Promise.resolve(); await Promise.resolve()
  f.sockets.find(item => String(item.url).includes('native-streams'))!.close()
  const error = await waiting
  expect(error.message).toContain('原生远程连接已断开')
  expect(error.dshRemoteStreamFailure).toEqual({ kind: 'carrier' })
  expect(error.name).toBe('Error')
  abort.abort()
})

it('retries opening failures with backoff but stops on terminal authorization and cancellation', async () => {
  vi.useFakeTimers()
  const f = fixture(), abort = new AbortController(), original = f.wire.getMockImplementation()!
  let attempts = 0
  f.wire.mockImplementation(async params => {
    if (params.body.endpoint !== 'session/follow') return original(params)
    attempts++
    if (attempts < 3) return { ok: false, error: { code: 'REMOTE_REALTIME_UNAVAILABLE', message: 'offline', retryable: true } } as any
    return original(params)
  })
  const payload = { args: { request: { address: { kind: 'session', sessionId: 'arkme:windows:same' } } } }
  const stream = f.hooks.openStream('session/follow', payload, abort.signal)[Symbol.asyncIterator]()
  try {
    const opening = stream.next()
    await vi.advanceTimersByTimeAsync(249)
    expect(attempts).toBe(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await opening).value.type).toBe('snapshot')
    expect(attempts).toBe(3)
    await stream.return()
    f.wire.mockImplementation(async params => params.body.endpoint === 'session/follow'
      ? { ok: false, error: { code: 'REMOTE_LOGIN_REQUIRED', message: 'login', retryable: false } } as any : original(params))
    const denied = f.hooks.openStream('session/follow', payload, abort.signal)[Symbol.asyncIterator]()
    await expect(denied.next()).rejects.toMatchObject({ dshRemoteStreamFailure: { kind: 'remote', code: 'REMOTE_LOGIN_REQUIRED' } })
    f.wire.mockImplementation(async params => params.body.endpoint === 'session/follow'
      ? { ok: false, error: { code: 'REMOTE_REALTIME_UNAVAILABLE', retryable: true } } as any : original(params))
    const cancelled = f.hooks.openStream('session/follow', payload, abort.signal)[Symbol.asyncIterator]().next().catch((error: any) => error)
    await vi.advanceTimersByTimeAsync(1)
    abort.abort()
    expect((await cancelled).name).toBe('AbortError')
    expect(vi.getTimerCount()).toBe(0)
  } finally { abort.abort(); f.listeners.get('pagehide')?.(); vi.useRealTimers() }
})

// Opt-in against the unmodified installed DSH public Client bundle.
// DSH_GATEWAY_PACKAGE is the directory containing its package.json.
it.skipIf(!process.env.DSH_GATEWAY_PACKAGE)('recovers a real DSH RemoteStream across carrier loss and repeated opening failures', async () => {
  const nativeRequire = createRequire(resolve(process.env.DSH_GATEWAY_PACKAGE!, 'package.json'))
  let gateway: any
  runInNewContext(readFileSync(nativeRequire.resolve('@deepseek-ai/dsh-api-gateway/client'), 'utf8'), {
    window: { __ModuleLoader__: { load: (entry: any) => { gateway = entry.factory(nativeRequire) } } },
    Error, AbortController, AbortSignal, crypto, setTimeout, clearTimeout, queueMicrotask,
  })
  const { Context } = nativeRequire('@deepseek-ai/cordis')
  const ctx = new Context(), f = fixture(), original = f.wire.getMockImplementation()!
  let opens = 0, failOpen = 0
  f.wire.mockImplementation(async params => {
    if (params.body.endpoint === 'session/follow') {
      opens++
      if (failOpen > 0) { failOpen--; return { ok: false, error: { code: 'REMOTE_TRANSPORT_FAILED', retryable: true } } as any }
      return { ok: true, value: { items: [{ type: 'snapshot', header: { id: 'same' }, cursor: opens, records: [] }] } } as any
    }
    if (params.body.mode === 'pull' && !params.body.endpoint) return await new Promise(() => {})
    return original(params)
  })
  ctx.provide('typert', { remotes: { register: () => () => {} } })
  ctx.provide('connection', {
    rpc: { open: (_prefix: string, endpoint: string, payload: unknown, signal: AbortSignal) => f.hooks.openStream(endpoint, payload, signal) },
    generation: { getSnapshot: () => ({ host: { home: '/' } }), subscribe: () => () => {} },
    registerGenerationSource: () => () => {}, start: () => ({ stop() {} }),
  })
  const plugin = ctx.plugin(gateway)
  await plugin
  const codec = { mode: 'strict', typeSymbol: '@fixture#Json', schema: { parse: (value: unknown) => value } }
  const unmount = await ctx.remote.$mount({ package: '@fixture/session', descriptors: [{
    id: '@fixture/session#session/follow', service: 'session', namespace: 'session', method: 'follow', mode: 'stream',
    invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec }],
    cancellation: { parameter: 'signal' }, result: codec,
  }] })
  const stream = ctx.remote.$stream({ name: 'fixture-follow',
    open: (signal: AbortSignal) => ctx.remote.session.follow({ address: { kind: 'session', sessionId: 'arkme:windows:same' } }, signal),
    ended: () => new gateway.RemoteStreamCarrierError('ended'),
  })
  const iterator = stream[Symbol.asyncIterator]()
  try {
    const first = (await iterator.next()).value
    first.accept(); expect(first.generation).toBe(1)
    const next = iterator.next()
    await vi.waitFor(() => expect(f.wire.mock.calls.some(([params]) => params.body.mode === 'pull' && !params.body.endpoint)).toBe(true))
    failOpen = 2
    f.sockets.find(socket => String(socket.url).includes('native-streams'))!.close()
    const restored = (await next).value
    restored.accept()
    expect(restored.generation).toBe(2)
    expect(restored.value.type).toBe('snapshot')
    expect(opens).toBe(4)
    expect(first.signal.aborted).toBe(true)
  } finally { await stream.dispose(); await unmount(); await plugin.dispose(); f.listeners.get('pagehide')?.() }
})
