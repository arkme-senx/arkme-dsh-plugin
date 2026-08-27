import { describe, expect, it } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'

const config: ArkmeServiceConfig = {
  environment: 'test',
  authBaseUrl: 'https://auth.example.test',
  subjectBaseUrl: 'https://subject.example.test',
  recordBaseUrl: 'https://record.example.test',
  chatBaseUrl: 'https://chat.example.test',
  botBaseUrl: 'https://bot.example.test',
  imBaseUrl: 'https://im.example.test',
  webrtcBaseUrl: 'https://webrtc.example.test',
  worldBaseUrl: 'https://world.example.test',
  relationBaseUrl: 'https://relation.example.test',
  intelligentBaseUrl: 'https://intelligent.example.test',
  routePath: '/arkme',
  audioBaseUrl: 'https://audio.example.test',
  requestTimeoutMs: 5_000,
  maxTextLength: 5_000,
  geetestCaptchaId: 'captcha-id',
  interwovenMomentsEnabled: false,
}

const session: ArkmeSessionCredentials = {
  userId: 7,
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
}

function createService(
  billingGateway?: unknown,
  fetchImpl: typeof fetch = async () => { throw new Error('network must not be used') },
  sessionStore = {
    read: async () => session,
    write: async () => undefined,
    delete: async () => undefined,
  },
): ArkmeService {
  return new ArkmeService(
    config,
    sessionStore,
    {} as never,
    fetchImpl,
    undefined,
    undefined,
    billingGateway as never,
  )
}

describe('Arkme billing gateway', () => {
  it('queries the managed AI balance through the production gateway without losing nano-CNY precision', async () => {
    const requests: Request[] = []
    const service = createService(undefined, async (input, init) => {
      requests.push(new Request(input, init))
      return new Response(JSON.stringify({
        code: 200,
        message: '请求成功',
        data: {
          currency: 'CNY',
          total_nano_cny: '9007199254740993000',
          available_nano_cny: '9007199254740992999',
          reserved_nano_cny: '1',
          pricing_version: 'deepseek-v4-flash-public-20260817',
          pricing_window: 'off_peak',
          provider: 'arkme-managed',
          model: 'deepseek-v4-flash',
          pricing: {
            cache_hit_input_nano_per_token: '50',
            cache_miss_input_nano_per_token: '1500',
            output_nano_per_token: '4500',
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    await expect(service.billingQuota()).resolves.toEqual({
      availableNanoCny: '9007199254740992999',
      totalNanoCny: '9007199254740993000',
      reservedNanoCny: '1',
      currency: 'CNY',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://intelligent.example.test/api/v1/managed-ai/balance/query')
    expect(requests[0]?.headers.get('Authorization')).toBe('Bearer access-token')
    await expect(requests[0]?.json()).resolves.toEqual({})
  })

  it('maps the backend product catalog without inventing packages or payment channels', async () => {
    const requests: Request[] = []
    const service = createService(undefined, async (input, init) => {
      requests.push(new Request(input, init))
      return new Response(JSON.stringify({
        code: 200,
        message: '请求成功',
        data: {
          currency: 'CNY',
          products: [{
            product_code: 'ai-test-cent',
            title: 'AI 余额支付测试',
            description: '仅用于支付闭环验证',
            price_cent: 1,
            credit_nano_cny: '10000000',
            payment_methods: [
              { id: 'wechat_native', provider: 'wechat', action_type: 'display_qr' },
              { id: 'alipay_pc_web', provider: 'alipay', action_type: 'open_url' },
            ],
            sort_order: -100,
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    await expect(service.billingProducts()).resolves.toEqual({ items: [{
      productId: 'ai-test-cent',
      title: 'AI 余额支付测试',
      description: '仅用于支付闭环验证',
      creditNanoCny: '10000000',
      priceMinor: 1,
      currency: 'CNY',
      paymentMethods: [
        { id: 'wechat_native', provider: 'wechat', actionType: 'display_qr' },
        { id: 'alipay_pc_web', provider: 'alipay', actionType: 'open_url' },
      ],
      enabled: true,
    }] })
    expect(requests[0]?.url).toBe('https://auth.example.test/api/v1/managed-ai/products/query')
    await expect(requests[0]?.json()).resolves.toEqual({})
  })

  it('creates an Alipay web order with the backend idempotency contract', async () => {
    const requests: Request[] = []
    const service = createService(undefined, async (input, init) => {
      requests.push(new Request(input, init))
      return new Response(JSON.stringify({
        code: 200,
        message: '请求成功',
        data: {
          order_uid: '755a40f2-b5a5-420f-a7c5-1e4543cf016c',
          status: 'pending_payment',
          payment_provider: 'alipay',
          payment_method: 'alipay_pc_web',
          payment_action: {
            type: 'open_url',
            url: 'https://openapi.alipay.com/gateway.do?order=example',
          },
          currency: 'CNY',
          price_cent: 1,
          credit_nano_cny: '10000000',
          expires_at: '2026-08-20T12:05:00Z',
          poll_interval_ms: 1000,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const clientRequestId = '8e37aebc-e2ba-4db2-b589-da729867410c'

    await expect(service.createBillingOrder({
      productId: 'ai-test-cent', paymentMethod: 'alipay_pc_web', clientRequestId,
    })).resolves.toEqual({
      orderId: '755a40f2-b5a5-420f-a7c5-1e4543cf016c',
      paymentProvider: 'alipay',
      paymentMethod: 'alipay_pc_web',
      status: 'pending',
      amountMinor: 1,
      currency: 'CNY',
      creditNanoCny: '10000000',
      expiresAtMillis: Date.parse('2026-08-20T12:05:00Z'),
      paymentAction: {
        type: 'open_url',
        url: 'https://openapi.alipay.com/gateway.do?order=example',
      },
      pollIntervalMillis: 1000,
    })
    await expect(requests[0]?.json()).resolves.toEqual({
      client_order_uid: clientRequestId,
      product_code: 'ai-test-cent',
      payment_method: 'alipay_pc_web',
    })
  })

  it('maps a WeChat Native order to an in-app QR action', async () => {
    const service = createService(undefined, async () => new Response(JSON.stringify({
      code: 200,
      message: '请求成功',
      data: {
        order_uid: '755a40f2-b5a5-420f-a7c5-1e4543cf016c',
        status: 'pending_payment',
        payment_provider: 'wechat',
        payment_method: 'wechat_native',
        payment_action: { type: 'display_qr', qr_code_content: 'weixin://wxpay/example' },
        currency: 'CNY',
        price_cent: 1,
        credit_nano_cny: '10000000',
        expires_at: '2026-08-20T12:05:00Z',
        poll_interval_ms: 1000,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(service.createBillingOrder({
      productId: 'ai-test-cent',
      paymentMethod: 'wechat_native',
      clientRequestId: '8e37aebc-e2ba-4db2-b589-da729867410c',
    })).resolves.toMatchObject({
      paymentProvider: 'wechat',
      paymentMethod: 'wechat_native',
      paymentAction: { type: 'display_qr', qrContent: 'weixin://wxpay/example' },
    })
  })

  it('keeps polling when a paid order is still crediting', async () => {
    const service = createService(undefined, async () => new Response(JSON.stringify({
      code: 200,
      message: '请求成功',
      data: {
        order_uid: '755a40f2-b5a5-420f-a7c5-1e4543cf016c',
        status: 'crediting',
        payment_provider: 'wechat',
        payment_method: 'wechat_native',
        currency: 'CNY',
        price_cent: 1,
        credit_nano_cny: '1',
        expires_at: '2026-08-20T12:05:00Z',
        paid_at: '2026-08-20T12:04:00Z',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(service.billingOrderStatus('755a40f2-b5a5-420f-a7c5-1e4543cf016c')).resolves.toEqual({
      orderId: '755a40f2-b5a5-420f-a7c5-1e4543cf016c',
      paymentProvider: 'wechat',
      paymentMethod: 'wechat_native',
      status: 'crediting',
      amountMinor: 1,
      currency: 'CNY',
      creditNanoCny: '1',
      expiresAtMillis: Date.parse('2026-08-20T12:05:00Z'),
      paidAtMillis: Date.parse('2026-08-20T12:04:00Z'),
    })
  })

  it('refreshes an access token rejected inside a successful HTTP envelope', async () => {
    let stored = session
    const requests: Request[] = []
    const service = createService(undefined, async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.url.endsWith('/api/public/v1/auth/new-short')) {
        return new Response(JSON.stringify({ code: 200, data: { access_token: 'fresh-access-token' } }), { status: 200 })
      }
      if (request.headers.get('Authorization') === 'Bearer access-token') {
        return new Response(JSON.stringify({
          code: 1000,
          message: '登录已失效',
          data: { error_code: 'invalid_access_token' },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 200, data: { currency: 'CNY', products: [] } }), { status: 200 })
    }, {
      read: async () => stored,
      write: async value => { stored = value },
      delete: async () => undefined,
    })

    await expect(service.billingProducts()).resolves.toEqual({ items: [] })
    expect(requests.map(request => request.url)).toEqual([
      'https://auth.example.test/api/v1/managed-ai/products/query',
      'https://auth.example.test/api/public/v1/auth/new-short',
      'https://auth.example.test/api/v1/managed-ai/products/query',
    ])
    expect(requests[2]?.headers.get('Authorization')).toBe('Bearer fresh-access-token')
  })

  it('preserves retryable order-processing errors for the same checkout attempt', async () => {
    const service = createService(undefined, async () => new Response(JSON.stringify({
      code: 1002,
      message: '服务繁忙',
      data: { error_code: 'order_processing' },
    }), { status: 200 }))

    await expect(service.createBillingOrder({
      productId: 'ai-test-cent',
      paymentMethod: 'wechat_native',
      clientRequestId: '8e37aebc-e2ba-4db2-b589-da729867410c',
    })).rejects.toMatchObject({ code: 'order_processing', retryable: true })
  })

  it('reports malformed server order identifiers as a retryable upstream contract failure', async () => {
    const service = createService(undefined, async () => new Response(JSON.stringify({
      code: 200,
      data: {
        order_uid: 'not-a-uuid',
        status: 'pending_payment',
        payment_provider: 'wechat',
        payment_method: 'wechat_native',
        payment_action: { type: 'display_qr', qr_code_content: 'weixin://wxpay/example' },
        currency: 'CNY',
        price_cent: 1,
        credit_nano_cny: '1',
        expires_at: '2026-08-20T12:05:00Z',
        poll_interval_ms: 1000,
      },
    }), { status: 200 }))

    await expect(service.createBillingOrder({
      productId: 'ai-test-cent',
      paymentMethod: 'wechat_native',
      clientRequestId: '8e37aebc-e2ba-4db2-b589-da729867410c',
    })).rejects.toMatchObject({ code: 'billing-contract-invalid', retryable: true, httpStatus: 502 })
  })

  it('exposes only normalized gateway snapshots through the Arkme service', async () => {
    const quota = { availableNanoCny: '1200', reservedNanoCny: '300', totalNanoCny: '1500', currency: 'CNY' as const }
    const products = { items: [{
      productId: 'product-1', title: 'AI 余额 ¥1', creditNanoCny: '1000000000',
      priceMinor: 600, currency: 'CNY' as const, paymentMethods: [
        { id: 'alipay_pc_web' as const, provider: 'alipay' as const, actionType: 'open_url' as const },
        { id: 'wechat_native' as const, provider: 'wechat' as const, actionType: 'display_qr' as const },
      ], enabled: true,
    }] }
    const order = {
      orderId: 'order-1', paymentProvider: 'alipay' as const, paymentMethod: 'alipay_pc_web' as const,
      status: 'pending' as const, amountMinor: 600, currency: 'CNY' as const,
      creditNanoCny: '1000000000',
      expiresAtMillis: 2_000_000_000_000,
      paymentAction: { type: 'open_url' as const, url: 'https://pay.example.test/order-1' },
    }
    const service = createService({
      quota: async () => quota,
      products: async () => products,
      createOrder: async () => order,
      orderStatus: async () => ({ ...order, status: 'paid' as const }),
    }) as ArkmeService & Record<string, (...args: never[]) => Promise<unknown>>

    await expect(service.billingQuota()).resolves.toEqual(quota)
    await expect(service.billingProducts()).resolves.toEqual(products)
    await expect(service.createBillingOrder({
      productId: 'product-1', paymentMethod: 'alipay_pc_web', clientRequestId: 'request-1',
    } as never)).resolves.toEqual(order)
    await expect(service.billingOrderStatus('order-1' as never)).resolves.toEqual({ ...order, status: 'paid' })
  })
})
