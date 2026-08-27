import type {
  ArkmeBillingOrderCreateInput,
  ArkmeBillingOrderSnapshot,
  ArkmeBillingOrderStatus,
  ArkmeBillingPaymentAction,
  ArkmeBillingPaymentMethod,
  ArkmeBillingPaymentMethodOption,
  ArkmeBillingPaymentProvider,
  ArkmeBillingProduct,
  ArkmeBillingProductList,
  ArkmeQuotaSnapshot,
} from './types.js'
import {
  ArkmePluginError,
  objectValue,
  stringValue,
  type ServiceRuntime,
} from './services/service.js'

export interface ArkmeBillingGateway {
  quota(signal?: AbortSignal): Promise<ArkmeQuotaSnapshot>
  products(signal?: AbortSignal): Promise<ArkmeBillingProductList>
  createOrder(input: ArkmeBillingOrderCreateInput, signal?: AbortSignal): Promise<ArkmeBillingOrderSnapshot>
  orderStatus(orderId: string, signal?: AbortSignal): Promise<ArkmeBillingOrderSnapshot>
}

export class ArkmeBillingUnavailableError extends Error {
  constructor() {
    super('购买服务暂不可用')
    this.name = 'ArkmeBillingUnavailableError'
  }
}

export class UnavailableArkmeBillingGateway implements ArkmeBillingGateway {
  async quota(): Promise<ArkmeQuotaSnapshot> { throw new ArkmeBillingUnavailableError() }
  async products(): Promise<ArkmeBillingProductList> { throw new ArkmeBillingUnavailableError() }
  async createOrder(): Promise<ArkmeBillingOrderSnapshot> { throw new ArkmeBillingUnavailableError() }
  async orderStatus(): Promise<ArkmeBillingOrderSnapshot> { throw new ArkmeBillingUnavailableError() }
}

function nanoCny(value: unknown, field: string): string {
  const normalized = stringValue(value).trim()
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new ArkmePluginError('billing-contract-invalid', `余额接口字段 ${field} 无效`, true, 502)
  }
  return normalized
}

function requiredString(value: unknown, field: string): string {
  const normalized = stringValue(value).trim()
  if (normalized === '') {
    throw new ArkmePluginError('billing-contract-invalid', `支付接口字段 ${field} 无效`, true, 502)
  }
  return normalized
}

function positiveSafeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ArkmePluginError('billing-contract-invalid', `支付接口字段 ${field} 无效`, true, 502)
  }
  return value
}

function optionalTimestampMillis(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const millis = Date.parse(requiredString(value, field))
  if (!Number.isFinite(millis)) {
    throw new ArkmePluginError('billing-contract-invalid', `支付接口字段 ${field} 无效`, true, 502)
  }
  return millis
}

function uuid(value: unknown, field: string, errorCode = 'billing-contract-invalid'): string {
  const normalized = stringValue(value).trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    const upstreamContract = errorCode === 'billing-contract-invalid'
    throw new ArkmePluginError(errorCode, `支付接口字段 ${field} 无效`, upstreamContract, upstreamContract ? 502 : 400)
  }
  return normalized
}

function paymentMethods(value: unknown): ArkmeBillingPaymentMethodOption[] {
  if (!Array.isArray(value)) {
    throw new ArkmePluginError('billing-contract-invalid', '支付接口字段 payment_methods 无效', true, 502)
  }
  const result: ArkmeBillingPaymentMethodOption[] = []
  for (const rawMethod of value) {
    const method = objectValue(rawMethod)
    const id = requiredString(method.id, 'payment_methods.id')
    const provider = requiredString(method.provider, 'payment_methods.provider')
    const actionType = requiredString(method.action_type, 'payment_methods.action_type')
    const valid = (id === 'wechat_native' && provider === 'wechat' && actionType === 'display_qr')
      || (id === 'alipay_pc_web' && provider === 'alipay' && actionType === 'open_url')
    if (!valid) {
      throw new ArkmePluginError('billing-contract-invalid', '支付接口包含未知支付方式', true, 502)
    }
    if (!result.some(item => item.id === id)) {
      result.push({
        id: id as ArkmeBillingPaymentMethod,
        provider: provider as ArkmeBillingPaymentMethodOption['provider'],
        actionType: actionType as ArkmeBillingPaymentMethodOption['actionType'],
      })
    }
  }
  if (result.length === 0) {
    throw new ArkmePluginError('billing-contract-invalid', '支付接口未返回可用渠道', true, 502)
  }
  return result
}

function productSnapshot(value: unknown, currency: 'CNY'): ArkmeBillingProduct {
  const product = objectValue(value)
  const description = stringValue(product.description).trim()
  return {
    productId: requiredString(product.product_code, 'product_code'),
    title: requiredString(product.title, 'title'),
    ...(description === '' ? {} : { description }),
    creditNanoCny: nanoCny(product.credit_nano_cny, 'credit_nano_cny'),
    priceMinor: positiveSafeInteger(product.price_cent, 'price_cent'),
    currency,
    paymentMethods: paymentMethods(product.payment_methods),
    enabled: true,
  }
}

function paymentMethodContract(
  paymentMethod: string,
  provider: string,
  actionType: string,
): boolean {
  return (paymentMethod === 'wechat_native' && provider === 'wechat' && actionType === 'display_qr')
    || (paymentMethod === 'alipay_pc_web' && provider === 'alipay' && actionType === 'open_url')
}

function paymentAction(value: unknown): ArkmeBillingPaymentAction {
  const action = objectValue(value)
  const type = requiredString(action.type, 'payment_action.type')
  if (type === 'open_url') {
    const url = requiredString(action.url, 'payment_action.url')
    let parsed: URL
    try { parsed = new URL(url) } catch {
      throw new ArkmePluginError('billing-contract-invalid', '支付接口字段 payment_action.url 无效', true, 502)
    }
    if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
      throw new ArkmePluginError('billing-contract-invalid', '支付接口字段 payment_action.url 无效', true, 502)
    }
    return { type, url: parsed.href }
  }
  if (type === 'display_qr') {
    return { type, qrContent: requiredString(action.qr_code_content, 'payment_action.qr_code_content') }
  }
  throw new ArkmePluginError('billing-contract-invalid', '支付接口返回未知支付动作', true, 502)
}

function orderSnapshot(value: unknown): ArkmeBillingOrderSnapshot {
  const order = objectValue(value)
  const status = requiredString(order.status, 'status')
  const statusMap: Partial<Record<string, ArkmeBillingOrderStatus>> = {
    pending_payment: 'pending',
    crediting: 'crediting',
    credited: 'paid',
    closed: 'closed',
  }
  const mappedStatus = statusMap[status]
  if (mappedStatus === undefined) {
    throw new ArkmePluginError('billing-contract-invalid', '支付接口返回未知订单状态', true, 502)
  }
  const paymentProvider = requiredString(order.payment_provider, 'payment_provider')
  const paymentMethod = requiredString(order.payment_method, 'payment_method')
  const rawAction = order.payment_action
  const action = rawAction === undefined || rawAction === null ? undefined : paymentAction(rawAction)
  const actionType = action?.type ?? (paymentMethod === 'wechat_native' ? 'display_qr' : paymentMethod === 'alipay_pc_web' ? 'open_url' : '')
  if (!paymentMethodContract(paymentMethod, paymentProvider, actionType)) {
    throw new ArkmePluginError('billing-contract-invalid', '支付接口返回未知支付方式', true, 502)
  }
  if (requiredString(order.currency, 'currency') !== 'CNY') {
    throw new ArkmePluginError('billing-contract-invalid', '支付接口币种无效', true, 502)
  }
  const expiresAtMillis = optionalTimestampMillis(order.expires_at, 'expires_at')
  if (expiresAtMillis === undefined) {
    throw new ArkmePluginError('billing-contract-invalid', '支付接口字段 expires_at 无效', true, 502)
  }
  if (mappedStatus === 'pending' && action === undefined) {
    throw new ArkmePluginError('billing-contract-invalid', '支付接口未返回有效支付动作', true, 502)
  }
  const pollInterval = order.poll_interval_ms
  const pollIntervalMillis = typeof pollInterval === 'number' && Number.isSafeInteger(pollInterval) && pollInterval > 0
    ? Math.min(10_000, Math.max(500, pollInterval))
    : undefined
  return {
    orderId: uuid(order.order_uid, 'order_uid'),
    paymentProvider: paymentProvider as ArkmeBillingPaymentProvider,
    paymentMethod: paymentMethod as ArkmeBillingPaymentMethod,
    status: mappedStatus,
    amountMinor: positiveSafeInteger(order.price_cent, 'price_cent'),
    currency: 'CNY',
    creditNanoCny: nanoCny(order.credit_nano_cny, 'credit_nano_cny'),
    expiresAtMillis,
    ...(action === undefined ? {} : { paymentAction: action }),
    ...(pollIntervalMillis === undefined ? {} : { pollIntervalMillis }),
    ...optionalTimestamp('paidAtMillis', order.paid_at, 'paid_at'),
    ...optionalTimestamp('creditedAtMillis', order.credited_at, 'credited_at'),
  }
}

function optionalTimestamp<K extends 'paidAtMillis' | 'creditedAtMillis'>(
  key: K,
  value: unknown,
  field: string,
): Partial<Record<K, number>> {
  const millis = optionalTimestampMillis(value, field)
  return millis === undefined ? {} : { [key]: millis } as Record<K, number>
}

export class HttpArkmeBillingGateway implements ArkmeBillingGateway {
  constructor(private readonly runtime: ServiceRuntime) {}

  private async post<T>(
    service: 'auth' | 'intelligent',
    path: string,
    body: Record<string, unknown>,
    lane: 'interactive-read' | 'write',
    signal?: AbortSignal,
    key?: string,
  ): Promise<T> {
    let session = await this.runtime.requireSession()
    const request = async (): Promise<T> => await this.runtime.post<T>(
      service === 'auth' ? this.runtime.config.authBaseUrl : this.runtime.config.intelligentBaseUrl,
      path,
      body,
      session.accessToken,
      [200],
      signal,
      true,
      this.runtime.authenticatedRequestOptions(session, service, lane, {
        lane,
        ...(key === undefined ? {} : { key, bypassCache: true }),
      }),
    )
    try {
      return await request()
    } catch (error) {
      if (!(error instanceof ArkmePluginError)
        || !['auth-http-401', 'auth-http-403', 'invalid_access_token'].includes(error.code)) {
        throw this.normalizeError(error)
      }
      session = await this.runtime.refreshAccessToken(session)
      try {
        return await request()
      } catch (retryError) {
        throw this.normalizeError(retryError)
      }
    }
  }

  private normalizeError(error: unknown): unknown {
    if (!(error instanceof ArkmePluginError)) return error
    const retryable = [
      'order_processing', 'purchase_unavailable', 'balance_unavailable',
      'arkme-network-error', 'arkme-timeout',
    ].includes(error.code)
    if (retryable === error.retryable) return error
    return new ArkmePluginError(error.code, error.message, retryable, error.httpStatus, { cause: error })
  }

  async quota(signal?: AbortSignal): Promise<ArkmeQuotaSnapshot> {
    const data = objectValue(await this.post<Record<string, unknown>>(
      'intelligent',
      '/api/v1/managed-ai/balance/query',
      {},
      'interactive-read',
      signal,
      'managed-ai-balance',
    ))
    const currency = stringValue(data.currency).trim()
    if (currency !== 'CNY') {
      throw new ArkmePluginError('billing-contract-invalid', '余额接口币种无效', true, 502)
    }
    const availableNanoCny = nanoCny(data.available_nano_cny, 'available_nano_cny')
    const totalNanoCny = nanoCny(data.total_nano_cny, 'total_nano_cny')
    const reservedNanoCny = nanoCny(data.reserved_nano_cny, 'reserved_nano_cny')
    if (BigInt(availableNanoCny) + BigInt(reservedNanoCny) !== BigInt(totalNanoCny)) {
      throw new ArkmePluginError('billing-contract-invalid', '余额接口金额不一致', true, 502)
    }
    return { availableNanoCny, totalNanoCny, reservedNanoCny, currency }
  }

  async products(signal?: AbortSignal): Promise<ArkmeBillingProductList> {
    const data = objectValue(await this.post<Record<string, unknown>>(
      'auth', '/api/v1/managed-ai/products/query', {}, 'interactive-read', signal, 'managed-ai-products',
    ))
    if (stringValue(data.currency).trim() !== 'CNY' || !Array.isArray(data.products)) {
      throw new ArkmePluginError('billing-contract-invalid', '商品接口响应无效', true, 502)
    }
    return { items: data.products.map(product => productSnapshot(product, 'CNY')) }
  }

  async createOrder(input: ArkmeBillingOrderCreateInput, signal?: AbortSignal): Promise<ArkmeBillingOrderSnapshot> {
    const clientOrderUid = uuid(input.clientRequestId, 'client_order_uid', 'billing-client-request-id-invalid')
    const data = await this.post<Record<string, unknown>>(
      'auth',
      '/api/v1/managed-ai/purchase/create',
      {
        client_order_uid: clientOrderUid,
        product_code: requiredString(input.productId, 'product_code'),
        payment_method: input.paymentMethod,
      },
      'write',
      signal,
    )
    return orderSnapshot(data)
  }

  async orderStatus(orderId: string, signal?: AbortSignal): Promise<ArkmeBillingOrderSnapshot> {
    const orderUid = uuid(orderId, 'order_uid', 'billing-order-id-invalid')
    const data = await this.post<Record<string, unknown>>(
      'auth',
      '/api/v1/managed-ai/purchase/status',
      { order_uid: orderUid },
      'interactive-read',
      signal,
    )
    return orderSnapshot(data)
  }
}
