import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ArkmePaymentDialog,
  ArkmeSettingsSectionView,
  arkmeSettingsTitle,
  formatArkmeBillingPrice,
  formatArkmeNanoCny,
  performArkmeLogout,
} from '../src/client/ArkmeSettingsSection.js'
import type { ArkmeBillingOrderSnapshot, ArkmeBillingProduct } from '../src/types.js'

const products: ArkmeBillingProduct[] = [
  {
    productId: 'small', title: '轻量包', creditNanoCny: '1000000000',
    priceMinor: 990, currency: 'CNY', paymentMethods: [
      { id: 'alipay_pc_web', provider: 'alipay', actionType: 'open_url' },
    ], enabled: true,
  },
  {
    productId: 'large', title: '畅享包', creditNanoCny: '10000000000',
    priceMinor: 5_000, currency: 'CNY', paymentMethods: [
      { id: 'wechat_native', provider: 'wechat', actionType: 'display_qr' },
    ], enabled: true,
  },
]

const noop = () => undefined

function renderSection(overrides: Partial<Parameters<typeof ArkmeSettingsSectionView>[0]> = {}): string {
  return renderToStaticMarkup(<ArkmeSettingsSectionView
    quotaState={{ kind: 'ready', quota: {
      availableNanoCny: '10000000000', totalNanoCny: '12000000000', reservedNanoCny: '2000000000', currency: 'CNY',
    } }}
    productsState={{ kind: 'ready', products }}
    selectedProductId="small"
    creatingMethod={undefined}
    installedVersion="0.1.10"
    clientVersion="0.1.0"
    harnessVersion="0.1.0-rc.8"
    authDescription="已登录"
    authenticated
    logoutBusy={false}
    notificationPermission="default"
    notificationBusy={false}
    onRefreshQuota={noop}
    onRetryProducts={noop}
    onSelectProduct={noop}
    onPurchase={noop}
    onEnableNotifications={noop}
    onLogout={noop}
    {...overrides}
  />)
}

describe('Arkme settings section', () => {
  it('groups the current quota and purchasing controls in one container', () => {
    const markup = renderSection()

    expect(markup).toMatch(
      /<section[^>]*aria-label="Arkme 余量与购买"[^>]*>[\s\S]*当前余量[\s\S]*购买余量[\s\S]*<\/section>/,
    )
  })

  it('renders the quota, products, migrated version, and logout action', () => {
    const markup = renderSection()

    expect(markup).toContain('当前余量')
    expect(markup).toContain('¥10.00')
    expect(markup).not.toContain('可用')
    expect(markup).not.toContain('总余额')
    expect(markup).not.toContain('已预占')
    expect(markup).toContain('购买余量')
    expect(markup).toContain('轻量包')
    expect(markup).toContain('畅享包')
    expect(markup).not.toContain('到账')
    expect(markup).toContain('¥9.90')
    expect(markup).toContain('版本信息')
    expect(markup).toContain('Arkme 插件')
    expect(markup).toContain('v0.1.10')
    expect(markup).toContain('客户端')
    expect(markup).toContain('v0.1.0')
    expect(markup).toContain('DeepSeek Harness')
    expect(markup).toContain('v0.1.0-rc.8')
    expect(markup).toMatch(/客户端[\s\S]*Arkme 插件[\s\S]*DeepSeek Harness/)
    expect(markup).not.toContain('已登录')
    expect(markup).toContain('退出登录')
  })

  it('keeps the latest desktop notification control inside the Arkme tab', () => {
    const markup = renderSection()

    expect(markup).toMatch(/版本信息[\s\S]*桌面通知[\s\S]*未开启[\s\S]*开启桌面通知/)
    expect(markup).not.toContain('settings.general.item')
  })

  it('gives each failed region an independent retry', () => {
    const failed = renderSection({
      quotaState: { kind: 'error', message: '购买服务暂不可用' },
      productsState: { kind: 'error', message: '购买服务暂不可用' },
    })

    expect(failed.match(/购买服务暂不可用/g)).toHaveLength(2)
    expect(failed.match(/重试/g)).toHaveLength(2)
  })

  it('renders loading and empty product states without inventing packages', () => {
    const loading = renderSection({
      quotaState: { kind: 'loading' },
      productsState: { kind: 'loading' },
    })
    const empty = renderSection({
      productsState: { kind: 'ready', products: [] },
      selectedProductId: undefined,
    })

    expect(loading).toContain('aria-busy="true"')
    expect(loading).toContain('正在加载余量')
    expect(loading).toContain('正在加载购买套餐')
    expect(empty).toContain('暂无可购买套餐')
    expect(empty).not.toContain('轻量包')
  })

  it('renders only payment methods declared by the selected product', () => {
    const alipay = renderSection()
    const wechat = renderSection({ selectedProductId: 'large' })

    expect(alipay).toMatch(/<button[^>]*>[\s\S]*<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*支付宝网页支付<\/button>/)
    expect(alipay).not.toContain('微信扫码支付')
    expect(wechat).not.toContain('支付宝网页支付')
    expect(wechat).toMatch(/<button[^>]*>[\s\S]*<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*微信扫码支付<\/button>/)
  })

  it('lays out enabled packages in a compact wrapping grid without horizontal scrolling', () => {
    const markup = renderSection()

    expect(markup).toMatch(/role="radiogroup"[^>]*aria-label="购买套餐"[^>]*aria-orientation="horizontal"/)
    expect(markup).toMatch(/display:grid/)
    expect(markup).toMatch(/grid-template-columns:repeat\(auto-fit,\s*minmax\(128px,\s*1fr\)\)/)
    expect(markup).not.toMatch(/overflow-x:/)
    expect(markup).toMatch(/轻量包[\s\S]*畅享包/)
  })

  it('formats all displayed CNY amounts to exactly two decimal places', () => {
    expect(formatArkmeBillingPrice(990, 'CNY')).toBe('¥9.90')
    expect(formatArkmeBillingPrice(5_000, 'CNY')).toBe('¥50.00')
    expect(formatArkmeNanoCny('1')).toBe('¥0.00')
    expect(formatArkmeNanoCny('5000000')).toBe('¥0.01')
    expect(formatArkmeNanoCny('10000000000')).toBe('¥10.00')
    expect(formatArkmeNanoCny('12801736510')).toBe('¥12.80')
    expect(formatArkmeNanoCny('9007199254740993000')).toBe('¥9,007,199,254.74')
    expect(arkmeSettingsTitle(undefined)).toBe('Arkme v…')
  })

  it('closes settings before publishing logout state and opening the auth gate', async () => {
    const events: string[] = []
    const snapshot = { status: 'logged-out', environment: 'prod' } as const

    await performArkmeLogout({
      requestLogout: async () => snapshot,
      closeSettings: () => { events.push('close') },
      publishAuth: value => { expect(value).toBe(snapshot); events.push('auth') },
      clearNavigation: () => { events.push('navigation') },
      notifyAuthChanged: authenticated => { expect(authenticated).toBe(false); events.push('gate') },
    })

    expect(events).toEqual(['close', 'auth', 'navigation', 'gate'])
  })
})

describe('Arkme payment dialog', () => {
  const pending: ArkmeBillingOrderSnapshot = {
    orderId: 'order-1', paymentProvider: 'alipay', paymentMethod: 'alipay_pc_web',
    status: 'pending', amountMinor: 990, currency: 'CNY', creditNanoCny: '1000000000',
    expiresAtMillis: new Date('2026-08-20T12:05:00Z').getTime(),
    paymentAction: { type: 'open_url', url: 'https://openapi.alipay.com/gateway.do?order=1' },
  }

  it('renders an accessible Alipay browser dialog without turning its page URL into a QR code', () => {
    const markup = renderToStaticMarkup(<ArkmePaymentDialog
      order={pending}
      nowMillis={new Date('2026-08-20T12:04:00Z').getTime()}
      statusError=""
      onClose={noop}
      onRetryStatus={noop}
      onRegenerate={noop}
      onOpenPaymentUrl={noop}
    />)

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('支付宝支付')
    expect(markup).toContain('已在系统浏览器打开支付宝收银台')
    expect(markup).toContain('重新打开支付页面')
    expect(markup).toContain('支付金额 ¥9.90')
    expect(markup).not.toContain('data:image/gif;base64,')
    expect(markup).toContain('订单号：order-1')
    expect(markup).toContain('剩余 01:00')
    expect(markup).toContain('aria-label="关闭支付弹窗"')
    expect(markup).not.toContain('data-dismiss="backdrop"')
  })

  it('preserves the order after a status error and offers query retry without another order', () => {
    const markup = renderToStaticMarkup(<ArkmePaymentDialog
      order={pending}
      nowMillis={pending.expiresAtMillis - 1_000}
      statusError="查询订单失败"
      onClose={noop}
      onRetryStatus={noop}
      onRegenerate={noop}
      onOpenPaymentUrl={noop}
    />)

    expect(markup).toContain('查询订单失败')
    expect(markup).toContain('订单号：order-1')
    expect(markup).toContain('重新查询')
    expect(markup).not.toContain('重新生成')
  })

  it('renders a WeChat Native QR and stops presenting it after expiry', () => {
    const wechatOrder: ArkmeBillingOrderSnapshot = {
      ...pending,
      paymentProvider: 'wechat',
      paymentMethod: 'wechat_native',
      paymentAction: { type: 'display_qr', qrContent: 'weixin://wxpay/order-1' },
    }
    const active = renderToStaticMarkup(<ArkmePaymentDialog
      order={wechatOrder}
      nowMillis={wechatOrder.expiresAtMillis - 1_000}
      statusError=""
      onClose={noop}
      onRetryStatus={noop}
      onRegenerate={noop}
      onOpenPaymentUrl={noop}
    />)
    const markup = renderToStaticMarkup(<ArkmePaymentDialog
      order={wechatOrder}
      nowMillis={wechatOrder.expiresAtMillis}
      statusError=""
      onClose={noop}
      onRetryStatus={noop}
      onRegenerate={noop}
      onOpenPaymentUrl={noop}
    />)

    expect(active).toContain('微信扫码支付')
    expect(active).toContain('data:image/gif;base64,')
    expect(markup).toContain('二维码已过期')
    expect(markup).toContain('重新生成')
    expect(markup).not.toContain('data:image/gif;base64,')
  })

  it('hides the QR and presents a non-payment action while credit is being delivered', () => {
    const markup = renderToStaticMarkup(<ArkmePaymentDialog
      order={{ ...pending, status: 'crediting', paymentAction: undefined }}
      nowMillis={pending.expiresAtMillis + 60_000}
      statusError=""
      onClose={noop}
      onRetryStatus={noop}
      onRegenerate={noop}
      onOpenPaymentUrl={noop}
    />)

    expect(markup).toContain('支付已确认，余额到账中')
    expect(markup).toContain('>关闭</button>')
    expect(markup).not.toContain('取消支付')
    expect(markup).not.toContain('data:image/gif;base64,')
  })
})
