import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import {
  DshApiProxyAdapter,
  stableDshRemoteSessionId,
  type DshRemoteApiProjectionEvent,
} from './api-proxy-adapter.js'
import { DshRemoteHostChannelManager } from './channel-manager.js'
import { DshRemoteCommandLedger, type DshRemoteLedgerEntry } from './command-ledger.js'
import type { DshRemoteHistoryEntry } from './dsh-event-contract.js'
import { canonicalHistoryEntry, DSH_REMOTE_PRESENTATION_VERSION } from './presentation.js'
import { asDshRemoteError, DshRemoteError } from './errors.js'
import { dshRemoteRequestIdentity, parseDshRemoteRequest } from './protocol-v1.js'
import { DshRemoteRuntimeStore } from './runtime-store.js'
import { DshRemoteRuntimeSecretBroker } from './runtime-secret-broker.js'
import type { DshRemoteSessionOwnership, DshRemoteSessionOwnershipOrigin } from './session-ownership-store.js'
import { extractCompletedTurnWindows, projectCompletedTurns } from './turn-projector.js'
import {
  DSH_REMOTE_MAX_PAGE_ITEMS,
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
  type DshRemoteTurnProjection,
} from './types.js'

const HISTORY_RECONCILE_INTERVAL_MILLIS = 30_000
const PROJECTION_SYNC_INTERVAL_MILLIS = 30_000
const BACKEND_HISTORY_BATCH_ITEMS = 100
const BACKEND_TURN_BATCH_ITEMS = 100
const BACKEND_TURN_BATCH_BYTES = 4 * 1024 * 1024
const LIVE_EVENT_BATCH_DELAY_MILLIS = 40
const LIVE_EVENT_BATCH_MAX_ITEMS = 50
const LIVE_EVENT_BATCH_MAX_BYTES = 32 * 1024
const REMOTE_DIAGNOSTICS_ENABLED = process.env.ARKME_DSH_REMOTE_DIAGNOSTICS === '1'

function remoteDiagnostic(event: string, details: Record<string, unknown>): void {
  if (REMOTE_DIAGNOSTICS_ENABLED) console.info(`dsh-arkme: ${event}`, details)
}

function diagnosticRef(value: string): string {
  return value.length <= 8 ? value : value.slice(-8)
}

interface SessionHistoryStatus {
  sessionRef: string
  projectionAsOfSeq: number
  lastEventSeq: number
  historyCompleteThroughSeq: number
  turnProjectionAsOfSeq: number
  turnProjectionCompleteThroughSeq: number
}

interface HostSession { userId: number; clientId: number }
interface HostRuntimeContext {
  serviceLeaseGeneration: number
  metadata: DshRemoteTrustedEventMetadata
}

interface PendingSessionEventBatch {
  accountId: string
  runtime: DshRemoteRuntimeProjection
  sessionRef: string
  entries: DshRemoteHistoryEntry[]
  bytes: number
  issuedAt: number
  timer?: ReturnType<typeof setTimeout>
}

function liveRunState(entries: DshRemoteHistoryEntry[]): 'running' | 'completed' | 'failed' | undefined {
  let state: 'running' | 'completed' | 'failed' | undefined
  for (const entry of entries) {
    if (entry.event.type === 'turn/start') state = 'running'
    if (entry.event.type !== 'turn/end') continue
    const data = entry.event.data !== null && typeof entry.event.data === 'object' && !Array.isArray(entry.event.data)
      ? entry.event.data as Record<string, unknown> : {}
    const raw = data.reason
    const reason = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? String((raw as Record<string, unknown>).kind ?? '') : String(raw ?? '')
    state = reason === 'error' ? 'failed' : 'completed'
  }
  return state
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
  sessionOwnership: DshRemoteSessionOwnership
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

function historySequence(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < -1) {
    throw new DshRemoteError('REMOTE_INVALID_RESPONSE', `Backend ${field} 无效`, true)
  }
  return value
}

function historyCompletenessSequence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < -2) {
    throw new DshRemoteError(
      'REMOTE_INVALID_RESPONSE',
      'Backend history_complete_through_seq 无效',
      true,
    )
  }
  return value
}

function sessionHistoryStatuses(value: Record<string, unknown>): Map<string, SessionHistoryStatus> {
  if (!Array.isArray(value.items)) {
    throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'Backend 历史完整性响应无效', true)
  }
  const result = new Map<string, SessionHistoryStatus>()
  for (const raw of value.items) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'Backend 历史完整性条目无效', true)
    }
    const item = raw as Record<string, unknown>
    const sessionRef = typeof item.session_ref === 'string' ? item.session_ref.trim() : ''
    if (sessionRef === '' || result.has(sessionRef)) {
      throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'Backend 历史完整性 Session 引用无效', true)
    }
    result.set(sessionRef, {
      sessionRef,
      projectionAsOfSeq: historySequence(item.projection_as_of_seq, 'projection_as_of_seq'),
      lastEventSeq: historySequence(item.last_event_seq, 'last_event_seq'),
      historyCompleteThroughSeq: historyCompletenessSequence(item.history_complete_through_seq),
      turnProjectionAsOfSeq: historySequence(item.turn_projection_as_of_seq ?? -1, 'turn_projection_as_of_seq'),
      turnProjectionCompleteThroughSeq: historyCompletenessSequence(item.turn_projection_complete_through_seq ?? -2),
    })
  }
  return result
}

function requiredCapabilities(operation: DshRemoteOperation): DshRemoteCapability[] {
  switch (operation) {
    case 'capabilities.get': return []
    case 'snapshot.get': return ['workspace.list', 'session.list']
    case 'workspace.list': return ['workspace.list']
    case 'model.list': return ['model.list']
    case 'session.model.get': return ['session.model.get']
    case 'session.model.select': return ['session.model.select']
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
  private historySyncError: DshRemoteError | undefined
  private lastProjectionSyncAttemptMillis = 0
  private projectionVersion = 0
  private historyReconcileTimer: ReturnType<typeof setTimeout> | undefined
  private historyReconcileFlight: Promise<void> | undefined
  private historyReconcileRequested = false
  private readonly liveProjectionTails = new Map<string, Promise<void>>()
  private readonly pendingSessionEventBatches = new Map<string, PendingSessionEventBatch>()
  private projectionSyncTail: Promise<void> = Promise.resolve()

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
    this.stopApiProxyEvents()
    await this.flushPendingSessionEventBatches()
    this.started = false
    this.stopTransportDisconnect?.()
    this.stopTransportDisconnect = undefined
    if (this.sessionTimer !== undefined) clearTimeout(this.sessionTimer)
    this.sessionTimer = undefined
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    if (this.historyReconcileTimer !== undefined) clearTimeout(this.historyReconcileTimer)
    this.historyReconcileTimer = undefined
    this.historyReconcileRequested = false
    this.liveProjectionTails.clear()
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
      ...((this.connectionError ?? this.historySyncError) !== undefined
        ? { unavailableReason: (this.connectionError ?? this.historySyncError)!.message }
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
    let request: DshRemoteRequest | undefined
    try {
      this.requireConnected()
      if (context.metadata.senderRole !== 'controller' || context.metadata.runtimeRef !== this.runtime!.runtimeRef) {
        throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控发送方上下文无效')
      }
      if (context.serviceLeaseGeneration !== this.serviceLeaseGeneration
        || context.metadata.targetHostLeaseGeneration !== this.serviceLeaseGeneration) {
        throw new DshRemoteError('HOST_GENERATION_STALE', '远控请求属于旧 Host lease', true)
      }
      if (this.now() - context.metadata.acceptedAtMillis > 30_000) {
        throw new DshRemoteError('COMMAND_EXPIRED', '远控请求投递延迟过长')
      }
      request = parseDshRemoteRequest(value, {
        expectedHostGeneration: this.runtime!.hostGeneration,
        nowMillis: this.now(),
      })
      const capabilities = new Set(this.options.apiProxy.capabilities())
      if (requiredCapabilities(request.operation).some(capability => !capabilities.has(capability))) {
        throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '当前 DSH Runtime 不支持该操作')
      }
      const result = await this.dispatch(request)
      return response(request, result.duplicate ? 'duplicate' : 'completed', this.now(), { result: result.value })
    } catch (error) {
      const remote = asDshRemoteError(error)
      const identity = request ?? (() => {
        const salvaged = dshRemoteRequestIdentity(value)
        if (salvaged === undefined) return undefined
        const now = this.now()
        return {
          protocol: DSH_REMOTE_PROTOCOL,
          protocol_major: DSH_REMOTE_PROTOCOL_MAJOR,
          kind: 'request' as const,
          request_ref: salvaged.requestRef,
          host_generation: salvaged.hostGeneration,
          issued_at: now,
          execute_before: now,
          operation: salvaged.operation,
          body: {},
        }
      })()
      remoteDiagnostic('remote_request_rejected', {
        requestRef: identity === undefined ? '' : diagnosticRef(identity.request_ref),
        operation: identity?.operation ?? '',
        code: remote.code,
        message: remote.message,
      })
      if (identity === undefined) throw remote
      return response(identity, 'rejected', this.now(), {
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
    await this.adoptExistingSessions(accountId)
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
    await this.flushPendingSessionEventBatches()
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
    this.historySyncError = undefined
    this.lastProjectionSyncAttemptMillis = 0
    this.projectionVersion = 0
    if (this.historyReconcileTimer !== undefined) clearTimeout(this.historyReconcileTimer)
    this.historyReconcileTimer = undefined
    this.historyReconcileRequested = false
    this.clearPendingSessionEventBatches()
    this.liveProjectionTails.clear()
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

  private async adoptExistingSessions(accountId: string): Promise<void> {
    const capabilities = new Set(this.options.apiProxy.capabilities())
    if (!capabilities.has('workspace.list') || !capabilities.has('session.list')) return
    const workspaceInventory = await this.options.apiProxy.workspaceInventory()
    let cursor: string | undefined
    const seenCursors = new Set<string>()
    do {
      const page = await this.options.apiProxy.sessions({
        limit: DSH_REMOTE_MAX_PAGE_ITEMS,
        workspaceInventory,
        ...(cursor === undefined ? {} : { cursor }),
      })
      await this.options.sessionOwnership.claimUnownedAndListOwned({
        accountId,
        sessionRefs: page.items.map(item => item.sessionId),
        origin: 'existing-at-login',
        nowMillis: this.now(),
        canClaim: () => this.started && this.accountId === accountId,
      })
      if (!this.started || this.accountId !== accountId) return
      cursor = page.nextCursor
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 会话游标发生循环', true)
        }
        seenCursors.add(cursor)
      }
    } while (cursor !== undefined)
  }

  private async accountSessionPage(
    accountId: string,
    input: Parameters<DshApiProxyAdapter['sessions']>[0] = {},
    origin: DshRemoteSessionOwnershipOrigin = 'observed-while-active',
  ): Promise<Awaited<ReturnType<DshApiProxyAdapter['sessions']>>> {
    const page = await this.options.apiProxy.sessions(input)
    const owned = await this.options.sessionOwnership.claimUnownedAndListOwned({
      accountId,
      sessionRefs: page.items.map(item => item.sessionId),
      origin,
      nowMillis: this.now(),
      canClaim: () => this.started && this.accountId === accountId,
    })
    this.requireActiveAccount(accountId)
    return { ...page, items: page.items.filter(item => owned.has(item.sessionId)) }
  }

  private async ownedInteractions(
    accountId: string,
    interactions: ReturnType<DshApiProxyAdapter['pending']>,
  ): Promise<ReturnType<DshApiProxyAdapter['pending']>> {
    const owned = await this.options.sessionOwnership.claimUnownedAndListOwned({
      accountId,
      sessionRefs: interactions.map(item => item.sessionId),
      origin: 'observed-while-active',
      nowMillis: this.now(),
      canClaim: () => this.started && this.accountId === accountId,
    })
    this.requireActiveAccount(accountId)
    return interactions.filter(item => owned.has(item.sessionId))
  }

  private async requireSessionOwnership(accountId: string, sessionRef: string): Promise<void> {
    this.requireActiveAccount(accountId)
    const owned = await this.options.sessionOwnership.listOwned(accountId, [sessionRef])
    this.requireActiveAccount(accountId)
    if (!owned.has(sessionRef)) throw new DshRemoteError('SESSION_NOT_FOUND', 'DSH 会话不存在')
  }

  private requireActiveAccount(accountId: string, runtimeRef?: string): void {
    if (!this.started || this.accountId !== accountId
      || (runtimeRef !== undefined && this.runtime?.runtimeRef !== runtimeRef)) {
      throw new DshRemoteError('HOST_GENERATION_STALE', '远控请求所属账号或 Runtime 已经切换', true)
    }
  }

  private async publishProjectionEvent(event: DshRemoteApiProjectionEvent): Promise<void> {
    const runtime = this.runtime
    const manager = this.channelManager
    const accountId = this.accountId
    if (!this.started || runtime === undefined || accountId === undefined) return
    const issuedAt = this.now()
    if (event.kind === 'session-event') {
      await this.enqueueSessionEventBatch(accountId, runtime, event.sessionId, event.entry, issuedAt)
      return
    }
    if (event.kind === 'session-projection') {
      const owned = await this.options.sessionOwnership.claimUnownedAndListOwned({
        accountId,
        sessionRefs: [event.sessionId],
        origin: 'observed-while-active',
        nowMillis: issuedAt,
        canClaim: () => this.historyOwnerMatches(accountId, runtime),
      })
      if (!owned.has(event.sessionId) || !this.historyOwnerMatches(accountId, runtime)
        || !this.connected || manager === undefined) return
      const requestRef = `projection_${randomUUID()}`
      await manager.publishProjectionEvent({
        protocol: DSH_REMOTE_PROTOCOL,
        protocol_major: DSH_REMOTE_PROTOCOL_MAJOR,
        kind: 'event',
        request_ref: requestRef,
        host_generation: runtime.hostGeneration,
        issued_at: issuedAt,
        operation: 'snapshot.get',
        body: {
          session_ref: event.sessionId,
          session_projection: { key: event.key, value: event.value, seq: event.seq },
        },
        projection_as_of_seq: event.seq,
      }, requestRef)
      void this.syncProjectionSnapshotSafely()
      return
    }
    const baseline = event.kind === 'mux-baseline'
    if (baseline) {
      const owned = await this.options.sessionOwnership.claimUnownedAndListOwned({
        accountId,
        sessionRefs: [event.sessionId],
        origin: 'observed-while-active',
        nowMillis: issuedAt,
        canClaim: () => this.historyOwnerMatches(accountId, runtime),
      })
      if (!owned.has(event.sessionId) || !this.historyOwnerMatches(accountId, runtime)) return
    }
    const pendingInteractions = await this.ownedInteractions(accountId, event.pendingInteractions)
    if (baseline) this.scheduleHistoryReconcile()
    if (!this.connected || manager === undefined) return
    const requestRef = `projection_${randomUUID()}`
    const pendingFits = Buffer.byteLength(JSON.stringify(pendingInteractions)) <= DSH_REMOTE_MAX_PAGE_RESULT_BYTES
    await manager.publishProjectionEvent({
      protocol: DSH_REMOTE_PROTOCOL,
      protocol_major: DSH_REMOTE_PROTOCOL_MAJOR,
      kind: 'event',
      request_ref: requestRef,
      host_generation: runtime.hostGeneration,
      issued_at: issuedAt,
      operation: 'snapshot.get',
      body: {
        ...(pendingFits ? { pending_interactions: pendingInteractions } : {}),
        ...(baseline ? { reason: 'mux-generation', session_ref: event.sessionId, last_seq: event.lastSeq } : {}),
        ...(!pendingFits && !baseline ? { reason: 'projection-overflow' } : {}),
      },
      ...(baseline && event.lastSeq >= 0 ? { projection_as_of_seq: event.lastSeq } : {}),
    }, requestRef)
  }

  private sessionEventBatchKey(
    accountId: string,
    runtime: DshRemoteRuntimeProjection,
    sessionRef: string,
  ): string {
    return `${accountId}\u0000${runtime.runtimeRef}\u0000${String(runtime.hostGeneration)}\u0000${sessionRef}`
  }

  private async enqueueSessionEventBatch(
    accountId: string,
    runtime: DshRemoteRuntimeProjection,
    sessionRef: string,
    entry: DshRemoteHistoryEntry,
    issuedAt: number,
  ): Promise<void> {
    const key = this.sessionEventBatchKey(accountId, runtime, sessionRef)
    const entryBytes = Buffer.byteLength(JSON.stringify(entry))
    const flushes: Promise<void>[] = []
    let batch = this.pendingSessionEventBatches.get(key)
    if (batch !== undefined && batch.entries.length > 0
      && batch.bytes + entryBytes > LIVE_EVENT_BATCH_MAX_BYTES) {
      flushes.push(this.flushSessionEventBatch(key))
      batch = undefined
    }
    if (batch === undefined) {
      batch = { accountId, runtime, sessionRef, entries: [], bytes: 0, issuedAt }
      this.pendingSessionEventBatches.set(key, batch)
    }
    batch.entries.push(entry)
    batch.bytes += entryBytes

    const delayedChunk = entry.event.type === 'assistant/chunk'
    const mustFlush = !delayedChunk
      || batch.entries.length >= LIVE_EVENT_BATCH_MAX_ITEMS
      || batch.bytes >= LIVE_EVENT_BATCH_MAX_BYTES
    if (mustFlush) {
      flushes.push(this.flushSessionEventBatch(key))
    } else if (batch.timer === undefined) {
      batch.timer = setTimeout(() => {
        void this.flushSessionEventBatch(key).catch(error => {
          if (!this.historyOwnerMatches(accountId, runtime)) return
          this.connectionError = asDshRemoteError(error)
          this.bump()
        })
      }, LIVE_EVENT_BATCH_DELAY_MILLIS)
      batch.timer.unref()
    }
    if (flushes.length > 0) await Promise.all(flushes)
  }

  private async flushSessionEventBatch(key: string): Promise<void> {
    const batch = this.pendingSessionEventBatches.get(key)
    if (batch === undefined) return
    this.pendingSessionEventBatches.delete(key)
    if (batch.timer !== undefined) clearTimeout(batch.timer)
    delete batch.timer
    await this.enqueueLiveProjection(batch.sessionRef, async () => {
      await this.publishSessionEventBatch(batch)
    })
  }

  private async publishSessionEventBatch(batch: PendingSessionEventBatch): Promise<void> {
    const { accountId, runtime, sessionRef } = batch
    if (!this.historyOwnerMatches(accountId, runtime) || batch.entries.length === 0) return
    const owned = await this.options.sessionOwnership.claimUnownedAndListOwned({
      accountId,
      sessionRefs: [sessionRef],
      origin: 'observed-while-active',
      nowMillis: batch.issuedAt,
      canClaim: () => this.historyOwnerMatches(accountId, runtime),
    })
    if (!owned.has(sessionRef) || !this.historyOwnerMatches(accountId, runtime)) return

    const entries = [...batch.entries].sort((left, right) => left.event.seq - right.event.seq)
    const firstSeq = entries[0]!.event.seq
    const lastSeq = entries.at(-1)!.event.seq
    void this.appendSessionHistory(runtime, sessionRef, entries)
      .then(() => {
        if (entries.some(entry => entry.event.type === 'turn/end')
          && this.historyOwnerMatches(accountId, runtime)) {
          this.scheduleHistoryReconcile()
        }
      })
      .catch(error => {
        if (!this.historyOwnerMatches(accountId, runtime)) return
        this.historySyncError = asDshRemoteError(error)
        this.scheduleHistoryReconcile(HISTORY_RECONCILE_INTERVAL_MILLIS)
        this.bump()
      })

    const manager = this.channelManager
    // Backend durability is independent from Realtime presence. A disconnected
    // Host still persists the DSH batch; only the live mobile projection waits.
    if (!this.connected || manager === undefined) return
    if (this.channelManager !== manager || this.runtime?.runtimeRef !== runtime.runtimeRef
      || this.runtime.hostGeneration !== runtime.hostGeneration) return
    const requestRef = `event_${createHash('sha256').update([
      'dsh-remote-session-event-batch-v1', runtime.runtimeRef, String(runtime.hostGeneration), sessionRef,
      String(firstSeq), String(lastSeq), String(entries.length),
    ].join('\n')).digest('base64url').slice(0, 40)}`
    remoteDiagnostic('remote_session_event_batch_publish_start', {
      sessionRef: diagnosticRef(sessionRef), firstSeq, lastSeq,
      itemCount: entries.length, payloadBytes: batch.bytes,
      requestRef: diagnosticRef(requestRef),
    })
    const runState = liveRunState(entries)
    try {
      await manager.publishProjectionEvent({
        protocol: DSH_REMOTE_PROTOCOL,
        protocol_major: DSH_REMOTE_PROTOCOL_MAJOR,
        kind: 'event',
        request_ref: requestRef,
        host_generation: runtime.hostGeneration,
        issued_at: batch.issuedAt,
        operation: 'session.history',
        body: {
          session_ref: sessionRef,
          entries,
          presentation_version: DSH_REMOTE_PRESENTATION_VERSION,
          ...(runState === undefined ? {} : { run_state: runState }),
        },
        session_seq: lastSeq,
        projection_as_of_seq: lastSeq,
      }, requestRef)
      remoteDiagnostic('remote_session_event_batch_publish_acked', {
        sessionRef: diagnosticRef(sessionRef), firstSeq, lastSeq,
        itemCount: entries.length, requestRef: diagnosticRef(requestRef),
      })
    } catch (error) {
      const remote = asDshRemoteError(error)
      remoteDiagnostic('remote_session_event_batch_publish_failed', {
        sessionRef: diagnosticRef(sessionRef), firstSeq, lastSeq,
        itemCount: entries.length, requestRef: diagnosticRef(requestRef),
        code: remote.code, message: remote.message,
      })
      throw error
    }
  }

  private clearPendingSessionEventBatches(): void {
    for (const batch of this.pendingSessionEventBatches.values()) {
      if (batch.timer !== undefined) clearTimeout(batch.timer)
    }
    this.pendingSessionEventBatches.clear()
  }

  private async flushPendingSessionEventBatches(): Promise<void> {
    await Promise.all([...this.pendingSessionEventBatches.keys()].map(async key => {
      await this.flushSessionEventBatch(key)
    }))
  }

  private async enqueueLiveProjection(
    sessionRef: string,
    action: () => Promise<void>,
  ): Promise<void> {
    const previous = this.liveProjectionTails.get(sessionRef) ?? Promise.resolve()
    const queued = previous.catch(() => undefined).then(action)
    this.liveProjectionTails.set(sessionRef, queued)
    try {
      await queued
    } finally {
      if (this.liveProjectionTails.get(sessionRef) === queued) {
        this.liveProjectionTails.delete(sessionRef)
      }
    }
  }

  private async appendSessionHistory(
    runtime: DshRemoteRuntimeProjection,
    sessionRef: string,
    entries: DshRemoteHistoryEntry[],
  ): Promise<void> {
    if (entries.length === 0) return
    const append = async (): Promise<void> => {
      for (let offset = 0; offset < entries.length; offset += BACKEND_HISTORY_BATCH_ITEMS) {
        await this.options.controlPlane.appendSessionEvents({
          runtime_ref: runtime.runtimeRef,
          host_generation: runtime.hostGeneration,
          session_ref: sessionRef,
          entries: entries.slice(offset, offset + BACKEND_HISTORY_BATCH_ITEMS).map(canonicalHistoryEntry),
        })
      }
    }
    try {
      await append()
    } catch (error) {
      const remote = asDshRemoteError(error)
      if (remote.code !== 'REMOTE_NOT_FOUND') throw error
      // A new DSH session can emit before the periodic metadata projection.
      // Publish the authoritative row, then retry the exact immutable seq set.
      await this.syncProjectionSnapshot(true)
      await append()
    }
  }

  private async syncSessionTurns(
    runtime: DshRemoteRuntimeProjection,
    sessionRef: string,
    turns: DshRemoteTurnProjection[],
  ): Promise<boolean> {
    const sync = this.options.controlPlane.syncSessionTurns
    const complete = this.options.controlPlane.completeSessionTurnHistory
    if (sync === undefined || complete === undefined) return false
    try {
      let batch: DshRemoteTurnProjection[] = []
      let batchBytes = 0
      const flush = async (): Promise<void> => {
        if (batch.length === 0) return
        await sync.call(this.options.controlPlane, {
          runtime_ref: runtime.runtimeRef,
          host_generation: runtime.hostGeneration,
          session_ref: sessionRef,
          items: batch,
        })
        batch = []
        batchBytes = 0
      }
      for (const turn of turns) {
        const bytes = Buffer.byteLength(JSON.stringify(turn))
        if (batch.length >= BACKEND_TURN_BATCH_ITEMS || batchBytes + bytes > BACKEND_TURN_BATCH_BYTES) {
          await flush()
        }
        batch.push(turn)
        batchBytes += bytes
      }
      await flush()
      return true
    } catch (error) {
      const remote = asDshRemoteError(error)
      if (!['REMOTE_NOT_FOUND', 'REMOTE_PROTOCOL_UNSUPPORTED', 'CAPABILITY_UNSUPPORTED'].includes(remote.code)) {
        throw error
      }
      // Backend-first rollout is expected, but an older test service must not
      // make DSH unavailable. Raw event history remains the compatibility path.
      this.scheduleHistoryReconcile(HISTORY_RECONCILE_INTERVAL_MILLIS)
      return false
    }
  }

  private scheduleHistoryReconcile(delayMillis = 0): void {
    const runtime = this.runtime
    if (!this.started || this.accountId === undefined || runtime?.desktopRef === undefined) return
    const capabilities = new Set(runtime.capabilities)
    if (!capabilities.has('session.list') || !capabilities.has('session.history')) return
    if (delayMillis === 0 && this.historyReconcileFlight !== undefined) {
      this.historyReconcileRequested = true
      return
    }
    if (this.historyReconcileTimer !== undefined) {
      if (delayMillis > 0) return
      clearTimeout(this.historyReconcileTimer)
    }
    this.historyReconcileTimer = setTimeout(() => {
      this.historyReconcileTimer = undefined
      void this.reconcileAllHistorySafely()
    }, delayMillis)
    this.historyReconcileTimer.unref()
  }

  private async reconcileAllHistorySafely(): Promise<void> {
    if (this.historyReconcileFlight !== undefined) return await this.historyReconcileFlight
    const accountId = this.accountId
    const runtime = this.runtime
    const flight = this.reconcileAllHistory()
    this.historyReconcileFlight = flight
    try {
      await flight
      if (accountId !== undefined && runtime !== undefined
        && this.historyOwnerMatches(accountId, runtime)
        && this.historySyncError !== undefined) {
        this.historySyncError = undefined
        this.bump()
      }
    } catch (error) {
      if (accountId !== undefined && runtime !== undefined
        && this.historyOwnerMatches(accountId, runtime)) {
        this.historySyncError = asDshRemoteError(error)
        this.bump()
        this.scheduleHistoryReconcile(HISTORY_RECONCILE_INTERVAL_MILLIS)
      }
    } finally {
      if (this.historyReconcileFlight === flight) this.historyReconcileFlight = undefined
      if (this.historyReconcileRequested) {
        this.historyReconcileRequested = false
        this.scheduleHistoryReconcile()
      }
    }
  }

  private historyOwnerMatches(accountId: string, runtime: DshRemoteRuntimeProjection): boolean {
    return this.started && this.accountId === accountId
      && this.runtime?.runtimeRef === runtime.runtimeRef
      && this.runtime.hostGeneration === runtime.hostGeneration
  }

  private async reconcileAllHistory(): Promise<void> {
    const accountId = this.accountId
    const runtime = this.runtime
    if (accountId === undefined || runtime?.desktopRef === undefined || !this.started) return
    const capabilities = new Set(runtime.capabilities)
    if (!capabilities.has('session.list') || !capabilities.has('session.history')) return

    const sessions = [] as Awaited<ReturnType<DshApiProxyAdapter['sessions']>>['items']
    let cursor: string | undefined
    const seenSessionCursors = new Set<string>()
    do {
      const page = await this.accountSessionPage(accountId, {
        limit: DSH_REMOTE_MAX_PAGE_ITEMS,
        ...(cursor === undefined ? {} : { cursor }),
      })
      if (!this.historyOwnerMatches(accountId, runtime)) return
      sessions.push(...page.items)
      cursor = page.nextCursor
      if (cursor !== undefined) {
        if (seenSessionCursors.has(cursor)) {
          throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 会话游标发生循环', true)
        }
        seenSessionCursors.add(cursor)
      }
    } while (cursor !== undefined)

    const statuses = new Map<string, SessionHistoryStatus>()
    for (let offset = 0; offset < sessions.length; offset += DSH_REMOTE_MAX_PAGE_ITEMS) {
      const refs = sessions.slice(offset, offset + DSH_REMOTE_MAX_PAGE_ITEMS).map(item => item.sessionId)
      const response = await this.options.controlPlane.sessionEventSyncStatuses({
        runtime_ref: runtime.runtimeRef,
        session_refs: refs,
      })
      if (!this.historyOwnerMatches(accountId, runtime)) return
      const page = sessionHistoryStatuses(response)
      for (const ref of refs) {
        const status = page.get(ref)
        if (status === undefined) {
          throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'Backend 缺少会话历史完整性条目', true)
        }
        statuses.set(ref, status)
      }
    }

    let firstFailure: unknown
    for (const session of sessions) {
      if (!this.historyOwnerMatches(accountId, runtime)) return
      const status = statuses.get(session.sessionId)
      if (status === undefined) continue
      if (session.projectionAsOfSeq !== undefined
        && status.historyCompleteThroughSeq >= session.projectionAsOfSeq
        && (this.options.controlPlane.syncSessionTurns === undefined
          || status.turnProjectionCompleteThroughSeq >= session.projectionAsOfSeq)) continue
      try {
        await this.reconcileSessionHistory(accountId, runtime, session.sessionId, session.projectionAsOfSeq)
      } catch (error) {
        firstFailure ??= error
      }
    }
    if (firstFailure !== undefined) throw firstFailure
  }

  private async reconcileSessionHistory(
    accountId: string,
    runtime: DshRemoteRuntimeProjection,
    sessionRef: string,
    expectedThroughSeq?: number,
  ): Promise<void> {
    let beforeSeq: number | undefined
    let completeThroughSeq: number | undefined
    let maximumEntrySeq = -1
    let pendingProjectionEntries: DshRemoteHistoryEntry[] = []
    let turnProjectionSupported = this.options.controlPlane.syncSessionTurns !== undefined
      && this.options.controlPlane.completeSessionTurnHistory !== undefined
    let turnProjectionBlocked = false
    const seenCursors = new Set<number>()
    while (true) {
      const page = await this.options.apiProxy.history({
        sessionId: sessionRef,
        limit: DSH_REMOTE_MAX_PAGE_ITEMS,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      })
      if (!this.historyOwnerMatches(accountId, runtime)) return
      if (completeThroughSeq === undefined) {
        completeThroughSeq = page.projectionAsOfSeq ?? expectedThroughSeq
      }
      for (const entry of page.entries) {
        maximumEntrySeq = Math.max(maximumEntrySeq, entry.event.seq)
      }
      await this.appendSessionHistory(runtime, sessionRef, page.entries)
      if (!this.historyOwnerMatches(accountId, runtime)) return
      const extracted = extractCompletedTurnWindows([
        ...page.entries,
        ...pendingProjectionEntries,
      ])
      pendingProjectionEntries = extracted.pending
      const pageTurns: DshRemoteTurnProjection[] = []
      for (const window of extracted.completed) {
        const projected = projectCompletedTurns(window)
        turnProjectionBlocked ||= projected.oversizedTurnRefs.length > 0
          || projected.unmatchedTurnEndSeqs.length > 0
        pageTurns.push(...projected.turns)
      }
      if (turnProjectionSupported && pageTurns.length > 0) {
        turnProjectionSupported = await this.syncSessionTurns(runtime, sessionRef, pageTurns)
      }
      if (!page.hasMore) break
      const next = page.nextCursor
      if (next === undefined || next < 0 || seenCursors.has(next)) {
        throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 历史游标无效或发生循环', true)
      }
      seenCursors.add(next)
      beforeSeq = next
    }
    const throughSeq = completeThroughSeq ?? maximumEntrySeq
    if (!this.historyOwnerMatches(accountId, runtime)) return
    await this.options.controlPlane.completeSessionEventHistory({
      runtime_ref: runtime.runtimeRef,
      host_generation: runtime.hostGeneration,
      session_ref: sessionRef,
      through_seq: throughSeq,
    })
    if (!this.historyOwnerMatches(accountId, runtime)) return
    const pendingProjection = projectCompletedTurns(pendingProjectionEntries)
    turnProjectionBlocked ||= pendingProjection.oversizedTurnRefs.length > 0
      || pendingProjection.unmatchedTurnEndSeqs.length > 0
    if (turnProjectionSupported && pendingProjection.turns.length > 0) {
      turnProjectionSupported = await this.syncSessionTurns(
        runtime,
        sessionRef,
        pendingProjection.turns,
      )
    }
    if (!turnProjectionSupported || turnProjectionBlocked) return
    if (!this.historyOwnerMatches(accountId, runtime)) return
    await this.options.controlPlane.completeSessionTurnHistory!({
      runtime_ref: runtime.runtimeRef,
      host_generation: runtime.hostGeneration,
      session_ref: sessionRef,
      through_seq: throughSeq,
    })
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
    this.scheduleHistoryReconcile()
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
      this.scheduleHistoryReconcile()
      this.bump()
    } catch (error) {
      await this.options.realtime.disconnect()
      await manager.close()
      throw error
    }
  }

  private async syncProjectionSnapshotSafely(force = false): Promise<void> {
    const now = this.now()
    if (!force && now - this.lastProjectionSyncAttemptMillis < PROJECTION_SYNC_INTERVAL_MILLIS) return
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
    const run = async (): Promise<void> => { await this.performProjectionSnapshot(force) }
    const next = this.projectionSyncTail.then(run, run)
    this.projectionSyncTail = next.then(() => undefined, () => undefined)
    await next
  }

  private async performProjectionSnapshot(force = false): Promise<void> {
    const runtime = this.runtime
    const accountId = this.accountId
    if (runtime === undefined || accountId === undefined) return
    if (force) this.lastProjectionSyncAttemptMillis = this.now()
    const capabilities = new Set(this.options.apiProxy.capabilities())
    const projectionAt = this.nextProjectionVersion()
    const snapshotRef = `snap_${runtime.hostGeneration}_${projectionAt}`
    const previous = await this.options.runtimeStore.projectionInventory(
      accountId,
      this.options.profileRef,
    )
    const workspaceInventory = capabilities.has('workspace.list')
      ? await this.options.apiProxy.workspaceInventory()
      : { items: [], archivedSessionIds: [] }
    const workspaces = workspaceInventory.items
    const currentWorkspaceRefs = new Set(workspaces.map(item => item.workspaceId))
    const workspaceItems = [
      ...workspaces.map((item, orderIndex) => ({
        workspace_ref: item.workspaceId,
        title: item.title,
        path: item.path,
        available: item.available,
        projection_at: projectionAt,
        order_index: orderIndex,
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
          order_index: 0,
          deleted: true,
        })),
    ]
    for (let offset = 0; offset < workspaceItems.length || offset === 0; offset += 100) {
      await this.options.controlPlane.syncWorkspaces({
        runtime_ref: runtime.runtimeRef,
        host_generation: runtime.hostGeneration,
        snapshot_ref: snapshotRef,
        items: workspaceItems.slice(offset, offset + 100),
      })
      if (workspaceItems.length === 0) break
    }

    const sessions = [] as Awaited<ReturnType<DshApiProxyAdapter['sessions']>>['items']
    if (capabilities.has('session.list')) {
      let cursor: string | undefined
      const seenCursors = new Set<string>()
      for (let pageCount = 0; pageCount < 200; pageCount += 1) {
        const page = await this.accountSessionPage(accountId, {
          limit: 50,
          workspaceInventory,
          ...(cursor === undefined ? {} : { cursor }),
        })
        sessions.push(...page.items)
        if (page.nextCursor === undefined) break
        if (seenCursors.has(page.nextCursor)) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 会话游标发生循环')
        seenCursors.add(page.nextCursor)
        cursor = page.nextCursor
        if (pageCount === 199) throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'DSH 会话分页超过安全上限')
      }
    }
    const currentSessionRefs = new Set(sessions.map(item => item.sessionId))
    const sessionOrder = new Map<string, number>()
    for (const workspace of workspaces) {
      workspace.sessionIds.forEach((sessionRef, orderIndex) => {
        if (!sessionOrder.has(sessionRef)) sessionOrder.set(sessionRef, orderIndex)
      })
    }
    const sessionItems = [
      ...sessions.map(item => ({
        workspace_ref: item.workspaceId,
        session_ref: item.sessionId,
        title: item.title ?? '',
        source_updated_at: Math.max(1, Math.trunc(item.updatedAt)),
        projection_at: projectionAt,
        order_index: sessionOrder.get(item.sessionId) ?? sessions.length,
        running: item.running,
        blank: item.blank,
        archived: item.archived === true,
        ...(item.origin === undefined ? {} : { origin: item.origin }),
        ...(item.parentSessionId === undefined ? {} : { parent_session_ref: item.parentSessionId }),
        ...(item.projectionAsOfSeq === undefined ? {} : { projection_as_of_seq: item.projectionAsOfSeq }),
        ...(Object.hasOwn(item, 'goal') ? { goal: item.goal } : {}),
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
          order_index: 0,
          running: false,
          blank: false,
          archived: false,
          deleted: true,
        })),
    ]
    for (let offset = 0; offset < sessionItems.length || offset === 0; offset += 100) {
      await this.options.controlPlane.syncSessions({
        runtime_ref: runtime.runtimeRef,
        host_generation: runtime.hostGeneration,
        snapshot_ref: snapshotRef,
        items: sessionItems.slice(offset, offset + 100),
      })
      if (sessionItems.length === 0) break
    }
    await this.options.controlPlane.completeProjectionSnapshot({
      runtime_ref: runtime.runtimeRef,
      host_generation: runtime.hostGeneration,
      snapshot_ref: snapshotRef,
      workspace_count: workspaces.length,
      session_count: sessions.length,
    })
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
        const accountId = this.accountId!
        const value = await this.options.apiProxy.snapshot({
          ...(cursor === undefined ? {} : { cursor }),
          ...(limit === undefined ? {} : { limit }),
        })
        this.requireActiveAccount(accountId)
        const ownedSessions = await this.options.sessionOwnership.claimUnownedAndListOwned({
          accountId,
          sessionRefs: value.sessions.map(item => item.sessionId),
          origin: 'observed-while-active',
          nowMillis: this.now(),
          canClaim: () => this.started && this.accountId === accountId,
        })
        return { duplicate: false, value: {
          ...value,
          sessions: value.sessions.filter(item => ownedSessions.has(item.sessionId)),
          pendingInteractions: await this.ownedInteractions(accountId, value.pendingInteractions),
        } }
      }
      case 'workspace.list': {
        const cursor = optionalString(request.body, 'cursor')
        const limit = optionalPositive(request.body, 'limit')
        return { duplicate: false, value: await this.options.apiProxy.workspacePage({
          ...(cursor === undefined ? {} : { cursor }),
          ...(limit === undefined ? {} : { limit }),
        }) }
      }
      case 'model.list':
        return { duplicate: false, value: await this.options.apiProxy.models() }
      case 'session.model.get': {
        const sessionId = stringBody(request.body, 'session_ref')
        await this.requireSessionOwnership(this.accountId!, sessionId)
        return { duplicate: false, value: await this.options.apiProxy.sessionModel({ sessionId }) }
      }
      case 'session.list': {
        const workspaceId = optionalString(request.body, 'workspace_ref')
        const cursor = optionalString(request.body, 'cursor')
        const limit = optionalPositive(request.body, 'limit')
        return { duplicate: false, value: await this.accountSessionPage(this.accountId!, {
          ...(workspaceId === undefined ? {} : { workspaceId }),
          ...(cursor === undefined ? {} : { cursor }),
          ...(limit === undefined ? {} : { limit }),
        }) }
      }
      case 'session.history': {
        const beforeSeq = optionalPositive(request.body, 'before_seq')
        const limit = optionalPositive(request.body, 'limit')
        const sessionId = stringBody(request.body, 'session_ref')
        await this.requireSessionOwnership(this.accountId!, sessionId)
        return { duplicate: false, value: await this.options.apiProxy.history({
          sessionId,
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
    if (request.operation !== 'session.create') {
      await this.requireSessionOwnership(accountId, stringBody(request.body, 'session_ref'))
    }
    this.requireActiveAccount(accountId, runtimeRef)
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
          if ((request.body.model_provider !== undefined || request.body.model_id !== undefined)
            && !this.runtime!.capabilities.includes('session.create.model')) {
            throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '当前 DSH 不支持远程选择模型')
          }
          value = await this.options.apiProxy.createSession({
            workspaceId: stringBody(request.body, 'workspace_ref'),
            dshRpcId: begun.entry.dshRpcId,
            beforeCreate: async plannedSessionId => {
              const owned = await this.options.sessionOwnership.claimUnownedAndListOwned({
                accountId,
                sessionRefs: [plannedSessionId],
                origin: 'remote-create',
                nowMillis: this.now(),
                canClaim: () => this.started && this.accountId === accountId
                  && this.runtime?.runtimeRef === runtimeRef,
              })
              this.requireActiveAccount(accountId, runtimeRef)
              if (!owned.has(plannedSessionId)) {
                throw new DshRemoteError('SESSION_STATE_CHANGED', 'DSH 会话归属已经变化')
              }
            },
            ...(request.body.model_provider === undefined
              ? {}
              : { modelSelection: {
                  provider: stringBody(request.body, 'model_provider'),
                  model: stringBody(request.body, 'model_id'),
                  ...(request.body.reasoning_effort === undefined
                    ? {}
                    : { reasoningEffort: stringBody(request.body, 'reasoning_effort', 128) }),
                } }),
          })
          break
        case 'session.model.select':
          value = await this.options.apiProxy.selectSessionModel({
            sessionId: stringBody(request.body, 'session_ref'),
            provider: stringBody(request.body, 'model_provider'),
            model: stringBody(request.body, 'model_id'),
            ...(request.body.reasoning_effort === undefined
              ? {}
              : { reasoningEffort: stringBody(request.body, 'reasoning_effort', 128) }),
            dshRpcId: begun.entry.dshRpcId,
          })
          break
        case 'session.prompt':
          value = {
            ...await this.options.apiProxy.prompt({
              sessionId: stringBody(request.body, 'session_ref'),
              mode: request.body.mode === 'queue' || request.body.mode === 'steer'
                ? request.body.mode
                : (() => { throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'prompt mode 无效') })(),
              content: [request.body.content],
              dshRpcId: begun.entry.dshRpcId,
            }),
            dsh_rpc_id: begun.entry.dshRpcId,
          }
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
    const accountId = this.accountId
    const runtimeRef = this.runtime?.runtimeRef
    if (this.ledger === undefined || accountId === undefined || runtimeRef === undefined) return
    for (const entry of this.ledger.unsettledForReconciliation(accountId, this.now())) {
      this.requireActiveAccount(accountId, runtimeRef)
      const argumentsValue = entry.payload.arguments
      const argumentsRecord = argumentsValue !== null && typeof argumentsValue === 'object' && !Array.isArray(argumentsValue)
        ? argumentsValue as Record<string, unknown> : undefined
      const sessionId = typeof argumentsRecord?.session_ref === 'string' ? argumentsRecord.session_ref : undefined
      let proven = false
      let recoveredValue: Record<string, unknown> = { recovered: true, dshRpcId: entry.dshRpcId }
      if (entry.operation === 'session.create' && typeof argumentsRecord?.workspace_ref === 'string') {
        try {
          const plannedSessionId = stableDshRemoteSessionId(entry.dshRpcId)
          const owned = await this.options.sessionOwnership.claimUnownedAndListOwned({
            accountId: entry.accountId,
            sessionRefs: [plannedSessionId],
            origin: 'remote-create',
            nowMillis: this.now(),
            canClaim: () => this.started && this.accountId === accountId
              && this.runtime?.runtimeRef === runtimeRef,
          })
          this.requireActiveAccount(accountId, runtimeRef)
          if (!owned.has(plannedSessionId)) {
            throw new DshRemoteError('SESSION_STATE_CHANGED', 'DSH 会话归属已经变化')
          }
          const created = await this.options.apiProxy.reconcileCreatedSession({
            workspaceId: argumentsRecord.workspace_ref,
            dshRpcId: entry.dshRpcId,
            ...(typeof argumentsRecord.model_provider !== 'string'
              || typeof argumentsRecord.model_id !== 'string'
              ? {}
              : { modelSelection: {
                  provider: argumentsRecord.model_provider,
                  model: argumentsRecord.model_id,
                  ...(typeof argumentsRecord.reasoning_effort === 'string'
                    ? { reasoningEffort: argumentsRecord.reasoning_effort }
                    : {}),
                } }),
          })
          if (created !== undefined) {
            proven = true
            recoveredValue = { recovered: true, sessionId: created.sessionId }
          }
        } catch { /* An unavailable list cannot prove a safe result. */ }
      }
      if (entry.operation === 'session.model.select' && sessionId !== undefined
        && typeof argumentsRecord?.model_provider === 'string'
        && typeof argumentsRecord.model_id === 'string') {
        try {
          proven = await this.options.apiProxy.sessionModelMatches({
            sessionId,
            provider: argumentsRecord.model_provider,
            model: argumentsRecord.model_id,
            ...(typeof argumentsRecord.reasoning_effort === 'string'
              ? { reasoningEffort: argumentsRecord.reasoning_effort }
              : {}),
          })
          if (proven) recoveredValue = {
            recovered: true,
            selected: {
              provider: argumentsRecord.model_provider,
              model: argumentsRecord.model_id,
              ...(typeof argumentsRecord.reasoning_effort === 'string'
                ? { reasoningEffort: argumentsRecord.reasoning_effort }
                : {}),
            },
          }
        } catch { /* An unavailable projection cannot prove a safe result. */ }
      }
      if (sessionId !== undefined && entry.operation !== 'session.model.select') {
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
