import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

import { ArkmeBillingSettings } from '../src/client/ArkmeBillingSettings.js'

const quota = {
  availableNanoCny: '10000000000', totalNanoCny: '10000000000', reservedNanoCny: '0', currency: 'CNY',
} as const
const products = {
  items: [{
    productId: '10', title: 'AI 余额 ¥10', creditNanoCny: '10000000000', priceMinor: 1_000,
    currency: 'CNY', enabled: true, paymentMethods: [
      { id: 'alipay_pc_web', provider: 'alipay', actionType: 'open_url' },
    ],
  }],
}

function nodeText(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : nodeText(child)).join('')
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const result = renderer.root.findAllByType('button').find(item => nodeText(item) === label)
  if (result === undefined) throw new Error('button not found: ' + label)
  return result
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>(next => { resolve = next }), resolve }
}

describe('Arkme billing payment feedback flow', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.callArkme.mockReset()
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    renderer = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retains paid feedback until completion even when the balance refresh fails', async () => {
    let quotaCalls = 0
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'billing.quota') {
        quotaCalls += 1
        if (quotaCalls === 3) throw new Error('余额网络中断')
        return quota
      }
      if (operation === 'billing.products') return products
      if (operation === 'billing.order.create') return {
        orderId: 'order-91cd', status: 'paid', paymentMethod: 'alipay_pc_web',
        amountMinor: 1_000, currency: 'CNY', expiresAtMillis: Date.now() + 300_000, pollIntervalMillis: 1_000,
      }
      throw new Error('unexpected operation: ' + operation)
    })

    await act(async () => {
      renderer = create(<ArkmeBillingSettings />)
      await flush()
    })
    await act(async () => {
      button(renderer!, '充值').props.onClick()
      await flush()
    })
    await act(async () => {
      button(renderer!, '支付宝网页支付').props.onClick()
      await flush()
    })

    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
    expect(nodeText(renderer!.root)).toContain('¥10.00 已到账')
    expect(nodeText(renderer!.root)).toContain('余额暂未刷新：余额网络中断')
    expect(nodeText(renderer!.root)).toContain('完成')

    await act(async () => { button(renderer!, '完成').props.onClick(); await flush() })
    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  })

  it('queries immediately when the window regains focus or becomes visible', async () => {
    const windowListeners = new Map<string, () => void>()
    const documentListeners = new Map<string, () => void>()
    vi.stubGlobal('window', {
      open: vi.fn(),
      addEventListener: (type: string, listener: () => void) => { windowListeners.set(type, listener) },
      removeEventListener: (type: string) => { windowListeners.delete(type) },
    })
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      activeElement: null,
      addEventListener: (type: string, listener: () => void) => { documentListeners.set(type, listener) },
      removeEventListener: (type: string) => { documentListeners.delete(type) },
    })
    let statusCalls = 0
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'billing.quota') return quota
      if (operation === 'billing.products') return products
      if (operation === 'billing.order.create') return {
        orderId: 'order-91cd', status: 'pending', paymentMethod: 'alipay_pc_web',
        amountMinor: 1_000, currency: 'CNY', expiresAtMillis: Date.now() + 300_000, pollIntervalMillis: 1_000,
      }
      if (operation === 'billing.order.status') {
        statusCalls += 1
        return {
          orderId: 'order-91cd', status: 'crediting', paymentMethod: 'alipay_pc_web',
          amountMinor: 1_000, currency: 'CNY', expiresAtMillis: Date.now() + 300_000, pollIntervalMillis: 1_000,
        }
      }
      throw new Error('unexpected operation: ' + operation)
    })

    await act(async () => { renderer = create(<ArkmeBillingSettings />); await flush() })
    await act(async () => { button(renderer!, '充值').props.onClick(); await flush() })
    await act(async () => { button(renderer!, '支付宝网页支付').props.onClick(); await flush() })
    expect(statusCalls).toBe(0)

    await act(async () => { windowListeners.get('focus')?.(); await flush() })
    expect(statusCalls).toBe(1)
    await act(async () => { documentListeners.get('visibilitychange')?.(); await flush() })
    expect(statusCalls).toBe(2)
  })

  it('keeps the latest post-payment balance when an older refresh finishes later', async () => {
    const beforePayment = deferred<typeof quota>()
    const afterPayment = deferred<typeof quota>()
    const refreshedQuota = {
      availableNanoCny: '20000000000', totalNanoCny: '20000000000', reservedNanoCny: '0', currency: 'CNY',
    } as const
    let quotaCalls = 0
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'billing.quota') {
        quotaCalls += 1
        if (quotaCalls === 1) return quota
        if (quotaCalls === 2) return await beforePayment.promise
        return await afterPayment.promise
      }
      if (operation === 'billing.products') return products
      if (operation === 'billing.order.create') return {
        orderId: 'order-91cd', status: 'paid', paymentMethod: 'alipay_pc_web',
        amountMinor: 1_000, currency: 'CNY', expiresAtMillis: Date.now() + 300_000, pollIntervalMillis: 1_000,
      }
      throw new Error('unexpected operation: ' + operation)
    })

    await act(async () => { renderer = create(<ArkmeBillingSettings />); await flush() })
    await act(async () => { button(renderer!, '充值').props.onClick(); await flush() })
    await act(async () => { button(renderer!, '支付宝网页支付').props.onClick(); await flush() })
    expect(quotaCalls).toBe(3)

    await act(async () => { afterPayment.resolve(refreshedQuota); await flush() })
    expect(nodeText(renderer!.root)).toContain('当前余额已刷新：¥20.00')
    await act(async () => { beforePayment.resolve(quota); await flush() })
    expect(nodeText(renderer!.root)).toContain('当前余额已刷新：¥20.00')
    expect(nodeText(renderer!.root)).not.toContain('当前余额已刷新：¥10.00')
  })

  it('manually retries a non-retryable polling failure immediately', async () => {
    vi.stubGlobal('window', { open: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('document', {
      visibilityState: 'visible', activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })
    let statusCalls = 0
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'billing.quota') return quota
      if (operation === 'billing.products') return products
      if (operation === 'billing.order.create') return {
        orderId: 'order-91cd', status: 'pending', paymentMethod: 'alipay_pc_web',
        amountMinor: 1_000, currency: 'CNY', expiresAtMillis: Date.now() + 300_000, pollIntervalMillis: 1_000,
      }
      if (operation === 'billing.order.status') {
        statusCalls += 1
        if (statusCalls === 1) throw { body: { message: '订单状态无效', retryable: false } }
        return {
          orderId: 'order-91cd', status: 'crediting', paymentMethod: 'alipay_pc_web',
          amountMinor: 1_000, currency: 'CNY', expiresAtMillis: Date.now() + 300_000, pollIntervalMillis: 1_000,
        }
      }
      throw new Error('unexpected operation: ' + operation)
    })

    await act(async () => { renderer = create(<ArkmeBillingSettings />); await flush() })
    await act(async () => { button(renderer!, '充值').props.onClick(); await flush() })
    await act(async () => { button(renderer!, '支付宝网页支付').props.onClick(); await flush() })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); await flush() })
    expect(statusCalls).toBe(1)

    await act(async () => { button(renderer!, '立即重试').props.onClick(); await flush() })
    expect(statusCalls).toBe(2)
    expect(nodeText(renderer!.root)).toContain('支付已确认，无需重复支付')
  })
})
