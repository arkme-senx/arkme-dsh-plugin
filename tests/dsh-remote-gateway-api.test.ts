import { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { createDshGatewayApi, type DshGatewayLike } from '../src/dsh-remote/gateway-api.js'
import { DshApiProxyAdapter } from '../src/dsh-remote/api-proxy-adapter.js'

function feed(signal: AbortSignal) {
  const values: unknown[] = []
  let wake: (() => void) | undefined
  return {
    push(value: unknown) { values.push(value); wake?.(); wake = undefined },
    async *[Symbol.asyncIterator]() {
      const abort = () => { wake?.() }
      signal.addEventListener('abort', abort)
      try {
        while (!signal.aborted) {
          if (values.length) yield values.shift()
          else await new Promise<void>(resolve => { wake = resolve; if (signal.aborted) resolve() })
        }
      } finally { signal.removeEventListener('abort', abort) }
    },
  }
}
function fixture(context?: Context, factory = createDshGatewayApi) {
  let listener: ((session: { id: string }, event: unknown) => void) | undefined
  const off = vi.fn(() => { listener = undefined })
  let created: ((id: string) => void) | undefined
  const offCreated = vi.fn(() => { created = undefined })
  let restored: ((session: Session) => void) | undefined
  const offRestored = vi.fn(() => { restored = undefined })
  const liveSessions: Session[] = []
  const ctx = { sessions: { list: () => liveSessions }, on: vi.fn((name, callback) => {
    if (name === 'arkme/session-created') { created = callback; return offCreated }
    if (name === 'session/created') { restored = callback; return offRestored }
    listener = callback; return off
  }) } as unknown as Context
  const stopped = vi.fn()
  let controls: ReturnType<typeof feed>
  let interactions: ReturnType<typeof feed>
  const gateway: DshGatewayLike = {
    invoke: vi.fn(async input => input.method === 'page'
      ? { records: [{ type: 'event', event: { seq: 0, type: 'turn/start', time: 1, data: {} } }], hasMore: false }
      : { accepted: true }),
    stream: vi.fn(async input => {
      if (input.method === 'control') { controls = feed(input.signal!); return controls }
      return (async function* () {
        try {
          yield input.namespace === 'workspace'
            ? { type: 'baseline', value: { items: [], archivedSessionIds: ['archived'] } }
            : { type: 'snapshot', cursor: 7, records: [], hasMore: true, projections: { asOfSeq: 7, values: {} } }
        } finally { stopped(input.signal?.aborted) }
      })()
    }),
    wireStream: { open: vi.fn(async (_endpoint, _payload, signal) => {
      interactions = feed(signal); interactions.push({ type: 'ready', clientId: 'client-1' }); return interactions
    }) },
  }
  const fetch = vi.fn(async (_request: Request) => Response.json({ result: { ok: true } }))
  const controller = new AbortController()
  const api = factory(context ?? ctx, gateway, { createSharedFetchHandler: () => ({ fetch }) }, controller.signal)
  return { api, gateway, controller, stopped, off, offCreated, offRestored, fetch, created: (id: string) => created?.(id),
    liveSessions, restored: (session: Session) => restored?.(session),
    appendSession: (session: Session, event: unknown) => listener?.(session, event),
    controls: () => controls, interactions: () => interactions,
    append: (event: unknown) => listener?.({ id: 'session-1' }, event),
  }
}

describe('current DSH public Gateway compatibility', () => {
  it.each([false, true])('keeps restore and live events in the actual Cordis/SessionStore (already restored: %s)', async alreadyRestored => {
    // The compatibility gate can load the exact installed runtime, not the dev peer.
    const require = createRequire(process.env.ARKME_DSH_TEST_RUNTIME_PACKAGE ?? import.meta.url)
    const { Context: RuntimeContext } = require('@deepseek-ai/cordis') as typeof import('@deepseek-ai/cordis')
    const { SessionStore } = require('@deepseek-ai/dsh-session') as typeof import('@deepseek-ai/dsh-session')
    const factory = process.env.ARKME_DSH_TEST_GATEWAY_MODULE
      ? (await import(process.env.ARKME_DSH_TEST_GATEWAY_MODULE)).createDshGatewayApi as typeof createDshGatewayApi
      : createDshGatewayApi
    // Read the real assembly declaration; root.provide would bypass inject checks.
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const declaration = source.match(/ctx\.inject\(\[('typertGateway'[\s\S]*?)\], apiCtx/)
    expect(declaration).not.toBeNull()
    const dependencies = [...declaration![1]!.matchAll(/'([^']+)'/g)].map(match => match[1]!)
    const root = new RuntimeContext()
    const store = await root.plugin(SessionStore)
    const provider = await root.plugin(ctx => {
      for (const dependency of dependencies) if (dependency !== 'sessions') ctx.provide(dependency, {})
    })
    let restored!: Session
    let owner: Awaited<ReturnType<Context['inject']>> | undefined
    const restore = async () => {
      owner = await root.inject(['sessions'], ctx => {
        restored = ctx.sessions.create('restored', { seed: [
          { seq: 0, time: 1, type: 'turn/start', data: { turn: 1 } },
          { seq: 1, time: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
        ] })
      })
    }
    if (alreadyRestored) await restore()
    let f!: ReturnType<typeof fixture>
    const scope = await root.inject(dependencies, ctx => { f = fixture(ctx, factory) })
    const iterator = f.api.events!.mux!({ rpcId: 'real-inject', payload: {} }, f.controller.signal)[Symbol.asyncIterator]()
    try {
      const opening = iterator.next()
      if (!alreadyRestored) await restore()
      expect(await opening).toMatchObject({ done: false, value: { payload: {
        type: 'session/event', sessionId: restored.id, event: { type: 'session/end-seed', seq: restored.firstLiveSeq },
      } } })
      const event = restored.append('turn/start', { turn: 2 })
      expect(await iterator.next()).toMatchObject({ done: false, value: { payload: {
        type: 'session/event', sessionId: restored.id, event: { type: 'turn/start', seq: event.seq },
      } } })
    } finally {
      f.controller.abort()
      await iterator.return?.()
      await scope.dispose()
      await owner?.dispose()
      await provider.dispose()
      await store.dispose()
    }
  })
  it.each([false, true])('publishes only the new restore marker before live events (already restored: %s)', async alreadyRestored => {
    const f = fixture()
    const seed = Session.create('session-1')
    seed.append('session/end-seed', {})
    seed.append('turn/start', { turn: 1 })
    seed.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const restored = Session.create('session-1', seed.events)
    // rc.2 constructor appends seq3 before store attachment, without session/event.
    expect(restored.events[restored.firstLiveSeq]?.type).toBe('session/end-seed')
    if (alreadyRestored) f.liveSessions.push(restored)
    const adapter = new DshApiProxyAdapter(f.api)
    const events: number[] = []
    adapter.subscribeProjectionEvents(event => { if (event.kind === 'session-event') events.push(event.entry.event.seq) })
    const stop = adapter.startEvents()
    await vi.waitFor(() => expect(f.interactions()).toBeDefined())
    // A prior session/created listener may append before this mux's created callback.
    const live = restored.append('turn/start', { turn: 2 })
    f.appendSession(restored, live)
    f.restored(restored)
    f.restored(restored)
    await vi.waitFor(() => expect(events).toEqual([3, 4]))
    stop()
    await vi.waitFor(() => expect(f.offRestored).toHaveBeenCalledOnce())
    f.controller.abort()
  })

  it('does not republish an inherited marker or a new empty session as restore history', async () => {
    const f = fixture()
    const seed = Session.create('seed')
    seed.append('session/end-seed', {})
    f.liveSessions.push(Session.create('untouched', seed.events), Session.create('empty'))
    const adapter = new DshApiProxyAdapter(f.api)
    const projected = vi.fn()
    adapter.subscribeProjectionEvents(projected)
    const stop = adapter.startEvents()
    await vi.waitFor(() => expect(f.interactions()).toBeDefined())
    for (const session of f.liveSessions) f.restored(session)
    f.created('metadata')
    await vi.waitFor(() => expect(projected).toHaveBeenCalledWith({ kind: 'session-metadata', sessionId: 'metadata' }))
    expect(projected.mock.calls.some(([event]) => event.kind === 'session-event')).toBe(false)
    stop(); f.controller.abort()
  })

  it('does not duplicate a marker that arrives through the live event hook', async () => {
    const f = fixture()
    const adapter = new DshApiProxyAdapter(f.api)
    const events: number[] = []
    adapter.subscribeProjectionEvents(event => { if (event.kind === 'session-event') events.push(event.entry.event.seq) })
    const stop = adapter.startEvents()
    await vi.waitFor(() => expect(f.interactions()).toBeDefined())
    const session = Session.create('session-1')
    f.appendSession(session, session.append('session/end-seed', {}))
    f.restored(session)
    await vi.waitFor(() => expect(events).toEqual([0]))
    stop(); f.controller.abort()
  })
  it('keeps prompt correlation, maps namespaced errors and closes snapshot readers', async () => {
    const f = fixture()
    const prompt = { sessionId: 'session-1', mode: 'queue' as const, content: [{ type: 'text' as const, text: 'hello' }] }
    await f.api.sessions!.prompt!({ rpcId: 'dedup-1', payload: prompt })
    expect(f.gateway.invoke).toHaveBeenCalledWith(expect.objectContaining({
      namespace: 'session', method: 'prompt', args: { request: { ...prompt, requestId: 'dedup-1' } },
    }))
    await expect(f.api.workspace!.list!({ rpcId: 'w', payload: {} })).resolves.toMatchObject({ result: { value: { archivedSessionIds: ['archived'] } } })
    await f.api.sessions!.history!({ rpcId: 'h', payload: { sessionId: 'session-1', beforeSeq: 3, maxMessages: 2 } })
    expect(f.gateway.invoke).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'page', args: { request: {
      address: { kind: 'session', sessionId: 'session-1' }, throughSeq: 7, beforeSeq: 3, maxMessages: 2,
    } } }))
    expect(f.stopped.mock.calls).toEqual([[true], [true]])
    vi.mocked(f.gateway.invoke).mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'session/not-found' }))
    await expect(f.api.sessions!.list!({ rpcId: 'l', payload: {} })).resolves.toMatchObject({ result: { ok: false, error: { code: 'session-not-found' } } })
  })

  it('projects committed events and interactions and releases every subscription on abort', async () => {
    const f = fixture()
    const adapter = new DshApiProxyAdapter(f.api)
    const projected = vi.fn()
    adapter.subscribeProjectionEvents(projected)
    const stop = adapter.startEvents()
    await vi.waitFor(() => expect(f.interactions()).toBeDefined())
    f.interactions().push({ type: 'emit', event: 'api-session/added', args: [{ sessionId: 'new-session' }] })
    f.created('attached-session')
    f.controls().push({ type: 'projection', sessionId: 'renamed-session', key: 'title', value: 'new title', seq: 2 })
    await vi.waitFor(() => {
      expect(projected).toHaveBeenCalledWith({ kind: 'session-metadata', sessionId: 'new-session' })
      expect(projected).toHaveBeenCalledWith({ kind: 'session-metadata', sessionId: 'attached-session' })
      expect(projected).toHaveBeenCalledWith({ kind: 'session-metadata', sessionId: 'renamed-session' })
    })
    const event = { type: 'turn/start', seq: 8, time: 123, data: {} }
    f.append(event)
    f.controls().push({ type: 'baseline', value: { projections: { 'session-1': { asOfSeq: 7, values: {} } } } })
    f.interactions().push({ type: 'waterfall', event: 'user-questions/request', agentId: 'session-1', eventId: 'q1', request: {
      questions: [{ id: 'q', question: 'Proceed?' }],
    } })
    await vi.waitFor(() => expect(adapter.pending()).toHaveLength(1))
    expect(projected).toHaveBeenCalledWith(expect.objectContaining({ kind: 'session-event', sessionId: 'session-1', entry: { event } }))
    expect(projected).toHaveBeenCalledWith(expect.objectContaining({ kind: 'mux-baseline', lastSeq: 7 }))
    await adapter.answerQuestion({ sessionId: 'session-1', interactionRpcRef: 'q1', answer: { answers: [{ id: 'q', selected: ['yes'] }] } })
    const body = await f.fetch.mock.calls[0]![0].json()
    expect(body.payload).toEqual({ args: { clientId: 'client-1', eventId: 'q1', outcome: { kind: 'result', value: { answers: [{ id: 'q', selected: ['yes'] }] } } } })
    expect(adapter.pending()).toHaveLength(0)
    f.interactions().push({ type: 'waterfall', event: 'approval/request', agentId: 'session-1', eventId: 'a1', request: { toolName: 'exec' } })
    await vi.waitFor(() => expect(adapter.pending()).toHaveLength(1))
    await expect(adapter.answerApproval({ sessionId: 'session-1', interactionRpcRef: 'a1', approvalId: 'a1', outcome: 'allowed-once' }))
      .rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
    f.interactions().push({ type: 'cancel', eventId: 'a1' })
    await vi.waitFor(() => expect(adapter.pending()).toHaveLength(0))
    stop()
    await vi.waitFor(() => expect(f.off).toHaveBeenCalledTimes(1))
    expect(f.offCreated).toHaveBeenCalledOnce()
    f.controller.abort()
  })

  it('bounds event backlog and releases the failed generation before recovery', async () => {
    const f = fixture()
    const iterator = f.api.events!.mux!({ rpcId: 'm', payload: {} }, f.controller.signal)[Symbol.asyncIterator]()
    const next = iterator.next()
    const rejected = expect(next).rejects.toMatchObject({ code: 'REMOTE_TRANSPORT_FAILED' })
    await vi.waitFor(() => expect(f.interactions()).toBeDefined())
    for (let seq = 0; seq < 1025; seq++) f.append({ type: 'turn/start', seq, time: seq, data: {} })
    await rejected
    expect(f.off).toHaveBeenCalledTimes(1)
    f.controller.abort()
  })

  it('does not issue writes after the owning Host lifetime is cancelled', async () => {
    const f = fixture()
    f.controller.abort()
    await expect(f.api.sessions!.create!({ rpcId: 'new', payload: { workspaceId: 'w', sessionId: 's' } }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(f.gateway.invoke).not.toHaveBeenCalled()
  })

  it('fails closed on foreign or expired interaction ids and delegates unrelated waterfalls', async () => {
    const f = fixture()
    const iterator = f.api.events!.mux!({ rpcId: 'm', payload: {} }, f.controller.signal)[Symbol.asyncIterator]()
    const next = iterator.next()
    await vi.waitFor(() => expect(f.interactions()).toBeDefined())
    f.interactions().push({ type: 'waterfall', event: 'other/request', eventId: 'other', agentId: 'session-1', request: {} })
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(1))
    expect((await f.fetch.mock.calls[0]![0].json()).payload.args.outcome).toEqual({ kind: 'next' })
    await expect(f.api.respond!({ type: 'client-response', rpcId: 'unknown', result: { ok: true, value: {} } })).resolves.toMatchObject({ accepted: false })
    f.controller.abort(); await next; await iterator.return?.()
    expect(f.off).toHaveBeenCalledTimes(1)
  })
})

it('routes session catalog edits to the exact public Gateway owner', async () => {
  const f = fixture()
  const api = f.api
  await api.sessions!.rename!({ rpcId: 'rename-1', payload: { sessionId: 'remote-session', title: '新的标题' } })
  await api.workspace!.archiveSession!({ rpcId: 'archive-1', payload: { sessionId: 'remote-session' } })
  expect(f.gateway.invoke).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'session', method: 'rename', args: { request: { sessionId: 'remote-session', title: '新的标题' } } }))
  expect(f.gateway.invoke).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'workspace', method: 'archiveSession', args: { request: { sessionId: 'remote-session' } } }))
})
