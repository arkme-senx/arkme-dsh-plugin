import qrcode from 'qrcode-generator'
import type {
  ArkmeBillingPaymentAction,
  ArkmeBillingOrderSnapshot,
  ArkmeBillingPaymentMethod,
  ArkmeBillingProduct,
  ArkmeBillingOrderStatus,
} from '../types.js'

export interface ArkmeCheckoutAttempt {
  productId: string
  paymentMethod: ArkmeBillingPaymentMethod
  clientRequestId: string
}

type ArkmeBillingCrypto = Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>>

export function createBillingClientRequestId(source: ArkmeBillingCrypto = globalThis.crypto): string {
  if (typeof source?.randomUUID === 'function') return source.randomUUID().toLowerCase()
  if (typeof source?.getRandomValues !== 'function') throw new Error('当前环境无法生成安全的支付请求标识')
  const bytes = source.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] ?? 0) & 0x0f | 0x40
  bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function selectDefaultBillingProduct(products: ArkmeBillingProduct[]): ArkmeBillingProduct | undefined {
  return products.find(product => product.enabled)
}

export function billingPaymentAvailable(
  product: ArkmeBillingProduct | undefined,
  paymentMethod: ArkmeBillingPaymentMethod,
): boolean {
  return product?.enabled === true && product.paymentMethods.some(method => method.id === paymentMethod)
}

export function activateBillingPaymentAction(
  action: ArkmeBillingPaymentAction | undefined,
  openURL: (url: string) => void,
): boolean {
  if (action?.type !== 'open_url') return false
  openURL(action.url)
  return true
}

function billingErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const body = 'body' in error ? error.body : undefined
  if (typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string') return body.code
  return 'code' in error && typeof error.code === 'string' ? error.code : ''
}

async function waitForBillingRetry(millis: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, millis))
}

export async function createBillingOrderWithProcessingRetry<T>(
  attempt: ArkmeCheckoutAttempt,
  createOrder: (input: ArkmeCheckoutAttempt) => Promise<T>,
  wait: (millis: number) => Promise<void> = waitForBillingRetry,
): Promise<T> {
  for (let attemptIndex = 0; attemptIndex < 3; attemptIndex += 1) {
    try {
      return await createOrder(attempt)
    } catch (error) {
      if (billingErrorCode(error) !== 'order_processing' || attemptIndex === 2) throw error
      await wait(500)
    }
  }
  throw new Error('支付订单创建状态无效')
}

export function checkoutAttempt(
  previous: ArkmeCheckoutAttempt | undefined,
  productId: string,
  paymentMethod: ArkmeBillingPaymentMethod,
  createId: () => string,
): ArkmeCheckoutAttempt {
  if (previous?.productId === productId && previous.paymentMethod === paymentMethod) return previous
  return { productId, paymentMethod, clientRequestId: createId() }
}

export function checkoutAttemptAfterOrder(
  attempt: ArkmeCheckoutAttempt | undefined,
  status: ArkmeBillingOrderStatus,
): ArkmeCheckoutAttempt | undefined {
  return ['paid', 'expired', 'closed', 'failed'].includes(status) ? undefined : attempt
}

export type ArkmeBillingOrderScreen = ArkmeBillingOrderStatus

export function billingOrderScreen(
  order: Pick<ArkmeBillingOrderSnapshot, 'status' | 'expiresAtMillis'>,
  nowMillis: number,
): ArkmeBillingOrderScreen {
  return (order.status === 'pending' || order.status === 'closed') && nowMillis >= order.expiresAtMillis
    ? 'expired'
    : order.status
}

export function billingQrDataUrl(content: string | undefined): string {
  const normalized = content?.trim() ?? ''
  if (normalized === '') return ''
  const qr = qrcode(0, 'M')
  qr.addData(normalized)
  qr.make()
  return qr.createDataURL(6, 12)
}

interface ArkmeBillingOrderPollerOptions {
  readStatus(orderId: string): Promise<ArkmeBillingOrderSnapshot>
  onUpdate(order: ArkmeBillingOrderSnapshot): void
  onError(error: unknown, retry: ArkmeBillingPollRetry): void
  onExpired?(): void
  intervalMillis?: number
  now?: () => number
}

export interface ArkmeBillingPollRetry {
  willRetry: boolean
  retryInMillis?: number
}

const TERMINAL_ORDER_STATUSES = new Set<ArkmeBillingOrderStatus>(['paid', 'expired', 'closed', 'failed'])
const POLL_RETRY_BACKOFF_MILLIS = [1_000, 2_000, 4_000, 8_000, 10_000] as const

function billingPollErrorRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('body' in error)) return true
  const body = error.body
  return !(typeof body === 'object' && body !== null && 'retryable' in body && body.retryable === false)
}

export class ArkmeBillingOrderPoller {
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private refresh: (() => void) | undefined
  private readonly intervalMillis: number
  private readonly now: () => number

  constructor(private readonly options: ArkmeBillingOrderPollerOptions) {
    this.intervalMillis = options.intervalMillis ?? 2_000
    this.now = options.now ?? Date.now
  }

  start(
    orderId: string,
    expiresAtMillis: number,
    requestedIntervalMillis?: number,
    initialStatus: ArkmeBillingOrderStatus = 'pending',
  ): void {
    this.stop()
    const generation = this.generation
    const intervalMillis = requestedIntervalMillis !== undefined
      && Number.isFinite(requestedIntervalMillis) && requestedIntervalMillis > 0
      ? Math.min(10_000, Math.max(500, Math.trunc(requestedIntervalMillis)))
      : this.intervalMillis
    let currentStatus = initialStatus
    if (TERMINAL_ORDER_STATUSES.has(currentStatus)) return
    let inFlight = false
    let refreshQueued = false
    let retryAttempt = 0
    const schedule = (delayMillis = intervalMillis) => {
      if (generation !== this.generation) return
      if (currentStatus === 'pending') {
        const remaining = expiresAtMillis - this.now()
        if (remaining <= 0) {
          this.options.onExpired?.()
          this.stop()
          return
        }
        this.timer = setTimeout(() => { void poll() }, Math.min(delayMillis, remaining))
      } else {
        this.timer = setTimeout(() => { void poll() }, delayMillis)
      }
    }
    const poll = async () => {
      if (generation !== this.generation) return
      if (inFlight) {
        refreshQueued = true
        return
      }
      if (currentStatus === 'pending' && this.now() >= expiresAtMillis) {
        this.options.onExpired?.()
        this.stop()
        return
      }
      inFlight = true
      let nextDelayMillis = intervalMillis
      try {
        const order = await this.options.readStatus(orderId)
        if (generation !== this.generation) return
        retryAttempt = 0
        this.options.onUpdate(order)
        currentStatus = billingOrderScreen({ ...order, expiresAtMillis }, this.now())
        if (TERMINAL_ORDER_STATUSES.has(currentStatus)) this.stop()
      } catch (error) {
        if (generation !== this.generation) return
        if (!billingPollErrorRetryable(error)) {
          this.options.onError(error, { willRetry: false })
          this.stop()
          return
        }
        nextDelayMillis = POLL_RETRY_BACKOFF_MILLIS[Math.min(retryAttempt, POLL_RETRY_BACKOFF_MILLIS.length - 1)] ?? 10_000
        retryAttempt += 1
        this.options.onError(error, { willRetry: true, retryInMillis: nextDelayMillis })
      } finally {
        inFlight = false
      }
      if (generation !== this.generation) return
      if (refreshQueued) {
        refreshQueued = false
        void poll()
        return
      }
      schedule(nextDelayMillis)
    }
    this.refresh = () => {
      if (generation !== this.generation) return
      if (this.timer !== undefined) clearTimeout(this.timer)
      this.timer = undefined
      if (inFlight) {
        refreshQueued = true
        return
      }
      void poll()
    }
    schedule()
  }

  refreshNow(): void {
    this.refresh?.()
  }

  stop(): void {
    this.generation += 1
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.refresh = undefined
  }
}
