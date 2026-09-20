import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import type { DshPublicApiProxyLike } from './api-proxy-adapter.js'
import { snapshotDshHistoryEntry } from './dsh-event-contract.js'
import { DshRemoteError } from './errors.js'

/** Public, carrier-independent DSH 0.1.5 Gateway seam (no private imports). */
export interface DshGatewayLike {
  invoke(request: { namespace: string; method: string; args: Record<string, unknown>; signal?: AbortSignal }): Promise<unknown>
  stream(request: { namespace: string; method: string; args: Record<string, unknown>; signal?: AbortSignal }): Promise<AsyncIterable<unknown>>
  wireStream: { open(endpoint: string, payload: unknown, signal: AbortSignal): Promise<AsyncIterable<unknown>> }
}
export interface DshConnectionLike {
  createSharedFetchHandler(channel: '/api'): { fetch(request: Request): Promise<Response> }
}
type Frame = { rpcId: string; payload: Record<string, unknown> }
type RecordValue = Record<string, unknown>
type Sessions = NonNullable<DshPublicApiProxyLike['sessions']>
type SessionValue<K extends keyof Sessions> = Extract<Awaited<ReturnType<NonNullable<Sessions[K]>>>, { result: { ok: true } }>['result']['value']
type WorkspaceValue = Extract<Awaited<ReturnType<NonNullable<NonNullable<DshPublicApiProxyLike['workspace']>['list']>>>, { result: { ok: true } }>['result']['value']
function record(value: unknown): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH Gateway 返回了无效对象')
  }
  return value as RecordValue
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH Gateway 缺少标识')
  return value
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH Gateway 返回了无效列表')
  return value
}

/** Keep the existing remote protocol/projections; translate only the DSH API boundary. */
export function createDshGatewayApi(
  ctx: Pick<Context, 'on'>,
  gateway: DshGatewayLike,
  connection: DshConnectionLike,
  lifetime: AbortSignal,
): DshPublicApiProxyLike {
  const pending = new Map<string, { clientId: string; sessionId: string; kind: 'question' | 'approval'; signal: AbortSignal }>()
  const invoke = async (method: string, request: Record<string, unknown> | undefined, signal = lifetime) => {
    signal.throwIfAborted()
    return await gateway.invoke({ namespace: 'session', method, args: request === undefined ? {} : { [method === 'list' ? '_request' : 'request']: request }, signal })
  }
  const wrap = <P, T>(operation: (payload: P, rpcId: string) => Promise<T>) =>
    async (request: { rpcId: string; payload: P }) => {
      try { return { rpcId: request.rpcId, result: { ok: true as const, value: await operation(request.payload, request.rpcId) } } }
      catch (error) {
        if (error instanceof DshRemoteError) throw error
        if (error === null || typeof error !== 'object') throw error
        const failure = record(error)
        if (typeof failure.code !== 'string') throw error
        const codes: Record<string, string> = {
          'session/not-found': 'session-not-found', 'workspace/not-found': 'workspace-not-found',
          'workspace/invalid-path': 'workspace-invalid-path', 'session/agent-busy': 'agent-busy',
          'session/steer-unavailable': 'steer-unavailable', 'session/queue-item-not-found': 'queue-item-not-found',
        }
        return { rpcId: request.rpcId, result: { ok: false as const, error: {
          code: codes[failure.code] ?? failure.code, message: String(failure.message ?? 'DSH 请求失败'),
        } } }
      }
    }
  // Snapshot-only readers always cancel AND return the iterator: no abandoned followers.
  async function opening(namespace: string, method: string, args: Record<string, unknown>) {
    const controller = new AbortController()
    const signal = AbortSignal.any([lifetime, controller.signal, AbortSignal.timeout(30_000)])
    signal.throwIfAborted()
    const stream = await gateway.stream({ namespace, method, args, signal })
    const iterator = stream[Symbol.asyncIterator]()
    try {
      const first = await iterator.next()
      if (first.done) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', `DSH ${namespace}.${method} 缺少初始快照`)
      return record(first.value)
    } finally { controller.abort(); await iterator.return?.() }
  }
  const api: DshPublicApiProxyLike = {
    workspace: { list: wrap(async () => {
      const frame = await opening('workspace', 'follow', {})
      if (frame.type !== 'baseline') throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH Workspace 缺少 baseline')
      const value = record(frame.value)
      return { items: array(value.items) as WorkspaceValue['items'], archivedSessionIds: array(value.archivedSessionIds) as string[] }
    }) },
    sessions: {
      list: wrap(async payload => record(await invoke('list', payload)) as unknown as SessionValue<'list'>),
      create: wrap(async payload => record(await invoke('create', payload)) as unknown as SessionValue<'create'>),
      modelCatalog: wrap(async () => record(await invoke('modelCatalog', undefined)) as unknown as SessionValue<'modelCatalog'>),
      selectModel: wrap(async payload => record(await invoke('selectModel', payload)) as unknown as SessionValue<'selectModel'>),
      prompt: wrap(async (payload, requestId) => record(await invoke('prompt', { ...payload, requestId })) as { accepted: true }),
      cancel: wrap(async payload => record(await invoke('cancel', payload)) as { accepted: true }),
      history: wrap(async payload => {
        const address = { kind: 'session', sessionId: payload.sessionId }
        const snapshot = await opening('session', 'follow', { request: { address, maxMessages: payload.maxMessages } })
        if (snapshot.type !== 'snapshot' || !Number.isSafeInteger(snapshot.cursor)) {
          throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH Session 缺少日志快照')
        }
        const page = payload.beforeSeq === undefined ? snapshot : record(await invoke('page', {
          address, throughSeq: snapshot.cursor, beforeSeq: payload.beforeSeq, maxMessages: payload.maxMessages,
        }))
        return {
          events: array(page.records).map(item => snapshotDshHistoryEntry({ event: record(item).event })),
          hasMore: page.hasMore === true,
          projections: record(snapshot.projections) as { asOfSeq: number; values: Record<string, unknown> },
        }
      }),
    },
    events: { mux: (_request, signal) => events(signal) },
    respond: async message => {
      const item = pending.get(message.rpcId)
      if (item === undefined || item.signal.aborted) return { accepted: false, reason: 'interaction-resolved' }
      const value = record(message.result.value)
      if (value.sessionId !== item.sessionId) return { accepted: false, reason: 'session-mismatch' }
      const outcome = item.kind === 'question' ? value.answer : value.outcome
      const result = await sendResult(item.clientId, message.rpcId, { kind: 'result', value: outcome }, item.signal)
      pending.delete(message.rpcId)
      return result
    },
  }
  async function sendResult(clientId: string, eventId: string, outcome: unknown, signal: AbortSignal) {
    // This is the public in-process Host carrier, not an unauthenticated network request.
    const response = await connection.createSharedFetchHandler('/api').fetch(new Request('http://localhost/api/$events/result', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: '$events/result', payload: { args: { clientId, eventId, outcome } } }),
    }))
    const result = record(record(await response.json()).result)
    if (!response.ok || result.ok !== true) throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'DSH 交互应答失败', true)
    return { accepted: true as const }
  }
  async function* events(parentSignal: AbortSignal): AsyncGenerator<Frame> {
    const controller = new AbortController()
    const signal = AbortSignal.any([lifetime, parentSignal, controller.signal])
    // ponytail: shift is O(n), capped at 1024 frames; use a ring only if profiling warrants it.
    const frames: Array<{ frame: Frame; bytes: number }> = []
    let bytes = 0
    let failure: unknown
    let wake: (() => void) | undefined
    const notify = () => { wake?.(); wake = undefined }
    const fail = (error: unknown) => { failure ??= error; controller.abort(); notify() }
    const push = (payload: Record<string, unknown>, rpcId: string = randomUUID()) => {
      if (signal.aborted) return
      try {
        const frame = { rpcId, payload }
        const size = Buffer.byteLength(JSON.stringify(frame))
        if (frames.length >= 1024 || bytes + size > 8 * 1024 * 1024) {
          throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'DSH 事件积压超限，重新建立快照', true)
        }
        frames.push({ frame, bytes: size }); bytes += size; notify()
      } catch (error) { fail(error) }
    }
    // One public append subscription for all sessions, not one follower per historical session.
    const off = ctx.on('session/event' as never, ((session: { id: string }, event: unknown) => {
      try { push({ type: 'session/event', sessionId: session.id, event: snapshotDshHistoryEntry({ event }).event }) }
      catch (error) { fail(error) }
    }) as never, { global: true })
    signal.addEventListener('abort', notify, { once: true })
    async function consume(stream: Promise<AsyncIterable<unknown>>, accept: (frame: RecordValue) => Promise<void> | void) {
      try {
        for await (const frame of await stream) {
          if (signal.aborted) break
          await accept(record(frame))
        }
        if (!signal.aborted) fail(new Error('DSH event stream ended'))
      } catch (error) { if (!signal.aborted) fail(error) }
    }
    let clientId: string | undefined
    const tasks = [
      consume(gateway.wireStream.open('$events', { args: {} }, signal), async frame => {
        if (frame.type === 'ready') { clientId = text(frame.clientId); return }
        if (frame.type === 'cancel') {
          const item = pending.get(text(frame.eventId))
          pending.delete(text(frame.eventId))
          if (item !== undefined) push(item.kind === 'question'
            ? { type: 'question/resolved', questionRpcId: frame.eventId }
            : { type: 'approval/resolved', sessionId: item.sessionId, approvalId: frame.eventId })
          return
        }
        if (frame.type !== 'waterfall' || clientId === undefined) return
        if (!['user-questions/request', 'approval/request'].includes(text(frame.event))) {
          await sendResult(clientId, text(frame.eventId), { kind: 'next' }, signal); return
        }
        if (pending.size >= 256) throw new Error('DSH pending interaction limit exceeded')
        const kind = frame.event === 'user-questions/request' ? 'question' : 'approval'
        const request = record(frame.request)
        pending.set(text(frame.eventId), { clientId, sessionId: text(frame.agentId), kind, signal })
        push(kind === 'question'
          ? { type: 'question/requested', sessionId: frame.agentId, questions: request.questions }
          : { type: 'approval/requested', sessionId: frame.agentId, approvalId: frame.eventId, toolName: request.toolName, reason: request.reason }, text(frame.eventId))
      }),
      consume(gateway.stream({ namespace: 'session', method: 'control', args: {}, signal }), frame => {
        if (frame.type === 'projection' && frame.key === 'goal') push({ ...frame, type: 'session/projection' })
        if (frame.type === 'baseline') {
          for (const [sessionId, value] of Object.entries(record(record(frame.value).projections))) {
            const projection = record(value)
            push({ type: 'session/subscribed', sessionId, lastSeq: projection.asOfSeq })
            if (record(projection.values).goal !== undefined) push({
              type: 'session/projection', sessionId, key: 'goal', value: record(projection.values).goal, seq: projection.asOfSeq,
            })
          }
        }
      }),
    ]
    try {
      while (!signal.aborted) {
        const next = frames.shift()
        if (next !== undefined) { bytes -= next.bytes; yield next.frame }
        else await new Promise<void>(resolve => { wake = resolve; if (signal.aborted) notify() })
      }
      if (failure !== undefined) throw failure
    } finally {
      controller.abort(); off(); signal.removeEventListener('abort', notify)
      await Promise.allSettled(tasks)
      for (const [id, item] of pending) if (item.signal === signal) pending.delete(id)
    }
  }
  return api
}
