import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { DshApiProxyAdapter, type DshRemoteApiProjectionEvent } from './api-proxy-adapter.js'
import { DshRemoteHostChannelManager } from './channel-manager.js'
import { DshRemoteCommandLedger, type DshRemoteLedgerEntry } from './command-ledger.js'
import { asDshRemoteError, DshRemoteError } from './errors.js'
import { parseDshRemoteRequest } from './protocol-v1.js'
import { DshRemoteRuntimeStore } from './runtime-store.js'
import { DshRemoteRuntimeSecretBroker } from './runtime-secret-broker.js'
import {
  DSH_REMOTE_MAX_PAGE_RESULT_BYTES,
  DSH_REMOTE_PROTOCOL,
  DSH_REMOTE_PROTOCOL_MAJOR,
  type DshRemoteControlPlane,
  type DshRemoteCapability,
  type DshRemoteHostFacade,
  type DshRemoteOperation,
  type DshRemoteRealtimeTransport,
  type DshRemoteRequest,
  type DshRemoteResponse,
  type DshRemoteRuntimeProjection,
  type DshRemoteStatus,
  type DshRemoteTrustedEventMetadata,
} from './types.js'

interface HostSession { userId: number; clientId: number }
interface HostRuntimeContext {
  serviceLeaseGeneration: number
  metadata: DshRemoteTrustedEventMetadata
}

export interface ArkmeRemoteRealtimeHostOptions {
  featureEnabled: boolean
  transportAvailable?: boolean
  profileRef: string
  hostClientRef: string
  displayName?: string
  platform?: NodeJS.Platform
  readSession: () => Promise<HostSession | undefined>
  secretBroker: DshRemoteRuntimeSecretBroker
  runtimeStore: DshRemoteRuntimeStore
  controlPlane: DshRemoteControlPlane
  realtime: DshRemoteRealtimeTransport
  apiProxy: DshApiProxyAdapter
  ledgerForAccount: (accountId: string, key: Buffer) => Promise<DshRemoteCommandLedger> | DshRemoteCommandLedger
  now?: () => number
}

function stringBody(body: Record<string, unknown>, key: string, max = 256): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new DshRemoteError('REMOTE_REQUEST_INVALID', `${key} 无效`)
  return value.trim()
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  return typeof body[key] === 'string' && body[key] !== '' ? body[key] as string : undefined
}

function optionalPositive(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function requiredCapabilities(operation: DshRemoteOperation): DshRemoteCapability[] {
  switch (operation) {
    case 'capabilities.get': return []
    case 'snapshot.get': return ['workspace.list', 'session.list']
    case 'workspace.list': return ['workspace.list']
    case 'session.list': return ['session.list']
    case 'session.create': return ['session.create']
    case 'session.history': return ['session.history']
    case 'session.prompt': return ['session.prompt']
    case 'session.cancel': return ['session.cancel']
    case 'interaction.question.respond': return ['interaction.question.respond']
    case 'interaction.approval.respond': return ['interaction.approval.respond']
  }
}

function response(
  request: DshRemoteRequest,
  status: DshRemoteResponse['status'],
  now: number,
  payload: { result?: unknown; error?: NonNullable<DshRemoteResponse['error']> },
): DshRemoteResponse {
  const result: DshRemoteResponse = {
    protocol: DSH_REMOTE_PROTOCOL,
    protocol_major: DSH_REMOTE_PROTOCOL_MAJOR,
    kind: 'response',
    request_ref: request.request_ref,
    status,
    host_generation: request.host_generation,
    issued_at: now,
    operation: request.operation,
    body: {},
  }
  if (payload.result !== undefined) result.result = payload.result
  if (payload.error !== undefined) result.error = payload.error
  return result
}

function resultFromLedger(entry: DshRemoteLedgerEntry): unknown {
  const result = entry.payload.result
  if (result !== null && typeof result === 'object' && 'rejected' in result) {
    const rejected = (result as { rejected?: unknown }).rejected
    if (rejected !== null && typeof rejected === 'object') {
      const source = rejected as Record<string, unknown>
      throw new DshRemoteError(
        typeof source.code === 'string' ? source.code as ConstructorParameters<typeof DshRemoteError>[0] : 'REMOTE_TRANSPORT_FAILED',
        typeof source.message === 'string' ? source.message : 'DSH 已拒绝该远控命令',
        source.retryable === true,
      )
    }
  }
  return result !== null && typeof result === 'object' && 'value' in result ? (result as { value: unknown }).value : result
}

/**
 * Account-login Host facade. Backend owns durable discovery/projections,
 * Realtime owns the short-lived Host lease, and DSH remains session truth.
 */
export class ArkmeRemoteRealtimeHost implements DshRemoteHostFacade {
  private readonly now: () => number
  private readonly listeners = new Set<(status: DshRemoteStatus) => void>()
  private runtime: DshRemoteRuntimeProjection | undefined
  private accountId: string | undefined
  private clientId = 0
  private ledger: DshRemoteCommandLedger | undefined
  private started = false
  private connected = false
  private serviceLeaseGeneration = 0
  private revision = 0
  private stopEvents: (() => void) | undefined
  private stopProjectionEvents: (() => void) | undefined
  private channelManager: DshRemoteHostChannelManager | undefined
  private stopTransportDisconnect: (() => void) | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private reconnecting = false
  private sessionTimer: ReturnType<typeof setTimeout> | undefined
  private connectionError: DshRemoteError | undefined
  private lastProjectionSyncAttemptMillis = 0
  private projectionVersion = 0

  constructor(private readonly options: ArkmeRemoteRealtimeHostOptions) {
    this.now = options.now ?? Date.now
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    if (!this.options.featureEnabled) { this.bump(); return }
    this.stopTransportDisconnect = this.options.realtime.subscribeDisconnect(error => { this.handleTransportDisconnect(error) })
    await this.syncSessionSafely()
    this.scheduleSessionSync()
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    this.stopApiProxyEvents()
    this.stopTransportDisconnect?.()
    this.stopTransportDisconnect = undefined
    if (this.sessionTimer !== undefined) clearTimeout(this.sessionTimer)
    this.sessionTimer = undefined
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    await this.deactivateAccount()
    this.bump()
  }

  getStatus(): DshRemoteStatus {
    const available = this.options.featureEnabled && this.accountId !== undefined
      && this.options.transportAvailable !== false && this.options.apiProxy.capabilities().length > 0
    return {
      contractVersion: 1,
      available,
      enabled: this.options.featureEnabled && this.accountId !== undefined,
      connected: this.connected,
      hostGeneration: this.runtime?.hostGeneration ?? 0,
      capabilities: this.runtime?.capabilities ?? this.options.apiProxy.capabilities(),
      revision: this.revision,
      ...(this.accountId === undefined ? {} : { accountId: this.accountId }),
      ...(this.runtime?.desktopRef === undefined ? {} : { desktopRef: this.runtime.desktopRef }),
      ...(this.runtime === undefined ? {} : { runtimeRef: this.runtime.runtimeRef }),
      ...(this.connectionError !== undefined ? { unavailableReason: this.connectionError.message }
        : available ? {} : { unavailableReason: !this.options.featureEnabled
          ? '远控能力尚未在此版本启用'
          : this.accountId === undefined
            ? '请先登录 Arkme 后使用 DSH 远程会话'
            : this.options.transportAvailable === false
              ? '当前 DSH Host 尚未提供带登录态的 Realtime Socket Factory'
              : this.options.apiProxy.capabilities().length === 0
                ? '当前 DSH 缺少公共 ApiProxy 能力'
                : '远控运行依赖尚未就绪' }),
    }
  }

  async renameDesktop(displayName: string): Promise<DshRemoteStatus> {
    this.requireReady()
    const normalized = displayName.trim()
    await this.options.runtimeStore.renameDesktop(this.accountId!, normalized)
    if (this.runtime?.desktopRef !== undefined) {
      await this.options.controlPlane.registerDesktop({
        display_name: normalized,
        platform: this.options.platform ?? process.platform,
      })
    }
    this.bump()
    return this.getStatus()
  }

  subscribe(listener: (status: DshRemoteStatus) => void): () => void {
    this.listeners.add(listener)
    listener(this.getStatus())
    return () => { this.listeners.delete(listener) }
  }

  /** Entry used only by the authenticated Realtime channel bridge. */
  async dispatchAuthorizedRequest(value: unknown, context: HostRuntimeContext): Promise<DshRemoteResponse> {
    this.requireConnected()
    if (context.metadata.senderRole !== 'controller' || context.metadata.runtimeRef !== this.runtime!.runtimeRef) {
      throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控发送方上下文无效')
    }
    if (context.serviceLeaseGeneration !== this.serviceLeaseGeneration
      || context.metadata.targetHostLeaseGeneration !== this.serviceLeaseGeneration) {
      throw new DshRemoteError('HOST_GENERATION_STALE', '远控请求属于旧 Host lease', true)
    }
    if (this.now() - context.metadata.acceptedAtMillis > 30_000) throw new DshRemoteError('COMMAND_EXPIRED', '远控请求投递延迟过长')
    const request = parseDshRemoteRequest(value, {
      expectedHostGeneration: this.runtime!.hostGeneration,
      nowMillis: this.now(),
    })
    try {
      const capabilities = new Set(this.options.apiProxy.capabilities())
      if (requiredCapabilities(request.operation).some(capability => !capabilities.has(capability))) {
        throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '当前 DSH Runtime 不支持该操作')
      }
      const result = await this.dispatch(request)
      return response(request, result.duplicate ? 'duplicate' : 'completed', this.now(), { result: result.value })
    } catch (error) {
      const remote = asDshRemoteError(error)
      return response(request, 'rejected', this.now(), {
        error: {
          code: remote.code,
          message: remote.message.slice(0, 256),
          retryable: remote.retryable,
          trace_ref: randomUUID(),
        },
      })
    }
  }

  private async syncSessionSafely(): Promise<void> {
    try { await this.syncSession() }
    catch (error) {
      this.connectionError = asDshRemoteError(error)
      this.bump()
    }
  }

  private async syncSession(): Promise<void> {
    if (!this.started || !this.options.featureEnabled) return
    const session = await this.options.readSession()
    if (session === undefined) {
      if (this.accountId !== undefined) await this.deactivateAccount()
      this.bump()
      return
    }
    const accountId = String(session.userId)
    if (this.accountId === accountId && this.clientId === session.clientId && this.runtime !== undefined) {
      await this.ensureAutomaticConnection()
      return
    }
    if (this.accountId !== undefined) await this.deactivateAccount()
    this.clientId = session.clientId
    this.accountId = accountId
    this.runtime = await this.options.runtimeStore.activateRuntime({
      accountId,
      profileRef: this.options.profileRef,
      capabilities: this.options.apiProxy.capabilities(),
      nowMillis: this.now(),
    })
    this.ledger = await this.options.ledgerForAccount(accountId, await this.options.secretBroker.ledgerKey(accountId))
    await this.reconcileUnsettled()
    this.ledger.cleanup({ retentionMillis: 7 * 24 * 60 * 60_000, maxCommands: 10_000 })
    await this.ensureAutomaticConnection()
    this.bump()
  }

  private async ensureAutomaticConnection(): Promise<void> {
    if (this.accountId === undefined || this.runtime === undefined) return
    if (this.connected) {
      await this.syncProjectionSnapshotSafely()
      return
    }
    if (this.options.transportAvailable === false || this.options.apiProxy.capabilities().length === 0) {
      this.connectionError = undefined
      this.bump()
      return
    }
    this.startApiProxyEvents()
    try { await this.connectHost() }
    catch (error) {
      this.handleTransportDisconnect(error)
      throw error
    }
  }

  private scheduleSessionSync(): void {
    if (!this.started || !this.options.featureEnabled || this.sessionTimer !== undefined) return
    this.sessionTimer = setTimeout(() => {
      this.sessionTimer = undefined
      void this.syncSessionSafely().finally(() => { this.scheduleSessionSync() })
    }, 2_000)
    this.sessionTimer.unref()
  }

  private async deactivateAccount(): Promise<void> {
    this.stopApiProxyEvents()
    let unregistered = false
    try {
      if (this.connected) {
        await this.options.realtime.unregisterHost()
        unregistered = true
      }
    } catch { /* Closing the socket releases the Host lease. */ }
    if (!unregistered) await this.options.realtime.disconnect()
    await this.channelManager?.close()
    this.channelManager = undefined
    if (unregistered) await this.options.realtime.disconnect()
    this.connected = false
    this.serviceLeaseGeneration = 0
    this.ledger?.close()
    this.ledger = undefined
    this.runtime = undefined
    this.accountId = undefined
    this.clientId = 0
    this.connectionError = undefined
    this.lastProjectionSyncAttemptMillis = 0
    this.projectionVersion = 0
  }

  private startApiProxyEvents(): void {
    if (this.stopProjectionEvents === undefined) {
      this.stopProjectionEvents = this.options.apiProxy.subscribeProjectionEvents(event => {
        void this.publishProjectionEvent(event).catch(error => {
          this.connectionError = asDshRemoteError(error)
          this.bump()
        })
      })
    }
    if (this.stopEvents === undefined) this.stopEvents = this.options.apiProxy.startEvents()
  }

  private stopApiProxyEvents(): void {
    this.stopEvents?.()
    this.stopEvents = undefined
    this.stopProjectionEvents?.()
    this.stopProjectionEvents = undefined
  }

  private async publishProjectionEvent(event: DshRemoteApiProjectionEvent): Promise<void> {
    const runtime = this.runtime
    const manager = this.channelManager
    if (!this.started || !this.connected || runtime === undefined || manager === undefined) return
    const issuedAt = this.now()
    if (event.kind === 'session-event') {
      const append = async (): Promise<void> => {
        await this.options.controlPlane.appendSessionEvents({
          runtime_ref: runtime.runtimeRef,
          host_generation: runtime.hostGeneration,
          session_ref: event.sessionId,
          entries: [event.entry],
        })
      }
      try {
        await append()
      } catch (error) {
        const remote = asDshRemoteError(error)
        if (remote.code !== 'REMOTE_NOT_FOUND') throw error
        // A newly-created DSH session can emit its first event before the
        // periodic metadata projection sees it. Backend intentionally rejects
        // orphan events, so publish the authoritative session row first and
        // retry this exact seq once. Backend's seq/hash guard keeps the retry
        // idempotent; all other failures remain fail-closed.
        await this.syncProjectionSnapshot(true)
        await append()
      }
      const seq = event.entry.event.seq
      const requestRef = `event_${createHash('sha256').update([
        'dsh-remote-session-event-v1', runtime.runtimeRef, String(runtime.hostGeneration), event.sessionId,
        String(seq), event.entry.event.type,
      ].join('\n')).digest('base64url').slice(0, 40)}`
      await manager.publishProjectionEvent({
        protocol: DSH_REMOTE_PROTOCOL,
        protocol_major: DSH_REMOTE_PROTOCOL_MAJOR,
        kind: 'event',
        request_ref: requestRef,
        host_generation: runtime.hostGeneration,
        issued_at: issuedAt,
        operation: 'session.history',
        body: { session_ref: event.sessionId, entries: [event.entry] },
        session_seq: seq,
        projection_as_of_seq: seq,
      }, requestRef)
      return
    }
    const baseline = event.kind === 'mux-baseline'
    const requestRef = `projection_${randomUUID()}`
    const pendingFits = Buffer.byteLength(JSON.stringify(event.pendingInteractions)) <= DSH_REMOTE_MAX_PAGE_RESULT_BYTES
    await manager.publishProjectionEvent({
      protocol: DSH_REMOTE_PROTOCOL,
      protocol_major: DSH_REMOTE_PROTOCOL_MAJOR,
      kind: 'event',
      request_ref: requestRef,
      host_generation: runtime.hostGeneration,
      issued_at: issuedAt,
      operation: 'snapshot.get',
      body: {
        ...(pendingFits ? { pending_interactions: event.pendingInteractions } : {}),
        ...(baseline ? { reason: 'mux-generation', session_ref: event.sessionId, last_seq: event.lastSeq } : {}),
        ...(!pendingFits && !baseline ? { reason: 'projection-overflow' } : {}),
      },
      ...(baseline && event.lastSeq >= 0 ? { projection_as_of_seq: event.lastSeq } : {}),
    }, requestRef)
  }

  private handleTransportDisconnect(error?: unknown): void {
    if (!this.started || this.runtime === undefined) return
    const remote = error === undefined ? undefined : asDshRemoteError(error)
    if (remote !== undefined) this.connectionError = remote
    this.connected = false
    this.serviceLeaseGeneration = 0
    const manager = this.channelManager
    this.channelManager = undefined
    // A fatal channel error can arrive while the socket is still open. Close
    // the transport immediately so Realtime releases the Host lease before a
    // replacement connection is admitted; otherwise presence could briefly
    // advertise an online Host that has already stopped consuming commands.
    void this.options.realtime.disconnect()
      .finally(async () => { await manager?.close() })
      .catch(() => undefined)
    this.bump()
    if (this.reconnectTimer !== undefined || this.options.transportAvailable === false || remote?.retryable === false) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (!this.started || this.runtime === undefined || this.reconnecting) return
      this.reconnecting = true
      void this.connectHost()
        .catch(caught => { this.handleTransportDisconnect(caught) })
        .finally(() => { this.reconnecting = false })
    }, 1_000)
    this.reconnectTimer.unref()
  }

  private async connectHost(): Promise<void> {
    const localRuntime = this.runtime!
    const accountId = this.accountId!
    const platform = this.options.platform ?? process.platform
    const displayName = (await this.options.runtimeStore.account(accountId)).displayName
      ?? this.options.displayName ?? hostname()
    const desktop = await this.options.controlPlane.registerDesktop({ display_name: displayName, platform })
    const desktopRef = typeof desktop.desktop_ref === 'string' ? desktop.desktop_ref
      : typeof desktop.desktopRef === 'string' ? desktop.desktopRef : ''
    if (desktopRef === '') throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'Backend 未返回桌面设备引用', true)
    await this.options.runtimeStore.bindDesktop(accountId, { desktopRef })
    this.runtime = { ...localRuntime, desktopRef }
    const registeredRuntime = await this.options.controlPlane.registerRuntime(desktopRef, {
      profile_ref: this.options.profileRef,
      host_client_ref: this.options.hostClientRef,
      service_namespace: 'dsh_remote',
      service_name: 'host',
      protocol: DSH_REMOTE_PROTOCOL,
      protocol_major: DSH_REMOTE_PROTOCOL_MAJOR,
      host_generation: localRuntime.hostGeneration,
      capabilities: localRuntime.capabilities,
    })
    const backendRuntimeRef = typeof registeredRuntime.runtime_ref === 'string' ? registeredRuntime.runtime_ref : ''
    const backendHostGeneration = typeof registeredRuntime.host_generation === 'number'
      && Number.isSafeInteger(registeredRuntime.host_generation) && registeredRuntime.host_generation > 0
      ? registeredRuntime.host_generation : 0
    if (backendRuntimeRef === '' || backendHostGeneration < localRuntime.hostGeneration) {
      throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'Backend 未返回匹配的 Runtime 引用与 Host generation', true)
    }
    this.runtime = {
      ...(await this.options.runtimeStore.adoptRuntimeRef(
        accountId,
        this.options.profileRef,
        backendRuntimeRef,
        backendHostGeneration,
      )),
      desktopRef,
    }
    await this.syncProjectionSnapshot(true)
    const controller = new AbortController()
    await this.options.realtime.connect({
      profileRef: this.options.profileRef,
      clientRef: this.options.hostClientRef,
      signal: controller.signal,
    })
    const manager = new DshRemoteHostChannelManager({
      accountId,
      profileRef: this.options.profileRef,
      hostClientRef: this.options.hostClientRef,
      runtimeRef: backendRuntimeRef,
      realtime: this.options.realtime,
      secretBroker: this.options.secretBroker,
      dispatch: async (request, context) => await this.dispatchAuthorizedRequest(request, context),
      onFatal: error => { this.handleTransportDisconnect(error) },
    })
    try {
      await manager.prepare()
      const registered = await this.options.realtime.registerHost({
        runtimeRef: backendRuntimeRef,
        capabilities: this.runtime.capabilities,
        signal: controller.signal,
      })
      await manager.activate(registered.serviceLeaseGeneration)
      this.channelManager = manager
      this.serviceLeaseGeneration = registered.serviceLeaseGeneration
      this.connected = true
      this.connectionError = undefined
      this.bump()
    } catch (error) {
      await this.options.realtime.disconnect()
      await manager.close()
      throw error
    }
  }

  private async syncProjectionSnapshotSafely(force = false): Promise<void> {
    const now = this.now()
    if (!force && now - this.lastProjectionSyncAttemptMillis < 5_000) return
    this.lastProjectionSyncAttemptMillis = now
    try {
      await this.syncProjectionSnapshot(force)
      this.connectionError = undefined
    } catch (error) {
      this.connectionError = asDshRemoteError(error)
      this.bump()
    }
  }

  private nextProjectionVersion(): number {
    this.projectionVersion = Math.max(this.projectionVersion + 1, Math.trunc(this.now()))
    return this.projectionVersion
  }

  private async syncProjectionSnapshot(force = false): Promise<void> {
    const runtime = this.runtime
    const accountId = this.accountId
    if (runtime === undefined || accountId === undefined) return
    if (force) this.lastProjectionSyncAttemptMillis = this.now()
    const capabilities = new Set(this.options.apiProxy.capabilities())
    const projectionAt = this.nextProjectionVersion()
    const previous = await this.options.runtimeStore.projectionInventory(
      accountId,
      this.options.profileRef,
    )
    const workspaces = capabilities.has('workspace.list') ? await this.options.apiProxy.workspaces() : []
    const currentWorkspaceRefs = new Set(workspaces.map(item => item.workspaceId))
    const workspaceItems = [
      ...workspaces.map(item => ({
        workspace_ref: item.workspaceId,
        title: item.title,
        path: item.path,
        available: item.available,
        projection_at: projectionAt,
        deleted: false,
      })),
      ...previous.workspaceRefs
        .filter(workspaceRef => !currentWorkspaceRefs.has(workspaceRef))
        .map(workspaceRef => ({
          workspace_ref: workspaceRef,
          title: '',
          path: '',
          available: false,
          projection_at: projectionAt,
          deleted: true,
        })),
    ]
    for (let offset = 0; offset < workspaceItems.length || offset === 0; offset += 100) {
      await this.options.controlPlane.syncWorkspaces({
        runtime_ref: runtime.runtimeRef,
        host_generation: runtime.hostGeneration,
        items: workspaceItems.slice(offset, offset + 100),
      })
      if (workspaceItems.length === 0) break
    }

    const sessions = [] as Awaited<ReturnType<DshApiProxyAdapter['sessions']>>['items']
    if (capabilities.has('session.list')) {
      let cursor: string | undefined
      const seenCursors = new Set<string>()
      for (let pageCount = 0; pageCount < 200; pageCount += 1) {
        const page = await this.options.apiProxy.sessions({ limit: 50, ...(cursor === undefined ? {} : { cursor }) })
        sessions.push(...page.items)
        if (page.nextCursor === undefined) break
        if (seenCursors.has(page.nextCursor)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 会话游标发生循环')
        seenCursors.add(page.nextCursor)
        cursor = page.nextCursor
        if (pageCount === 199) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 会话分页超过安全上限')
      }
    }
    const currentSessionRefs = new Set(sessions.map(item => item.sessionId))
    const sessionItems = [
      ...sessions.map(item => ({
        workspace_ref: item.workspaceId,
        session_ref: item.sessionId,
        title: item.title ?? '',
        source_updated_at: Math.max(1, Math.trunc(item.updatedAt)),
        projection_at: projectionAt,
        running: item.running,
        blank: item.blank,
        ...(item.projectionAsOfSeq === undefined ? {} : { projection_as_of_seq: item.projectionAsOfSeq }),
        deleted: false,
      })),
      ...previous.sessions
        .filter(item => !currentSessionRefs.has(item.sessionRef))
        .map(item => ({
          workspace_ref: item.workspaceRef,
          session_ref: item.sessionRef,
          title: '',
          source_updated_at: item.sourceUpdatedAt,
          projection_at: projectionAt,
          running: false,
          blank: false,
          deleted: true,
        })),
    ]
    for (let offset = 0; offset < sessionItems.length || offset === 0; offset += 100) {
      await this.options.controlPlane.syncSessions({
        runtime_ref: runtime.runtimeRef,
        host_generation: runtime.hostGeneration,
        items: sessionItems.slice(offset, offset + 100),
      })
      if (sessionItems.length === 0) break
    }
    await this.options.runtimeStore.saveProjectionInventory(
      accountId,
      this.options.profileRef,
      {
        workspaceRefs: workspaces.map(item => item.workspaceId),
        sessions: sessions.map(item => ({
          sessionRef: item.sessionId,
          workspaceRef: item.workspaceId,
          sourceUpdatedAt: Math.max(1, Math.trunc(item.updatedAt)),
        })),
      },
    )
  }

  private async dispatch(request: DshRemoteRequest): Promise<{ duplicate: boolean; value: unknown }> {
    switch (request.operation) {
      case 'capabilities.get': return { duplicate: false, value: { capabilities: this.options.apiProxy.capabilities() } }
      case 'snapshot.get': {
        const cursor = optionalString(request.body, 'cursor')
        const limit = optionalPositive(request.body, 'limit')
        return { duplicate: false, value: await this.options.apiProxy.snapshot({
          ...(cursor === undefined ? {} : { cursor }),
          ...(limit === undefined ? {} : { limit }),
        }) }
      }
      case 'workspace.list': {
        const cursor = optionalString(request.body, 'cursor')
        const limit = optionalPositive(request.body, 'limit')
        return { duplicate: false, value: await this.options.apiProxy.workspacePage({
          ...(cursor === undefined ? {} : { cursor }),
          ...(limit === undefined ? {} : { limit }),
        }) }
      }
      case 'session.list': {
        const workspaceId = optionalString(request.body, 'workspace_ref')
        const cursor = optionalString(request.body, 'cursor')
        const limit = optionalPositive(request.body, 'limit')
        return { duplicate: false, value: await this.options.apiProxy.sessions({
          ...(workspaceId === undefined ? {} : { workspaceId }),
          ...(cursor === undefined ? {} : { cursor }),
          ...(limit === undefined ? {} : { limit }),
        }) }
      }
      case 'session.history': {
        const beforeSeq = optionalPositive(request.body, 'before_seq')
        const limit = optionalPositive(request.body, 'limit')
        return { duplicate: false, value: await this.options.apiProxy.history({
          sessionId: stringBody(request.body, 'session_ref'),
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
          ...(limit === undefined ? {} : { limit }),
        }) }
      }
      default: return await this.dispatchWrite(request)
    }
  }

  private async dispatchWrite(request: DshRemoteRequest): Promise<{ duplicate: boolean; value: unknown }> {
    const ledger = this.ledger
    if (ledger === undefined) throw new DshRemoteError('REMOTE_STORAGE_FAILED', '远控命令账本尚未就绪')
    const accountId = this.accountId!
    const runtimeRef = this.runtime!.runtimeRef
    const begun = ledger.begin({
      accountId,
      runtimeRef,
      requestRef: request.request_ref,
      operation: request.operation,
      arguments: request.body,
      executeBeforeMillis: request.execute_before,
    })
    if (begun.duplicate) {
      if (begun.entry.state === 'completed') return { duplicate: true, value: resultFromLedger(begun.entry) }
      throw new DshRemoteError('COMMAND_OUTCOME_UNKNOWN', '同一命令的结果尚未完成对账')
    }
    const identity = { accountId, runtimeRef, requestRef: request.request_ref }
    let value: unknown
    try {
      switch (request.operation) {
        case 'session.create':
          value = await this.options.apiProxy.createSession({
            workspaceId: stringBody(request.body, 'workspace_ref'),
            dshRpcId: begun.entry.dshRpcId,
          })
          break
        case 'session.prompt':
          value = await this.options.apiProxy.prompt({
            sessionId: stringBody(request.body, 'session_ref'),
            mode: request.body.mode === 'queue' || request.body.mode === 'steer'
              ? request.body.mode
              : (() => { throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'prompt mode 无效') })(),
            content: [request.body.content],
            dshRpcId: begun.entry.dshRpcId,
          })
          break
        case 'session.cancel':
          value = await this.options.apiProxy.cancel({
            sessionId: stringBody(request.body, 'session_ref'),
            dshRpcId: begun.entry.dshRpcId,
          })
          break
        case 'interaction.question.respond':
          await this.options.apiProxy.answerQuestion({
            interactionRpcRef: stringBody(request.body, 'interaction_rpc_ref'),
            sessionId: stringBody(request.body, 'session_ref'),
            answer: request.body.answer,
          })
          value = { accepted: true }
          break
        case 'interaction.approval.respond':
          await this.options.apiProxy.answerApproval({
            interactionRpcRef: stringBody(request.body, 'interaction_rpc_ref'),
            sessionId: stringBody(request.body, 'session_ref'),
            approvalId: stringBody(request.body, 'approval_id'),
            outcome: request.body.outcome === 'allowed-once' || request.body.outcome === 'rejected'
              ? request.body.outcome
              : (() => { throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'approval outcome 无效') })(),
          })
          value = { accepted: true }
          break
        default:
          throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '远控操作不受支持')
      }
    } catch (error) {
      const known = error instanceof DshRemoteError
        && (error.code !== 'REMOTE_TRANSPORT_FAILED' || error.details.dshRejected === true)
      if (known) ledger.completeRejected(identity, error)
      else ledger.markOutcomeUnknown(identity, 'DSH transport failed after the command ledger entered pending')
      throw error
    }
    ledger.complete(identity, { value })
    return { duplicate: false, value }
  }

  private async reconcileUnsettled(): Promise<void> {
    if (this.ledger === undefined || this.accountId === undefined) return
    for (const entry of this.ledger.unsettledForReconciliation(this.accountId, this.now())) {
      const argumentsValue = entry.payload.arguments
      const argumentsRecord = argumentsValue !== null && typeof argumentsValue === 'object' && !Array.isArray(argumentsValue)
        ? argumentsValue as Record<string, unknown> : undefined
      const sessionId = typeof argumentsRecord?.session_ref === 'string' ? argumentsRecord.session_ref : undefined
      let proven = false
      let recoveredValue: Record<string, unknown> = { recovered: true, dshRpcId: entry.dshRpcId }
      if (entry.operation === 'session.create' && typeof argumentsRecord?.workspace_ref === 'string') {
        try {
          const created = await this.options.apiProxy.reconcileCreatedSession({
            workspaceId: argumentsRecord.workspace_ref,
            dshRpcId: entry.dshRpcId,
          })
          if (created !== undefined) {
            proven = true
            recoveredValue = { recovered: true, sessionId: created.sessionId }
          }
        } catch { /* An unavailable list cannot prove a safe result. */ }
      }
      if (sessionId !== undefined) {
        try {
          const history = await this.options.apiProxy.history({ sessionId, limit: 50 })
          proven = this.options.apiProxy.historyContainsRpcId(history.entries, entry.dshRpcId)
        } catch { /* Absence or unavailable history cannot prove a safe retry. */ }
      }
      const identity = {
        accountId: entry.accountId,
        runtimeRef: entry.runtimeRef,
        requestRef: entry.requestRef,
      }
      if (proven) this.ledger.complete(identity, { value: recoveredValue })
      else this.ledger.markOutcomeUnknown(identity, 'DSH history did not prove the accepted result after Host recovery')
    }
  }

  private requireReady(): void {
    if (!this.started || this.accountId === undefined || this.runtime === undefined) {
      throw new DshRemoteError('REMOTE_LOGIN_REQUIRED', '请先登录 Arkme 后使用远控')
    }
  }

  private requireConnected(): void {
    this.requireReady()
    if (!this.connected || this.serviceLeaseGeneration <= 0) {
      throw new DshRemoteError('RUNTIME_OFFLINE', '当前 Runtime 未连接 Realtime', true)
    }
  }

  private bump(): void {
    this.revision += 1
    const snapshot = this.getStatus()
    for (const listener of this.listeners) listener(snapshot)
  }
}
