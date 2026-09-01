import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ArkmeBalanceSettingsRowView,
  ArkmePaymentDialog,
  ArkmeRechargeDialogView,
} from '../src/client/ArkmeBillingSettings.js'
import type { ArkmeBillingProduct } from '../src/types.js'

const noop = () => undefined

const pendingOrder = {
  orderId: 'order-91cd', status: 'pending', paymentMethod: 'alipay_pc_web',
  amountMinor: 1_000, currency: 'CNY', expiresAtMillis: 120_000, pollIntervalMillis: 1_000,
  paymentAction: { type: 'open_url', url: 'https://openapi.alipay.com/gateway.do?order=1' },
} as const

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

    expect(markup).toMatch(/AI 余额[\s\S]*¥12\.80[\s\S]*可用于在 DSH 会话中通过 Arkme 调用 AI 模型[\s\S]*预占余额[\s\S]*¥0\.30[\s\S]*class="arkme-redesign-update-button arkme-redesign-recharge-trigger"[\s\S]*>充值<\/button>/)
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
    expect(markup).toMatch(/AI 余额[\s\S]*可用于在 DSH 会话中通过 Arkme 调用 AI 模型[\s\S]*class="arkme-redesign-update-button arkme-redesign-recharge-trigger"[\s\S]*>充值<\/button>/)
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
    expect(markup).toContain('充值后可在 DSH 会话中通过 Arkme 调用 AI 模型')
    expect(markup).not.toContain('选择充值套餐和支付方式')
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

  it('uses accurate pending and crediting close semantics without claiming to cancel payment', () => {
    const pending = renderToStaticMarkup(<ArkmePaymentDialog
      order={pendingOrder as never}
      nowMillis={1_000}
      statusError=""
      statusRetryable={false}
      quotaState={{ kind: 'ready', quota: {
        availableNanoCny: '0', totalNanoCny: '0', reservedNanoCny: '0', currency: 'CNY',
      } }}
      onClose={noop}
      onRetryStatus={noop}
      onRegenerate={noop}
      onRefreshQuota={noop}
      onOpenPaymentUrl={noop}
    />)
    const crediting = renderToStaticMarkup(<ArkmePaymentDialog
      order={{ ...pendingOrder, status: 'crediting' } as never}
      nowMillis={130_000}
      statusError=""
      statusRetryable={false}
      quotaState={{ kind: 'loading' }}
      onClose={noop}
      onRetryStatus={noop}
      onRegenerate={noop}
      onRefreshQuota={noop}
      onOpenPaymentUrl={noop}
    />)

    expect(pending).toContain('<h2 id="arkme-payment-dialog-title">完成支付</h2>')
    expect(pending).toContain('完成支付后返回 Arkme，页面会自动确认结果。')
    expect(pending).toMatch(/稍后查看[\s\S]*重新打开支付页面/)
    expect(pending).not.toContain('取消支付')
    expect(crediting).toContain('支付已确认，无需重复支付')
    expect(crediting).toContain('稍后查看')
    expect(crediting).not.toContain('取消支付')
  })

  it('keeps a dynamic paid success state while balance refresh loads, succeeds, or fails', () => {
    const renderPaid = (quotaState: Parameters<typeof ArkmePaymentDialog>[0]['quotaState']) => renderToStaticMarkup(<ArkmePaymentDialog
      order={{ ...pendingOrder, status: 'paid', paymentAction: undefined } as never}
      nowMillis={1_000}
      statusError=""
      statusRetryable={false}
      quotaState={quotaState}
      onClose={noop}
      onRetryStatus={noop}
      onRegenerate={noop}
      onRefreshQuota={noop}
      onOpenPaymentUrl={noop}
    />)

    expect(renderPaid({ kind: 'loading' })).toMatch(/¥10\.00 已到账[\s\S]*正在刷新当前余额[\s\S]*>完成<\/button>/)
    expect(renderPaid({ kind: 'ready', quota: {
      availableNanoCny: '10000000000', totalNanoCny: '10000000000', reservedNanoCny: '0', currency: 'CNY',
    } })).toMatch(/¥10\.00 已到账[\s\S]*当前余额已刷新[\s\S]*¥10\.00/)
    expect(renderPaid({ kind: 'error', message: '网络中断' })).toMatch(/支付成功[\s\S]*¥10\.00 已到账[\s\S]*余额暂未刷新[\s\S]*>刷新余额<\/button>[\s\S]*>完成<\/button>/)
  })

  it('offers immediate retry only for a retryable polling error and exposes terminal actions', () => {
    const retryable = renderToStaticMarkup(<ArkmePaymentDialog
      order={pendingOrder as never}
      nowMillis={1_000}
      statusError="查询暂时失败"
      statusRetryable
      statusRetryInMillis={2_000}
      quotaState={{ kind: 'loading' }}
      onClose={noop}
      onRetryStatus={noop}
      onRegenerate={noop}
      onRefreshQuota={noop}
      onOpenPaymentUrl={noop}
    />)
    const expired = renderToStaticMarkup(<ArkmePaymentDialog
      order={{ ...pendingOrder, status: 'expired' } as never}
      nowMillis={130_000}
      statusError=""
      statusRetryable={false}
      quotaState={{ kind: 'loading' }}
      onClose={noop}
      onRetryStatus={noop}
      onRegenerate={noop}
      onRefreshQuota={noop}
      onOpenPaymentUrl={noop}
    />)

    expect(retryable).toContain('<h2 id="arkme-payment-dialog-title">正在确认支付</h2>')
    expect(retryable).toContain('暂时无法查询订单状态')
    expect(retryable).toContain('系统会自动退避重试；请勿重复付款。')
    expect(retryable).toContain('下次重试约 2 秒后')
    expect(retryable).toMatch(/稍后查看[\s\S]*立即重试/)
    expect(expired).toMatch(/重新生成[\s\S]*>关闭<\/button>/)
    expect(expired).not.toContain('取消支付')
  })
})
