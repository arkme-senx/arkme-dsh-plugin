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
  it('shows available and reserved balances with an accessible reservation explanation', () => {
    const markup = renderToStaticMarkup(<ArkmeBalanceSettingsRowView
      quotaState={{ kind: 'ready', quota: {
        availableNanoCny: '12801736510', totalNanoCny: '13101736510', reservedNanoCny: '300000000', currency: 'CNY',
      } }}
      onOpen={noop}
    />)

    expect(markup).toMatch(/当前余额[\s\S]*¥12\.80[\s\S]*预占余额[\s\S]*¥0\.30[\s\S]*class="arkme-redesign-update-button arkme-redesign-recharge-trigger"[\s\S]*>充值<\/button>/)
    expect(markup).toContain('class="arkme-redesign-reserved-help" tabindex="0" aria-label="预占余额说明" aria-describedby="arkme-reserved-balance-tooltip">?</span>')
    expect(markup).toContain('id="arkme-reserved-balance-tooltip" role="tooltip">当前运行的任务预先占用的余额，任务完成后将返还剩余余额。</span>')
    expect(markup).toContain('>充值</button><span class="arkme-redesign-trailing-slot" aria-hidden="true"></span>')
    expect(markup).not.toContain('总余额')
  })

  it.each([
    ['zero reserved balance', { kind: 'ready', quota: {
      availableNanoCny: '12801736510', totalNanoCny: '12801736510', reservedNanoCny: '0', currency: 'CNY',
    } }],
    ['invalid reserved balance', { kind: 'ready', quota: {
      availableNanoCny: '12801736510', totalNanoCny: '12801736510', reservedNanoCny: 'invalid', currency: 'CNY',
    } }],
    ['loading balance', { kind: 'loading' }],
    ['failed balance', { kind: 'error', message: '读取失败' }],
  ] as const)('hides reservation details for %s', (_caseName, quotaState) => {
    const markup = renderToStaticMarkup(<ArkmeBalanceSettingsRowView quotaState={quotaState} onOpen={noop} />)

    expect(markup).toContain('arkme-redesign-balance-row is-without-reserved')
    expect(markup).not.toContain('预占余额')
    expect(markup).not.toContain('arkme-reserved-balance-tooltip')
    expect(markup).toMatch(/当前余额[\s\S]*class="arkme-redesign-update-button arkme-redesign-recharge-trigger"[\s\S]*>充值<\/button>/)
  })

  it('renders both available payment entries in the recharge dialog', () => {
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
    expect(markup).toContain('<span>当前余额</span>')
    expect(markup).toMatch(/display:grid/)
    expect(markup).not.toMatch(/overflow-x:/)
    expect(markup).toMatch(/AI 余额 ¥10[\s\S]*AI 余额 ¥50[\s\S]*AI 余额 ¥100[\s\S]*AI 余额支付测试/)
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*支付宝网页支付/)
    expect(markup).toMatch(/<svg[^>]*class="arkme-billing-platform-icon is-alipay"[^>]*viewBox="0 0 1024 1024"[^>]*>[\s\S]*<path[^>]*fill="#009FE8"/)
    expect(markup).toMatch(/<button type="button"><svg[^>]*class="arkme-billing-platform-icon is-alipay"[^>]*>[\s\S]*?<\/svg>支付宝网页支付<\/button>/)
    expect(markup).toMatch(/<button type="button"><svg[^>]*class="arkme-billing-platform-icon is-wechat"[^>]*>[\s\S]*?<\/svg>微信扫码支付<\/button>/)
    expect(markup).toContain('aria-label="关闭充值弹窗"')
  })

  it('disables payment entries not advertised by the selected product', () => {
    const markup = renderToStaticMarkup(<ArkmeRechargeDialogView
      quotaState={{ kind: 'ready', quota: {
        availableNanoCny: '12801736510', totalNanoCny: '12801736510', reservedNanoCny: '0', currency: 'CNY',
      } }}
      productsState={{ kind: 'ready', products }}
      selectedProductId="50"
      creatingMethod={undefined}
      purchaseError=""
      onClose={noop}
      onRefreshQuota={noop}
      onRetryProducts={noop}
      onSelectProduct={noop}
      onPurchase={noop}
    />)

    expect(markup).toMatch(/<button type="button" disabled=""><svg[^>]*class="arkme-billing-platform-icon is-alipay"[^>]*>[\s\S]*?<\/svg>支付宝网页支付<\/button>/)
    expect(markup).toMatch(/<button type="button" disabled=""><svg[^>]*class="arkme-billing-platform-icon is-wechat"[^>]*>[\s\S]*?<\/svg>微信扫码支付<\/button>/)
  })
})
