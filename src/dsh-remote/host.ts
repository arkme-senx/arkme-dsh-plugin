import { DshLiveEventBatcher, LIVE_BATCH_ITEMS, type LiveEventBatch } from './live-event-batcher.js'
import { DesktopSessionPresence } from './desktop-session-presence.js'
import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { scheduler } from 'node:timers/promises'
import {
  DshApiProxyAdapter,
  stableDshRemoteSessionId,
  type DshRemoteApiProjectionEvent,
} from './api-proxy-adapter.js'
import { DshRemoteHostChannelManager } from './channel-manager.js'
import { DshRemoteCommandLedger, type DshRemoteLedgerEntry } from './command-ledger.js'
import { dshTranscriptHistoryEntries, type DshRemoteHistoryEntry } from './dsh-event-contract.js'
import { DSH_REMOTE_PRESENTATION_VERSION } from './presentation.js'
import { asDshRemoteError, DshRemoteError } from './errors.js'
import { dshRemoteRequestIdentity, parseDshRemoteRequest } from './protocol-v1.js'
import { DshRemoteRuntimeStore } from './runtime-store.js'
import { DshRemoteRuntimeSecretBroker } from './runtime-secret-broker.js'
import type { DshRemoteSessionOwnership, DshRemoteSessionOwnershipOrigin } from './session-ownership-store.js'
import type { DshRemoteTurnUploadOutbox } from './turn-upload-outbox.js'
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
} from './types.js'

const PROJECTION_SYNC_INTERVAL_MILLIS = 30_000
const LIVE_EVENT_BATCH_MAX_ITEMS = LIVE_BATCH_ITEMS
const HISTORY_OBJECT_BACKFILL_INITIAL_DELAY_MILLIS = 5_000
const HISTORY_OBJECT_BACKFILL_NEXT_DELAY_MILLIS = 250
const HISTORY_OBJECT_BACKFILL_RETRY_DELAY_MILLIS = 30_000
const HISTORY_OBJECT_KNOWN_BATCH_ITEMS = 500
const RECONNECT_BASE_DELAY_MILLIS = 1_000
const RECONNECT_MAX_DELAY_MILLIS = 30_000
const RECONNECT_STABLE_MILLIS = 60_000
const REMOTE_DIAGNOSTICS_ENABLED = process.env.ARKME_DSH_REMOTE_DIAGNOSTICS === '1'

function remoteDiagnostic(event: string, details: Record<string, unknown>): void {
  if (REMOTE_DIAGNOSTICS_ENABLED) console.info(`dsh-arkme: ${event}`, details)
}

function diagnosticRef(value: string): string {
  return value.length <= 8 ? value : value.slice(-8)
}

interface HostSession { userId: number; clientId: number }
interface DshRemotePersistenceHeader { id: string }
interface DshRemotePersistenceSnapshot {
  header: DshRemotePersistenceHeader
  revision: unknown
}
export interface DshRemoteSessionPersistenceLike {
  listSnapshots(signal?: AbortSignal): Promise<DshRemotePersistenceSnapshot[]>
  readFrom(sessionId: string, fromSeq: number, signal?: AbortSignal): Promise<{
    meta: DshRemotePersistenceHeader
    events: DshRemoteHistoryEntry['event'][]
  }>
  /** Public JSONL-backend seam that decodes packed rows without current message-shape validation. */
  loadStored?(sessionId: string, signal?: AbortSignal): Promise<{
    meta: DshRemotePersistenceHeader
    events: DshRemoteHistoryEntry['event'][]
  } | undefined>
}

function isLegacyMessageShapeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:lacks an identified message|message has invalid (?:source|content)|message must have (?:model|tool) source|message must contain one tool-result block|message has mismatched tool call ids)/.test(message)
}
interface HostRuntimeContext {
  serviceLeaseGeneration: number
  metadata: DshRemoteTrustedEventMetadata
}

interface ScopedLiveEventBatch extends LiveEventBatch {
  accountId: string
  runtime: DshRemoteRuntimeProjection
  generation: number
  scopeKey: string
}

interface TurnObjectUploadCapability {
  maxObjectBytes: number
  backfillMode?: 'local_persistence_v1'
}

type DshRemoteHostControlPlane = Pick<DshRemoteControlPlane,
  | 'registerDesktop'
  | 'registerRuntime'
  | 'syncWorkspaces'
  | 'syncSessions'
  | 'completeProjectionSnapshot'
  | 'turnObjectUploadCapabilities'
  | 'knownHistorySessions'
>

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
  readLifecycle?: () => Promise<{ resumeGeneration: number; suspended: boolean } | undefined>
  readSession: () => Promise<HostSession | undefined>
  secretBroker: DshRemoteRuntimeSecretBroker
  runtimeStore: DshRemoteRuntimeStore
  sessionOwnership: DshRemoteSessionOwnership
  controlPlane: DshRemoteHostControlPlane
  realtime: DshRemoteRealtimeTransport
  apiProxy: DshApiProxyAdapter
  ledgerForAccount: (accountId: string, key: Buffer) => Promise<DshRemoteCommandLedger> | DshRemoteCommandLedger
  turnUploadForAccount?: (
    accountId: string,
    key: Buffer,
    maxObjectBytes: number,
    callbacks: { onError: (error: unknown, sessionRef?: string) => void; onFinalized: (sessionRef: string) => void },
  ) => DshRemoteTurnUploadOutbox
  sessionPersistence?: DshRemoteSessionPersistenceLike
  now?: () => number
  yieldToEventLoop?: () => Promise<void>
  onDiagnostic?: (event: string, fields: Record<string, unknown>) => void
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

function validHistorySessionRef(value: string): boolean {
  return value.trim() === value && value.length > 0 && value.length <= 128
    && ![...value].some(char => char.codePointAt(0)! < 0x21 || char.codePointAt(0) === 0x7f)
}

function requiredCapabilities(operation: DshRemoteOperation): DshRemoteCapability[] {
  switch (operation) {
    case 'capabilities.get': return []
    case 'snapshot.get': return ['workspace.list', 'session.list']
    case 'workspace.list': return ['workspace.list']
    case 'model.list': return ['model.list']
    case 'session.model.get': return ['session.model.get']
    case 'session.model.select': return ['session.model.select']
    case 'session.current': return ['session.list', 'workspace.list']
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
  private accountGeneration = 0
  private projectionController = new AbortController()
  private accountId: string | undefined
  private clientId = 0
  private ledger: DshRemoteCommandLedger | undefined
  private turnUpload: DshRemoteTurnUploadOutbox | undefined
  private turnUploadActivationFlight: Promise<void> | undefined
  private turnUploadActivationController: AbortController | undefined
  private nextTurnUploadActivationAt = 0
  private attemptId: string | undefined
  private failedAttemptId: string | undefined
  private resumeGeneration: number | undefined
  private started = false
  private connected = false
  private serviceLeaseGeneration = 0
  private revision = 0
  private stopEvents: (() => void) | undefined
  private stopProjectionEvents: (() => void) | undefined
  private channelManager: DshRemoteHostChannelManager | undefined
  private stopTransportDisconnect: (() => void) | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private stableConnectionTimer: ReturnType<typeof setTimeout> | undefined
  private connectionFlight: Promise<void> | undefined
  private connectionController: AbortController | undefined
  private reconnectAttempt = 0
  private sessionTimer: ReturnType<typeof setTimeout> | undefined
  private connectionError: DshRemoteError | undefined
  private historySyncError: DshRemoteError | undefined
  private historySyncErrorSessionRef: string | undefined
  private projectionError: DshRemoteError | undefined
  private lastProjectionSyncAttemptMillis = 0
  private projectionVersion = 0
  private historyObjectBackfillTimer: ReturnType<typeof setTimeout> | undefined
  private historyObjectBackfillFlight: Promise<boolean> | undefined
  private historyObjectBackfillController: AbortController | undefined
  private readonly historyObjectBackfillFailures = new Map<string, { revision: string; nextAttemptAt: number }>()
  private liveEventBatcher: { key: string; value: DshLiveEventBatcher } | undefined
  private liveDeliveryStats: Record<string, number> = {}
  private lastDeliveryReportAt = performance.now()
  private projectionSyncTail: Promise<void> = Promise.resolve()
  private backgroundProjectionFlight: Promise<void> | undefined

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
    await this.stopLifecycle(true)
  }

  async suspend(): Promise<void> {
    await this.stopLifecycle(false)
  }

  private async stopLifecycle(flushPending: boolean): Promise<void> {
    if (!this.started) return
    this.stopApiProxyEvents()
    if (flushPending) await this.flushPendingSessionEventBatches()
    else this.clearPendingSessionEventBatches()
    this.started = false
    this.connectionController?.abort()
    this.connectionController = undefined
    this.stopTransportDisconnect?.()
    this.stopTransportDisconnect = undefined
    if (this.sessionTimer !== undefined) clearTimeout(this.sessionTimer)
    this.sessionTimer = undefined
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    if (this.stableConnectionTimer !== undefined) clearTimeout(this.stableConnectionTimer)
    this.stableConnectionTimer = undefined
    this.reconnectAttempt = 0
    await this.deactivateAccount()
    this.bump()
  }

  private readonly desktopSessions = new DesktopSessionPresence()
  private desktopSelectionTimer: ReturnType<typeof setTimeout> | undefined
  private desktopSelectionFlight: Promise<void> | undefined
  private desktopSelectionDirty = false
  private publishedDesktopSelection: string | undefined

  private scheduleDesktopSelection(): void {
    if (this.desktopSelectionTimer !== undefined) clearTimeout(this.desktopSelectionTimer)
    this.desktopSelectionTimer = undefined
    const delay = this.desktopSessions.expiryDelay(performance.now())
    if (delay !== undefined) {
      this.desktopSelectionTimer = setTimeout(() => { this.scheduleDesktopSelection() }, delay)
      this.desktopSelectionTimer.unref()
    }
    const manager = this.channelManager
    const runtime = this.runtime
    const generation = this.accountGeneration
    if (!this.started || !this.connected || manager === undefined || runtime === undefined) return
    this.desktopSelectionDirty = true
    if (this.desktopSelectionFlight !== undefined) return
    const flight = (async () => {
      while (this.desktopSelectionDirty && generation === this.accountGeneration && manager === this.channelManager) {
        this.desktopSelectionDirty = false
        const selection = this.desktopSessions.snapshot(performance.now())
        const fingerprint = JSON.stringify([selection.revision, selection.sessionRef ?? null])
        if (fingerprint === this.publishedDesktopSelection) continue
        const value = await this.currentSession()
        if (generation !== this.accountGeneration || manager !== this.channelManager) return
        if (this.desktopSessions.snapshot(performance.now()).revision !== selection.revision) {
          this.desktopSelectionDirty = true
          continue
        }
        const requestRef = `desktop_selection_${randomUUID()}`
        await manager.publishProjectionEvent({
          protocol: DSH_REMOTE_PROTOCOL, protocol_major: DSH_REMOTE_PROTOCOL_MAJOR,
          kind: 'event', request_ref: requestRef, host_generation: runtime.hostGeneration,
          issued_at: this.now(), operation: 'session.current',
          body: { ...value, selectionRevision: selection.revision },
        }, requestRef)
        if (generation !== this.accountGeneration || manager !== this.channelManager) return
        // A just-created session may not be owned until its canonical baseline arrives.
        if (value.session !== null || selection.sessionRef === undefined) this.publishedDesktopSelection = fingerprint
      }
    })().catch(error => {
      this.diagnostic('desktop_selection_failed', { error_code: asDshRemoteError(error).code })
    }).finally(() => {
      if (this.desktopSelectionFlight === flight) {
        this.desktopSelectionFlight = undefined
        if (this.desktopSelectionDirty && generation === this.accountGeneration) this.scheduleDesktopSelection()
      }
    })
    this.desktopSelectionFlight = flight
  }

  reportCurrentSession(input: { accountId: string; windowRef: string; revision: number; sessionRef: string | null }): void {
    this.requireActiveAccount(input.accountId)
    this.desktopSessions.report(input, performance.now())
    this.scheduleDesktopSelection()
  }

  async currentSession(): Promise<{ session: { sessionRef: string; workspaceRef: string; title?: string; running: boolean; projectionAsOfSeq?: number } | null }> {
    const accountId = this.accountId
    const generation = this.accountGeneration
    const sessionRef = this.desktopSessions.current(performance.now())
    if (accountId === undefined || sessionRef === undefined) return { session: null }
    const owned = await this.options.sessionOwnership.listOwned(accountId, [sessionRef])
    if (generation !== this.accountGeneration || !owned.has(sessionRef)) return { session: null }
    const page = await this.options.apiProxy.sessions({ sessionId: sessionRef, limit: 1 })
    this.requireActiveAccount(accountId)
    // A slow lookup may outlive a tab switch or the Browser lease.
    if (generation !== this.accountGeneration || this.desktopSessions.current(performance.now()) !== sessionRef) return { session: null }
    const session = page.items.find(item => item.sessionId === sessionRef && !item.archived && item.origin !== 'subagent')
    return { session: session === undefined ? null : { sessionRef, workspaceRef: session.workspaceId, running: session.running, ...(session.title === undefined ? {} : { title: session.title }), ...(session.projectionAsOfSeq === undefined ? {} : { projectionAsOfSeq: session.projectionAsOfSeq }) } }
  }

  private capabilities(): DshRemoteCapability[] {
    const values = this.options.apiProxy.capabilities()
    return values.includes('session.list') && values.includes('workspace.list')
      ? [...values, 'session.current'] : values
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
      capabilities: this.runtime?.capabilities ?? this.capabilities(),
      revision: this.revision,
      ...(this.accountId === undefined ? {} : { accountId: this.accountId }),
      ...(this.runtime?.desktopRef === undefined ? {} : { desktopRef: this.runtime.desktopRef }),
      ...(this.runtime === undefined ? {} : { runtimeRef: this.runtime.runtimeRef }),
      ...(this.connectionError !== undefined
        ? { unavailableReason: this.connectionError.message }
        : available ? {} : { unavailableReason: !this.options.featureEnabled
          ? '远控能力尚未在此版本启用'
          : this.accountId === undefined
            ? '请先登录 Arkme 后使用 DSH 远程会话'
            : this.options.transportAvailable === false
              ? '当前 DSH Host 尚未提供带登录态的 Realtime Socket Factory'
              : this.options.apiProxy.capabilities().length === 0
                ? '当前 DSH 缺少公共 ApiProxy 能力'
                : '远控运行依赖尚未就绪' }),
      ...(this.historySyncError === undefined
        ? {}
        : { historySyncWarning: this.historySyncError.message }),
      ...(this.projectionError === undefined
        ? {}
        : { projectionWarning: this.projectionError.message }),
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
    const lifecycle = await this.options.readLifecycle?.()
    if (lifecycle !== undefined) {
      const resumed = this.resumeGeneration !== undefined && lifecycle.resumeGeneration !== this.resumeGeneration
      this.resumeGeneration = lifecycle.resumeGeneration
      if (resumed) {
        if (this.connected) this.options.realtime.revalidate()
        if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
        this.reconnectTimer = undefined
      }
    }
    const session = await this.options.readSession()
    if (session === undefined) {
      if (this.accountId !== undefined) await this.deactivateAccount()
      this.bump()
      return
    }
    const accountId = String(session.userId)
    if (this.accountId === accountId && this.clientId === session.clientId && this.runtime !== undefined) {
      await this.ensureAutomaticConnection()
      if (this.turnUpload === undefined && this.turnUploadActivationFlight === undefined
        && this.now() >= this.nextTurnUploadActivationAt) {
        this.startTurnUploadActivation(
          accountId,
          this.runtime,
          await this.options.secretBroker.ledgerKey(accountId),
        )
      }
      return
    }
    if (this.accountId !== undefined) await this.deactivateAccount()
    this.clientId = session.clientId
    this.accountId = accountId
    this.accountGeneration += 1
    this.projectionController = new AbortController()
    await this.adoptExistingSessions(accountId)
    this.runtime = await this.options.runtimeStore.activateRuntime({
      accountId,
      profileRef: this.options.profileRef,
      capabilities: this.capabilities(),
      nowMillis: this.now(),
    })
    const accountKey = await this.options.secretBroker.ledgerKey(accountId)
    this.ledger = await this.options.ledgerForAccount(accountId, accountKey)
    await this.reconcileUnsettled()
    this.ledger.cleanup({ retentionMillis: 7 * 24 * 60 * 60_000, maxCommands: 10_000 })
    await this.ensureAutomaticConnection()
    this.startTurnUploadActivation(accountId, this.runtime, accountKey)
    this.bump()
  }

  private startTurnUploadActivation(
    accountId: string,
    runtime: DshRemoteRuntimeProjection,
    accountKey: Buffer,
  ): void {
    if (this.turnUpload !== undefined || this.turnUploadActivationFlight !== undefined) return
    this.nextTurnUploadActivationAt = this.now() + HISTORY_OBJECT_BACKFILL_RETRY_DELAY_MILLIS
    const controller = new AbortController()
    const flight = this.activateTurnUploadIfAvailable(
      accountId,
      runtime,
      accountKey,
      AbortSignal.any([controller.signal, AbortSignal.timeout(2_000)]),
    )
    this.turnUploadActivationController = controller
    this.turnUploadActivationFlight = flight
    void flight.finally(() => {
      if (this.turnUploadActivationFlight === flight) this.turnUploadActivationFlight = undefined
      if (this.turnUploadActivationController === controller) this.turnUploadActivationController = undefined
    })
  }

  private async activateTurnUploadIfAvailable(
    accountId: string,
    runtime: DshRemoteRuntimeProjection,
    accountKey: Buffer,
    signal: AbortSignal,
  ): Promise<void> {
    const capability = await this.turnObjectUploadCapability(signal)
    if (capability === undefined || !this.historyOwnerMatches(accountId, runtime) ||
      this.turnUpload !== undefined) return
    let outbox: DshRemoteTurnUploadOutbox | undefined
    try {
      outbox = this.options.turnUploadForAccount?.(
        accountId,
        accountKey,
        capability.maxObjectBytes,
        {
          onError: (error, sessionRef) => {
            if (!this.historyOwnerMatches(accountId, runtime)) return
            this.historySyncError = asDshRemoteError(error)
            this.historySyncErrorSessionRef = sessionRef
            this.bump()
          },
          onFinalized: sessionRef => {
            if (!this.historyOwnerMatches(accountId, runtime) || this.historySyncError === undefined ||
              this.historySyncErrorSessionRef !== sessionRef) return
            this.historySyncError = undefined
            this.historySyncErrorSessionRef = undefined
            this.bump()
          },
        },
      )
      await outbox?.activate(runtime)
      if (this.historyOwnerMatches(accountId, runtime)) {
        this.turnUpload = outbox
        if (outbox !== undefined && this.historySyncError !== undefined) {
          this.historySyncError = undefined
          this.historySyncErrorSessionRef = undefined
          this.bump()
        }
        if (capability.backfillMode === 'local_persistence_v1') {
          this.scheduleHistoryObjectBackfill(HISTORY_OBJECT_BACKFILL_INITIAL_DELAY_MILLIS)
        }
      }
      else await outbox?.close()
    } catch (error) {
      // Local Outbox initialization failure degrades only remote history
      // durability. Realtime and the local DSH session remain available.
      await outbox?.close().catch(() => undefined)
      if (this.historyOwnerMatches(accountId, runtime)) {
        this.historySyncError = asDshRemoteError(error)
        this.bump()
      }
    }
  }

  private async turnObjectUploadCapability(signal: AbortSignal): Promise<TurnObjectUploadCapability | undefined> {
    const capabilities = this.options.controlPlane.turnObjectUploadCapabilities
    if (capabilities === undefined) return undefined
    try {
      const value = await capabilities.call(this.options.controlPlane, signal)
      const maxObjectBytes = value.max_object_bytes
      return value.available === true
        && value.storage_version === 'oss_turn_v1'
        && value.coverage === 'live_completed_turns'
        && value.content_encoding === 'gzip'
        && typeof maxObjectBytes === 'number'
        && Number.isSafeInteger(maxObjectBytes)
        && maxObjectBytes > 0
        ? {
            maxObjectBytes,
            ...(value.backfill_mode === 'local_persistence_v1'
              ? { backfillMode: 'local_persistence_v1' as const }
              : {}),
          }
        : undefined
    } catch {
      // A temporarily unavailable Backend leaves history local until the next
      // capability probe. The short probe never gates realtime or user work.
      return undefined
    }
  }

  private scheduleHistoryObjectBackfill(delayMillis: number): void {
    if (!this.started || this.accountId === undefined || this.runtime === undefined ||
      this.turnUpload === undefined || this.options.sessionPersistence === undefined ||
      this.historyObjectBackfillTimer !== undefined || this.historyObjectBackfillFlight !== undefined) return
    const accountId = this.accountId
    const runtime = this.runtime
    this.historyObjectBackfillTimer = setTimeout(() => {
      this.historyObjectBackfillTimer = undefined
      if (!this.historyOwnerMatches(accountId, runtime) || this.turnUpload === undefined) return
      const controller = new AbortController()
      this.historyObjectBackfillController = controller
      const flight = this.backfillOneHistorySession(accountId, runtime, controller.signal)
      this.historyObjectBackfillFlight = flight
      let queued = false
      let retry = false
      void flight.then(
        value => { queued = value },
        error => {
          if (!controller.signal.aborted && this.historyOwnerMatches(accountId, runtime)) {
            this.historySyncError = asDshRemoteError(error)
            this.bump()
            retry = true
          }
        },
      ).finally(() => {
        if (this.historyObjectBackfillFlight === flight) this.historyObjectBackfillFlight = undefined
        if (this.historyObjectBackfillController === controller) this.historyObjectBackfillController = undefined
        if (this.historyOwnerMatches(accountId, runtime)) {
          if (queued) this.scheduleHistoryObjectBackfill(HISTORY_OBJECT_BACKFILL_NEXT_DELAY_MILLIS)
          else if (retry || controller.signal.aborted || this.historyObjectBackfillFailures.size > 0) {
            this.scheduleHistoryObjectBackfill(HISTORY_OBJECT_BACKFILL_RETRY_DELAY_MILLIS)
          }
        }
      })
    }, delayMillis)
    this.historyObjectBackfillTimer.unref()
  }

  private deferHistoryObjectBackfill(delayMillis = HISTORY_OBJECT_BACKFILL_RETRY_DELAY_MILLIS): void {
    if (this.historyObjectBackfillTimer !== undefined) clearTimeout(this.historyObjectBackfillTimer)
    this.historyObjectBackfillTimer = undefined
    this.historyObjectBackfillController?.abort()
    if (this.turnUpload !== undefined) {
      this.scheduleHistoryObjectBackfill(delayMillis)
    }
  }

  private async readHistorySource(
    persistence: DshRemoteSessionPersistenceLike,
    sessionRef: string,
    signal: AbortSignal,
  ): Promise<{ meta: DshRemotePersistenceHeader; events: DshRemoteHistoryEntry['event'][] }> {
    try {
      return await persistence.readFrom(sessionRef, 0, signal)
    } catch (error) {
      if (!isLegacyMessageShapeError(error) || persistence.loadStored === undefined) throw error
      const stored = await persistence.loadStored(sessionRef, signal)
      if (stored === undefined) throw error
      return stored
    }
  }

  private async backfillOneHistorySession(
    accountId: string,
    runtime: DshRemoteRuntimeProjection,
    signal: AbortSignal,
  ): Promise<boolean> {
    const persistence = this.options.sessionPersistence
    const outbox = this.turnUpload
    const known = this.options.controlPlane.knownHistorySessions
    if (persistence === undefined || outbox === undefined || known === undefined) return false
    const snapshots = await persistence.listSnapshots(signal)
    signal.throwIfAborted()
    this.requireActiveAccount(accountId, runtime.runtimeRef)

    const localRefs = snapshots
      .map(snapshot => snapshot.header.id)
      .filter(validHistorySessionRef)
    const ownedRefs = await this.options.sessionOwnership.listOwned(accountId, localRefs)
    signal.throwIfAborted()
    this.requireActiveAccount(accountId, runtime.runtimeRef)
    const candidates = localRefs.filter(ref => ownedRefs.has(ref))
    const knownRefs = new Set<string>()
    for (let offset = 0; offset < candidates.length; offset += HISTORY_OBJECT_KNOWN_BATCH_ITEMS) {
      const requested = candidates.slice(offset, offset + HISTORY_OBJECT_KNOWN_BATCH_ITEMS)
      const response = await known.call(this.options.controlPlane, { session_refs: requested }, signal)
      const refs = response.session_refs
      if (!Array.isArray(refs) || refs.some(ref => typeof ref !== 'string' || !requested.includes(ref))) {
        throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'Backend 历史 Session 归属响应无效', true)
      }
      for (const ref of refs) knownRefs.add(ref)
    }
    const validSnapshots = snapshots.filter(snapshot => {
      const ref = snapshot.header.id
      const revision = typeof snapshot.revision === 'string' ? snapshot.revision : ''
      return knownRefs.has(ref) && revision !== '' && revision.length <= 1024
        && outbox.needsHistoryRevision(ref, revision)
    })
    const currentRevisions = new Map(validSnapshots.map(snapshot => [
      snapshot.header.id,
      snapshot.revision as string,
    ]))
    for (const [sessionRef, failure] of this.historyObjectBackfillFailures) {
      if (currentRevisions.get(sessionRef) !== failure.revision) this.historyObjectBackfillFailures.delete(sessionRef)
    }
    const now = this.now()
    for (const target of validSnapshots) {
      const revision = target.revision as string
      const sessionRef = target.header.id
      const failure = this.historyObjectBackfillFailures.get(sessionRef)
      if (failure?.revision === revision && failure.nextAttemptAt > now) continue
      try {
        const source = await this.readHistorySource(persistence, sessionRef, signal)
        signal.throwIfAborted()
        this.requireActiveAccount(accountId, runtime.runtimeRef)
        if (source.meta.id !== sessionRef) {
          throw new DshRemoteError('REMOTE_INVALID_RESPONSE', '历史 Session 读取结果无效', true)
        }

        let turnStart = -1
        for (let index = 0; index < source.events.length; index += 1) {
          const event = source.events[index]!
          if (event.type === 'turn/start') turnStart = index
          if (event.type !== 'turn/end' || turnStart < 0) continue
          for (let offset = turnStart; offset <= index; offset += LIVE_EVENT_BATCH_MAX_ITEMS) {
            signal.throwIfAborted()
            const batch = source.events.slice(offset, Math.min(index + 1, offset + LIVE_EVENT_BATCH_MAX_ITEMS))
              .map(item => ({ event: item }))
            await outbox.capture(sessionRef, batch)
            await this.yieldHistoryReconciliation()
          }
          turnStart = -1
        }

        const current = (await persistence.listSnapshots(signal))
          .find(snapshot => snapshot.header.id === sessionRef)
        signal.throwIfAborted()
        this.requireActiveAccount(accountId, runtime.runtimeRef)
        this.historyObjectBackfillFailures.delete(sessionRef)
        if (current === undefined || current.revision !== revision) return true
        const throughSeq = source.events.reduce(
          (latest, event) => Math.max(latest, event.seq), -1,
        )
        outbox.queueHistoryFinalization(sessionRef, revision, throughSeq)
        return true
      } catch (error) {
        if (signal.aborted) throw error
        this.historyObjectBackfillFailures.set(sessionRef, {
          revision,
          nextAttemptAt: this.now() + HISTORY_OBJECT_BACKFILL_RETRY_DELAY_MILLIS,
        })
        this.historySyncError = asDshRemoteError(error)
        this.historySyncErrorSessionRef = sessionRef
        this.bump()
      }
    }
    return false
  }

  private async ensureAutomaticConnection(): Promise<void> {
    if (this.accountId === undefined || this.runtime === undefined) return
    if (this.connected) {
      this.scheduleProjectionSnapshot()
      return
    }
    if (this.options.transportAvailable === false || this.options.apiProxy.capabilities().length === 0) {
      this.connectionError = undefined
      this.bump()
      return
    }
    if (this.connectionError?.retryable === false) return
    if (this.reconnectTimer !== undefined) return
    if (this.connectionFlight !== undefined) return await this.connectionFlight
    this.startApiProxyEvents()
    const controller = new AbortController()
    this.attemptId = randomUUID()
    const startedAt = performance.now()
    this.diagnostic('connect_started', { attempt_id: this.attemptId, user_id: this.accountId, client_id: this.clientId, runtime_ref: this.runtime.runtimeRef })
    const timeoutError = new DshRemoteError('REMOTE_TRANSPORT_FAILED', '远控连接准备超时', true, { reason: 'connect_timeout' })
    const timer = setTimeout(() => { controller.abort(timeoutError) }, 30_000)
    timer.unref()
    let removeAbort = () => undefined as void
    const aborted = new Promise<never>((_, reject) => {
      const abort = () => { reject(controller.signal.reason) }
      controller.signal.addEventListener('abort', abort, { once: true })
      removeAbort = () => { controller.signal.removeEventListener('abort', abort) }
    })
    const flight = Promise.race([this.connectHost(controller.signal), aborted])
      .catch(error => {
        if (!controller.signal.aborted || controller.signal.reason === timeoutError) this.handleTransportDisconnect(error)
        throw error
      })
      .finally(() => {
        clearTimeout(timer)
        removeAbort()
        this.diagnostic('connect_finished', { attempt_id: this.attemptId, user_id: this.accountId, duration_ms: Math.round(performance.now() - startedAt) })
        if (this.connectionFlight === flight) this.connectionFlight = undefined
        if (this.connectionController === controller) this.connectionController = undefined
      })
    this.connectionController = controller
    this.connectionFlight = flight
    await flight
  }

  private scheduleSessionSync(): void {
    if (!this.started || !this.options.featureEnabled || this.sessionTimer !== undefined) return
    this.sessionTimer = setTimeout(() => {
      this.sessionTimer = undefined
      this.reportLiveDelivery()
      void this.syncSessionSafely().finally(() => { this.scheduleSessionSync() })
    }, 2_000)
    this.sessionTimer.unref()
  }

  private async deactivateAccount(): Promise<void> {
    this.accountGeneration += 1
    this.projectionController.abort()
    this.backgroundProjectionFlight = undefined
    this.projectionSyncTail = Promise.resolve()
    this.stopApiProxyEvents()
    this.connectionController?.abort()
    this.connectionController = undefined
    this.connectionFlight = undefined
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    if (this.stableConnectionTimer !== undefined) clearTimeout(this.stableConnectionTimer)
    this.stableConnectionTimer = undefined
    this.reconnectAttempt = 0
    this.turnUploadActivationController?.abort()
    await this.turnUploadActivationFlight?.catch(() => undefined)
    this.turnUploadActivationFlight = undefined
    this.turnUploadActivationController = undefined
    if (this.historyObjectBackfillTimer !== undefined) clearTimeout(this.historyObjectBackfillTimer)
    this.historyObjectBackfillTimer = undefined
    this.historyObjectBackfillController?.abort()
    this.historyObjectBackfillController = undefined
    await this.historyObjectBackfillFlight?.catch(() => undefined)
    this.historyObjectBackfillFlight = undefined
    this.historyObjectBackfillFailures.clear()
    if (this.historyObjectBackfillTimer !== undefined) clearTimeout(this.historyObjectBackfillTimer)
    this.historyObjectBackfillTimer = undefined
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
    await this.turnUpload?.close()
    this.turnUpload = undefined
    this.nextTurnUploadActivationAt = 0
    this.runtime = undefined
    this.accountId = undefined
    if (this.desktopSelectionTimer !== undefined) clearTimeout(this.desktopSelectionTimer)
    this.desktopSelectionTimer = undefined
    this.desktopSelectionDirty = false
    this.desktopSelectionFlight = undefined
    this.publishedDesktopSelection = undefined
    this.desktopSessions.clear()
    this.clientId = 0
    this.connectionError = undefined
    this.historySyncError = undefined
    this.historySyncErrorSessionRef = undefined
    this.projectionError = undefined
    this.lastProjectionSyncAttemptMillis = 0
    this.projectionVersion = 0
    this.clearPendingSessionEventBatches()
  }

  private startApiProxyEvents(): void {
    if (this.stopProjectionEvents === undefined) {
      this.stopProjectionEvents = this.options.apiProxy.subscribeProjectionEvents(event => {
        void this.publishProjectionEvent(event).catch(error => {
          this.projectionError = asDshRemoteError(error)
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
      this.deferHistoryObjectBackfill(
        event.entry.event.type === 'turn/end'
          ? HISTORY_OBJECT_BACKFILL_NEXT_DELAY_MILLIS
          : HISTORY_OBJECT_BACKFILL_RETRY_DELAY_MILLIS,
      )
      this.enqueueSessionEventBatch(accountId, runtime, event.sessionId, event.entry, issuedAt)
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

  private enqueueSessionEventBatch(
    accountId: string, runtime: DshRemoteRuntimeProjection, sessionRef: string,
    entry: DshRemoteHistoryEntry, issuedAt: number,
  ): void {
    const generation = this.accountGeneration
    const key = `${accountId}/${runtime.runtimeRef}/${runtime.hostGeneration}/${generation}`
    if (this.liveEventBatcher?.key !== key) {
      this.clearPendingSessionEventBatches()
      const current = () => this.liveEventBatcher?.key === key && this.historyOwnerMatches(accountId, runtime)
      this.liveEventBatcher = { key, value: new DshLiveEventBatcher({
        publish: async batch => {
          if (current()) await this.publishSessionEventBatch({ ...batch, accountId, runtime, generation, scopeKey: key })
        },
        replay: async (ref, afterSeq, throughSeq) => {
          if (!current()) throw new DshRemoteError('HOST_GENERATION_STALE', 'Live delivery scope changed')
          // Overflow belongs to the same live producer and uses the same adoption policy.
          const owned = await this.options.sessionOwnership.claimUnownedAndListOwned({
            accountId, sessionRefs: [ref], origin: 'observed-while-active',
            nowMillis: this.now(), canClaim: current,
          })
          if (!current()) throw new DshRemoteError('HOST_GENERATION_STALE', 'Live delivery scope changed')
          if (!owned.has(ref)) return { entries: [], throughSeq }
          let upper = throughSeq
          while (true) {
            const page = await this.options.apiProxy.history({ sessionId: ref, beforeSeq: upper + 1, limit: LIVE_BATCH_ITEMS })
            if (!current()) throw new DshRemoteError('HOST_GENERATION_STALE', 'Live delivery scope changed')
            if (page.hasMore && page.nextCursor !== undefined && page.nextCursor > afterSeq + 1) {
              if (upper <= afterSeq + 1) throw new DshRemoteError('CAPABILITY_UNSUPPORTED', 'Canonical event exceeds history replay limit')
              upper = afterSeq + Math.max(1, Math.floor((upper - afterSeq) / 2))
              continue
            }
            const knownThrough = page.projectionAsOfSeq ?? page.entries.at(-1)?.event.seq ?? -1
            if (knownThrough < upper) {
              const head = await this.options.apiProxy.history({ sessionId: ref, limit: 1 })
              if (!current()) throw new DshRemoteError('HOST_GENERATION_STALE', 'Live delivery scope changed')
              if ((head.projectionAsOfSeq ?? head.entries.at(-1)?.event.seq ?? -1) < upper) {
                throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'Canonical history has not reached the pending live range', true)
              }
            }
            return { entries: page.entries.filter(item => item.event.seq > afterSeq && item.event.seq <= upper), throughSeq: upper }
          }
        },
        onError: error => {
          if (!current()) return
          this.projectionError = asDshRemoteError(error)
          this.bump()
        },
      }) }
    }
    this.liveEventBatcher.value.enqueue(sessionRef, entry, issuedAt)
  }

  private async publishSessionEventBatch(batch: ScopedLiveEventBatch): Promise<void> {
    const { accountId, runtime, sessionRef } = batch
    if (this.liveEventBatcher?.key !== batch.scopeKey || !this.historyOwnerMatches(accountId, runtime) || batch.entries.length === 0) return
    const prepareStarted = performance.now()
    const owned = await this.options.sessionOwnership.claimUnownedAndListOwned({
      accountId,
      sessionRefs: [sessionRef],
      origin: 'observed-while-active',
      nowMillis: batch.issuedAt,
      canClaim: () => this.historyOwnerMatches(accountId, runtime),
    })
    if (!owned.has(sessionRef) || this.liveEventBatcher?.key !== batch.scopeKey || !this.historyOwnerMatches(accountId, runtime)) return

    const entries = [...batch.entries].sort((left, right) => left.event.seq - right.event.seq)
    const firstSeq = entries[0]!.event.seq
    const lastSeq = entries.at(-1)!.event.seq
    const ownershipMs = performance.now() - prepareStarted
    const captureStarted = performance.now()
    if (this.turnUpload !== undefined) {
      try { await this.turnUpload.capture(sessionRef, entries) }
      catch (error) {
        if (!this.historyOwnerMatches(accountId, runtime)) return
        this.historySyncError = asDshRemoteError(error)
        this.historySyncErrorSessionRef = sessionRef
        this.bump()
      }
    }

    const captureMs = performance.now() - captureStarted
    if (batch.generation !== this.accountGeneration || this.liveEventBatcher?.key !== batch.scopeKey) return
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
    let completed = false
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
      }, requestRef, timing => {
        completed = timing.completed
        if (batch.generation !== this.accountGeneration || this.liveEventBatcher?.key !== batch.scopeKey) return
        const stats = this.liveDeliveryStats
        const values = { queue_ms: batch.queueWaitMs, ownership_ms: ownershipMs, capture_ms: captureMs,
          channel_queue_ms: timing.queueMs, publish_ack_ms: timing.publishMs }
        stats.batch_count = (stats.batch_count ?? 0) + 1
        stats.event_count = (stats.event_count ?? 0) + entries.length
        stats.incomplete_batches = (stats.incomplete_batches ?? 0) + Number(!timing.completed)
        stats.replayed_batches = (stats.replayed_batches ?? 0) + Number(batch.replayed)
        stats.payload_bytes = (stats.payload_bytes ?? 0) + batch.bytes
        for (const [name, value] of Object.entries(values)) {
          stats[`${name}_sum`] = (stats[`${name}_sum`] ?? 0) + Math.round(value)
          stats[`${name}_max`] = Math.max(stats[`${name}_max`] ?? 0, Math.round(value))
        }
        const pending = this.liveEventBatcher?.value.stats()
        stats.pending_bytes_max = Math.max(stats.pending_bytes_max ?? 0, pending?.bufferedBytes ?? 0)
        stats.pending_entries_max = Math.max(stats.pending_entries_max ?? 0, pending?.bufferedEntries ?? 0)
        this.reportLiveDelivery()
      })
      if (!completed || batch.generation !== this.accountGeneration) return
      remoteDiagnostic('remote_session_event_batch_publish_acked', {
        sessionRef: diagnosticRef(sessionRef), firstSeq, lastSeq,
        itemCount: entries.length, requestRef: diagnosticRef(requestRef),
      })
      if (this.projectionError !== undefined) {
        this.projectionError = undefined
        this.bump()
      }
    } catch (error) {
      const remote = asDshRemoteError(error)
      remoteDiagnostic('remote_session_event_batch_publish_failed', {
        sessionRef: diagnosticRef(sessionRef), firstSeq, lastSeq,
        itemCount: entries.length, requestRef: diagnosticRef(requestRef),
        code: remote.code, message: remote.message,
      })
      // ChannelManager owns bounded wire retries. Re-enqueueing an already captured
      // batch would replay turn/start into the outbox and could seal a newer Turn.
      this.projectionError = remote
      this.bump()
    }
  }

  private clearPendingSessionEventBatches(): void {
    this.liveEventBatcher?.value.close()
    this.liveEventBatcher = undefined
    this.liveDeliveryStats = {}
    this.lastDeliveryReportAt = performance.now()
  }

  private async flushPendingSessionEventBatches(): Promise<void> {
    await this.liveEventBatcher?.value.flush()
  }

  private reportLiveDelivery(): void {
    const stats = this.liveDeliveryStats
    if (!stats.batch_count || performance.now() - this.lastDeliveryReportAt < 10_000) return
    this.lastDeliveryReportAt = performance.now()
    this.diagnostic('live_delivery_window', { user_id: this.accountId, runtime_ref: this.runtime?.runtimeRef, ...stats })
    this.liveDeliveryStats = {}
  }

  private historyOwnerMatches(accountId: string, runtime: DshRemoteRuntimeProjection): boolean {
    return this.started && this.accountId === accountId
      && this.runtime?.runtimeRef === runtime.runtimeRef
      && this.runtime.hostGeneration === runtime.hostGeneration
  }

  private async yieldHistoryReconciliation(): Promise<void> {
    await (this.options.yieldToEventLoop?.() ?? scheduler.yield())
  }

  private handleTransportDisconnect(error: unknown): void {
    if (!this.started || this.runtime === undefined) return
    const remote = asDshRemoteError(error)
    if (!this.connected && this.attemptId !== undefined && this.failedAttemptId === this.attemptId) return
    this.failedAttemptId = this.attemptId
    this.diagnostic('connection_failed', { attempt_id: this.attemptId, user_id: this.accountId, client_id: this.clientId, runtime_ref: this.runtime.runtimeRef, error_code: remote.code, retryable: remote.retryable, reason: remote.details.reason })
    this.connectionError = remote
    this.connected = false
    this.serviceLeaseGeneration = 0
    if (this.stableConnectionTimer !== undefined) clearTimeout(this.stableConnectionTimer)
    this.stableConnectionTimer = undefined
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
    if (this.reconnectTimer !== undefined || this.options.transportAvailable === false || !remote.retryable) return
    const ceiling = Math.min(
      RECONNECT_MAX_DELAY_MILLIS,
      RECONNECT_BASE_DELAY_MILLIS * (2 ** Math.min(this.reconnectAttempt, 5)),
    )
    const delayMillis = Math.max(
      RECONNECT_BASE_DELAY_MILLIS,
      Math.floor((ceiling / 2) + (Math.random() * ceiling / 2)),
    )
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 6)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (!this.started || this.runtime === undefined) return
      void this.ensureAutomaticConnection().catch(() => undefined)
    }, delayMillis)
    this.reconnectTimer.unref()
  }

  private async connectHost(signal: AbortSignal): Promise<void> {
    const localRuntime = this.runtime!
    const accountId = this.accountId!
    const platform = this.options.platform ?? process.platform
    const displayName = (await this.options.runtimeStore.account(accountId)).displayName
      ?? this.options.displayName ?? hostname()
    signal.throwIfAborted()
    const desktop = await this.options.controlPlane.registerDesktop({ display_name: displayName, platform }, AbortSignal.any([signal, AbortSignal.timeout(10_000)]))
    signal.throwIfAborted()
    const desktopRef = typeof desktop.desktop_ref === 'string' ? desktop.desktop_ref
      : typeof desktop.desktopRef === 'string' ? desktop.desktopRef : ''
    if (desktopRef === '') throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'Backend 未返回桌面设备引用', true)
    await this.options.runtimeStore.bindDesktop(accountId, { desktopRef })
    signal.throwIfAborted()
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
    }, AbortSignal.any([signal, AbortSignal.timeout(10_000)]))
    signal.throwIfAborted()
    const backendRuntimeRef = typeof registeredRuntime.runtime_ref === 'string' ? registeredRuntime.runtime_ref : ''
    const backendHostGeneration = typeof registeredRuntime.host_generation === 'number'
      && Number.isSafeInteger(registeredRuntime.host_generation) && registeredRuntime.host_generation > 0
      ? registeredRuntime.host_generation : 0
    if (backendRuntimeRef === '' || backendHostGeneration < localRuntime.hostGeneration) {
      throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'Backend 未返回匹配的 Runtime 引用与 Host generation', true)
    }
    const adopted = await this.options.runtimeStore.adoptRuntimeRef(
      accountId, this.options.profileRef, backendRuntimeRef, backendHostGeneration,
    )
    signal.throwIfAborted()
    if (this.accountId !== accountId) throw new DshRemoteError('REMOTE_LOGIN_REQUIRED', '账号已切换')
    this.runtime = { ...adopted, desktopRef }
    signal.throwIfAborted()
    await this.options.realtime.connect({
      profileRef: this.options.profileRef,
      clientRef: this.options.hostClientRef,
      signal,
    })
    const manager = new DshRemoteHostChannelManager({
      accountId,
      profileRef: this.options.profileRef,
      hostClientRef: this.options.hostClientRef,
      runtimeRef: backendRuntimeRef,
      signal,
      realtime: this.options.realtime,
      secretBroker: this.options.secretBroker,
      dispatch: async (request, context) => await this.dispatchAuthorizedRequest(request, context),
      onProjectionError: error => {
        this.projectionError = asDshRemoteError(error)
        this.bump()
      },
      onFatal: error => { this.handleTransportDisconnect(error) },
    })
    try {
      await manager.prepare()
      signal.throwIfAborted()
      const registered = await this.options.realtime.registerHost({
        runtimeRef: backendRuntimeRef,
        capabilities: this.runtime.capabilities,
        signal,
      })
      manager.activate(registered.serviceLeaseGeneration)
      signal.throwIfAborted()
      this.channelManager = manager
      this.serviceLeaseGeneration = registered.serviceLeaseGeneration
      this.connected = true
      this.publishedDesktopSelection = undefined
      this.scheduleDesktopSelection()
      this.failedAttemptId = undefined
      this.connectionError = undefined
      this.diagnostic('host_registered', { attempt_id: this.attemptId, user_id: accountId, client_id: this.clientId, runtime_ref: backendRuntimeRef, host_generation: this.runtime.hostGeneration, lease_generation: this.serviceLeaseGeneration })
      this.scheduleProjectionSnapshot(true)
      if (this.reconnectAttempt > 0) {
        const stableManager = manager
        this.stableConnectionTimer = setTimeout(() => {
          if (this.connected && this.channelManager === stableManager) this.reconnectAttempt = 0
        }, RECONNECT_STABLE_MILLIS)
        this.stableConnectionTimer.unref()
      }
      this.bump()
    } catch (error) {
      if (!signal.aborted) await this.options.realtime.disconnect()
      await manager.close()
      throw error
    }
  }

  private scheduleProjectionSnapshot(force = false): void {
    if (this.backgroundProjectionFlight !== undefined) return
    const flight = this.syncProjectionSnapshotSafely(force).finally(() => {
      if (this.backgroundProjectionFlight === flight) this.backgroundProjectionFlight = undefined
    })
    this.backgroundProjectionFlight = flight
  }

  private async syncProjectionSnapshotSafely(force = false): Promise<void> {
    const generation = this.accountGeneration
    const now = this.now()
    if (!force && now - this.lastProjectionSyncAttemptMillis < PROJECTION_SYNC_INTERVAL_MILLIS) return
    this.lastProjectionSyncAttemptMillis = now
    try {
      await this.syncProjectionSnapshot(force)
      if (generation !== this.accountGeneration) return
      if (this.projectionError !== undefined) {
        this.projectionError = undefined
        this.bump()
      }
    } catch (error) {
      if (generation !== this.accountGeneration) return
      this.projectionError = asDshRemoteError(error)
      this.bump()
    }
  }

  private nextProjectionVersion(): number {
    this.projectionVersion = Math.max(this.projectionVersion + 1, Math.trunc(this.now()))
    return this.projectionVersion
  }

  private async syncProjectionSnapshot(force = false): Promise<void> {
    const generation = this.accountGeneration
    const run = async (): Promise<void> => {
      if (generation === this.accountGeneration) await this.performProjectionSnapshot(force, generation)
    }
    const next = this.projectionSyncTail.then(run, run)
    this.projectionSyncTail = next.then(() => undefined, () => undefined)
    await next
  }

  private async performProjectionSnapshot(force = false, generation = this.accountGeneration): Promise<void> {
    const runtime = this.runtime
    const accountId = this.accountId
    if (runtime === undefined || accountId === undefined) return
    const signal = AbortSignal.any([this.projectionController.signal, AbortSignal.timeout(30_000)])
    const check = () => {
      signal.throwIfAborted()
      if (generation !== this.accountGeneration) throw new DshRemoteError('REMOTE_LOGIN_REQUIRED', '账号作用域已切换')
      this.requireActiveAccount(accountId, runtime.runtimeRef)
    }
    check()
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
    check()
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
      check()
      await this.options.controlPlane.syncWorkspaces({
        runtime_ref: runtime.runtimeRef,
        host_generation: runtime.hostGeneration,
        snapshot_ref: snapshotRef,
        items: workspaceItems.slice(offset, offset + 100),
      }, signal)
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
      check()
      await this.options.controlPlane.syncSessions({
        runtime_ref: runtime.runtimeRef,
        host_generation: runtime.hostGeneration,
        snapshot_ref: snapshotRef,
        items: sessionItems.slice(offset, offset + 100),
      }, signal)
      if (sessionItems.length === 0) break
    }
    check()
    await this.options.controlPlane.completeProjectionSnapshot({
      runtime_ref: runtime.runtimeRef,
      host_generation: runtime.hostGeneration,
      snapshot_ref: snapshotRef,
      workspace_count: workspaces.length,
      session_count: sessions.length,
    }, signal)
    check()
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
      case 'session.current': {
        const selection = this.desktopSessions.snapshot(performance.now())
        return { duplicate: false, value: { ...await this.currentSession(), selectionRevision: selection.revision } }
      }
      case 'capabilities.get': return { duplicate: false, value: { capabilities: this.capabilities() } }
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
        const history = await this.options.apiProxy.history({
          sessionId,
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
          ...(limit === undefined ? {} : { limit }),
        })
        return { duplicate: false, value: request.body.omit_superseded_chunks === true
          ? { ...history, entries: dshTranscriptHistoryEntries(history.entries) }
          : history }
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

  private diagnostic(event: string, fields: Record<string, unknown>): void {
    try { this.options.onDiagnostic?.(event, fields) } catch { /* Observability must not affect transport state. */ }
  }

}
