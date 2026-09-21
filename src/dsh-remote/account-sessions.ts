import { DshCloudNativeTransport } from './cloud-native-transport.js'
import { DshNativeHistoryCache } from './native-history-cache.js'
import type { NativeHistoryPage, NativeHistoryRecord } from './native-history.js'
import { DshRemoteFragmentReader, dshRemoteOutboundPayloads } from './transport-fragment.js'
import type { DshRemoteHistoryEntry } from './dsh-event-contract.js'
import { randomUUID } from 'node:crypto'
import { DshRemoteError, type DshRemoteErrorCode } from './errors.js'
import { parseDshRemoteRequest } from './protocol-v1.js'
import { projectDshHistoryNodes } from './turn-projector.js'
import type { DshRemoteHttpRequester } from './control-plane.js'
import type { DshAccountSessionPage, DshAccountSessionHistory, DshSessionHistoryCursor } from './account-session-types.js'
import type { DshRemoteRealtimeTransport, DshRemoteRuntimeTarget, DshRemoteStatus, DshRemoteTimelineNode } from './types.js'

const BASE = '/api/v1/dsh-remote'
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '会话数据格式无效')
  return value as Record<string, unknown>
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '会话列表格式无效')
  return value
}
function ref(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '会话引用无效')
  return value
}
interface Runtime { capabilities: string[]; target: DshRemoteRuntimeTarget; generation: number; presence: string; desktopRef: string; desktopName: string; runtimeName: string }
interface Channel {
  transport: DshRemoteRealtimeTransport
  controller: AbortController
  ready: Promise<void>
  listeners: Set<(payload: Record<string, unknown>) => void>
  users: number
  runtime: Runtime
}

/** Account directory and controller-side routing. DSH Host remains the sole execution owner. */
export class DshAccountSessions {
  private lifetime = new AbortController()
  private readonly cloud: DshCloudNativeTransport
  private readonly nativeHistories = new Map<string, { key: string; address: Record<string, unknown>; touched: number }>()
  private readonly channels = new Map<string, Channel>()
  constructor(private readonly options: {
    request: DshRemoteHttpRequester
    requireAccount: () => Promise<string | void>
    historyCache?: DshNativeHistoryCache
    onCacheError?: () => void
    localStatus: () => DshRemoteStatus
    createTransport: () => DshRemoteRealtimeTransport
    profileRef: string
    clientRef: string
  }) { this.cloud = new DshCloudNativeTransport(options.request) }

  close(): void {
    this.lifetime.abort(new Error('会话账号已切换'))
    for (const channel of this.channels.values()) { channel.controller.abort(); void channel.transport.disconnect() }
    this.channels.clear()
    this.nativeHistories.clear()
    this.cloud.close()
    this.lifetime = new AbortController()
  }

  private async scope(signal?: AbortSignal): Promise<AbortSignal> {
    const scoped = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal
    await this.options.requireAccount()
    scoped.throwIfAborted()
    return scoped
  }

  private async runtimes(signal: AbortSignal): Promise<Map<string, Runtime>> {
    const result = await this.options.request.post(`${BASE}/desktops/list`, {}, signal)
    signal.throwIfAborted()
    const values = new Map<string, Runtime>()
    for (const raw of array(result.desktops)) {
      const desktop = object(raw), identity = object(desktop.desktop)
      for (const row of array(desktop.runtimes)) {
        const view = object(row), runtime = object(view.runtime), presence = object(view.presence)
        values.set(ref(runtime.runtime_ref), {
          target: { runtimeRef: ref(runtime.runtime_ref), hostProfileRef: ref(runtime.profile_ref), hostClientRef: ref(runtime.host_client_ref), hostLeaseGeneration: Number(presence.lease_generation ?? 0) },
          capabilities: Array.isArray(runtime.capabilities) ? runtime.capabilities.filter((v): v is string => typeof v === 'string') : [],
          generation: Number(runtime.host_generation), presence: String(presence.presence),
          desktopRef: ref(identity.desktop_ref), desktopName: String(identity.display_name ?? ''), runtimeName: String(runtime.profile_ref),
        })
      }
    }
    return values
  }

  async list(params: Record<string, unknown> = {}, requestSignal?: AbortSignal): Promise<DshAccountSessionPage> {
    const signal = await this.scope(requestSignal)
    const [page, runtimes] = await Promise.all([
      this.options.request.post(`${BASE}/sessions/account-list`, { limit: params.limit ?? 50, ...(params.cursor === undefined ? {} : { cursor: params.cursor }) }, signal),
      this.runtimes(signal),
    ])
    signal.throwIfAborted()
    const localRuntimeRef = this.options.localStatus().runtimeRef
    const localRuntime = localRuntimeRef === undefined ? undefined : runtimes.get(localRuntimeRef)
    const items = array(page.items).map(raw => {
      const row = object(raw), runtimeRef = ref(row.runtime_ref), runtime = runtimes.get(runtimeRef)
      if (!runtime) throw new DshRemoteError('REMOTE_PROJECTION_CONFLICT', '会话目录发生变化，请刷新', true)
      return {
        runtimeRef, sessionRef: ref(row.session_ref), workspaceRef: String(row.workspace_ref ?? ''), workspaceName: row.workspace_ref === '' ? '未分组' : '工作区信息暂不可用',
        capabilities: runtime.capabilities, title: String(row.title ?? ''), updatedAt: Number(row.source_updated_at), running: row.running === true,
        projectionAsOfSeq: Number.isSafeInteger(row.projection_as_of_seq) && Number(row.projection_as_of_seq) >= -1 ? Number(row.projection_as_of_seq) : -1,
        blank: row.blank === true, archived: row.archived === true, origin: String(row.origin ?? ''),
        desktopName: runtime.desktopName, runtimeName: runtime.runtimeName,
        sameDesktop: runtime.desktopRef === localRuntime?.desktopRef,
        presence: (runtime.presence === 'online' || runtime.presence === 'offline' ? runtime.presence : 'unknown') as 'online' | 'offline' | 'unknown',
        local: runtimeRef === localRuntimeRef,
      }
    })
    let warning: string | undefined
    const sources = [...new Set(items.filter(item => item.workspaceRef !== '').map(item => item.runtimeRef))]
    for (let offset = 0; offset < sources.length; offset += 4) await Promise.all(sources.slice(offset, offset + 4).map(async runtimeRef => {
      const wanted = new Set(items.filter(item => item.runtimeRef === runtimeRef && item.workspaceRef !== '').map(item => item.workspaceRef))
      let cursor: string | undefined
      const seen = new Set<string>()
      try {
        for (let page = 0; page < 50 && wanted.size; page++) {
          const result = await this.options.request.post(`${BASE}/workspaces/list`, { runtime_ref: runtimeRef, limit: 100, ...(cursor === undefined ? {} : { cursor }) }, signal)
          for (const raw of array(result.items)) {
            const workspace = object(raw), workspaceRef = ref(workspace.workspace_ref)
            for (const item of items) if (item.runtimeRef === runtimeRef && item.workspaceRef === workspaceRef) item.workspaceName = String(workspace.title || workspace.path || '未命名工作区')
            wanted.delete(workspaceRef)
          }
          if (result.next_cursor === undefined) break
          cursor = ref(result.next_cursor)
          if (seen.has(cursor)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '工作区游标重复')
          seen.add(cursor)
        }
      } catch { signal.throwIfAborted(); warning = '部分工作区信息暂未更新' }
    }))
    signal.throwIfAborted()
    return { contractVersion: 1, items, ...(warning === undefined ? {} : { warning }), ...(localRuntime === undefined ? {} : { localRuntime: { desktopName: localRuntime.desktopName, runtimeName: localRuntime.runtimeName } }), ...(page.next_cursor === undefined ? {} : { nextCursor: page.next_cursor as NonNullable<DshAccountSessionPage['nextCursor']> }), ...(localRuntimeRef === undefined ? {} : { localRuntimeRef }) }
  }

  private async runtime(runtimeRef: unknown, signal: AbortSignal): Promise<Runtime> {
    const runtime = (await this.runtimes(signal)).get(ref(runtimeRef))
    if (!runtime) throw new DshRemoteError('REMOTE_NOT_FOUND', '当前账号没有该实例')
    return runtime
  }

  private async acquire(runtime: Runtime, signal: AbortSignal): Promise<{ channel: Channel; release: () => void }> {
    if (runtime.presence !== 'online' || runtime.target.hostLeaseGeneration <= 0) throw new DshRemoteError('RUNTIME_OFFLINE', '源电脑暂不可执行', true)
    const key = runtime.target.runtimeRef
    let channel = this.channels.get(key)
    if (channel && (channel.runtime.generation !== runtime.generation || channel.runtime.target.hostLeaseGeneration !== runtime.target.hostLeaseGeneration)) {
      channel.controller.abort(); await channel.transport.disconnect(); this.channels.delete(key); channel = undefined
    }
    if (!channel) {
      if (this.channels.size >= 8) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '打开的远程实例过多')
      const controller = new AbortController(), transport = this.options.createTransport()
      channel = { controller, transport, listeners: new Set(), users: 0, runtime, ready: Promise.resolve() }
      const current = channel, reader = new DshRemoteFragmentReader()
      this.channels.set(key, channel)
      const stopDisconnect = transport.subscribeDisconnect(error => controller.abort(error))
      controller.signal.addEventListener('abort', stopDisconnect, { once: true })
      channel.ready = (async () => {
        await transport.connect({ profileRef: this.options.profileRef, clientRef: `${this.options.clientRef}_${key}`, signal: controller.signal })
        await transport.subscribe({ target: runtime.target, signal: controller.signal, onEvent: (raw, metadata) => {
          if (metadata.runtimeRef !== runtime.target.runtimeRef || metadata.senderRole !== 'host' || metadata.targetHostLeaseGeneration !== runtime.target.hostLeaseGeneration) return
          try {
            const payload = reader.accept(raw)
            if (!payload || payload.protocol !== 'dsh.remote' || payload.protocol_major !== 1 || payload.host_generation !== runtime.generation) return
            for (const listener of current.listeners) listener(payload)
          } catch (error) { controller.abort(error) }
        } })
      })()
    }
    const current = channel
    current.users++
    let released = false
    const release = () => {
      if (released) return
      released = true
      signal.removeEventListener('abort', release)
      if (--current.users === 0) {
        current.controller.abort()
        void current.transport.disconnect()
        if (this.channels.get(key) === current) this.channels.delete(key)
      }
    }
    signal.addEventListener('abort', release, { once: true })
    try { await current.ready; signal.throwIfAborted(); current.controller.signal.throwIfAborted(); return { channel: current, release } }
    catch (error) { release(); throw error }
  }

  private async rpc(runtime: Runtime, operation: string, body: Record<string, unknown>, requestRef: string, signal: AbortSignal): Promise<unknown> {
    const now = Date.now()
    const request = parseDshRemoteRequest({ protocol: 'dsh.remote', protocol_major: 1, kind: 'request', request_ref: requestRef, host_generation: runtime.generation, issued_at: now, execute_before: now + 30_000, operation, body }, { expectedHostGeneration: runtime.generation, nowMillis: now })
    const { channel, release } = await this.acquire(runtime, signal)
    try {
      return await new Promise((resolve, reject) => {
        const abort = () => finish(() => reject(combined.reason))
        const combined = AbortSignal.any([signal, channel.controller.signal, AbortSignal.timeout(30_000)])
        const finish = (action: () => void) => { channel.listeners.delete(receive); combined.removeEventListener('abort', abort); action() }
        const receive = (payload: Record<string, unknown>) => {
          if (payload.kind !== 'response' || payload.request_ref !== request.request_ref || payload.operation !== operation) return
          if (payload.error !== undefined) {
            const error = object(payload.error)
            const safe: Partial<Record<DshRemoteErrorCode, string>> = {
              CAPABILITY_UNSUPPORTED: '源实例不支持该操作', WORKSPACE_UNAVAILABLE: '源工作区不可用',
              SESSION_NOT_FOUND: '源会话不存在', COMMAND_EXPIRED: '命令已过期', COMMAND_OUTCOME_UNKNOWN: '命令结果未知，请核对源会话',
              INTERACTION_RESOLVED: '该交互已处理', HOST_GENERATION_STALE: '源实例已重启，请重新连接',
              SESSION_STATE_CHANGED: '会话状态已变化，请刷新', REMOTE_REQUEST_INVALID: '会话操作参数无效',
            }
            const code = String(error.code) as DshRemoteErrorCode
            finish(() => reject(new DshRemoteError(safe[code] ? code : 'REMOTE_TRANSPORT_FAILED', safe[code] ?? '源电脑操作失败', error.retryable === true)))
            return
          }
          if (['accepted', 'completed', 'duplicate'].includes(String(payload.status))) finish(() => resolve(payload.result))
        }
        channel.listeners.add(receive)
        combined.addEventListener('abort', abort, { once: true })
        if (combined.aborted) { abort(); return }
        void (async () => {
          const frames = operation === 'session.native' ? dshRemoteOutboundPayloads(request, requestRef) : [{ value: request }]
          // Bounded parallel publication keeps native attachments within the
          // existing command deadline; fragment assembly is order-independent.
          for (let offset = 0; offset < frames.length; offset += 8) await Promise.all(frames.slice(offset, offset + 8).map(frame =>
            channel.transport.publish({ target: runtime.target, commandId: frame.commandId ?? requestRef, direction: 'request', payload: frame.value as Record<string, unknown>, signal: combined })))
        })().catch(error => finish(() => reject(error)))
      })
    } finally { release() }
  }

  async command(params: Record<string, unknown>, requestSignal?: AbortSignal): Promise<unknown> {
    const signal = await this.scope(requestSignal), runtime = await this.runtime(params.runtimeRef, signal)
    const operation = String(params.operation)
    if (!['session.create', 'session.rename', 'session.archive', 'session.prompt', 'session.cancel', 'session.model.get', 'session.model.select', 'model.list', 'interaction.question.respond', 'interaction.approval.respond'].includes(operation)) throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '不支持该会话操作')
    const body = { ...object(params.body ?? {}), ...(operation === 'model.list' || operation === 'session.create' ? {} : { session_ref: ref(params.sessionRef) }) }
    return await this.rpc(runtime, operation, body, ref(params.requestRef), signal)
  }

  async read(params: Record<string, unknown>, requestSignal?: AbortSignal): Promise<DshAccountSessionHistory> {
    const signal = await this.scope(requestSignal), runtime = await this.runtime(params.runtimeRef, signal), sessionRef = ref(params.sessionRef)
    const cursor = params.cursor === undefined ? undefined : object(params.cursor) as unknown as DshSessionHistoryCursor
    if (cursor && (!['host', 'cloud'].includes(cursor.source) || !Number.isSafeInteger(cursor.before) || cursor.before < 0)) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '历史游标无效')
    if (params.source !== undefined && params.source !== 'host' && params.source !== 'cloud') throw new DshRemoteError('REMOTE_REQUEST_INVALID', '历史来源无效')
    const source = cursor?.source ?? (params.source === 'host' ? 'host' : 'cloud')
    if (source === 'host' && runtime.presence === 'online') {
      const value = object(await this.rpc(runtime, 'session.history', { session_ref: sessionRef, limit: 50, ...(cursor ? { before_seq: cursor.before } : {}), omit_superseded_chunks: true }, randomUUID(), signal))
      const nodes = projectDshHistoryNodes(array(value.entries) as DshRemoteHistoryEntry[])
      return { nodes, complete: value.hasMore !== true, online: true, ...(value.nextCursor === undefined ? {} : { nextCursor: { source: 'host', before: Number(value.nextCursor) } }) }
    }
    if (source === 'host') throw new DshRemoteError('RUNTIME_OFFLINE', '源电脑已离线，请重新打开已同步历史', true)
    const value = await this.options.request.post(`${BASE}/session-turns/list`, { runtime_ref: runtime.target.runtimeRef, session_ref: sessionRef, limit: 20, ...(cursor ? { before_start_seq: cursor.before } : {}) }, signal)
    signal.throwIfAborted()
    const nodes = array(value.items).flatMap(raw => array(object(raw).nodes) as DshRemoteTimelineNode[]).sort((a, b) => a.anchor_seq - b.anchor_seq || a.ordinal - b.ordinal)
    return { nodes, complete: value.complete === true, online: false, ...(value.next_cursor === undefined ? {} : { nextCursor: { source: 'cloud', before: Number(value.next_cursor) } }), ...(value.complete === true ? {} : { warning: '部分历史尚未同步，等待源电脑补齐' }) }
  }

  private cached<T>(read: () => T): T | undefined {
    try { return read() } catch { delete this.options.historyCache; this.options.onCacheError?.(); return undefined }
  }

  /** Native browser carrier; account, target and lease resolution stay Host-owned. */
  async native(params: Record<string, unknown>, requestSignal?: AbortSignal): Promise<unknown> {
    const signal = await this.scope(requestSignal)
    const account = await this.options.requireAccount()
    signal.throwIfAborted()
    const runtime = await this.runtime(params.runtimeRef, signal)
    let body = object(params.body)
    const cache = this.options.historyCache
    const stream = `${account}:${runtime.target.runtimeRef}:${String(body.streamRef)}`
    const sourceWritable = runtime.presence === 'online' && runtime.target.hostLeaseGeneration > 0 && runtime.capabilities.includes('session.native')
    if (!sourceWritable) {
      const value = await this.cloud.call(runtime.target.runtimeRef, body, stream, signal, cache && typeof account === 'string'
        ? { store: { snapshot: key => this.cached(() => cache.snapshot(key)), page: (key, through, before) => this.cached(() => cache.page(key, through, before)), write: (key, records, snapshot) => { this.cached(() => cache.write(key, records, snapshot)) } }, key: session => DshNativeHistoryCache.key(account, runtime.target.runtimeRef, { kind: 'session', sessionId: session }) } : undefined)
      return { ...value, sourceWritable: false }
    }
    if (this.cloud.has(stream)) {
      this.cloud.release(stream)
      if (body.mode === 'close') return { done: true, sourceWritable: true }
      throw new DshRemoteError('REMOTE_NOT_FOUND', '源实例已恢复，请重新连接', true)
    }
    for (const [id, item] of this.nativeHistories) if (Date.now() - item.touched > 45_000) this.nativeHistories.delete(id)
    let key: string | undefined
    if (cache && typeof account === 'string' && ['session/page', 'session/follow'].includes(String(body.endpoint))) {
      const request = object(object(body.payload).args).request as Record<string, unknown>
      const address = object(request.address)
      if (address.kind !== 'session' && (address.kind !== 'subagent' || !['one-shot', 'continuable'].includes(String(address.mode)))) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '原生会话地址无效')
      const identity = address.kind === 'session' ? { kind: 'session', sessionId: ref(address.sessionId) }
        : { kind: 'subagent', parentSessionId: ref(address.parentSessionId), childSessionId: ref(address.childSessionId), mode: address.mode }
      key = DshNativeHistoryCache.key(account, runtime.target.runtimeRef, identity)
      if (body.mode === 'call' && body.endpoint === 'session/page') {
        if (!Number.isSafeInteger(request.throughSeq) || Number(request.throughSeq) < -1 || (request.beforeSeq !== undefined && (!Number.isSafeInteger(request.beforeSeq) || Number(request.beforeSeq) < 0))) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '历史分页序号无效')
        const page = this.cached(() => cache.page(key!, Number(request.throughSeq), request.beforeSeq === undefined ? undefined : Number(request.beforeSeq)))
        if (page) { signal.throwIfAborted(); return { ok: true, value: page, sourceWritable: true } }
      }
      if (body.mode === 'pull') {
        if (this.nativeHistories.size >= 64 && !this.nativeHistories.has(stream)) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '历史订阅数量超限')
        this.nativeHistories.set(stream, { key, address: identity, touched: Date.now() })
        const cached = this.cached(() => cache.snapshot(key!))
        if (runtime.capabilities.includes('session.native.history') && cached && this.cached(() => cache.page(key!, Number(cached.cursor)))) body = { ...body, afterSeq: cached.cursor }
      }
    }
    const history = this.nativeHistories.get(stream)
    if (history) history.touched = Date.now()
    const value = object(await this.rpc(runtime, 'session.native', body, ref(params.requestRef), signal))
    signal.throwIfAborted()
    if (body.mode === 'close' || value.done === true) this.nativeHistories.delete(stream)
    if (!cache) return { ...value, sourceWritable: true }
    if (key && body.endpoint === 'session/page' && value.ok === true) this.cached(() => cache.write(key!, object(value.value).records as NativeHistoryRecord[]))
    if (history && Array.isArray(value.items)) {
      const records: NativeHistoryRecord[] = []
      for (let i = 0; i < value.items.length; i++) {
        const frame = object(value.items[i])
        if (frame.type === 'snapshot') {
          this.cached(() => cache.write(history.key, frame.records as NativeHistoryRecord[], frame))
          let page = this.cached(() => cache.page(history.key, Number(frame.cursor)))
          if (!page) {
            const full = object(await this.rpc(runtime, 'session.native', { mode: 'call', endpoint: 'session/page', payload: { args: { request: { address: history.address, throughSeq: frame.cursor } } } }, randomUUID(), signal))
            if (full.ok !== true) throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', '历史缓存缺页')
            page = full.value as NativeHistoryPage
            signal.throwIfAborted()
            this.cached(() => cache.write(history.key, page!.records))
          }
          value.items[i] = { ...frame, ...page }
        } else if (frame.type === 'event') records.push(frame as NativeHistoryRecord)
      }
      if (records.length) this.cached(() => cache.write(history.key, records))
    }
    return { ...value, sourceWritable: true }
  }

  async observe(params: Record<string, unknown>, requestSignal: AbortSignal, notify: () => void): Promise<void> {
    const signal = await this.scope(requestSignal), runtime = await this.runtime(params.runtimeRef, signal), sessionRef = ref(params.sessionRef)
    const { channel, release } = await this.acquire(runtime, signal)
    const receive = (payload: Record<string, unknown>) => {
      if (payload.kind === 'event' || payload.kind === 'snapshot') {
        const body = object(payload.body)
        if (body.session_ref === sessionRef || body.session_ref === undefined) notify()
      }
    }
    try {
      channel.listeners.add(receive)
      notify()
      const combined = AbortSignal.any([signal, channel.controller.signal])
      await new Promise<void>((resolve, reject) => {
        const abort = () => signal.aborted ? resolve() : reject(combined.reason)
        if (combined.aborted) abort(); else combined.addEventListener('abort', abort, { once: true })
      })
    } finally { channel.listeners.delete(receive); release() }
  }
}
