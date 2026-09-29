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
  const localBaseline = { queues: {} as Record<string, unknown>, jobs: {} as Record<string, unknown>, projections: {} as Record<string, unknown> }
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
        ? { type: 'ready', clientId: 'local-client', host: { home: '/local' } } : { type: 'baseline', value: localBaseline } })
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
  return { window, attributes, fetch, wire, sockets, localBaseline, listeners, rpc, row, hooks, directory: window.__ARKME_NATIVE_DIRECTORY__ }
}
it('leaves non-embedded pages untouched', () => expect(fixture('').hooks).toBeUndefined())
it('releases background remote sources while native sessions remain resident across more than eight selections', async () => {
  const f = fixture(), abort = new AbortController(), readers: any[] = [], waiting: Promise<unknown>[] = []
  const active = new Map<string, any>()
  f.wire.mockImplementation(async params => {
    const body = params.body
    if (body.mode === 'close') { active.delete(body.streamRef); return { ok: true, value: { done: true } } as any }
    if (!body.endpoint) return await new Promise(() => {})
    active.set(body.streamRef, params)
    return { ok: true, value: { items: body.endpoint === 'session/follow'
      ? [{ type: 'snapshot', header: { id: params.sessionRef }, cursor: 1, records: [] }]
      : body.endpoint === 'session/control' ? [{ type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } }]
        : [{ type: 'ready', clientId: 'remote-client' }] } } as any
  })
  try {
    for (let index = 0; index < 12; index++) {
      const id = `session-${index}`
      f.directory.select(`arkme:windows:${id}`)
      const reader = f.hooks.openStream('session/follow', { args: { request: { address: { kind: 'session', sessionId: `arkme:windows:${id}` } } } }, abort.signal)[Symbol.asyncIterator]()
      readers.push(reader)
      expect((await reader.next()).value.header.id).toBe(`arkme:windows:${id}`)
      waiting.push(reader.next().catch((error: unknown) => error))
    }
    await vi.waitFor(() => expect([...active.values()].map(value => value.sessionRef)).toEqual(['session-11', 'session-11', 'session-11']))
    expect(f.sockets.filter(socket => String(socket.url).includes('native-streams'))).toHaveLength(1)
    f.directory.select('arkme:windows:session-0')
    expect(await waiting[0]).toMatchObject({ dshRemoteStreamFailure: { kind: 'carrier' } })
    const restored = f.hooks.openStream('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'arkme:windows:session-0' } } } }, abort.signal)[Symbol.asyncIterator]()
    readers.push(restored)
    expect((await restored.next()).value.header.id).toBe('arkme:windows:session-0')
  } finally {
    abort.abort(); await Promise.all(waiting); for (const reader of readers) await reader.return()
    await vi.waitFor(() => expect(active.size).toBe(0))
  }
})
it('waits for the selected canonical source, preserves same-machine aliases and ignores unchanged directory publications', async () => {
  const f = fixture(), abort = new AbortController(), original = f.wire.getMockImplementation()!
  f.directory.select(undefined)
  f.wire.mockImplementation(async params => {
    if (params.body.mode === 'pull' && !params.body.endpoint) return await new Promise(() => {})
    const value = await original(params)
    return params.body.endpoint ? { ...value, value: { ...value.value, done: false } } : value
  })
  const reader = f.hooks.openStream('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'arkme:creator:same' } } } }, abort.signal)[Symbol.asyncIterator]()
  const opening = reader.next()
  try {
    await Promise.resolve(); expect(f.wire).not.toHaveBeenCalled()
    f.directory.select('same')
    await Promise.resolve(); expect(f.wire).not.toHaveBeenCalled()
    const row = f.row('creator', { local: true, localTakeover: true })
    f.directory.publish([row])
    expect((await opening).value.header.id).toBe('same')
    const pending = reader.next().catch((error: unknown) => error)
    f.directory.select('arkme:creator:same'); f.directory.publish([row]); f.directory.select('same')
    await Promise.resolve(); await Promise.resolve()
    expect(f.wire.mock.calls.filter(([params]) => params.body.endpoint === 'session/follow')).toHaveLength(1)
    expect(f.wire.mock.calls.filter(([params]) => params.body.mode === 'close')).toHaveLength(0)
    abort.abort(); await pending
  } finally { abort.abort(); await opening.catch(() => undefined); await reader.return() }
})
it('deduplicates native shared sessions from multiple creator instances and routes each canonical address', async () => {
  const f = fixture(), abort = new AbortController()
  const stream = f.hooks.openStream('$events', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  await stream.next()
  f.directory.publish([f.row('creator-a', { local: true, localTakeover: true, sessionRef: 'local' }), f.row('creator-b', { local: true, localTakeover: true, sessionRef: 'sibling' }), f.row('windows')])
  expect((await stream.next()).value.args[0].sessionId).toBe('local')
  expect((await stream.next()).value.args[0].sessionId).toBe('sibling')
  const list = await f.rpc('session/list', { _request: {} })
  expect(list.result.value.items.map((row: any) => row.sessionId)).toEqual(['local', 'arkme:windows:same'])
  for (const [runtimeRef, sessionId] of [['creator-a', 'local'], ['creator-b', 'sibling']]) {
    await f.rpc('session/prompt', { request: { sessionId, content: [] } })
    expect(JSON.parse(String(f.fetch.mock.calls.at(-1)![1].body)).params).toMatchObject({ runtimeRef, sessionRef: sessionId })
  }
  await stream.return()
})
it('scopes executor events and control to the addressed session after takeover', async () => {
  const f = fixture(), abort = new AbortController(), original = f.wire.getMockImplementation()!
  f.wire.mockImplementation(async params => {
    if (params.body.endpoint === '$events') return { ok: true, value: { items: [
      { type: 'ready', clientId: 'source-client' },
      { type: 'emit', event: 'api-session/added', args: [{ sessionId: 'new-on-executor' }] },
      { type: 'emit', event: 'api-session/status', args: [params.sessionRef, true] },
    ] } } as any
    if (params.body.endpoint === 'session/control') return { ok: true, value: { items: [{
      type: 'baseline', value: { queues: {}, jobs: {}, projections: {
        'new-on-executor': { asOfSeq: 1, values: { title: 'unrelated' } },
        [params.sessionRef]: { asOfSeq: 2, values: { title: params.sessionRef } },
      } },
    }] } } as any
    if (params.body.mode === 'pull' && !params.body.endpoint) return await new Promise(() => {})
    return original(params)
  })
  const events = f.hooks.openStream('$events', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  let controls = f.hooks.openStream('session/control', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  const histories: any[] = []
  try {
    await events.next(); await controls.next()
    for (const id of ['same', 'another']) {
      const history = f.hooks.openStream('session/follow', { args: { request: { address: { sessionId: `arkme:creator:${id}` } } } }, abort.signal)[Symbol.asyncIterator]()
      histories.push(history); await history.next()
      expect((await events.next()).value).toMatchObject({ event: 'api-session/status', args: [`arkme:creator:${id}`, true] })
      await expect(controls.next()).rejects.toMatchObject({ dshRemoteStreamFailure: { kind: 'carrier' } })
      controls = f.hooks.openStream('session/control', { args: {} }, abort.signal)[Symbol.asyncIterator]()
      expect((await controls.next()).value.value.projections[`arkme:creator:${id}`]).toEqual({ asOfSeq: 2, values: { title: id } })
    }
    expect(f.wire.mock.calls.filter(([p]) => p.body.endpoint === '$events').map(([p]) => p.sessionRef)).toEqual(['same', 'another'])
    expect(f.wire.mock.calls.filter(([p]) => p.body.mode === 'pull').every(([p]) => ['same', 'another'].includes(p.sessionRef))).toBe(true)
  } finally { abort.abort(); for (const history of histories) await history.return(); await events.return(); await controls.return() }
})
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
  const unsupported = await f.rpc('session/unsupported', { request: { sessionId: 'arkme:windows:same' } })
  expect(unsupported.result.ok).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(calls)
})
it('routes model and reasoning selection for same-machine sessions through their canonical owner', async () => {
  const f = fixture()
  f.directory.publish([f.row('creator-a', { local: true, localTakeover: true })])
  f.directory.select('arkme:another:other-session')
  const request = { sessionId: 'same', provider: 'deepseek', model: 'pro', reasoningEffort: 'high' }
  const result = await f.rpc('session/selectModel', { request })
  expect(result.result.ok).toBe(true)
  expect(JSON.parse(String(f.fetch.mock.calls.at(-1)![1].body))).toMatchObject({
    operation: 'remote.session.native', params: {
      runtimeRef: 'creator-a', sessionRef: 'same',
      body: { mode: 'call', endpoint: 'session/selectModel', payload: { args: { request } } },
    },
  })
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
  const baseline = { type: 'baseline', value: { queues: { 'arkme:windows:same': [{ id: 'queued' }] },
    projections: { 'arkme:windows:same': { asOfSeq: 7, values: { modelSelection: { next: { model: 'source-model' } } } } } } }
  expect((await control.next()).value).toMatchObject(baseline)
  await control.return(); control = openControl()
  expect((await control.next()).value).toMatchObject(baseline)
  await history.return()
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
  expect(question).toMatchObject({ eventId: expect.stringMatching(/^arkme:request-\d+:ask-1$/), agentId: 'arkme:windows:same', request: { text: 'same' } })
  await f.rpc('$events/result', { clientId: 'local-client', eventId: question.eventId, outcome: { kind: 'next' } })
  expect(JSON.parse(String(f.fetch.mock.calls[0]![1].body))).toMatchObject({ params: { runtimeRef: 'windows', sessionRef: 'same', body: { payload: { args: { eventId: 'ask-1', clientId: 'source-client' } } } } })
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

it('pins follow routing before selection is restored and closes the same address when it leaves selection', async () => {
  const f = fixture(), abort = new AbortController(), original = f.wire.getMockImplementation()!
  f.wire.mockImplementation(async params => {
    if (params.body.mode === 'pull' && !params.body.endpoint) return await new Promise(() => {})
    const response = await original(params)
    return params.body.endpoint === 'session/follow' ? { ...response, value: { ...response.value, done: false } } : response
  })
  const stream = f.hooks.openStream('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'arkme:windows:same' } } } }, abort.signal)[Symbol.asyncIterator]()
  try {
    await stream.next()
    const opening = f.wire.mock.calls.map(([params]) => params).find(params => params.body.endpoint === 'session/follow')
    expect(opening.sessionRef).toBe('same')
    f.directory.select('arkme:windows:other')
    const pending = stream.next().catch(() => undefined)
    await vi.waitFor(() => expect(f.wire.mock.calls.some(([params]) => params.body.streamRef === opening.body.streamRef && params.body.mode === 'close')).toBe(true))
    expect(f.wire.mock.calls.map(([params]) => params).find(params => params.body.streamRef === opening.body.streamRef && params.body.mode === 'close').sessionRef).toBe('same')
    abort.abort(); await pending
  } finally { abort.abort(); await stream.return(); f.listeners.get('pagehide')?.() }
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
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  } finally { abort.abort(); f.listeners.get('pagehide')?.(); vi.useRealTimers() }
})

it('retries a source that ends before its opening snapshot instead of completing the journal', async () => {
  vi.useFakeTimers()
  const f = fixture(), abort = new AbortController(), original = f.wire.getMockImplementation()!
  let opens = 0
  f.wire.mockImplementation(async params => {
    if (params.body.endpoint === 'session/follow' && ++opens < 3) return { ok: true, value: { items: [], done: true } } as any
    return original(params)
  })
  const stream = f.hooks.openStream('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'arkme:windows:same' } } } }, abort.signal)[Symbol.asyncIterator]()
  try {
    const opening = stream.next()
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await opening).value?.type).toBe('snapshot')
    expect(opens).toBe(3)
  } finally { abort.abort(); await stream.return(); f.listeners.get('pagehide')?.(); vi.useRealTimers() }
})

it('reopens ended remote control streams while the conversation remains open', async () => {
  vi.useFakeTimers()
  const f = fixture(), abort = new AbortController(), original = f.wire.getMockImplementation()!
  let controls = 0
  f.wire.mockImplementation(async params => {
    if (params.body.endpoint === 'session/control') {
      controls++
      return { ok: true, value: { items: [{ type: 'baseline', value: { queues: {}, jobs: {}, projections: { same: { asOfSeq: controls, values: { title: `round-${controls}` } } } } }], done: controls === 1 } } as any
    }
    if (params.body.mode === 'pull' && !params.body.endpoint) return await new Promise(() => {})
    return original(params)
  })
  let local = f.hooks.openStream('session/control', { args: {} }, abort.signal)[Symbol.asyncIterator]()
  const follow = f.hooks.openStream('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'arkme:windows:same' } } } }, abort.signal)[Symbol.asyncIterator]()
  try {
    await local.next(); await follow.next()
    await expect(local.next()).rejects.toMatchObject({ dshRemoteStreamFailure: { kind: 'carrier' } })
    local = f.hooks.openStream('session/control', { args: {} }, abort.signal)[Symbol.asyncIterator]()
    expect((await local.next()).value.value.projections['arkme:windows:same'].values.title).toBe('round-1')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(controls).toBe(2)
    await expect(local.next()).rejects.toMatchObject({ dshRemoteStreamFailure: { kind: 'carrier' } })
    local = f.hooks.openStream('session/control', { args: {} }, abort.signal)[Symbol.asyncIterator]()
    expect((await local.next()).value.value.projections['arkme:windows:same'].values.title).toBe('round-2')
  } finally { abort.abort(); await follow.return(); await local.return(); f.listeners.get('pagehide')?.(); vi.useRealTimers() }
})

it('uses the real DSH snapshot reader to replace complete control baselines while retaining every other source', async () => {
  const nativeRequire = createRequire(import.meta.url)
  let gateway: any
  runInNewContext(readFileSync(nativeRequire.resolve('@deepseek-ai/dsh-api-gateway/client'), 'utf8'), {
    window: { __ModuleLoader__: { load: (entry: any) => { gateway = entry.factory(nativeRequire) } } },
    Error, AbortController, AbortSignal, crypto, setTimeout, clearTimeout, queueMicrotask,
  })
  const f = fixture(), abort = new AbortController(), failures: unknown[] = [], snapshots: any[] = [], updates: any[] = []
  f.localBaseline.projections.local = { asOfSeq: 4, values: { title: 'local stays' } }
  const baselines: Record<string, any> = {
    one: { asOfSeq: 9, values: { title: 'old', removedKey: true } },
    two: { asOfSeq: 7, values: { title: 'other stays' } },
  }
  const endpoints = new Map<string, string>(), pending = new Map<string, (value: any) => void>()
  f.wire.mockImplementation(async params => {
    if (params.body.mode === 'close') return { ok: true, value: { done: true } } as any
    const endpoint = params.body.endpoint
    if (endpoint) {
      endpoints.set(params.body.streamRef, `${params.sessionRef}:${endpoint}`)
      return { ok: true, value: { items: endpoint === 'session/control'
        ? [{ type: 'baseline', value: { queues: {}, jobs: {}, projections: { [params.sessionRef]: baselines[params.sessionRef] } } }]
        : endpoint === 'session/follow' ? [{ type: 'snapshot', header: { id: params.sessionRef }, records: [], cursor: 9 }]
          : [{ type: 'ready', clientId: 'source' }] } } as any
    }
    return await new Promise(resolve => pending.set(endpoints.get(params.body.streamRef)!, resolve))
  })
  const connection = { generation: { getSnapshot: () => ({}), subscribe: () => () => {} } }
  const native = new gateway.RemoteStream(connection, { name: 'control',
    open: async function* (signal: AbortSignal) {
      try { yield* f.hooks.openStream('session/control', { args: {} }, signal) }
      catch (error: any) {
        if (error.dshRemoteStreamFailure?.kind === 'carrier') throw new gateway.RemoteStreamCarrierError(error.message)
        throw error
      }
    }, ended: () => new gateway.RemoteStreamCarrierError('ended') })
  const reader = new gateway.RemoteSnapshotStream(native, { name: 'control', isSnapshot: (frame: any) => frame.type === 'baseline',
    replace: (frame: any) => snapshots.push(frame.value), update: (frame: any) => updates.push(frame), failed: (error: unknown) => failures.push(error) })
  reader.start()
  const histories: any[] = []
  try {
    await vi.waitFor(() => expect(snapshots).toHaveLength(1))
    for (const id of ['one', 'two']) {
      const history = f.hooks.openStream('session/follow', { args: { request: { address: { sessionId: `arkme:origin:${id}` } } } }, abort.signal)[Symbol.asyncIterator]()
      histories.push(history); await history.next()
    }
    await vi.waitFor(() => expect(snapshots.at(-1).projections['arkme:origin:two']?.values.title).toBe('other stays'))
    pending.get('two:session/control')!({ ok: true, value: { items: [{ type: 'projection', sessionId: 'two', key: 'later', value: 'delta retained', seq: 10 }] } })
    await vi.waitFor(() => expect(updates.at(-1)?.key).toBe('later'))
    const before = snapshots.length
    baselines.one = { asOfSeq: 5, values: { title: 'recomputed at lower cut' } }
    pending.get('one:session/control')!({ ok: true, value: { items: [], done: true } })
    // Existing published data remains until the successor baseline is available.
    expect(snapshots).toHaveLength(before)
    await vi.waitFor(() => expect(snapshots.at(-1).projections['arkme:origin:one']).toEqual(baselines.one), { timeout: 2_000 })
    expect(snapshots.at(-1).projections).toEqual({
      local: f.localBaseline.projections.local,
      'arkme:origin:one': baselines.one,
      'arkme:origin:two': baselines.two,
    })
    expect(updates.filter(value => value.key === 'later')).toHaveLength(2) // replay after the new baseline
    expect(failures).toEqual([])
    expect(f.sockets.filter(value => String(value.url).includes('remote.mux'))).toHaveLength(1)
    expect(f.sockets.filter(value => String(value.url).includes('native-streams'))).toHaveLength(1)
  } finally { abort.abort(); for (const history of histories) await history.return(); await reader.dispose(); f.listeners.get('pagehide')?.() }
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
  f.directory.select('arkme:windows:same')
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
    f.directory.select('arkme:windows:other')
    const resumed = iterator.next()
    await vi.waitFor(() => expect(f.wire.mock.calls.some(([params]) => params.body.mode === 'close')).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(opens).toBe(4) // The native journal remains resident without background retries.
    f.directory.select('arkme:windows:same')
    const reopened = (await resumed).value
    reopened.accept()
    expect(reopened.generation).toBe(3)
    expect(reopened.value.type).toBe('snapshot')
    expect(opens).toBe(5)
    expect(restored.signal.aborted).toBe(true)
  } finally { await stream.dispose(); await unmount(); await plugin.dispose(); f.listeners.get('pagehide')?.() }
})

it('keeps a writable session enabled during an official carrier generation restart', async () => {
  const f = fixture(), abort = new AbortController()
  f.directory.publish([f.row('creator', { local: true, localTakeover: true, capabilities: ['session.native.channel'] })])
  f.directory.select('same')
  const stream = f.hooks.openStream('session/follow', { args: { request: { address: { sessionId: 'same' } } } }, abort.signal)[Symbol.asyncIterator]()
  await stream.next()
  await expect(stream.next()).rejects.toMatchObject({ dshRemoteStreamFailure: { kind: 'carrier' } })
  expect(f.directory.writable('same')).toBe(true)
  expect(f.attributes.get('data-arkme-source-writable')).toBe('true')
  abort.abort()
})

it('scopes authoritative cloud read-only responses to one canonical session', async () => {
  const f = fixture()
  const rows = [f.row('creator', { capabilities: ['session.native.channel'] }), f.row('creator', { sessionRef: 'other', capabilities: ['session.native.channel'] })]
  f.directory.publish(rows)
  f.fetch.mockImplementation(async () => Response.json({ ok: true, value: { ok: true, value: {}, sourceWritable: false } }))
  await f.rpc('session/page', { request: { address: { sessionId: 'arkme:creator:other' } } })
  expect(f.directory.writable('arkme:creator:other')).toBe(false)
  expect(f.directory.writable('arkme:creator:same')).toBe(true)
  f.directory.publish(rows)
  expect(f.directory.writable('arkme:creator:other')).toBe(false)
  f.fetch.mockImplementation(async () => Response.json({ ok: true, value: { ok: true, value: {}, sourceWritable: true } }))
  await f.rpc('session/page', { request: { address: { sessionId: 'arkme:creator:other' } } })
  expect(f.directory.writable('arkme:creator:other')).toBe(true)
})

it('ignores an old cancelled read-only response after its successor became writable', async () => {
  const f = fixture(), cancelled = new AbortController()
  f.directory.publish([f.row('creator', { capabilities: ['session.native.channel'] })])
  let finish!: () => void
  f.fetch.mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { finish = resolve })
    return Response.json({ ok: true, value: { ok: true, value: {}, sourceWritable: false } })
  })
  const old = f.hooks.fetch(new URL('http://localhost:3000/api/session/page'), {
    signal: cancelled.signal,
    body: JSON.stringify({ rpcId: 'old', method: 'session/page', payload: { args: { request: { address: { sessionId: 'arkme:creator:same' } } } } }),
  })
  const checked = expect(old).rejects.toMatchObject({ name: 'AbortError' })
  cancelled.abort()
  await f.rpc('session/prompt', { request: { sessionId: 'arkme:creator:same', content: [] } })
  finish(); await checked
  expect(f.directory.writable('arkme:creator:same')).toBe(true)
})
