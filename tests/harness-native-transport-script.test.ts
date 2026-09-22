import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { harnessNativeTransportScript } from '../src/harness-native-transport-script.js'

import { publishedControlBaseline } from './helpers/published-dsh-protocol.js'

let currentBaseline: Awaited<ReturnType<typeof publishedControlBaseline>>
beforeAll(async () => { currentBaseline = await publishedControlBaseline({}) })

const disposers: Array<() => void> = []
afterEach(() => { disposers.splice(0).forEach(fn => fn()); vi.useRealTimers() })

function fixture(search = '?arkme-harness-embed=1') {
  const attributes = new Map<string, string>([['data-arkme-account-id', '3016']])
  const listeners = new Map<string, () => void>()
  const window = { location: { search, href: 'http://localhost:3000/arkme-self/harness' }, frameElement: { parentElement: {
    getAttribute: (key: string) => attributes.get(key), setAttribute: (key: string, value: string) => attributes.set(key, value),
    removeAttribute: (key: string) => attributes.delete(key),
  } }, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn) } as any
  const fetch = vi.fn(async (url: string | URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    return Response.json(String(url).startsWith('/arkme') ? { ok: true, value: { ok: true, value: {}, sourceWritable: true } }
      : { type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { items: [{ sessionId: 'local' }] } } })
  })
  const wire = vi.fn(async (params: any) => ({ ok: true, value: params.body.mode === 'close' ? { done: true } : {
    items: params.body.endpoint === '$events' ? [{ type: 'ready', clientId: 'remote-client', host: { home: 'C:/' } }]
      : params.body.endpoint === 'session/control' ? [currentBaseline]
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
        ? { type: 'ready', clientId: 'local-client', host: { home: '/local' } } : currentBaseline })
    }
    receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
    close() { this.readyState = 3; this.onclose?.() }
  }
  let nextId = 0
  runInNewContext(harnessNativeTransportScript('/arkme-self/api'), { window, Error, WebSocket: Socket, DOMException, URLSearchParams, URL, AbortController, AbortSignal, structuredClone, setTimeout, clearTimeout, fetch, Response, crypto: { randomUUID: () => `request-${++nextId}` } })
  disposers.push(() => listeners.get('pagehide')?.())
  const hooks = window.__DSH_TRANSPORT__
  const rpc = async (method: string, args: object) => (await hooks.fetch(`api/${method}`, { body: JSON.stringify({ rpcId: 'rpc', method, payload: { args } }) })).json()
  const row = (runtimeRef = 'windows', extra = {}) => ({ runtimeRef, sessionRef: 'same', title: runtimeRef, updatedAt: 42, running: false, blank: false, local: false, presence: 'online', capabilities: ['session.native'], ...extra })
  return { window, attributes, fetch, wire, sockets, listeners, rpc, row, hooks, directory: window.__ARKME_NATIVE_DIRECTORY__ }
}
it('leaves non-embedded pages untouched', () => expect(fixture('').hooks).toBeUndefined())
it('reads reminders and their catalogue from the selected source, keeping prompt text and task ids exact', async () => {
  const f = fixture()
  f.directory.publish([f.row(), f.row('linux')]); f.directory.select('arkme:windows:same')
  f.fetch.mockImplementation(async (_url, init) => {
    const { params } = JSON.parse(String(init.body))
    expect(params.runtimeRef).toBe('windows')
    return Response.json({ ok: true, value: { ok: true, value: params.body.endpoint === 'schedule/catalog'
      ? [{ sessionId: 'same', id: 'task', prompt: 'same arkme:windows:same', status: 'inactive' }]
      : [{ id: 'task', title: 'Reminder' }] } })
  })
  expect((await f.rpc('schedule/catalog', {})).result.value).toEqual([{ sessionId: 'arkme:windows:same', id: 'task', prompt: 'same arkme:windows:same', status: 'inactive' }])
  expect((await f.rpc('schedule/list', { request: { sessionId: 'arkme:windows:same' } })).result.value).toEqual([{ id: 'task', title: 'Reminder' }])
  expect(JSON.parse(String(f.fetch.mock.calls.at(-1)![1].body)).params.body.payload.args.request.sessionId).toBe('same')
})
it('keeps local reminder reads on the native local API', async () => {
  const f = fixture(); f.directory.select('local')
  await f.rpc('schedule/catalog', {}); await f.rpc('schedule/list', { request: { sessionId: 'local' } })
  expect(f.fetch.mock.calls.map(([url]) => String(url))).toEqual(['http://localhost:3000/api/schedule/catalog', 'http://localhost:3000/api/schedule/list'])
})
it('routes foreign detail history to its bound source and blocks reminder updates', async () => {
  const f = fixture(); f.directory.publish([f.row(), f.row('linux')]); f.directory.select('arkme:linux:same')
  const expected = { id: 'task', kind: 'at', title: 'Reminder', prompt: 'Keep exact', scheduledAt: '2027-01-01T00:00:00Z' }
  f.fetch.mockImplementation(async (_url, init) => {
    const { params } = JSON.parse(String(init.body))
    expect(params.runtimeRef).toBe('windows')
    const request = params.body.payload.args.request
    expect(request.sessionId).toBe('same')
    if (params.body.endpoint === 'schedule/update') expect(request.expected).toEqual(expected)
    return Response.json({ ok: true, value: { ok: true, value: { id: 'task', updated: true, record: expected } } })
  })
  await f.rpc('schedule/history', { request: { sessionId: 'arkme:windows:same', id: 'task', limit: 20 } })
  const request = { sessionId: 'arkme:windows:same', id: 'task', expected }
  expect((await f.rpc('schedule/update', { request })).result.ok).toBe(false)
  expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('distinguishes an offline store from a successfully empty list and preserves outer transport error codes', async () => {
  const f = fixture(); f.directory.publish([f.row()]); f.directory.select('arkme:windows:same')
  f.fetch.mockResolvedValueOnce(Response.json({ ok: false, error: { code: 'RUNTIME_OFFLINE', message: 'offline' } }, { status: 503 }))
  expect((await f.rpc('schedule/list', { request: { sessionId: 'arkme:windows:same' } })).result).toMatchObject({ ok: false, error: { code: 'RUNTIME_OFFLINE' } })
  expect(f.attributes.get('data-arkme-schedule-error')).toBe('RUNTIME_OFFLINE')
  f.fetch.mockResolvedValueOnce(Response.json({ ok: true, value: { ok: true, value: [] } }))
  expect((await f.rpc('schedule/list', { request: { sessionId: 'arkme:windows:same' } })).result).toEqual({ ok: true, value: [] })
  expect(f.attributes.has('data-arkme-schedule-error')).toBe(false)
})
it('ignores a late failure after selecting another source', async () => {
  const f = fixture(); f.directory.publish([f.row(), f.row('linux')]); f.directory.select('arkme:windows:same')
  let finish!: (value: Response) => void
  f.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = f.rpc('schedule/catalog', {})
  f.directory.select('arkme:linux:same')
  finish(Response.json({ ok: true, value: { ok: false, error: { code: 'RUNTIME_OFFLINE' } } }))
  await pending
  expect(f.attributes.has('data-arkme-schedule-error')).toBe(false)
})
it('invalidates native reminder caches when the selected source or source availability changes', async () => {
  const f = fixture(), controller = new AbortController()
  const stream = f.hooks.openStream('$events', { args: {} }, controller.signal)[Symbol.asyncIterator]()
  await stream.next()
  f.directory.select('arkme:windows:same')
  expect((await stream.next()).value).toEqual({ type: 'emit', event: 'schedule/changed', args: [] })
  f.directory.publish([f.row()])
  expect((await stream.next()).value.event).toBe('api-session/added')
  expect((await stream.next()).value.event).toBe('schedule/changed')
  f.directory.publish([f.row('windows', { presence: 'offline' })])
  expect((await stream.next()).value.event).toBe('schedule/changed')
  await stream.return()
})
it('accepts the 0.2 relative unary RPC route and the legacy URL carrier', async () => {
  const f = fixture()
  await f.rpc('session/create', { request: { workspaceId: 'work' } })
  expect(f.fetch.mock.calls.at(-1)?.[0].href).toBe('http://localhost:3000/api/session/create')
  await f.hooks.fetch(new URL('http://localhost:3000/api/session/create'), {
    body: JSON.stringify({ rpcId: 'legacy', method: 'session/create', payload: { args: { request: { workspaceId: 'work' } } } }),
  })
  expect(f.fetch.mock.calls.at(-1)?.[0].pathname).toBe('/api/session/create')
})
it('merges account rows with native local rows and publishes add/update/delete through the native event stream', async () => {
  const f = fixture(), abort = new AbortController()
  const stream = f.hooks.openStream('$events', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  expect((await stream.next()).value.clientId).toBe('local-client')
  f.directory.publish([f.row(), f.row('linux'), f.row('archived', { archived: true }), f.row('child', { origin: 'subagent' })])
  expect((await stream.next()).value).toMatchObject({ event: 'api-session/added', args: [{ sessionId: 'arkme:windows:same', updatedAt: 42, projections: { kind: 'cached' } }] })
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
it('admits online conversation actions only, blocks offline and unsupported sources, and keeps routing exact', async () => {
  const f = fixture()
  f.directory.publish([f.row(), f.row('linux')]); f.directory.select('arkme:windows:same')
  for (const operation of ['session/rename', 'messageFeedback/put', 'messageFeedback/delete', 'sessionFeedback/record', 'workspace/archiveSession', 'schedule/update', 'schedule/delete']) {
    const result = await f.rpc(operation, { request: { sessionId: 'arkme:windows:same', text: 'arkme:linux:same' } })
    expect(result.result.ok).toBe(false)
  }
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.wire).not.toHaveBeenCalled()
  expect(f.attributes.get('data-arkme-source-writable')).toBe('true')
  expect(f.directory.writable('arkme:windows:same')).toBe(true); expect(f.directory.writable('local')).toBe(true)
  for (const operation of ['session/prompt', 'session/cancel', 'session/updateQueue', 'session/attachment']) {
    expect((await f.rpc(operation, { request: { sessionId: 'arkme:windows:same', content: [{ type: 'text', text: 'arkme:linux:same' }] } })).result.ok).toBe(true)
    const { params } = JSON.parse(String(f.fetch.mock.calls.at(-1)![1].body))
    expect(params.runtimeRef).toBe('windows'); expect(params.body.payload.args.request.sessionId).toBe('same')
    expect(params.body.payload.args.request.content[0].text).toBe('arkme:linux:same')
  }
  f.fetch.mockClear()
  for (const extra of [{ presence: 'offline' }, { capabilities: [] }]) {
    f.directory.publish([f.row('windows', extra)])
    expect((await f.rpc('session/prompt', { request: { sessionId: 'arkme:windows:same' } })).result.ok).toBe(false)
    expect(f.directory.writable('arkme:windows:same')).toBe(false)
  }
  expect(f.fetch).not.toHaveBeenCalled()
  await expect(f.rpc('session/prompt', { agent: 'arkme:windows:same', request: { sessionId: 'arkme:linux:same' } })).rejects.toThrow('跨实例')
  await expect(f.rpc('session/prompt', { agent: 'local', request: { sessionId: 'arkme:linux:same' } })).rejects.toThrow('跨实例')
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


})

it('keeps an idle native local entry executable while its cloud metadata advances', async () => {
  const f = fixture(), dispatchEvent = vi.fn()
  f.window.frameElement.parentElement.ownerDocument = { dispatchEvent, defaultView: { CustomEvent: class { constructor(public type: string, public init: unknown) {} } } }
  const local = { sessionId: 'same', updatedAt: 42, running: false, blank: false, projections: { asOfSeq: 3, values: { title: 'same' } } }
  f.fetch.mockImplementation(async () => Response.json({ result: { ok: true, value: { items: [local] } } }))
  const row = f.row('canonical', { previousRuntimeRefs: ['local-runtime'], coveredLocalHistory: { runtimeRef: 'local-runtime', updatedAt: 42, projectionAsOfSeq: 3 } })
  await f.rpc('session/list', {})
  f.directory.publish([row], 'local-runtime')
  expect(f.directory.canonicalLocal('same')).toBeUndefined()
  expect(dispatchEvent).not.toHaveBeenCalled()
  expect((await f.rpc('session/list', {})).result.value.items.map((r: any) => r.sessionId)).toEqual(['same'])
  expect(f.directory.preferredSession('arkme:canonical:same')).toBe('same')
  await f.rpc('session/prompt', { request: { sessionId: 'same', prompt: '继续' } })
  expect(f.fetch).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ body: expect.stringContaining('session/prompt') }))
  expect(f.wire).not.toHaveBeenCalled()
  local.updatedAt = 43
  expect((await f.rpc('session/list', {})).result.value.items.map((r: any) => r.sessionId)).toEqual(['same'])
  expect(f.directory.canonicalLocal('same')).toBeUndefined()
})
it('never folds unverified, ambiguous, wrong-runtime or running local sources', async () => {
  const f = fixture()
  f.fetch.mockImplementation(async () => Response.json({ result: { ok: true, value: { items: [{ sessionId: 'same', updatedAt: 42, running: false, projections: { asOfSeq: 3 } }] } } }))
  const row = f.row('canonical', { previousRuntimeRefs: ['local-runtime'] })
  f.directory.publish([row], 'local-runtime')
  expect((await f.rpc('session/list', {})).result.value.items).toHaveLength(2)
  const proved = { ...row, coveredLocalHistory: { runtimeRef: 'local-runtime', updatedAt: 42, projectionAsOfSeq: 3 } }
  f.directory.publish([proved], 'different-runtime')
  expect((await f.rpc('session/list', {})).result.value.items).toHaveLength(2)
  f.directory.publish([proved, { ...proved, runtimeRef: 'other' }], 'local-runtime')
  expect((await f.rpc('session/list', {})).result.value.items).toHaveLength(3)
})
it('keeps one native local entry when content proof selects local history and redirects old cloud selection', async () => {
  const f = fixture(), dispatchEvent = vi.fn()
  f.window.frameElement.parentElement.ownerDocument = { dispatchEvent, defaultView: { CustomEvent: class { constructor(public type: string, public init: unknown) {} } } }
  f.fetch.mockImplementation(async () => Response.json({ result: { ok: true, value: { items: [{ sessionId: 'same', updatedAt: 42, running: false, projections: { asOfSeq: 3 } }] } } }))
  await f.rpc('session/list', {})
  f.directory.select('arkme:canonical:same')
  const row = f.row('canonical', { previousRuntimeRefs: ['local-runtime'], coveredLocalHistory: { runtimeRef: 'local-runtime', updatedAt: 42, projectionAsOfSeq: 3, source: 'local' } })
  f.directory.publish([row], 'local-runtime')
  expect((await f.rpc('session/list', {})).result.value.items.map((r: any) => r.sessionId)).toEqual(['same'])
  expect(f.directory.preferredSession('arkme:canonical:same')).toBe('same')
  expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ init: { detail: { runtimeRef: '', sessionRef: 'same', accountId: '3016', accountScope: '' } } }))
  f.directory.publish([f.row('canonical', { previousRuntimeRefs: ['local-runtime'] })], 'local-runtime')
  expect((await f.rpc('session/list', {})).result.value.items).toHaveLength(2)
})
it('does not resurrect a proven hidden cloud row on metadata refresh and restores it once evidence expires', async () => {
  const f = fixture(), abort = new AbortController()
  f.fetch.mockImplementation(async () => Response.json({ result: { ok: true, value: { items: [{ sessionId: 'same', updatedAt: 42, running: false, projections: { asOfSeq: -1 } }] } } }))
  await f.rpc('session/list', {})
  const stream = f.hooks.openStream('$events', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  await stream.next()
  const row = f.row('canonical', { previousRuntimeRefs: ['local-runtime'], coveredLocalHistory: { runtimeRef: 'local-runtime', updatedAt: 42, projectionAsOfSeq: -1, source: 'local' } })
  f.directory.publish([row], 'local-runtime')
  expect((await stream.next()).value.event).toBe('api-session/added')
  expect((await stream.next()).value).toMatchObject({ event: 'api-session/removed', args: ['arkme:canonical:same'] })
  f.directory.publish([{ ...row, title: 'new title' }], 'local-runtime')
  f.directory.publish([f.row('canonical', { title: 'new title', previousRuntimeRefs: ['local-runtime'] })], 'local-runtime')
  // The next event must be the one restoration, not a hidden metadata update.
  expect((await stream.next()).value).toMatchObject({ event: 'api-session/added', args: [{ sessionId: 'arkme:canonical:same', projections: { values: { title: 'new title' } } }] })
  expect((await f.rpc('session/list', {})).result.value.items).toHaveLength(2)
  await stream.return()
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

it('keeps one account-owned entry while cold-start Host registration has no Runtime yet', async () => {
  for (const [running, selected] of [[false, false], [true, false], [false, true]]) {
    const f = fixture()
    if (selected) f.directory.select('same')
    f.fetch.mockImplementation(async () => Response.json({ result: { ok: true, value: { items: [{ sessionId: 'same', running, updatedAt: 1 }] } } }))
    f.directory.publish([f.row('cloud', { canonicalIdentity: true, coveredLocalHistory: { updatedAt: 1, projectionAsOfSeq: -1, source: 'cloud' } })])
    expect((await f.rpc('session/list', {})).result.value.items.map((item: any) => item.sessionId)).toEqual(['same'])
    // Registration enriches the identity; it must not insert a second row.
    f.directory.publish([f.row('cloud', { canonicalIdentity: true, coveredLocalHistory: { runtimeRef: 'restored', updatedAt: 1, projectionAsOfSeq: -1, source: 'cloud' } })], 'restored')
    expect((await f.rpc('session/list', {})).result.value.items.map((item: any) => item.sessionId)).toEqual(['same'])
  }
})

it('returns a cold-start cloud selection to its native owner when registration identifies the same Runtime', () => {
  const f = fixture(), dispatchEvent = vi.fn()
  f.window.frameElement.parentElement.ownerDocument = { dispatchEvent, defaultView: { CustomEvent: class { constructor(public type: string, public init: unknown) {} } } }
  f.directory.publish([f.row('cloud', { canonicalIdentity: true })])
  f.directory.select('arkme:cloud:same')
  f.directory.publish([f.row('cloud', { canonicalIdentity: true, local: true })], 'cloud')
  expect(dispatchEvent).toHaveBeenCalledOnce()
  expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ init: { detail: { runtimeRef: '', sessionRef: 'same', accountId: '3016', accountScope: '' } } }))
  f.directory.publish([f.row('cloud', { canonicalIdentity: true, local: true })], 'cloud')
  expect(dispatchEvent).toHaveBeenCalledOnce()
})



it('waits offline without opening remote streams and resumes the journal when the source returns', async () => {
  vi.useFakeTimers()
  const f = fixture(), abort = new AbortController()
  f.directory.publish([f.row('windows', { presence: 'offline' })]); f.directory.select('arkme:windows:same')
  const journal = f.hooks.openStream('session/follow', { args: { request: { address: { sessionId: 'arkme:windows:same' } } } }, abort.signal)[Symbol.asyncIterator]()
  const next = journal.next()
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.wire).not.toHaveBeenCalled()
  f.directory.publish([f.row()]); await vi.advanceTimersByTimeAsync(1000)
  expect((await next).value.header.id).toBe('arkme:windows:same')
  abort.abort(); await journal.return()
})

it('starts a new combined control generation instead of appending a second baseline', async () => {
  const f = fixture(), abort = new AbortController()
  f.directory.publish([f.row()]); f.directory.select('arkme:windows:same')
  const control = f.hooks.openStream('session/control', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  expect((await control.next()).value).toEqual(currentBaseline)
  const baseline = await publishedControlBaseline({ same: { asOfSeq: 5, values: { modelSelection: { model: 'source-model' } } } })
  f.wire.mockImplementation(async params => ({ ok: true, value: params.body.mode === 'close' ? { done: true } : {
    items: params.body.endpoint === 'session/control' ? [baseline] : params.body.endpoint === 'session/follow' ? [{ type: 'snapshot', header: { id: 'same' }, cursor: -1, records: [] }] : [], done: true,
  } }))
  const journal = f.hooks.openStream('session/follow', { args: { request: { address: { sessionId: 'arkme:windows:same' } } } }, abort.signal)[Symbol.asyncIterator]()
  expect((await journal.next()).value.header.id).toBe('arkme:windows:same')
  expect((await control.next()).done).toBe(true)
  const renewed = f.hooks.openStream('session/control', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  const opening = (await renewed.next()).value
  expect(opening.type).toBe('baseline')
  expect(opening.value.projections['arkme:windows:same']).toEqual({ asOfSeq: 5, values: { modelSelection: { model: 'source-model' } } })
  expect(f.attributes.get('data-arkme-source-writable')).toBe('true')
  abort.abort(); await journal.return(); await renewed.return()
})

it('delivers an online prompt to its source and forwards the subsequent live journal event', async () => {
  const f = fixture(), abort = new AbortController()
  f.directory.publish([f.row()]); f.directory.select('arkme:windows:same')
  let resolveReply!: (value: any) => void
  const reply = new Promise(resolve => { resolveReply = resolve })
  let journalRef = ''
  f.wire.mockImplementation(async params => {
    const body = params.body
    if (body.mode === 'close') return { ok: true, value: { done: true } }
    if (body.endpoint === 'session/follow') {
      journalRef = body.streamRef
      return { ok: true, value: { sourceWritable: true, items: [{ type: 'snapshot', header: { id: 'same' }, cursor: -1, records: [] }], done: false } }
    }
    if (body.streamRef === journalRef) return reply
    return { ok: true, value: { items: [], done: true } }
  })
  const journal = f.hooks.openStream('session/follow', { args: { request: { address: { sessionId: 'arkme:windows:same' } } } }, abort.signal)[Symbol.asyncIterator]()
  expect((await journal.next()).value.header.id).toBe('arkme:windows:same')
  const live = journal.next()
  f.fetch.mockImplementation(async (_url, init) => {
    const { params } = JSON.parse(String(init.body))
    expect(params.body.endpoint).toBe('session/prompt')
    expect(params.runtimeRef).toBe('windows')
    expect(params.body.payload.args.request.sessionId).toBe('same')
    resolveReply({ ok: true, value: { sourceWritable: true, items: [{ type: 'event', event: { type: 'assistant/message', seq: 1, data: { text: 'response from source' } } }], done: false } })
    return Response.json({ ok: true, value: { ok: true, value: { accepted: true }, sourceWritable: true } })
  })
  expect((await f.rpc('session/prompt', { request: { sessionId: 'arkme:windows:same', content: [{ type: 'text', text: 'hello' }] } })).result.value.accepted).toBe(true)
  expect((await live).value.event.data.text).toBe('response from source')
  abort.abort(); await journal.return()
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
