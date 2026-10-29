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
  runInNewContext(harnessNativeTransportScript('/arkme-self/api'), { window, WebSocket: Socket, DOMException, URLSearchParams, URL, AbortController, AbortSignal, structuredClone, setTimeout, clearTimeout, fetch, Response, crypto: { randomUUID: () => `request-${++nextId}` } })
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
it('blocks foreign native mutations even after online source replies and selection changes', async () => {
  const f = fixture()
  f.directory.publish([f.row(), f.row('linux')]); f.directory.select('arkme:windows:same')
  for (const operation of ['session/prompt', 'session/cancel', 'session/rename', 'session/updateQueue', 'session/attachment', 'messageFeedback/put', 'messageFeedback/delete', 'sessionFeedback/record', 'workspace/archiveSession', 'schedule/update', 'schedule/delete']) {
    const result = await f.rpc(operation, { request: { sessionId: 'arkme:windows:same', text: 'arkme:linux:same' } })
    expect(result.result.ok).toBe(false)
  }
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.wire).not.toHaveBeenCalled()
  expect(f.attributes.get('data-arkme-source-writable')).toBe('false')
  expect(f.directory.writable('arkme:windows:same')).toBe(false); expect(f.directory.writable('local')).toBe(true)
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

it('redirects a selected retired address after a complete canonical directory refresh', () => {
  const f = fixture(), dispatchEvent = vi.fn()
  f.window.frameElement.parentElement.ownerDocument = { dispatchEvent, defaultView: { CustomEvent: class { constructor(public type: string, public init: unknown) {} } } }
  f.directory.publish([f.row('retired')]); f.directory.select('arkme:retired:same')
  f.directory.publish([f.row('canonical', { presence: 'offline', previousRuntimeRefs: ['retired'] })])
  expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'arkme:native-session-open', init: { detail: { runtimeRef: 'canonical', sessionRef: 'same', accountId: '3016', accountScope: '' } } }))
  expect(f.attributes.get('data-arkme-source-writable')).toBe('false')
  f.directory.publish([f.row('canonical', { presence: 'offline', previousRuntimeRefs: ['retired'] })])
  expect(dispatchEvent).toHaveBeenCalledOnce()
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

it('keeps an ongoing native selection through completion and hides an archived alias', async()=>{
 const f=fixture(),dispatchEvent=vi.fn()
 f.window.frameElement.parentElement.ownerDocument={dispatchEvent,defaultView:{CustomEvent:class{constructor(public type:string,public init:unknown){}}}}
 const local={sessionId:'same',updatedAt:1,running:true,projections:{asOfSeq:9999}}
 f.fetch.mockImplementation(async()=>Response.json({result:{ok:true,value:{items:[local]}}}))
 await f.rpc('session/list',{});f.directory.select('same')
 const row=f.row('canonical',{previousRuntimeRefs:['local-runtime'],coveredLocalHistory:{runtimeRef:'local-runtime',updatedAt:1,projectionAsOfSeq:9999,source:'cloud'}})
 for(let i=0;i<100;i++){local.updatedAt++;local.projections.asOfSeq++;f.directory.publish([{...row,contentRevision:String(i)}],'local-runtime');expect((await f.rpc('session/list',{})).result.value.items.map((r:any)=>r.sessionId)).toEqual(['same'])}
 local.running=false;f.directory.publish([row],'local-runtime')
 expect(dispatchEvent).not.toHaveBeenCalled()
 f.directory.publish([{...row,archived:true}],'local-runtime')
 expect((await f.rpc('session/list',{})).result.value.items).toEqual([])
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



it('never opens remote journal/control/event streams while retaining the local control baseline', async () => {
  const f = fixture(), abort = new AbortController()
  f.directory.publish([f.row()]); f.directory.select('arkme:windows:same')
  const control = f.hooks.openStream('session/control', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  expect((await control.next()).value).toEqual(currentBaseline)
  for (const endpoint of ['session/follow', 'session/control', '$events']) {
    const stream = f.hooks.openStream(endpoint, { args: { request: { address: { sessionId: 'arkme:windows:same' } } } }, abort.signal)[Symbol.asyncIterator]()
    await expect(stream.next()).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
  }
  expect(f.wire).not.toHaveBeenCalled()
  expect(f.attributes.get('data-arkme-source-writable')).toBe('false')
  const response = await f.rpc('$events/result', { eventId: 'arkme:windows:question', outcome: { kind: 'next' } })
  expect(response.result.ok).toBe(false)
  expect(f.fetch).not.toHaveBeenCalled()
  f.directory.select('local'); expect(f.attributes.get('data-arkme-source-writable')).toBe('true')
  abort.abort(); await control.return()
})
