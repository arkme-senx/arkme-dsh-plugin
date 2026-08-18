import { randomUUID } from 'node:crypto'
import {
  ArkmeOutgoingCallError,
  type ArkmeOutgoingCallIntentClaim,
  type ArkmeOutgoingCallIntentResolutionInput,
  type ArkmeOutgoingCallMediaType,
  type ArkmeOutgoingCallToolResult,
} from './outgoing-call-contract.js'

const INTENT_TTL_MS = 30_000
const ACTIVE_LEASE_TTL_MS = 120_000

interface BrokerOptions {
  now?: () => number
  randomId?: () => string
  setTimer?: (callback: () => void, delay: number) => unknown
  clearTimer?: (handle: unknown) => void
}

interface PendingIntent {
  userId: number
  intentId: string
  callRequestId: string
  sourceRef: string
  displayName: string
  mediaType: ArkmeOutgoingCallMediaType
  expiresAtMillis: number
  claimToken?: string
  claimed: boolean
  toolSettled: boolean
  resolve(value: ArkmeOutgoingCallToolResult): void
  reject(error: Error): void
  timer: unknown
  signal?: AbortSignal
  abort?: () => void
}

interface ActiveLease {
  callRequestId: string
  expiresAtMillis: number
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized === '') throw new ArkmeOutgoingCallError('call-cancelled', `${label}不能为空`)
  return normalized
}

function validUserId(userId: number): number {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new ArkmeOutgoingCallError('call-cancelled', '呼叫账号无效')
  }
  return userId
}

export class ArkmeOutgoingCallBroker {
  private readonly now: () => number
  private readonly randomId: () => string
  private readonly setTimer: (callback: () => void, delay: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private readonly intents = new Map<string, PendingIntent>()
  private readonly leases = new Map<number, ActiveLease>()
  private disposed = false

  constructor(options: BrokerOptions = {}) {
    this.now = options.now ?? Date.now
    this.randomId = options.randomId ?? randomUUID
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay))
    this.clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  request(input: {
    userId: number
    sourceRef: string
    displayName: string
    mediaType: ArkmeOutgoingCallMediaType
    signal?: AbortSignal
  }): Promise<ArkmeOutgoingCallToolResult> {
    if (this.disposed) return Promise.reject(new ArkmeOutgoingCallError('call-cancelled', '呼叫服务已停止'))
    const userId = validUserId(input.userId)
    const sourceRef = nonEmpty(input.sourceRef, '私聊引用')
    const displayName = nonEmpty(input.displayName, '私聊用户名称')
    if (input.mediaType !== 'audio' && input.mediaType !== 'video') {
      return Promise.reject(new ArkmeOutgoingCallError('call-cancelled', '呼叫媒体类型无效'))
    }
    if (input.signal?.aborted === true) {
      return Promise.reject(new ArkmeOutgoingCallError('call-cancelled', '呼叫请求已取消'))
    }
    const intentId = this.randomId()
    const callRequestId = this.randomId()
    const expiresAtMillis = this.now() + INTENT_TTL_MS
    return new Promise<ArkmeOutgoingCallToolResult>((resolve, reject) => {
      const intent: PendingIntent = {
        userId,
        intentId,
        callRequestId,
        sourceRef,
        displayName,
        mediaType: input.mediaType,
        expiresAtMillis,
        claimed: false,
        toolSettled: false,
        resolve,
        reject,
        timer: undefined,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }
      intent.timer = this.setTimer(() => {
        const current = this.intents.get(intentId)
        if (current === undefined) return
        this.intents.delete(intentId)
        this.detachAbort(current)
        if (!current.toolSettled) {
          current.toolSettled = true
          current.reject(new ArkmeOutgoingCallError('call-ui-unavailable', '呼叫界面不可用，请保持 Arkme 界面打开后重试'))
        }
      }, INTENT_TTL_MS)
      if (input.signal !== undefined) {
        const abort = (): void => {
          const current = this.intents.get(intentId)
          if (current === undefined || current.toolSettled) return
          current.toolSettled = true
          current.reject(new ArkmeOutgoingCallError('call-cancelled', '呼叫请求已取消'))
          if (!current.claimed) this.removeIntent(current)
        }
        intent.abort = abort
        input.signal.addEventListener('abort', abort, { once: true })
      }
      this.intents.set(intentId, intent)
    })
  }

  claim(userId: number): ArkmeOutgoingCallIntentClaim | null {
    validUserId(userId)
    this.expireStaleIntents()
    const intent = [...this.intents.values()]
      .filter(candidate => candidate.userId === userId && !candidate.claimed)
      .sort((a, b) => a.expiresAtMillis - b.expiresAtMillis)[0]
    if (intent === undefined) return null
    intent.claimed = true
    intent.claimToken = this.randomId()
    return {
      intentId: intent.intentId,
      claimToken: intent.claimToken,
      callRequestId: intent.callRequestId,
      sourceRef: intent.sourceRef,
      displayName: intent.displayName,
      mediaType: intent.mediaType,
      expiresAtMillis: intent.expiresAtMillis,
    }
  }

  resolveIntent(input: ArkmeOutgoingCallIntentResolutionInput): void {
    validUserId(input.userId)
    const intent = this.intents.get(nonEmpty(input.intentId, '呼叫意图'))
    if (intent === undefined) throw new ArkmeOutgoingCallError('call-cancelled', '呼叫意图已失效')
    if (intent.userId !== input.userId) throw new ArkmeOutgoingCallError('call-cancelled', '呼叫意图与当前账号不匹配')
    if (intent.claimToken === undefined || intent.claimToken !== input.claimToken) {
      throw new ArkmeOutgoingCallError('call-cancelled', '呼叫意图领取凭据无效')
    }
    this.removeIntent(intent)
    if (intent.toolSettled) return
    intent.toolSettled = true
    if (input.outcome.status === 'calling') {
      intent.resolve({ status: 'calling', displayName: intent.displayName, mediaType: intent.mediaType })
      return
    }
    intent.reject(new ArkmeOutgoingCallError(input.outcome.code, input.outcome.message))
  }

  acquireLease(userId: number, callRequestId: string): number {
    validUserId(userId)
    const requestId = nonEmpty(callRequestId, '呼叫请求')
    this.expireLease(userId)
    const current = this.leases.get(userId)
    if (current !== undefined && current.callRequestId !== requestId) {
      throw new ArkmeOutgoingCallError('call-active', '当前已有通话进行中')
    }
    const expiresAtMillis = this.now() + ACTIVE_LEASE_TTL_MS
    this.leases.set(userId, { callRequestId: requestId, expiresAtMillis })
    return expiresAtMillis
  }

  heartbeatLease(userId: number, callRequestId: string): number {
    validUserId(userId)
    const requestId = nonEmpty(callRequestId, '呼叫请求')
    this.expireLease(userId)
    const current = this.leases.get(userId)
    if (current === undefined || current.callRequestId !== requestId) {
      throw new ArkmeOutgoingCallError('call-cancelled', '呼叫租约已失效')
    }
    current.expiresAtMillis = this.now() + ACTIVE_LEASE_TTL_MS
    return current.expiresAtMillis
  }

  releaseLease(userId: number, callRequestId: string): void {
    validUserId(userId)
    const requestId = nonEmpty(callRequestId, '呼叫请求')
    const current = this.leases.get(userId)
    if (current?.callRequestId === requestId) this.leases.delete(userId)
  }

  clearUser(userId: number, message: string): void {
    validUserId(userId)
    for (const intent of [...this.intents.values()]) {
      if (intent.userId !== userId) continue
      this.removeIntent(intent)
      if (!intent.toolSettled) {
        intent.toolSettled = true
        intent.reject(new ArkmeOutgoingCallError('call-cancelled', message))
      }
    }
    this.leases.delete(userId)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const intent of [...this.intents.values()]) {
      this.removeIntent(intent)
      if (!intent.toolSettled) {
        intent.toolSettled = true
        intent.reject(new ArkmeOutgoingCallError('call-cancelled', '呼叫服务已停止'))
      }
    }
    this.leases.clear()
  }

  private expireStaleIntents(): void {
    for (const intent of [...this.intents.values()]) {
      if (intent.expiresAtMillis > this.now()) continue
      this.removeIntent(intent)
      if (!intent.toolSettled) {
        intent.toolSettled = true
        intent.reject(new ArkmeOutgoingCallError('call-ui-unavailable', '呼叫界面不可用，请保持 Arkme 界面打开后重试'))
      }
    }
  }

  private expireLease(userId: number): void {
    const current = this.leases.get(userId)
    if (current !== undefined && current.expiresAtMillis <= this.now()) this.leases.delete(userId)
  }

  private removeIntent(intent: PendingIntent): void {
    this.intents.delete(intent.intentId)
    this.clearTimer(intent.timer)
    this.detachAbort(intent)
  }

  private detachAbort(intent: PendingIntent): void {
    if (intent.signal !== undefined && intent.abort !== undefined) {
      intent.signal.removeEventListener('abort', intent.abort)
    }
  }
}
