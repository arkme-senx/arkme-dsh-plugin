import { DshSessionChannelClient } from './session-channel.js'
import type { DshDirectoryDelta } from './account-session-directory.js'
import { DshCloudNativeTransport } from './cloud-native-transport.js'
import { DshNativeHistoryCache } from './native-history-cache.js'
import type { NativeHistoryPage, NativeHistoryRecord } from './native-history.js'
import { DshRemoteFragmentReader, dshRemoteOutboundPayloads } from './transport-fragment.js'
import type { DshRemoteHistoryEntry } from './dsh-event-contract.js'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
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
interface Runtime { checkedAt: number; capabilities: string[]; target: DshRemoteRuntimeTarget; generation: number; presence: string; desktopRef: string; desktopName: string; runtimeName: string }
interface Channel {
  transport: DshRemoteRealtimeTransport
  controller: AbortController
  ready: Promise<void>
  listeners: Set<(payload: Record<string, unknown>) => void>
  users: number
  runtime: Runtime
}
interface NativeRoute {
  runtimeRef: string
  sessionRef: string | undefined
  sessionChannel?: boolean
  idle?: ReturnType<typeof setTimeout>
  key: string
  runtime: Promise<Runtime>
  controller: AbortController
  users: number
}

/** Account directory and controller-side routing. DSH Host remains the sole execution owner. */
export class DshAccountSessions {
  private sessionChannel: DshSessionChannelClient | undefined
  private lifetime = new AbortController()
  private readonly cloud: DshCloudNativeTransport
  private readonly nativeHistories = new Map<string, { key: string; address: Record<string, unknown>; touched: number }>()
  private discovery: { promise: Promise<Map<string, Runtime>>; controller: AbortController; users: number } | undefined
  private readonly nativeStreams = new Map<string, { channel?: Channel; route: NativeRoute; release: () => void; timer: ReturnType<typeof setTimeout> }>()
  private readonly nativeRoutes = new Map<string, NativeRoute>()
  private readonly channels = new Map<string, Channel>()
  // Negotiated protocol support only; never cache the executor as a routing authority.
  private readonly stableRoutes = new Map<string, Runtime>()
  constructor(private readonly options: {
    request: DshRemoteHttpRequester
    requireAccount: () => Promise<string | void>
    historyCache?: DshNativeHistoryCache
    onCacheError?: () => void
    localStatus: () => DshRemoteStatus
    transport: DshRemoteRealtimeTransport
    connected: (signal: AbortSignal) => Promise<void>
    localNative?: (params: Record<string, unknown>, signal: AbortSignal) => Promise<unknown | undefined>
    localSession?: (runtimeRef: string, sessionRef: string) => boolean
  }) { this.cloud = new DshCloudNativeTransport(options.request) }

  close(): void {
    this.sessionChannel?.close(); this.sessionChannel = undefined
    this.lifetime.abort(new Error('会话账号已切换'))
    for (const route of this.nativeRoutes.values()) this.invalidateNativeRoute(route)
    for (const channel of this.channels.values()) channel.controller.abort()
    this.discovery = undefined
    this.channels.clear()
    this.stableRoutes.clear()
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

  private async wait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted()
    return await new Promise<T>((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }

  private async runtimes(signal: AbortSignal): Promise<Map<string, Runtime>> {
    signal.throwIfAborted()
    let flight = this.discovery
    if (!flight) {
      const controller = new AbortController()
      const scoped = AbortSignal.any([controller.signal, this.lifetime.signal, AbortSignal.timeout(30_000)])
      flight = { promise: this.loadRuntimes(scoped), controller, users: 0 }
      this.discovery = flight
    }
    const current = flight
    current.users++
    try { return await this.wait(current.promise, signal) }
    finally {
      if (--current.users === 0) { current.controller.abort(); if (this.discovery === current) this.discovery = undefined }
    }
  }

  private async loadRuntimes(signal: AbortSignal): Promise<Map<string, Runtime>> {
    const result = await this.options.request.post(`${BASE}/desktops/list`, {}, signal)
    signal.throwIfAborted()
    const values = new Map<string, Runtime>()
    for (const raw of array(result.desktops)) {
      const desktop = object(raw), identity = object(desktop.desktop)
      for (const row of array(desktop.runtimes)) {
        const view = object(row), runtime = object(view.runtime), presence = object(view.presence)
        values.set(ref(runtime.runtime_ref), {
          checkedAt: Date.now(),
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
      this.options.request.post(`${BASE}/sessions/account-list`, { limit: params.limit ?? 50,
        ...(params.includeDeleted === true ? { include_deleted: true } : {}), ...(params.cursor === undefined ? {} : { cursor: params.cursor }) }, signal),
      this.runtimes(signal),
    ])
    signal.throwIfAborted()
    const localRuntimeRef = this.options.localStatus().runtimeRef
    const localRuntime = localRuntimeRef === undefined ? undefined : runtimes.get(localRuntimeRef)
    const items = array(page.items).map(raw => {
      const row = object(raw), runtimeRef = ref(row.runtime_ref), runtime = runtimes.get(row.executor_runtime_ref ? ref(row.executor_runtime_ref) : runtimeRef)
      const deleted = Number(row.deleted_at ?? 0) > 0
      if (!runtime && !deleted) throw new DshRemoteError('REMOTE_PROJECTION_CONFLICT', '会话目录发生变化，请刷新', true)
      if (runtime && !deleted) this.rememberStableRoute(runtimeRef, row.session_ref, runtime)
      const localTakeover = this.options.localSession?.(runtimeRef, ref(row.session_ref)) === true
      return {
        runtimeRef, sessionRef: ref(row.session_ref), workspaceRef: String(row.workspace_ref ?? ''), workspaceName: row.workspace_ref === '' ? '未分组' : '工作区信息暂不可用',
        ...(Number.isSafeInteger(row.host_generation) && Number(row.host_generation) > 0 && Number.isSafeInteger(row.projection_at) && Number(row.projection_at) > 0
          ? { directoryVersion: [Number(row.host_generation), Number(row.projection_at)] as const } : {}),
        ...(deleted ? { deleted: true } : {}),
        capabilities: runtime?.capabilities ?? [], title: String(row.title ?? ''), updatedAt: Number(row.source_updated_at), running: row.running === true,
        projectionAsOfSeq: Number.isSafeInteger(row.projection_as_of_seq) && Number(row.projection_as_of_seq) >= -1 ? Number(row.projection_as_of_seq) : -1,
        blank: row.blank === true, archived: row.archived === true, origin: String(row.origin ?? ''),
        desktopName: runtime?.desktopName ?? '', runtimeName: runtime?.runtimeName ?? '',
        sameDesktop: runtime !== undefined && runtime.desktopRef === localRuntime?.desktopRef,
        presence: (runtime?.presence === 'online' || runtime?.presence === 'offline' ? runtime.presence : 'unknown') as 'online' | 'offline' | 'unknown',
        local: runtimeRef === localRuntimeRef || localTakeover,
        ...(row.executor_runtime_ref ? { executorRuntimeRef: ref(row.executor_runtime_ref) } : {}),
        ...(localTakeover ? { localTakeover: true } : {}),
      }
    })
    let warning: string | undefined
    // New servers include this page's workspaces in one account-scoped read.
    // Older servers retain their existing lookup path during rollout.
    if (Array.isArray(page.workspaces)) for (const raw of page.workspaces) {
      const workspace = object(raw)
      for (const item of items) if (item.runtimeRef === workspace.runtime_ref && item.workspaceRef === workspace.workspace_ref) item.workspaceName = String(workspace.title || workspace.path || '未命名工作区')
    }
    const sources = Array.isArray(page.workspaces) ? [] : [...new Set(items.filter(item => item.workspaceRef !== '').map(item => item.runtimeRef))]
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
    return { contractVersion: 1, items, ...(page.includes_deleted === true ? { includesDeleted: true } : {}), ...(warning === undefined ? {} : { warning }), ...(localRuntime === undefined ? {} : { localRuntime: { desktopName: localRuntime.desktopName, runtimeName: localRuntime.runtimeName } }), ...(page.next_cursor === undefined ? {} : { nextCursor: page.next_cursor as NonNullable<DshAccountSessionPage['nextCursor']> }), ...(localRuntimeRef === undefined ? {} : { localRuntimeRef }) }
  }

  private async runtime(runtimeRef: unknown, signal: AbortSignal): Promise<Runtime> {
    const key = ref(runtimeRef), active = this.channels.get(key)
    // Short routing reuse only while a live subscription owns the exact lease.
    // Realtime still checks that lease on every request; errors invalidate it.
    if (active && !active.controller.signal.aborted && Date.now() - active.runtime.checkedAt < 5_000) return active.runtime
    const runtime = (await this.runtimes(signal)).get(key)
    if (!runtime) throw new DshRemoteError('REMOTE_NOT_FOUND', '当前账号没有该实例')
    return runtime
  }

  private rememberStableRoute(runtimeRef: string, sessionRef: unknown, runtime: Runtime): void {
    const key = JSON.stringify([runtimeRef, sessionRef])
    if (runtime.presence === 'online' && typeof sessionRef === 'string') this.cloud.resume(runtimeRef, sessionRef)
    if (!runtime.capabilities.some(value => value === 'session.native.channel' || value === 'session.commands.channel')) { this.stableRoutes.delete(key); return }
    if (!this.stableRoutes.has(key) && this.stableRoutes.size >= 512) this.stableRoutes.delete(this.stableRoutes.keys().next().value!)
    this.stableRoutes.set(key, runtime)
  }

  private async executionRuntime(runtimeRef: unknown, sessionRef: unknown, signal: AbortSignal, capability = 'session.commands.channel'): Promise<Runtime> {
    const canonical = ref(runtimeRef), session = sessionRef === undefined ? undefined : ref(sessionRef)
    const known = this.stableRoutes.get(JSON.stringify([canonical, session]))
    if (known?.capabilities.includes(capability)) return known
    if (session === undefined) return this.runtime(canonical, signal)
    // Only unknown/legacy protocol discovery needs the execution directory.
    // Once negotiated, the account channel routes by the canonical session.
    const value = await this.options.request.post(`${BASE}/sessions/execution`, { runtime_ref: canonical, session_ref: session }, signal)
    const executor = value.executor_runtime_ref ? ref(value.executor_runtime_ref) : canonical
    const runtime = await this.runtime(executor, signal)
    this.rememberStableRoute(canonical, session, runtime)
    return runtime
  }

  private async acquire(runtime: Runtime, signal: AbortSignal): Promise<{ channel: Channel; release: () => void }> {
    if (runtime.presence !== 'online' || runtime.target.hostLeaseGeneration <= 0) throw new DshRemoteError('RUNTIME_OFFLINE', '源电脑暂不可执行', true)
    const key = runtime.target.runtimeRef
    let channel = this.channels.get(key)
    if (channel && (channel.runtime.generation !== runtime.generation || channel.runtime.target.hostLeaseGeneration !== runtime.target.hostLeaseGeneration)) {
      channel.controller.abort(); channel = undefined
    }
    if (!channel) {
      if (this.channels.size >= 8) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '打开的远程实例过多')
      const controller = new AbortController(), transport = this.options.transport
      channel = { controller, transport, listeners: new Set(), users: 0, runtime, ready: Promise.resolve() }
      const current = channel, reader = new DshRemoteFragmentReader()
      this.channels.set(key, channel)
      const stopDisconnect = transport.subscribeDisconnect(error => controller.abort(error))
      controller.signal.addEventListener('abort', () => {
        stopDisconnect()
        if (this.channels.get(key) === current) this.channels.delete(key)
        for (const [id, stream] of this.nativeStreams) if (stream.channel === current) {
          this.invalidateNativeRoute(stream.route); this.releaseStream(id)
        }
      }, { once: true })
      channel.ready = (async () => {
        await this.options.connected(controller.signal)
        await transport.subscribe({ target: runtime.target, signal: controller.signal, onError: error => controller.abort(error), onEvent: (raw, metadata) => {
          if (metadata.runtimeRef !== runtime.target.runtimeRef || metadata.senderRole !== 'host' || metadata.targetHostLeaseGeneration !== runtime.target.hostLeaseGeneration) return
          try {
            const payload = reader.accept(raw)
            if (!payload || payload.protocol !== 'dsh.remote' || payload.protocol_major !== 1 || payload.host_generation !== runtime.generation) return
            for (const listener of current.listeners) listener(payload)
          } catch (error) { controller.abort(error) }
        } })
      })()
    }
    channel.runtime = runtime
    const current = channel
    current.users++
    let released = false
    const release = () => {
      if (released) return
      released = true
      signal.removeEventListener('abort', release)
      if (--current.users === 0) {
        current.controller.abort()
      }
    }
    signal.addEventListener('abort', release, { once: true })
    try { await this.wait(current.ready, AbortSignal.any([signal, current.controller.signal])); signal.throwIfAborted(); current.controller.signal.throwIfAborted(); return { channel: current, release } }
    catch (error) { release(); throw error }
  }

  private releaseStream(key: string): void {
    const stream = this.nativeStreams.get(key)
    this.nativeHistories.delete(key)
    if (!stream) return
    this.nativeStreams.delete(key); clearTimeout(stream.timer); stream.release()
  }

  private invalidateNativeRoute(route: NativeRoute): void {
    clearTimeout(route.idle)
    if (this.nativeRoutes.get(route.key) === route) this.nativeRoutes.delete(route.key)
    route.controller.abort(new DshRemoteError('REMOTE_NOT_FOUND', '会话订阅已失效，请重新连接', true))
  }

  private releaseNativeRoute(route: NativeRoute): void {
    if (--route.users !== 0) return
    if (!route.sessionChannel) { this.invalidateNativeRoute(route); return }
    // Native generations may all close during handoff. Keep their stable
    // session capability briefly; it contains no live executor routing truth.
    route.idle = setTimeout(() => this.invalidateNativeRoute(route), 45_000); route.idle.unref()
  }

  private nativeRoute(key: string, runtime: string, session: string | undefined): NativeRoute {
    // One connection lifetime per addressed session, shared by all consumers.
    // Active users pin the route; stable idle capability reuse is bounded below.
    let route = this.nativeRoutes.get(key)
    if (!route) {
      // Idle capability reuse must not turn recent session visits into active capacity.
      if (this.nativeRoutes.size >= 64) {
        for (const idle of this.nativeRoutes.values()) if (idle.users === 0 && idle.idle !== undefined) {
          this.invalidateNativeRoute(idle)
          break
        }
      }
      if (this.nativeRoutes.size >= 64) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '原生会话连接数量超限')
      const controller = new AbortController()
      route = { key, runtimeRef: runtime, sessionRef: session, controller, users: 0, runtime: this.executionRuntime(runtime, session,
        AbortSignal.any([controller.signal, this.lifetime.signal, AbortSignal.timeout(30_000)]), 'session.native.channel') }
      this.nativeRoutes.set(key, route)
    }
    clearTimeout(route.idle)
    return route
  }

  private retainStream(key: string, channel: Channel, route: NativeRoute): void {
    const stream = this.nativeStreams.get(key)
    if (stream) { stream.timer.refresh(); return }
    if (this.nativeStreams.size >= 64) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '原生订阅数量超限')
    channel.users++; route.users++
    // Match the source Host's 45-second idle stream lease, including lost close frames.
    const timer = setTimeout(() => this.releaseStream(key), 45_000)
    timer.unref()
    this.nativeStreams.set(key, { channel, route, timer, release: () => {
      this.releaseNativeRoute(route)
      if (--channel.users === 0) channel.controller.abort()
    } })
  }

  private accountChannel(): DshSessionChannelClient {
    return this.sessionChannel ??= new DshSessionChannelClient(this.options.transport, this.options.connected, () => {
      this.sessionChannel = undefined
      for (const route of this.nativeRoutes.values()) if (route.sessionChannel) this.invalidateNativeRoute(route)
    }, address => this.cloud.resume(address.runtimeRef, address.sessionRef))
  }

  async observeDirectory(requestSignal: AbortSignal, notify: (delta?: DshDirectoryDelta) => void): Promise<void> {
    const signal = await this.scope(requestSignal)
    await this.accountChannel().observeDirectory(signal, delta => notify(delta === undefined ? undefined : {
      ...delta, sessions: delta.sessions.map(row => ({ ...row,
        localTakeover: this.options.localSession?.(row.runtime_ref, row.session_ref) === true,
      })),
    }))
  }

  private async nativeRpc(runtime: Runtime, body: Record<string, unknown>, requestRef: string, signal: AbortSignal, route: NativeRoute, stream?: string): Promise<unknown> {
    if (!route.sessionRef || !runtime.capabilities.includes('session.native.channel')) return this.rpc(runtime, 'session.native', body, requestRef, signal, stream ? { key: stream, route } : undefined)
    route.sessionChannel = true
    if (body.mode === 'close' && !this.sessionChannel) return { done: true }
    const channel = this.accountChannel()
    if (stream) {
      const retained = this.nativeStreams.get(stream)
      if (retained) retained.timer.refresh()
      else {
        if (this.nativeStreams.size >= 64) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '原生订阅数量超限')
        route.users++
        const timer = setTimeout(() => this.releaseStream(stream), 45_000); timer.unref()
        this.nativeStreams.set(stream, { route, timer, release: () => this.releaseNativeRoute(route) })
      }
    }
    return channel.request({ runtimeRef: route.runtimeRef, sessionRef: route.sessionRef }, body, requestRef, signal)
  }

  private async rpc(runtime: Runtime, operation: string, body: Record<string, unknown>, requestRef: string, signal: AbortSignal, stream?: { key: string; route: NativeRoute }, canonicalRuntime = runtime.target.runtimeRef): Promise<unknown> {
    const now = Date.now()
    const request = parseDshRemoteRequest({ protocol: 'dsh.remote', protocol_major: 1, kind: 'request', request_ref: requestRef, host_generation: runtime.generation, issued_at: now, execute_before: now + 30_000, operation, body }, { expectedHostGeneration: runtime.generation, nowMillis: now })
    if (operation !== 'session.native' && runtime.capabilities.includes('session.commands.channel')) return this.accountChannel().command(canonicalRuntime, request, signal)
    const { channel, release } = await this.acquire(runtime, signal)
    try {
      if (stream) this.retainStream(stream.key, channel, stream.route)
      return await new Promise((resolve, reject) => {
        const abort = () => finish(() => reject(combined.reason))
        const combined = AbortSignal.any([signal, channel.controller.signal, AbortSignal.timeout(30_000), ...(stream ? [stream.route.controller.signal] : [])])
        const finish = (action: () => void) => { channel.listeners.delete(receive); combined.removeEventListener('abort', abort); action() }
        const receive = (payload: Record<string, unknown>) => {
          if (payload.kind !== 'response' || payload.request_ref !== request.request_ref || payload.operation !== operation) return
          if (payload.error !== undefined) {
            const error = object(payload.error)
            const safe: Partial<Record<DshRemoteErrorCode, string>> = {
              CAPABILITY_UNSUPPORTED: '源实例不支持该操作', WORKSPACE_UNAVAILABLE: '源工作区不可用',
              SESSION_NOT_FOUND: '源会话不存在', COMMAND_EXPIRED: '命令已过期', COMMAND_OUTCOME_UNKNOWN: '命令结果未知，请核对源会话',
              INTERACTION_RESOLVED: '该交互已处理', HOST_GENERATION_STALE: '源实例已重启，请重新连接',
              REMOTE_NOT_FOUND: '远程订阅已结束，请重新连接', RUNTIME_OFFLINE: '源电脑暂不可执行',
              HOST_CHANNEL_NOT_READY: '源连接尚未就绪', CONNECTION_REPLACED: '源连接已替换',
              REMOTE_LOGIN_REQUIRED: '请先登录', REMOTE_PROTOCOL_UNSUPPORTED: '源协议不兼容',
              SESSION_STATE_CHANGED: '会话状态已变化，请刷新', REMOTE_REQUEST_INVALID: '会话操作参数无效',
            }
            const code = String(error.code) as DshRemoteErrorCode
            finish(() => reject(new DshRemoteError(safe[code] ? code : 'REMOTE_TRANSPORT_FAILED', safe[code] ?? '源电脑操作失败', error.retryable === true)))
            if (['HOST_GENERATION_STALE', 'CONNECTION_REPLACED', 'HOST_CHANNEL_NOT_READY', 'RUNTIME_OFFLINE'].includes(code)) channel.controller.abort()
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
    const signal = await this.scope(requestSignal), runtime = await this.executionRuntime(params.runtimeRef, params.sessionRef, signal)
    const operation = String(params.operation)
    if (!['session.create', 'session.rename', 'session.archive', 'session.prompt', 'session.cancel', 'session.model.get', 'session.model.select', 'model.list', 'interaction.question.respond', 'interaction.approval.respond'].includes(operation)) throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '不支持该会话操作')
    const body = { ...object(params.body ?? {}), ...(operation === 'model.list' || operation === 'session.create' ? {} : { session_ref: ref(params.sessionRef) }) }
    return await this.rpc(runtime, operation, body, ref(params.requestRef), signal, undefined, ref(params.runtimeRef))
  }

  async read(params: Record<string, unknown>, requestSignal?: AbortSignal): Promise<DshAccountSessionHistory> {
    const signal = await this.scope(requestSignal), runtime = await this.executionRuntime(params.runtimeRef, params.sessionRef, signal), sessionRef = ref(params.sessionRef)
    const cursor = params.cursor === undefined ? undefined : object(params.cursor) as unknown as DshSessionHistoryCursor
    if (cursor && (!['host', 'cloud'].includes(cursor.source) || !Number.isSafeInteger(cursor.before) || cursor.before < 0)) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '历史游标无效')
    if (params.source !== undefined && params.source !== 'host' && params.source !== 'cloud') throw new DshRemoteError('REMOTE_REQUEST_INVALID', '历史来源无效')
    const source = cursor?.source ?? (params.source === 'host' ? 'host' : 'cloud')
    if (source === 'host' && (runtime.presence === 'online' || runtime.capabilities.includes('session.commands.channel'))) {
      const value = object(await this.rpc(runtime, 'session.history', { session_ref: sessionRef, limit: 50, ...(cursor ? { before_seq: cursor.before } : {}), omit_superseded_chunks: true }, randomUUID(), signal, undefined, ref(params.runtimeRef)))
      const nodes = projectDshHistoryNodes(array(value.entries) as DshRemoteHistoryEntry[])
      return { nodes, complete: value.hasMore !== true, online: true, ...(value.nextCursor === undefined ? {} : { nextCursor: { source: 'host', before: Number(value.nextCursor) } }) }
    }
    if (source === 'host') throw new DshRemoteError('RUNTIME_OFFLINE', '源电脑已离线，请重新打开已同步历史', true)
    const value = await this.options.request.post(`${BASE}/session-turns/list`, { runtime_ref: ref(params.runtimeRef), session_ref: sessionRef, limit: 20, ...(cursor ? { before_start_seq: cursor.before } : {}) }, signal)
    signal.throwIfAborted()
    const nodes = array(value.items).flatMap(raw => array(object(raw).nodes) as DshRemoteTimelineNode[]).sort((a, b) => a.anchor_seq - b.anchor_seq || a.ordinal - b.ordinal)
    return { nodes, complete: value.complete === true, online: false, ...(value.next_cursor === undefined ? {} : { nextCursor: { source: 'cloud', before: Number(value.next_cursor) } }), ...(value.complete === true ? {} : { warning: '部分历史尚未同步，等待源电脑补齐' }) }
  }

  private cached<T>(read: () => T): T | undefined {
    try { return read() } catch { delete this.options.historyCache; this.options.onCacheError?.(); return undefined }
  }

  /** Native browser carrier; account, target and lease resolution stay Host-owned. */
  async native(params: Record<string, unknown>, requestSignal?: AbortSignal): Promise<unknown> {
    const signal = await this.scope(AbortSignal.any([...(requestSignal ? [requestSignal] : []), AbortSignal.timeout(30_000)])), body = object(params.body)
    const prompt = body.mode === 'call' && body.endpoint === 'session/prompt'
      && (body.payload as { args?: { request?: { mode?: unknown } } } | undefined)?.args?.request?.mode === 'queue'
    // Retry only explicit stale-owner rejection. Each transport attempt gets
    // a new command ID; the original native requestId deduplicates the inbox
    // and persisted journal even when the executor changes.
    for (let attempt = 0; ; attempt++) {
      try { return await this.nativeOnce(attempt ? { ...params, requestRef: randomUUID() } : params, signal) }
      catch (error) {
        if (!prompt || attempt >= 4 || !(error instanceof DshRemoteError)
          || error.code !== 'SESSION_STATE_CHANGED' || !error.retryable) throw error
        await delay(250 * 2 ** attempt, undefined, { signal })
      }
    }
  }

  private async nativeOnce(params: Record<string, unknown>, requestSignal?: AbortSignal): Promise<unknown> {
    const signal = await this.scope(requestSignal)
    const account = await this.options.requireAccount()
    signal.throwIfAborted()
    const canonicalRuntime = ref(params.runtimeRef)
    const sessionRef = typeof params.sessionRef === 'string' ? ref(params.sessionRef) : undefined
    let body = object(params.body)
    const cache = this.options.historyCache
    const stream = `${account}:${canonicalRuntime}:${String(body.streamRef)}`
    const previous = this.nativeStreams.get(stream)
    const routeKey = JSON.stringify([account, canonicalRuntime, sessionRef])
    if (previous && sessionRef !== undefined && previous.route.key !== routeKey) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '原生订阅不能切换会话')
    if (!previous) {
      const local = await this.options.localNative?.(params, signal)
      if (local !== undefined) return local
    }
    if (body.mode === 'close') {
      // A close belongs to the original Host, even after a handoff. No lookup.
      try {
        if (previous) return await this.nativeRpc(await previous.route.runtime, body, ref(params.requestRef), signal, previous.route)
        this.cloud.release(stream)
        return { done: true }
      } finally { this.releaseStream(stream) }
    }
    if (body.mode === 'pull' && body.endpoint === undefined && this.cloud.has(stream)) {
      return { ...await this.cloud.call(canonicalRuntime, body, stream, signal), sourceWritable: false }
    }
    if (body.mode === 'pull' && body.endpoint === undefined && !previous && !this.cloud.has(stream)) throw new DshRemoteError('REMOTE_NOT_FOUND', '原生订阅已断开，请重新连接', true)
    const route = previous?.route ?? this.nativeRoute(routeKey, canonicalRuntime, sessionRef)
    route.users++
    const readCloud = async () => {
      if (route.sessionChannel && sessionRef && body.mode === 'pull') {
        await this.sessionChannel?.request({ runtimeRef: canonicalRuntime, sessionRef }, { mode: 'close', streamRef: body.streamRef }, randomUUID(), signal)
      }
      this.releaseStream(stream)
      const value = await this.cloud.call(canonicalRuntime, body, stream, signal, cache && typeof account === 'string'
        ? { store: { snapshot: key => this.cached(() => cache.snapshot(key)), page: (key, through, before) => this.cached(() => cache.page(key, through, before)), write: (key, records, snapshot) => { this.cached(() => cache.write(key, records, snapshot)) } }, key: session => DshNativeHistoryCache.key(account, canonicalRuntime, { kind: 'session', sessionId: session }) } : undefined, sessionRef)
      return { ...value, sourceWritable: false }
    }
    try {
      const runtime = await this.wait(route.runtime, AbortSignal.any([signal, route.controller.signal]))
      const sourceWritable = sessionRef !== undefined && runtime.capabilities.includes('session.native.channel')
        || runtime.presence === 'online' && runtime.target.hostLeaseGeneration > 0 && runtime.capabilities.includes('session.native')
      if (!sourceWritable) return await readCloud()
      if (this.cloud.has(stream)) {
        this.cloud.release(stream)
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
        key = DshNativeHistoryCache.key(account, canonicalRuntime, identity)
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
      let value: Record<string, unknown>
      value = object(await this.nativeRpc(runtime, body, ref(params.requestRef), signal, route, body.mode === 'pull' ? stream : undefined)); signal.throwIfAborted()
      if (body.mode === 'pull' && value.done === true && !route.sessionChannel) this.invalidateNativeRoute(route)
      else if (body.mode === 'pull') { const retained = this.nativeStreams.get(stream); if (retained) retained.timer.refresh() }
      signal.throwIfAborted()
      if (value.done === true) this.nativeHistories.delete(stream)
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
              const full = object(await this.nativeRpc(runtime, { mode: 'call', endpoint: 'session/page', payload: { args: { request: { address: history.address, throughSeq: frame.cursor } } } }, randomUUID(), signal, route))
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
    } catch (error) {
      if (route.sessionChannel && error instanceof DshRemoteError && error.code === 'RUNTIME_OFFLINE') {
        this.invalidateNativeRoute(route)
        if (!signal.aborted && (body.mode === 'pull' && body.endpoint !== undefined || body.mode === 'call' && body.endpoint === 'session/page')) return await readCloud()
      }
      if (!route.sessionChannel && !signal.aborted && (body.mode === 'pull' || error instanceof DshRemoteError && [
        'SESSION_STATE_CHANGED', 'HOST_GENERATION_STALE', 'CONNECTION_REPLACED',
        'HOST_CHANNEL_NOT_READY', 'RUNTIME_OFFLINE', 'REMOTE_TRANSPORT_FAILED',
      ].includes(error.code))) this.invalidateNativeRoute(route)
      throw error
    } finally { this.releaseNativeRoute(route) }
  }

  async observe(params: Record<string, unknown>, requestSignal: AbortSignal, notify: () => void): Promise<void> {
    const signal = await this.scope(requestSignal), runtime = await this.executionRuntime(params.runtimeRef, params.sessionRef, signal), sessionRef = ref(params.sessionRef)
    if (runtime.capabilities.includes('session.commands.channel')) return this.accountChannel().observe({ runtimeRef: ref(params.runtimeRef), sessionRef }, signal, notify)
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
