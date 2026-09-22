import { readFiveTurns, type NativeHistoryPage } from './native-history.js'
import { randomUUID } from 'node:crypto'
import type { DshConnectionLike, DshGatewayLike } from './gateway-api.js'
import { DshRemoteError } from './errors.js'

type RecordValue = Record<string, unknown>
export function nativeRecord(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '原生传输数据无效')
  return value as RecordValue
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '原生列表数据无效')
  return value
}
type Scope = {
  accountId: string
  createSessionId: string
  claim(id: string): Promise<void>
  signal: AbortSignal
  owned(ids: string[]): Promise<Set<string>>
}
type Lease = {
  accountId: string; endpoint: string; controller: AbortController
  iterator: AsyncIterator<unknown>; pending?: Promise<IteratorResult<unknown>>
  timer: ReturnType<typeof setTimeout>; busy: boolean
  clientId?: string; events: Set<string>; historyRequest?: RecordValue; afterSeq?: number | undefined
}

/** Native wire values remain native: no mobile timeline conversion, UI or
 * Session implementation lives here. The allowlist is an authorization boundary. */
export class DshNativeTransport {
  private readonly streams = new Map<string, Lease>()
  private readonly opening = new Set<string>()
  constructor(private readonly gateway: DshGatewayLike, private readonly connection: DshConnectionLike) {}

  close(): void { for (const id of this.streams.keys()) this.release(id) }

  private release(id: string): void {
    const lease = this.streams.get(id)
    if (!lease) return
    this.streams.delete(id); clearTimeout(lease.timer); lease.controller.abort()
    void lease.iterator.return?.().catch(() => undefined)
  }

  private async requireOwned(scope: Scope, id: unknown): Promise<void> {
    if (typeof id !== 'string' || !(await scope.owned([id])).has(id)) throw new DshRemoteError('REMOTE_NOT_FOUND', '当前账号没有该会话')
    scope.signal.throwIfAborted()
  }

  private async authorize(endpoint: string, payload: unknown, scope: Scope, stream: boolean): Promise<void> {
    const args = nativeRecord(nativeRecord(payload).args)
    if (stream && ['$events', 'session/control', 'workspace/follow'].includes(endpoint)) return
    if (!stream && ['session/create', 'session/list', 'session/modelCatalog', 'session/canOpenWorkspacePath', 'settings/describe', 'agentPresets/list'].includes(endpoint)) return
    if (endpoint === '$events/result' && !stream) {
      const lease = [...this.streams.values()].find(item => item.accountId === scope.accountId && item.clientId === args.clientId && item.events.has(String(args.eventId)))
      if (!lease) throw new DshRemoteError('REMOTE_NOT_FOUND', '交互已经结束')
      return
    }
    if ((stream && endpoint === 'session/follow') || (!stream && endpoint === 'session/page')) {
      const address = nativeRecord(nativeRecord(args.request).address)
      // Native Gateway verifies a subagent's parent/child relationship.
      await this.requireOwned(scope, address.kind === 'session' ? address.sessionId : address.parentSessionId)
      return
    }
    if (!stream && /^(session\/(rename|selectModel|prompt|attachment|updateQueue|cancel)|messageFeedback\/(list|put|delete)|sessionFeedback\/record|workspace\/archiveSession)$/.test(endpoint)) {
      await this.requireOwned(scope, nativeRecord(args.request).sessionId)
      return
    }
    if (!stream && /^subagents\/(list|prompt|interruptByParent)$/.test(endpoint)) {
      await this.requireOwned(scope, endpoint === 'subagents/prompt' ? nativeRecord(args.request).parentSessionId : args.parentSessionId)
      return
    }
    // These APIs resolve their Agent through the native Gateway. A caller may
    // address only an account-owned root; arbitrary namespaces stay closed.
    if (!stream && /^(commands\/(list|execute)|goals\/(get|edit|pause|resume|complete|clear|create)|fileUploads\/upload|fileReferences\/list|agentPresets\/select|permissionPresets\/(list|select))$/.test(endpoint)) {
      await this.requireOwned(scope, args.agent)
      return
    }
    throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '当前远程连接不支持该原生操作')
  }

  private async filter(endpoint: string, value: unknown, scope: Scope, lease?: Lease): Promise<unknown | undefined> {
    const frame = nativeRecord(value)
    const ids = async (values: unknown[]) => await scope.owned(values.filter((v): v is string => typeof v === 'string'))
    if (endpoint === 'session/list') {
      const items = list(frame.items), owned = await ids(items.map(item => nativeRecord(item).sessionId))
      return { ...frame, items: items.filter(item => owned.has(String(nativeRecord(item).sessionId))) }
    }
    if (endpoint === 'session/control') {
      if (frame.type !== 'baseline') return (await ids([frame.sessionId])).has(String(frame.sessionId)) ? frame : undefined
      const baseline = nativeRecord(frame.value), refs = Object.values(baseline).flatMap(value => Object.keys(nativeRecord(value)))
      const owned = await ids(refs)
      return { ...frame, value: Object.fromEntries(Object.entries(baseline).map(([key, value]) => [key, Object.fromEntries(Object.entries(nativeRecord(value)).filter(([id]) => owned.has(id)))])) }
    }
    if (endpoint === 'workspace/follow' || endpoint === 'workspace/archiveSession') {
      const source = frame.type === 'baseline' ? nativeRecord(frame.value) : frame
      const items = source.items === undefined ? [] : list(source.items)
      const workspaces = source.workspace === undefined ? items : [source.workspace]
      const owned = await ids([...workspaces.flatMap(item => list(nativeRecord(item).sessionIds)), ...list(source.archivedSessionIds ?? [])])
      const project = (raw: unknown) => { const item = nativeRecord(raw); return { ...item, sessionIds: list(item.sessionIds).filter(id => owned.has(String(id))) } }
      const projected = { ...source,
        ...(source.items === undefined ? {} : { items: items.map(project).filter(item => item.sessionIds.length > 0) }),
        ...(source.workspace === undefined ? {} : { workspace: project(source.workspace) }),
        ...(source.archivedSessionIds === undefined ? {} : { archivedSessionIds: list(source.archivedSessionIds).filter(id => owned.has(String(id))) }),
      }
      if (source.workspace !== undefined && nativeRecord(projected.workspace).sessionIds instanceof Array && (nativeRecord(projected.workspace).sessionIds as unknown[]).length === 0) return undefined
      return frame.type === 'baseline' ? { ...frame, value: projected } : projected
    }
    if (endpoint === '$events' && lease) {
      if (frame.type === 'ready') { lease.clientId = String(frame.clientId); return frame }
      if (frame.type === 'cancel') { if (!lease.events.delete(String(frame.eventId))) return; return frame }
      if (frame.type === 'waterfall') {
        if ((await ids([frame.agentId])).has(String(frame.agentId))) { lease.events.add(String(frame.eventId)); return frame }
        await this.call('$events/result', { args: { clientId: lease.clientId, eventId: frame.eventId, outcome: { kind: 'next' } } }, scope.signal)
        return
      }
      if (frame.type === 'emit' && typeof frame.event === 'string') {
        if (frame.event === 'llm/adapters-updated') return frame
        if (frame.event.startsWith('api-session/')) {
          const first = list(frame.args)[0], id = frame.event === 'api-session/added' ? nativeRecord(first).sessionId : first
          return (await ids([id])).has(String(id)) ? frame : undefined
        }
        if (['agent-preset/selected', 'goal/activation-changed'].includes(frame.event)) return (await ids([list(frame.args)[0]])).has(String(list(frame.args)[0])) ? frame : undefined
      }
      return
    }
    return frame
  }

  private async call(endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    const response = await this.connection.createSharedFetchHandler('/api').fetch(new Request(`http://localhost/api/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload }),
    }))
    const envelope = nativeRecord(await response.json())
    return envelope.result
  }

  private async historyPage(request: RecordValue, signal: AbortSignal): Promise<NativeHistoryPage> {
    const result = nativeRecord(await this.call('session/page', { args: { request: { ...request, maxMessages: 10 } } }, signal))
    if (result.ok !== true) throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', '源实例历史读取失败')
    return result.value as NativeHistoryPage
  }

  async request(body: RecordValue, scope: Scope): Promise<unknown> {
    scope.signal.throwIfAborted()
    const mode = body.mode, id = String(body.streamRef ?? '')
    if (mode === 'close') {
      if (this.streams.get(id)?.accountId === scope.accountId) this.release(id)
      return { done: true }
    }
    if (mode === 'call') {
      const endpoint = String(body.endpoint)
      await this.authorize(endpoint, body.payload, scope, false)
      if (endpoint === 'session/create') {
        const args = nativeRecord(nativeRecord(body.payload).args), request = nativeRecord(args.request)
        const sessionId = request.sessionId ?? scope.createSessionId
        if (typeof sessionId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId)) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '会话标识无效')
        // Reserve ownership before the native owner publishes the new session.
        await scope.claim(sessionId)
        body = { ...body, payload: { args: { ...args, request: { ...request, sessionId } } } }
      }
      if (endpoint === 'session/canOpenWorkspacePath') return { ok: true, value: false }
      if (endpoint === 'session/page') {
        const request = nativeRecord(nativeRecord(body.payload).args).request as RecordValue
        const page = await this.historyPage(request, scope.signal)
        return { ok: true, value: await readFiveTurns(page, beforeSeq => this.historyPage({ ...request, beforeSeq }, scope.signal)) }
      }
      const result = nativeRecord(await this.call(endpoint, body.payload, scope.signal))
      if (result.ok === true && endpoint === 'settings/describe') result.value = { ...nativeRecord(result.value), writable: false, hasDocument: false }
      if (result.ok === true && ['session/list', 'workspace/archiveSession'].includes(endpoint)) result.value = await this.filter(endpoint, result.value, scope)
      scope.signal.throwIfAborted()
      return result
    }
    let lease = this.streams.get(id)
    if (!lease) {
      if (body.endpoint === undefined) throw new DshRemoteError('REMOTE_NOT_FOUND', '原生订阅已断开', true)
      if (this.opening.has(id)) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '原生订阅正在建立')
      if (this.streams.size + this.opening.size >= 64) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '原生订阅数量超限')
      this.opening.add(id)
      try {
      const endpoint = String(body.endpoint)
      await this.authorize(endpoint, body.payload, scope, true)
      const controller = new AbortController(), signal = AbortSignal.any([controller.signal, scope.signal])
      const historyRequest = endpoint === 'session/follow' ? nativeRecord(nativeRecord(body.payload).args).request as RecordValue : undefined
      const payload = historyRequest ? { args: { request: { ...historyRequest, maxMessages: 10 } } } : body.payload
      const stream = await this.gateway.wireStream.open(endpoint, payload, signal)
      lease = { accountId: scope.accountId, endpoint, controller, iterator: stream[Symbol.asyncIterator](), busy: false, events: new Set(), ...(historyRequest ? { historyRequest, afterSeq: body.afterSeq as number | undefined } : {}), timer: setTimeout(() => this.release(id), 45_000) }
      lease.timer.unref(); this.streams.set(id, lease)
      signal.addEventListener('abort', () => this.release(id), { once: true })
      } finally { this.opening.delete(id) }
    }
    if (lease.accountId !== scope.accountId || lease.busy) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '原生订阅请求冲突')
    lease.busy = true; lease.timer.refresh()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), 20_000) })
    const items: unknown[] = []
    try {
      while (items.length < 64) {
        lease.pending ??= lease.iterator.next()
        let batchTimer: ReturnType<typeof setTimeout> | undefined
        const next = await Promise.race([lease.pending, items.length ? new Promise<undefined>(resolve => { batchTimer = setTimeout(() => resolve(undefined), 2) }) : deadline])
        clearTimeout(batchTimer)
        scope.signal.throwIfAborted()
        if (!next) return { items }
        delete lease.pending
        if (next.done) { this.release(id); return { items, done: true } }
        const value = await this.filter(lease.endpoint, next.value, scope, lease)
        if (value !== undefined) {
        if (lease.historyRequest && nativeRecord(value).type === 'snapshot') {
          const snapshot = nativeRecord(value)
          const page = await readFiveTurns(snapshot as NativeHistoryPage, beforeSeq => this.historyPage({ ...lease!.historyRequest, throughSeq: snapshot.cursor, beforeSeq }, scope.signal))
          const after = lease.afterSeq
          const records = after !== undefined && after <= Number(snapshot.cursor) && (page.records[0]?.event.seq ?? 0) <= after + 1
            ? page.records.filter(record => record.event.seq > after) : page.records
          items.push({ ...snapshot, ...page, records })
        } else items.push(value)
      }
      }
      return { items }
    } catch (error) { this.release(id); throw error }
    finally { clearTimeout(timeout); lease.busy = false; if (this.streams.get(id) === lease) lease.timer.refresh() }
  }
}
