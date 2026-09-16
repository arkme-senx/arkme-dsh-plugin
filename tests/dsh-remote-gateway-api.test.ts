import { Context } from '@deepseek-ai/cordis'
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
function fixture() {
  let listener: ((session: { id: string }, event: unknown) => void) | undefined
  const off = vi.fn(() => { listener = undefined })
  const ctx = { on: vi.fn((_name, callback) => { listener = callback; return off }) } as unknown as Context
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
  const api = createDshGatewayApi(ctx, gateway, { createSharedFetchHandler: () => ({ fetch }) }, controller.signal)
  return { api, gateway, controller, stopped, off, fetch,
    controls: () => controls, interactions: () => interactions,
    append: (event: unknown) => listener?.({ id: 'session-1' }, event),
  }
}

describe('current DSH public Gateway compatibility', () => {
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
