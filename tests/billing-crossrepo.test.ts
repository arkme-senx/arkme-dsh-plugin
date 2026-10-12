import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'

// Opt-in fixture from frontend/test/e2e/mobile_ai_purchase/run.py.
// Uses the production plugin gateway, real Backend HTTP and Intelligent wallet.
const ready = process.env.MOBILE_PURCHASE_BACKEND_READY
it.skipIf(!ready)('desktop purchases and mobile purchases use the same durable wallet', async () => {
  const backend = JSON.parse(readFileSync(ready!, 'utf8')) as Record<string, string>
  const wallet = JSON.parse(readFileSync(process.env.MOBILE_PURCHASE_WALLET_READY!, 'utf8')) as Record<string, string>
  for (const source of [backend, wallet]) expect(new URL(source.url!).hostname).toBe('127.0.0.1')
  const config: ArkmeServiceConfig = {
    environment: 'test', authBaseUrl: backend.url!, intelligentBaseUrl: wallet.url!,
    subjectBaseUrl: backend.url!, recordBaseUrl: backend.url!, chatBaseUrl: backend.url!,
    botBaseUrl: backend.url!, imBaseUrl: backend.url!, webrtcBaseUrl: backend.url!,
    worldBaseUrl: backend.url!, relationBaseUrl: backend.url!, audioBaseUrl: backend.url!,
    routePath: '/arkme', requestTimeoutMs: 5000, maxTextLength: 5000,
    geetestCaptchaId: 'unused', interwovenMomentsEnabled: false,
  }
  const service = new ArkmeService(config, {
    read: async () => ({ userId: 42, accessToken: backend.token42!, refreshToken: 'unused' }),
    write: async () => undefined, delete: async () => undefined,
  }, {} as never, async (input, init) => {
    // The two isolated service fixtures deliberately use separate JWT secrets.
    const request = new Request(input, init)
    if (new URL(request.url).origin === wallet.url) {
      request.headers.set('Authorization', 'Bearer ' + wallet.token42)
    }
    return fetch(request)
  })
  expect((await service.billingQuota()).availableNanoCny).toBe('0')
  const products = await service.billingProducts()
  expect(products.items).toHaveLength(1)
  const product = products.items[0]!
  expect(product.paymentMethods.map(m => m.id).sort()).toEqual(['alipay_pc_web', 'wechat_native'])
  expect(product.creditNanoCny).toBe('10000000000')
  for (const [index, paymentMethod] of (['wechat_native', 'alipay_pc_web'] as const).entries()) {
    const input = { productId: product.productId, paymentMethod, clientRequestId: randomUUID() }
    const order = await service.createBillingOrder(input)
    expect(order.status).toBe('pending')
    expect(order.paymentMethod).toBe(paymentMethod)
    expect((await service.createBillingOrder(input)).orderId).toBe(order.orderId)
    const cash = () => fetch(backend.url + '/__test/cash', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_uid: order.orderId }),
    })
    expect((await cash()).status).toBe(200)
    expect((await cash()).status).toBe(200)
    const paid = await service.billingOrderStatus(order.orderId)
    expect(paid.status).toBe('paid')
    expect(paid.creditNanoCny).toBe(product.creditNanoCny)
    expect((await service.billingQuota()).availableNanoCny).toBe(String(BigInt(index + 1) * 10000000000n))
  }
}, 30_000)
