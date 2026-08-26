import type {
  ArkmeOutgoingCallFailureCode,
  ArkmeOutgoingCallIntentClaim,
  ArkmeOutgoingCallMediaType,
  ArkmeOutgoingCallPrepareResult,
} from '../outgoing-call-contract.js'
import type { ArkmePluginOperation } from '../types.js'
import { callArkme } from './api.js'
import {
  parseDesktopCallBridgeEvent,
  requestDesktopCallMediaPermissions,
  sendDesktopCallCommand,
  type DesktopCallBridgeEvent,
  type DesktopCallMediaPermissionResult,
} from './outgoing-call-bridge.js'
import { outgoingCallUi, type OutgoingCallUiController, type OutgoingCallUiRequest } from './outgoing-call-ui-controller.js'

export type OutgoingCallPhase = 'idle' | 'preparing' | 'bootstrapping' | 'calling' | 'active' | 'ending' | 'error'

export interface OutgoingCallRuntimeSnapshot {
  visible: boolean
  retainFrame: boolean
  phase: OutgoingCallPhase
  assetBasePath: string
  callRequestId: string
  displayName: string
  mediaType: ArkmeOutgoingCallMediaType
  statusText: string
  error: string
  compact: boolean
  fullscreen: boolean
}

type ApiCall = (operation: ArkmePluginOperation | 'calls.outgoing.diag', params?: Record<string, unknown>) => Promise<unknown>
type BrowserPreparedCall = Omit<ArkmeOutgoingCallPrepareResult['call'], 'calleeAvatar'> & { calleeAvatar: string }
type BrowserPrepared = Omit<ArkmeOutgoingCallPrepareResult, 'call'> & { call: BrowserPreparedCall }

export interface OutgoingCallRuntimeOptions {
  api?: ApiCall
  controller?: OutgoingCallUiController
  randomId?: () => string
  origin?: () => string
  loadAvatar?: (imageRef: string) => Promise<string>
  permissions?: typeof requestDesktopCallMediaPermissions
  setInterval?: typeof globalThis.setInterval
  clearInterval?: typeof globalThis.clearInterval
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
}

const TERMINAL_TYPES = new Set(['end', 'user_reject', 'user_no_response', 'user_line_busy', 'not_connected'])
const FAILURE_CODES = new Set<ArkmeOutgoingCallFailureCode>([
  'call-ui-unavailable', 'call-active', 'call-source-invalid', 'call-peer-unavailable',
  'call-permission-denied', 'call-bootstrap-failed', 'call-engine-failed', 'call-cancelled',
])

const INITIAL_SNAPSHOT: OutgoingCallRuntimeSnapshot = {
  visible: false,
  retainFrame: false,
  phase: 'idle',
  assetBasePath: '/arkme-self/api/call',
  callRequestId: '',
  displayName: '',
  mediaType: 'audio',
  statusText: '',
  error: '',
  compact: false,
  fullscreen: false,
}

const TERMINATE_GRACE_MS = 1_800
const CALL_START_FALLBACK_MS = 35_000
const DIAG_PREFIX = 'ArkmeCallDiag'
const HOST_DIAG_LABEL_PATTERNS = [
  'api_', 'bridge_', 'iframe_engine_', 'iframe_handle_message', 'iframe_post_to_flutter', 'iframe_local_terminal',
  'iframe_start_outgoing_call', 'iframe_finalize', 'iframe_reset_runtime_state', 'iframe_destroy_engine',
  'cancel_', 'call_start_', 'state_terminal_', 'finish', 'hide_terminal_overlay', 'schedule_finish', 'release_lease', 'heartbeat_', 'media_permission',
  'flush_', 'start_', 'resolve_intent', 'tool_intent', 'frame_attached',
]

function failureFrom(error: unknown): { code: ArkmeOutgoingCallFailureCode; message: string } {
  const body = error !== null && typeof error === 'object' && 'body' in error
    ? (error as { body?: unknown }).body : undefined
  const record = body !== null && typeof body === 'object' ? body as Record<string, unknown> : {}
  const code = typeof record.code === 'string' && FAILURE_CODES.has(record.code as ArkmeOutgoingCallFailureCode)
    ? record.code as ArkmeOutgoingCallFailureCode : 'call-bootstrap-failed'
  const raw = typeof record.message === 'string'
    ? record.message
    : error instanceof Error ? error.message : '呼叫初始化失败，请重试'
  return { code, message: raw.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300) || '呼叫初始化失败，请重试' }
}

export class OutgoingCallRuntime {
  private readonly api: ApiCall
  private readonly controller: OutgoingCallUiController
  private readonly randomId: () => string
  private readonly origin: () => string
  private readonly loadAvatar: ((imageRef: string) => Promise<string>) | undefined
  private readonly permissions: typeof requestDesktopCallMediaPermissions
  private readonly startInterval: typeof globalThis.setInterval
  private readonly stopInterval: typeof globalThis.clearInterval
  private readonly startTimeout: typeof globalThis.setTimeout
  private readonly stopTimeout: typeof globalThis.clearTimeout
  private listeners = new Set<() => void>()
  private snapshot: OutgoingCallRuntimeSnapshot = INITIAL_SNAPSHOT
  private frame: HTMLIFrameElement | null = null
  private prepared: BrowserPrepared | undefined
  private intent: ArkmeOutgoingCallIntentClaim | undefined
  private leaseCallRequestId = ''
  private bootstrapSent = false
  private callSent = false
  private generation = 0
  private pollTimer: ReturnType<typeof globalThis.setInterval> | undefined
  private heartbeatTimer: ReturnType<typeof globalThis.setInterval> | undefined
  private callStartFallbackTimer: ReturnType<typeof globalThis.setTimeout> | undefined
  private unsubscribeController: (() => void) | undefined
  private claiming = false

  constructor(options: OutgoingCallRuntimeOptions = {}) {
    this.api = options.api ?? (callArkme as ApiCall)
    this.controller = options.controller ?? outgoingCallUi
    this.randomId = options.randomId ?? (() => crypto.randomUUID())
    this.origin = options.origin ?? (() => window.location.origin)
    this.loadAvatar = options.loadAvatar
    this.permissions = options.permissions ?? requestDesktopCallMediaPermissions
    this.startInterval = options.setInterval ?? globalThis.setInterval.bind(globalThis)
    this.stopInterval = options.clearInterval ?? globalThis.clearInterval.bind(globalThis)
    this.startTimeout = options.setTimeout ?? globalThis.setTimeout.bind(globalThis)
    this.stopTimeout = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis)
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): OutgoingCallRuntimeSnapshot => this.snapshot

  configure(assetBasePath: string): void {
    if (!/^\/[A-Za-z0-9/_-]+$/.test(assetBasePath) || assetBasePath.endsWith('/')) return
    this.diag('configure_asset_base_path', { assetBasePath })
    this.update({ assetBasePath })
  }

  mount(): void {
    if (this.unsubscribeController !== undefined) return
    this.diag('mount', {})
    const consume = () => {
      const request = this.controller.consume()
      if (request !== undefined) {
        this.diag('controller_request_consumed', request)
        void this.start(request)
      }
    }
    this.unsubscribeController = this.controller.subscribe(consume)
    consume()
    this.pollTimer = this.startInterval(() => { void this.pollToolIntent().catch(() => undefined) }, 750)
    void this.pollToolIntent().catch(() => undefined)
  }

  attachFrame(frame: HTMLIFrameElement | null): void {
    this.frame = frame
    this.diag('frame_attached', { hasFrame: frame !== null })
    this.flushBootstrap()
  }

  handleWindowMessage(event: MessageEvent): void {
    const source = this.frame?.contentWindow
    if (source === null || source === undefined || this.snapshot.callRequestId === '') return
    const message = parseDesktopCallBridgeEvent(event, {
      expectedSource: source,
      expectedOrigin: this.origin(),
      callRequestId: this.snapshot.callRequestId,
    })
    if (message === undefined) {
      if (event.source === source) this.diag('bridge_message_ignored', {
        origin: event.origin,
        dataType: typeof event.data,
        callRequestId: this.snapshot.callRequestId,
      })
      return
    }
    this.diag('bridge_message_received', message)
    this.handleBridgeMessage(message)
  }

  handleBridgeMessage(message: DesktopCallBridgeEvent): void {
    if (message.type === 'diag') {
      this.diag(`iframe_${message.label ?? 'diag'}`, {
        detail: message.detail,
        phase: message.phase,
        reason: message.reason,
      })
      return
    }
    if (this.snapshot.phase === 'idle') return
    if (message.type === 'ready') {
      if (!this.bootstrapSent) this.flushBootstrap()
      else this.flushCall()
      return
    }
    if (message.type === 'media_permission_request') {
      if (message.requestId === undefined) return
      void this.resolvePermissions({
        requestId: message.requestId,
        camera: message.camera === true,
        microphone: message.microphone === true,
      })
      return
    }
    if (message.type === 'calling') {
      this.clearCallStartFallback()
      this.update({ phase: 'calling', statusText: `正在呼叫 ${this.snapshot.displayName}…` })
      void this.resolveIntentCalling()
      return
    }
    if (message.type === 'begin') {
      this.clearCallStartFallback()
      this.update({ phase: 'active', statusText: '通话中' })
      return
    }
    if (
      message.type === 'state' && this.callSent && message.hasActiveCall === false &&
      (message.phase === 'idle' || message.phase === 'ending')
    ) {
      this.diag('state_terminal_detected', {
        phase: message.phase,
        statusText: message.statusText,
        message: message.message,
      })
      this.finishTerminal(message.message ?? (message.phase === 'ending' ? message.statusText : undefined) ?? '通话已结束')
      return
    }
    if (message.type === 'state' && message.statusText !== undefined) {
      this.update({ statusText: message.statusText })
      return
    }
    if (message.type === 'toggle_fullscreen_request') {
      this.update({ fullscreen: !this.snapshot.fullscreen, compact: false })
      return
    }
    if (message.type === 'toggle_compact_mode_request') {
      this.update({ compact: !this.snapshot.compact, fullscreen: false })
      return
    }
    if (message.type === 'hide_window_request') {
      this.cancel()
      return
    }
    if (message.type === 'permission_denied') {
      void this.finish('call-permission-denied', message.message ?? '请允许麦克风权限后重试')
      return
    }
    if (message.type === 'fatal_error') {
      void this.finish('call-engine-failed', message.message ?? '呼叫引擎启动失败')
      return
    }
    if (TERMINAL_TYPES.has(message.type)) this.finishTerminal(message.message ?? '')
  }

  async pollToolIntent(): Promise<void> {
    if (this.snapshot.phase !== 'idle' || this.claiming) return
    this.claiming = true
    try {
      const claim = await this.callApi('calls.outgoing.intent.claim') as ArkmeOutgoingCallIntentClaim | null
      if (claim === null || claim === undefined) return
      this.diag('tool_intent_claimed', {
        intentId: claim.intentId,
        callRequestId: claim.callRequestId,
        mediaType: claim.mediaType,
        displayName: claim.displayName,
      })
      if (this.snapshot.phase !== 'idle') {
        await this.callApi('calls.outgoing.intent.resolve', {
          intentId: claim.intentId, claimToken: claim.claimToken, status: 'failed',
          code: 'call-active', message: '已有通话正在进行',
        })
        return
      }
      await this.start({ sourceRef: claim.sourceRef, displayName: claim.displayName, mediaType: claim.mediaType }, claim)
    } finally { this.claiming = false }
  }

  cancel(): void {
    if (this.snapshot.phase === 'idle') return
    const frame = this.frame
    const shouldTerminateFrame = frame !== null && (
      this.snapshot.phase === 'bootstrapping' || this.snapshot.phase === 'calling' || this.snapshot.phase === 'active' ||
      this.bootstrapSent || this.callSent
    )
    this.diag('cancel_requested', {
      shouldTerminateFrame,
      hasFrame: frame !== null,
      bootstrapSent: this.bootstrapSent,
      callSent: this.callSent,
    })
    if (shouldTerminateFrame) {
      sendDesktopCallCommand(frame, 'terminate')
      this.hideTerminalOverlay('通话已结束', true)
      this.scheduleFinish('call-cancelled', '通话已结束', TERMINATE_GRACE_MS)
      return
    }
    this.hideTerminalOverlay('已取消呼叫', false)
    void this.finish('call-cancelled', '已取消呼叫')
  }

  dispose(): void {
    this.generation += 1
    this.unsubscribeController?.()
    this.unsubscribeController = undefined
    if (this.pollTimer !== undefined) this.stopInterval(this.pollTimer)
    if (this.heartbeatTimer !== undefined) this.stopInterval(this.heartbeatTimer)
    this.clearCallStartFallback()
    this.pollTimer = undefined
    this.heartbeatTimer = undefined
    this.claiming = false
    if (this.frame !== null) sendDesktopCallCommand(this.frame, 'logout')
    const lease = this.leaseCallRequestId
    this.leaseCallRequestId = ''
    if (lease !== '') void this.callApi('calls.outgoing.release', { callRequestId: lease })
    const intent = this.intent
    this.intent = undefined
    if (intent !== undefined) void this.callApi('calls.outgoing.intent.resolve', {
      intentId: intent.intentId, claimToken: intent.claimToken, status: 'failed',
      code: 'call-ui-unavailable', message: '呼叫界面已关闭',
    })
    this.prepared = undefined
    this.frame = null
    this.snapshot = { ...INITIAL_SNAPSHOT, assetBasePath: this.snapshot.assetBasePath }
    this.listeners.forEach(listener => { listener() })
  }

  private async start(request: OutgoingCallUiRequest, intent?: ArkmeOutgoingCallIntentClaim): Promise<void> {
    this.diag('start_enter', {
      sourceRef: request.sourceRef,
      displayName: request.displayName,
      mediaType: request.mediaType,
      hasIntent: intent !== undefined,
      intentId: intent?.intentId,
      callRequestId: intent?.callRequestId,
    })
    if (this.snapshot.phase !== 'idle') {
      if (intent !== undefined) await this.callApi('calls.outgoing.intent.resolve', {
        intentId: intent.intentId, claimToken: intent.claimToken, status: 'failed',
        code: 'call-active', message: '已有通话正在进行',
      })
      return
    }
    const callRequestId = intent?.callRequestId ?? this.randomId()
    const generation = ++this.generation
    this.intent = intent
    this.bootstrapSent = false
    this.callSent = false
    this.update({
      visible: true, retainFrame: false, phase: 'preparing', callRequestId, displayName: request.displayName,
      mediaType: request.mediaType, statusText: '正在准备呼叫…', error: '', compact: false, fullscreen: false,
    })
    try {
      const result = await this.callApi('calls.outgoing.prepare', {
        sourceRef: request.sourceRef, mediaType: request.mediaType, callRequestId,
      }) as ArkmeOutgoingCallPrepareResult
      const prepared: BrowserPrepared = { ...result, call: { ...result.call } }
      if (generation !== this.generation) {
        this.diag('start_prepare_stale_generation_release', { callRequestId, generation, currentGeneration: this.generation })
        await this.callApi('calls.outgoing.release', { callRequestId })
        return
      }
      if (prepared.peerAvatarRef !== undefined && this.loadAvatar !== undefined) {
        try { prepared.call.calleeAvatar = await this.loadAvatar(prepared.peerAvatarRef) } catch { /* avatar is optional */ }
      }
      this.prepared = prepared
      this.leaseCallRequestId = callRequestId
      this.diag('start_prepared', {
        callRequestId,
        roomId: prepared.call.roomId,
        mediaType: prepared.call.mediaType,
        calleeCount: prepared.call.calleeAccounts.length,
        hasPeerAvatarRef: prepared.peerAvatarRef !== undefined,
      })
      this.update({ phase: 'bootstrapping', displayName: prepared.displayName, statusText: '正在初始化通话…' })
      this.startHeartbeat()
      this.flushBootstrap()
    } catch (error) {
      if (generation !== this.generation) return
      const failure = failureFrom(error)
      await this.fail(failure.code, failure.message)
    }
  }

  private flushBootstrap(): void {
    if (this.bootstrapSent || this.prepared === undefined || this.frame === null) return
    const sent = sendDesktopCallCommand(this.frame, 'bootstrap', this.prepared.bootstrap)
    this.diag('flush_bootstrap', { sent, callRequestId: this.snapshot.callRequestId })
    if (!sent) return
    this.bootstrapSent = true
    this.prepared.bootstrap.userSig = ''
  }

  private flushCall(): void {
    if (!this.bootstrapSent || this.callSent || this.prepared === undefined || this.frame === null) return
    const sent = sendDesktopCallCommand(this.frame, 'call', this.prepared.call)
    this.diag('flush_call', {
      sent,
      callRequestId: this.snapshot.callRequestId,
      roomId: this.prepared.call.roomId,
      mediaType: this.prepared.call.mediaType,
    })
    if (!sent) return
    this.callSent = true
    this.prepared = undefined
    this.scheduleCallStartFallback()
    this.update({ statusText: `正在呼叫 ${this.snapshot.displayName}…` })
  }

  private async resolvePermissions(request: { requestId: string; camera: boolean; microphone: boolean }): Promise<void> {
    let result: DesktopCallMediaPermissionResult
    try { result = await this.permissions(request) }
    catch {
      result = {
        requestId: request.requestId, cameraRequested: request.camera, microphoneRequested: request.microphone,
        cameraGranted: false, microphoneGranted: false, cameraStatus: 'denied', microphoneStatus: 'denied',
        granted: false, message: '媒体权限申请失败',
      }
    }
    if (this.frame !== null) sendDesktopCallCommand(this.frame, 'media_permission_result', result as unknown as Record<string, unknown>)
    this.diag('media_permission_resolved', {
      requestId: request.requestId,
      camera: request.camera,
      microphone: request.microphone,
      granted: result.granted,
      cameraGranted: result.cameraGranted,
      microphoneGranted: result.microphoneGranted,
      message: result.message,
    })
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) this.stopInterval(this.heartbeatTimer)
    this.heartbeatTimer = this.startInterval(() => {
      const callRequestId = this.leaseCallRequestId
      if (callRequestId !== '') void this.callApi('calls.outgoing.heartbeat', { callRequestId }).catch(error => {
        this.diag('heartbeat_failed', { callRequestId, error: error instanceof Error ? error.message : String(error) })
        void this.fail('call-ui-unavailable', '呼叫连接已失效，请重试')
      })
    }, 15_000)
  }

  private scheduleCallStartFallback(): void {
    this.clearCallStartFallback()
    const generation = this.generation
    const callRequestId = this.snapshot.callRequestId
    const delayMs = CALL_START_FALLBACK_MS
    this.diag('call_start_fallback_schedule', { callRequestId, delayMs, generation })
    this.callStartFallbackTimer = this.startTimeout(() => {
      this.callStartFallbackTimer = undefined
      const phase = this.snapshot.phase
      if (this.generation !== generation || this.snapshot.callRequestId !== callRequestId || !this.callSent) {
        this.diag('call_start_fallback_skipped', {
          callRequestId,
          generation,
          currentGeneration: this.generation,
          currentCallRequestId: this.snapshot.callRequestId,
        })
        return
      }
      if (phase !== 'bootstrapping' && phase !== 'calling') return
      this.diag('call_start_fallback_fire', { callRequestId, phase })
      void this.finish('call-cancelled', '通话已结束')
    }, delayMs)
  }

  private clearCallStartFallback(): void {
    if (this.callStartFallbackTimer !== undefined) {
      this.stopTimeout(this.callStartFallbackTimer)
      this.callStartFallbackTimer = undefined
    }
  }

  private async resolveIntentCalling(): Promise<void> {
    const intent = this.intent
    this.intent = undefined
    if (intent === undefined) return
    this.diag('resolve_intent_calling', { intentId: intent.intentId, callRequestId: intent.callRequestId })
    await this.callApi('calls.outgoing.intent.resolve', {
      intentId: intent.intentId, claimToken: intent.claimToken, status: 'calling',
    })
  }

  private async fail(code: ArkmeOutgoingCallFailureCode, message: string): Promise<void> {
    const intent = this.intent
    this.intent = undefined
    this.diag('fail', { code, message, intentId: intent?.intentId, callRequestId: this.snapshot.callRequestId })
    if (intent !== undefined) await this.callApi('calls.outgoing.intent.resolve', {
      intentId: intent.intentId, claimToken: intent.claimToken, status: 'failed', code, message,
    }).catch(() => undefined)
    await this.releaseLease()
    this.prepared = undefined
    this.update({ phase: 'error', statusText: '', error: message })
  }

  private finishTerminal(message: string): void {
    const terminalMessage = message || '通话已结束'
    this.clearCallStartFallback()
    this.diag('finish_terminal', { message: terminalMessage, hasFrame: this.frame !== null })
    this.hideTerminalOverlay(terminalMessage, this.frame !== null)
    this.scheduleFinish('call-cancelled', terminalMessage, 650)
  }

  private hideTerminalOverlay(message: string, retainFrame: boolean): void {
    this.diag('hide_terminal_overlay', { message, retainFrame })
    this.update({ visible: false, retainFrame, phase: 'ending', statusText: message, compact: false, fullscreen: false })
  }

  private scheduleFinish(code: ArkmeOutgoingCallFailureCode, message: string, delayMs: number): void {
    const generation = this.generation
    this.diag('schedule_finish', { code, message, delayMs, generation })
    this.startTimeout(() => {
      if (this.generation !== generation) {
        this.diag('schedule_finish_skipped_generation_changed', { generation, currentGeneration: this.generation })
        return
      }
      this.diag('schedule_finish_fire', { code, message, generation })
      void this.finish(code, message)
    }, delayMs)
  }

  private async finish(code: ArkmeOutgoingCallFailureCode, message: string): Promise<void> {
    this.diag('finish_enter', { code, message, callRequestId: this.leaseCallRequestId })
    this.generation += 1
    this.clearCallStartFallback()
    const settled = this.leaseCallRequestId === '' ? undefined : {
      callRequestId: this.leaseCallRequestId,
      displayName: this.snapshot.displayName,
      mediaType: this.snapshot.mediaType,
      status: code === 'call-cancelled' ? 'ended' as const : 'failed' as const,
    }
    const intent = this.intent
    this.intent = undefined
    if (intent !== undefined) await this.callApi('calls.outgoing.intent.resolve', {
      intentId: intent.intentId, claimToken: intent.claimToken, status: 'failed', code, message,
    }).catch(() => undefined)
    if (this.frame !== null) sendDesktopCallCommand(this.frame, 'logout')
    await this.releaseLease()
    this.prepared = undefined
    this.bootstrapSent = false
    this.callSent = false
    this.update({
      visible: false, retainFrame: false, phase: 'idle', callRequestId: '', displayName: '', mediaType: 'audio',
      statusText: '', error: '', compact: false, fullscreen: false,
    })
    this.diag('finish_done', { code, message, settled })
    if (settled !== undefined) this.controller.notifySettled(settled)
  }

  private async releaseLease(): Promise<void> {
    const callRequestId = this.leaseCallRequestId
    this.leaseCallRequestId = ''
    if (this.heartbeatTimer !== undefined) this.stopInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
    this.diag('release_lease', { callRequestId })
    if (callRequestId !== '') await this.callApi('calls.outgoing.release', { callRequestId }).catch(error => {
      this.diag('release_lease_failed', { callRequestId, error: error instanceof Error ? error.message : String(error) })
    })
  }

  private update(patch: Partial<OutgoingCallRuntimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.diag('snapshot_update', { patch })
    this.listeners.forEach(listener => { listener() })
  }

  private async callApi(operation: ArkmePluginOperation, params?: Record<string, unknown>): Promise<unknown> {
    this.diag('api_call_start', { operation, params: this.sanitizeParams(params) })
    try {
      const result = await this.api(operation, params)
      this.diag('api_call_success', { operation })
      return result
    } catch (error) {
      this.diag('api_call_failed', { operation, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  private diag(label: string, detail: object): void {
    const snapshot = {
      phase: this.snapshot.phase,
      visible: this.snapshot.visible,
      retainFrame: this.snapshot.retainFrame,
      callRequestId: this.snapshot.callRequestId,
      leaseCallRequestId: this.leaseCallRequestId,
      mediaType: this.snapshot.mediaType,
      displayName: this.snapshot.displayName,
      bootstrapSent: this.bootstrapSent,
      callSent: this.callSent,
      generation: this.generation,
    }
    try {
      console.info(`${DIAG_PREFIX} runtime ${label}`, { ...detail, snapshot })
    } catch {
      console.info(`${DIAG_PREFIX} runtime ${label}`)
    }
    this.postHostDiag(label, { ...detail, snapshot })
  }

  private postHostDiag(label: string, detail: Record<string, unknown>): void {
    if (!HOST_DIAG_LABEL_PATTERNS.some(pattern => label.startsWith(pattern))) return
    if ((label === 'api_call_start' || label === 'api_call_success')
      && detail.operation === 'calls.outgoing.intent.claim') return
    let encoded = '{}'
    try { encoded = JSON.stringify(detail) } catch { encoded = '{"serializeError":true}' }
    void this.api('calls.outgoing.diag', {
      label,
      detail: encoded.slice(0, 4_000),
    }).catch(() => undefined)
  }

  private sanitizeParams(params: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (params === undefined) return undefined
    const safe: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params)) {
      if (/sig|token|credential|password|secret/i.test(key)) {
        safe[key] = '[redacted]'
      } else {
        safe[key] = value
      }
    }
    return safe
  }
}
