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

type ApiCall = (operation: ArkmePluginOperation, params?: Record<string, unknown>) => Promise<unknown>
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
}

const TERMINAL_TYPES = new Set(['end', 'user_reject', 'user_no_response', 'user_line_busy', 'not_connected'])
const FAILURE_CODES = new Set<ArkmeOutgoingCallFailureCode>([
  'call-ui-unavailable', 'call-active', 'call-source-invalid', 'call-peer-unavailable',
  'call-permission-denied', 'call-bootstrap-failed', 'call-engine-failed', 'call-cancelled',
])

const INITIAL_SNAPSHOT: OutgoingCallRuntimeSnapshot = {
  visible: false,
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
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): OutgoingCallRuntimeSnapshot => this.snapshot

  configure(assetBasePath: string): void {
    if (!/^\/[A-Za-z0-9/_-]+$/.test(assetBasePath) || assetBasePath.endsWith('/')) return
    this.update({ assetBasePath })
  }

  mount(): void {
    if (this.unsubscribeController !== undefined) return
    const consume = () => {
      const request = this.controller.consume()
      if (request !== undefined) void this.start(request)
    }
    this.unsubscribeController = this.controller.subscribe(consume)
    consume()
    this.pollTimer = this.startInterval(() => { void this.pollToolIntent().catch(() => undefined) }, 750)
    void this.pollToolIntent().catch(() => undefined)
  }

  attachFrame(frame: HTMLIFrameElement | null): void {
    this.frame = frame
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
    if (message !== undefined) this.handleBridgeMessage(message)
  }

  handleBridgeMessage(message: DesktopCallBridgeEvent): void {
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
      this.update({ phase: 'calling', statusText: `正在呼叫 ${this.snapshot.displayName}…` })
      void this.resolveIntentCalling()
      return
    }
    if (message.type === 'begin') {
      this.update({ phase: 'active', statusText: '通话中' })
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
      void this.fail('call-permission-denied', message.message ?? '请允许麦克风权限后重试')
      return
    }
    if (message.type === 'fatal_error') {
      void this.fail('call-engine-failed', message.message ?? '呼叫引擎启动失败')
      return
    }
    if (TERMINAL_TYPES.has(message.type)) this.finishTerminal(message.message ?? '')
  }

  async pollToolIntent(): Promise<void> {
    if (this.snapshot.phase !== 'idle' || this.claiming) return
    this.claiming = true
    try {
      const claim = await this.api('calls.outgoing.intent.claim') as ArkmeOutgoingCallIntentClaim | null
      if (claim === null || claim === undefined) return
      if (this.snapshot.phase !== 'idle') {
        await this.api('calls.outgoing.intent.resolve', {
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
    if (this.snapshot.phase === 'calling' || this.snapshot.phase === 'active') {
      this.update({ phase: 'ending', statusText: '正在结束通话…' })
      if (this.frame !== null) sendDesktopCallCommand(this.frame, 'terminate')
      this.startTimeout(() => { void this.finish('call-cancelled', '通话已结束') }, 1_200)
      return
    }
    this.update({ visible: false, phase: 'ending', statusText: '已取消呼叫' })
    void this.finish('call-cancelled', '已取消呼叫')
  }

  dispose(): void {
    this.generation += 1
    this.unsubscribeController?.()
    this.unsubscribeController = undefined
    if (this.pollTimer !== undefined) this.stopInterval(this.pollTimer)
    if (this.heartbeatTimer !== undefined) this.stopInterval(this.heartbeatTimer)
    this.pollTimer = undefined
    this.heartbeatTimer = undefined
    this.claiming = false
    if (this.frame !== null) sendDesktopCallCommand(this.frame, 'logout')
    const lease = this.leaseCallRequestId
    this.leaseCallRequestId = ''
    if (lease !== '') void this.api('calls.outgoing.release', { callRequestId: lease })
    const intent = this.intent
    this.intent = undefined
    if (intent !== undefined) void this.api('calls.outgoing.intent.resolve', {
      intentId: intent.intentId, claimToken: intent.claimToken, status: 'failed',
      code: 'call-ui-unavailable', message: '呼叫界面已关闭',
    })
    this.prepared = undefined
    this.frame = null
    this.snapshot = { ...INITIAL_SNAPSHOT, assetBasePath: this.snapshot.assetBasePath }
    this.listeners.forEach(listener => { listener() })
  }

  private async start(request: OutgoingCallUiRequest, intent?: ArkmeOutgoingCallIntentClaim): Promise<void> {
    if (this.snapshot.phase !== 'idle') {
      if (intent !== undefined) await this.api('calls.outgoing.intent.resolve', {
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
      visible: true, phase: 'preparing', callRequestId, displayName: request.displayName,
      mediaType: request.mediaType, statusText: '正在准备呼叫…', error: '', compact: false, fullscreen: false,
    })
    try {
      const result = await this.api('calls.outgoing.prepare', {
        sourceRef: request.sourceRef, mediaType: request.mediaType, callRequestId,
      }) as ArkmeOutgoingCallPrepareResult
      const prepared: BrowserPrepared = { ...result, call: { ...result.call } }
      if (generation !== this.generation) {
        await this.api('calls.outgoing.release', { callRequestId })
        return
      }
      if (prepared.peerAvatarRef !== undefined && this.loadAvatar !== undefined) {
        try { prepared.call.calleeAvatar = await this.loadAvatar(prepared.peerAvatarRef) } catch { /* avatar is optional */ }
      }
      this.prepared = prepared
      this.leaseCallRequestId = callRequestId
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
    if (!sendDesktopCallCommand(this.frame, 'bootstrap', this.prepared.bootstrap)) return
    this.bootstrapSent = true
    this.prepared.bootstrap.userSig = ''
  }

  private flushCall(): void {
    if (!this.bootstrapSent || this.callSent || this.prepared === undefined || this.frame === null) return
    if (!sendDesktopCallCommand(this.frame, 'call', this.prepared.call)) return
    this.callSent = true
    this.prepared = undefined
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
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) this.stopInterval(this.heartbeatTimer)
    this.heartbeatTimer = this.startInterval(() => {
      const callRequestId = this.leaseCallRequestId
      if (callRequestId !== '') void this.api('calls.outgoing.heartbeat', { callRequestId }).catch(() => {
        void this.fail('call-ui-unavailable', '呼叫连接已失效，请重试')
      })
    }, 15_000)
  }

  private async resolveIntentCalling(): Promise<void> {
    const intent = this.intent
    this.intent = undefined
    if (intent === undefined) return
    await this.api('calls.outgoing.intent.resolve', {
      intentId: intent.intentId, claimToken: intent.claimToken, status: 'calling',
    })
  }

  private async fail(code: ArkmeOutgoingCallFailureCode, message: string): Promise<void> {
    const intent = this.intent
    this.intent = undefined
    if (intent !== undefined) await this.api('calls.outgoing.intent.resolve', {
      intentId: intent.intentId, claimToken: intent.claimToken, status: 'failed', code, message,
    }).catch(() => undefined)
    await this.releaseLease()
    this.prepared = undefined
    this.update({ phase: 'error', statusText: '', error: message })
  }

  private finishTerminal(message: string): void {
    this.update({ phase: 'ending', statusText: message || '通话已结束' })
    this.startTimeout(() => { void this.finish('call-cancelled', message || '通话已结束') }, 650)
  }

  private async finish(code: ArkmeOutgoingCallFailureCode, message: string): Promise<void> {
    this.generation += 1
    const intent = this.intent
    this.intent = undefined
    if (intent !== undefined) await this.api('calls.outgoing.intent.resolve', {
      intentId: intent.intentId, claimToken: intent.claimToken, status: 'failed', code, message,
    }).catch(() => undefined)
    if (this.frame !== null) sendDesktopCallCommand(this.frame, 'logout')
    await this.releaseLease()
    this.prepared = undefined
    this.bootstrapSent = false
    this.callSent = false
    this.update({
      visible: false, phase: 'idle', callRequestId: '', displayName: '', mediaType: 'audio',
      statusText: '', error: '', compact: false, fullscreen: false,
    })
  }

  private async releaseLease(): Promise<void> {
    const callRequestId = this.leaseCallRequestId
    this.leaseCallRequestId = ''
    if (this.heartbeatTimer !== undefined) this.stopInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
    if (callRequestId !== '') await this.api('calls.outgoing.release', { callRequestId }).catch(() => undefined)
  }

  private update(patch: Partial<OutgoingCallRuntimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach(listener => { listener() })
  }
}
