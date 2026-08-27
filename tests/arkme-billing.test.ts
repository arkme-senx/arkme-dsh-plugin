import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.useRealTimers() })

describe('Arkme billing client state', () => {
  it('selects the first enabled product and honors its advertised payment methods', async () => {
    const billing = await import('../src/client/arkme-billing.js')
    const products = [
      { productId: 'disabled', enabled: false, paymentMethods: [
        { id: 'alipay_pc_web', provider: 'alipay', actionType: 'open_url' },
      ] },
      { productId: 'enabled', enabled: true, paymentMethods: [
        { id: 'wechat_native', provider: 'wechat', actionType: 'display_qr' },
      ] },
    ] as never

    const selected = billing.selectDefaultBillingProduct(products)

    expect(selected).toMatchObject({ productId: 'enabled' })
    expect(billing.billingPaymentAvailable(selected, 'wechat_native')).toBe(true)
    expect(billing.billingPaymentAvailable(selected, 'alipay_pc_web')).toBe(false)
  })

  it('reuses an idempotency key only while retrying the same checkout selection', async () => {
    const billing = await import('../src/client/arkme-billing.js')
    let sequence = 0
    const createId = () => `request-${String(++sequence)}`

    const first = billing.checkoutAttempt(undefined, 'product-1', 'alipay_pc_web', createId)
    const retry = billing.checkoutAttempt(first, 'product-1', 'alipay_pc_web', createId)
    const changedMethod = billing.checkoutAttempt(retry, 'product-1', 'wechat_native', createId)

    expect(first.clientRequestId).toBe('request-1')
    expect(retry).toBe(first)
    expect(changedMethod.clientRequestId).toBe('request-2')
  })

  it('releases the checkout idempotency key after an order reaches a terminal state', async () => {
    const billing = await import('../src/client/arkme-billing.js')
    const attempt = { productId: 'product-1', paymentMethod: 'alipay_pc_web', clientRequestId: 'request-1' } as const

    expect(billing.checkoutAttemptAfterOrder(attempt, 'pending')).toBe(attempt)
    expect(billing.checkoutAttemptAfterOrder(attempt, 'crediting')).toBe(attempt)
    expect(billing.checkoutAttemptAfterOrder(attempt, 'paid')).toBeUndefined()
    expect(billing.checkoutAttemptAfterOrder(attempt, 'closed')).toBeUndefined()
  })

  it('generates a standard UUID v4 without falling back to timestamp identifiers', async () => {
    const billing = await import('../src/client/arkme-billing.js')
    const generated = billing.createBillingClientRequestId({
      getRandomValues: (target: Uint8Array) => {
        target.fill(0)
        return target
      },
    } as never)

    expect(generated).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('treats a pending order as expired at the server deadline and renders a WeChat QR data URL', async () => {
    const billing = await import('../src/client/arkme-billing.js')
    const order = {
      status: 'pending', expiresAtMillis: 5_000,
      paymentAction: { type: 'display_qr', qrContent: 'weixin://wxpay/order-1' },
    } as never

    expect(billing.billingOrderScreen(order, 4_999)).toBe('pending')
    expect(billing.billingOrderScreen(order, 5_000)).toBe('expired')
    expect(billing.billingOrderScreen({ status: 'crediting', expiresAtMillis: 5_000 }, 6_000)).toBe('crediting')
    expect(billing.billingQrDataUrl(order.paymentAction.qrContent)).toMatch(/^data:image\/gif;base64,/)
  })

  it('opens only open-url payment actions in the external browser', async () => {
    const billing = await import('../src/client/arkme-billing.js')
    const opened: string[] = []

    expect(billing.activateBillingPaymentAction(
      { type: 'open_url', url: 'https://openapi.alipay.com/gateway.do?order=1' },
      url => { opened.push(url) },
    )).toBe(true)
    expect(billing.activateBillingPaymentAction(
      { type: 'display_qr', qrContent: 'weixin://wxpay/order-1' },
      url => { opened.push(url) },
    )).toBe(false)
    expect(opened).toEqual(['https://openapi.alipay.com/gateway.do?order=1'])
  })

  it('retries order-processing with the exact same checkout attempt', async () => {
    const billing = await import('../src/client/arkme-billing.js')
    const attempt = {
      productId: 'product-1', paymentMethod: 'alipay_pc_web',
      clientRequestId: '8e37aebc-e2ba-4db2-b589-da729867410c',
    } as const
    const seen: unknown[] = []
    const waits: number[] = []

    const result = await billing.createBillingOrderWithProcessingRetry(
      attempt,
      async input => {
        seen.push(input)
        if (seen.length === 1) throw { body: { code: 'order_processing' } }
        return { orderId: 'order-1' }
      },
      async millis => { waits.push(millis) },
    )

    expect(result).toEqual({ orderId: 'order-1' })
    expect(seen).toEqual([attempt, attempt])
    expect(waits).toEqual([500])
  })

  it('polls every two seconds until payment succeeds, then stops', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const billing = await import('../src/client/arkme-billing.js')
    let reads = 0
    const statuses: string[] = []
    const poller = new billing.ArkmeBillingOrderPoller({
      readStatus: async () => ({ status: ++reads === 1 ? 'pending' : 'paid' } as never),
      onUpdate: order => { statuses.push(order.status) },
      onError: error => { throw error },
    })

    poller.start('order-1', 20_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(statuses).toEqual(['pending', 'paid'])
    expect(reads).toBe(2)
  })

  it('uses the server interval and keeps polling a crediting order beyond QR expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)
    const billing = await import('../src/client/arkme-billing.js')
    let reads = 0
    const statuses: string[] = []
    const poller = new billing.ArkmeBillingOrderPoller({
      readStatus: async () => ({ status: ++reads === 1 ? 'crediting' : 'paid' } as never),
      onUpdate: order => { statuses.push(order.status) },
      onError: error => { throw error },
    })

    poller.start('order-1', 1_500, 1_000, 'crediting')
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(statuses).toEqual(['crediting', 'paid'])
    expect(reads).toBe(2)
  })

  it('preserves the order for manual retry after a status query failure', async () => {
    vi.useFakeTimers()
    const billing = await import('../src/client/arkme-billing.js')
    let reads = 0
    const errors: string[] = []
    const poller = new billing.ArkmeBillingOrderPoller({
      readStatus: async () => { reads += 1; throw new Error('查询失败') },
      onUpdate: () => { throw new Error('unexpected update') },
      onError: error => { errors.push(error instanceof Error ? error.message : String(error)) },
    })

    poller.start('order-1', Date.now() + 20_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(errors).toEqual(['查询失败'])
    expect(reads).toBe(1)
  })

  it('cancels scheduled polling when the payment dialog closes', async () => {
    vi.useFakeTimers()
    const billing = await import('../src/client/arkme-billing.js')
    let reads = 0
    const poller = new billing.ArkmeBillingOrderPoller({
      readStatus: async () => { reads += 1; return { status: 'pending' } as never },
      onUpdate: () => undefined,
      onError: () => undefined,
    })

    poller.start('order-1', Date.now() + 20_000)
    poller.stop()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(reads).toBe(0)
  })
})
