import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ArkmeBalanceSettingsRowView,
  ArkmeRechargeDialogView,
} from '../src/client/ArkmeBillingSettings.js'
import type { ArkmeBillingProduct } from '../src/types.js'

const noop = () => undefined

const products: ArkmeBillingProduct[] = [
  {
    productId: '10', title: 'AI 余额 ¥10', creditNanoCny: '10000000000', priceMinor: 1_000,
    currency: 'CNY', enabled: true, paymentMethods: [
      { id: 'alipay_pc_web', provider: 'alipay', actionType: 'open_url' },
      { id: 'wechat_native', provider: 'wechat', actionType: 'display_qr' },
    ],
  },
  {
    productId: '50', title: 'AI 余额 ¥50', creditNanoCny: '50000000000', priceMinor: 5_000,
    currency: 'CNY', enabled: true, paymentMethods: [],
  },
  {
    productId: '100', title: 'AI 余额 ¥100', creditNanoCny: '100000000000', priceMinor: 10_000,
    currency: 'CNY', enabled: true, paymentMethods: [],
  },
  {
    productId: 'test', title: 'AI 余额支付测试', creditNanoCny: '1', priceMinor: 1,
    currency: 'CNY', enabled: true, paymentMethods: [],
  },
]

describe('Arkme billing settings migration', () => {
  it('places the balance below its title and the recharge control before the disclosure arrow', () => {
    const markup = renderToStaticMarkup(<ArkmeBalanceSettingsRowView
      quotaState={{ kind: 'ready', quota: {
        availableNanoCny: '12801736510', totalNanoCny: '12801736510', reservedNanoCny: '0', currency: 'CNY',
      } }}
      onOpen={noop}
    />)

    expect(markup).toMatch(/当前余量[\s\S]*¥12\.80[\s\S]*>充值<\/button>[\s\S]*<svg/)
    expect(markup).not.toContain('总余额')
    expect(markup).not.toContain('已预占')
  })

  it('renders a compact wrapping recharge dialog with platform icons and no horizontal scrolling', () => {
    const markup = renderToStaticMarkup(<ArkmeRechargeDialogView
      quotaState={{ kind: 'ready', quota: {
        availableNanoCny: '12801736510', totalNanoCny: '12801736510', reservedNanoCny: '0', currency: 'CNY',
      } }}
      productsState={{ kind: 'ready', products }}
      selectedProductId="10"
      creatingMethod={undefined}
      purchaseError=""
      onClose={noop}
      onRefreshQuota={noop}
      onRetryProducts={noop}
      onSelectProduct={noop}
      onPurchase={noop}
    />)

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-label="余额充值"')
    expect(markup).toMatch(/display:grid/)
    expect(markup).not.toMatch(/overflow-x:/)
    expect(markup).toMatch(/AI 余额 ¥10[\s\S]*AI 余额 ¥50[\s\S]*AI 余额 ¥100[\s\S]*AI 余额支付测试/)
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*支付宝网页支付/)
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*微信扫码支付/)
    expect(markup).toContain('aria-label="关闭充值弹窗"')
  })
})
