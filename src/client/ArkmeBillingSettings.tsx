import {
  useCallback, useEffect, useRef, useState,
} from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  ArkmeBillingOrderSnapshot,
  ArkmeBillingPaymentMethod,
  ArkmeBillingProduct,
  ArkmeBillingProductList,
  ArkmeQuotaSnapshot,
} from '../types.js'
import { callArkme } from './api.js'
import {
  ArkmeBillingOrderPoller,
  activateBillingPaymentAction,
  billingOrderScreen,
  billingPaymentAvailable,
  billingQrDataUrl,
  checkoutAttempt,
  checkoutAttemptAfterOrder,
  createBillingClientRequestId,
  createBillingOrderWithProcessingRetry,
  selectDefaultBillingProduct,
} from './arkme-billing.js'

export type ArkmeQuotaViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; quota: ArkmeQuotaSnapshot }
  | { kind: 'error'; message: string }

export type ArkmeProductsViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; products: ArkmeBillingProduct[] }
  | { kind: 'error'; message: string }

export function formatArkmeBillingPrice(priceMinor: number, _currency: 'CNY'): string {
  return `¥${(priceMinor / 100).toFixed(2)}`
}

export function formatArkmeNanoCny(value: string): string {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return '—'
  const roundedCents = (BigInt(value) + 5_000_000n) / 10_000_000n
  const whole = roundedCents / 100n
  const fraction = (roundedCents % 100n).toString().padStart(2, '0')
  return `¥${whole.toLocaleString('zh-CN')}.${fraction}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : String(error)
}

export interface ArkmeBalanceSettingsRowViewProps {
  quotaState: ArkmeQuotaViewState
  onOpen(): void
}

export function ArkmeBalanceSettingsRowView(props: ArkmeBalanceSettingsRowViewProps) {
  const description = props.quotaState.kind === 'ready'
    ? formatArkmeNanoCny(props.quotaState.quota.availableNanoCny)
    : props.quotaState.kind === 'loading' ? '正在加载余量…' : '余量读取失败，点击重试'

  return <div className="arkme-redesign-setting-row arkme-redesign-balance-row">
    <button type="button" className="arkme-redesign-balance-main" onClick={props.onOpen}>
      <strong>当前余量</strong>
      <small>{description}</small>
    </button>
    <button
      type="button"
      className="arkme-redesign-update-button arkme-redesign-recharge-trigger"
      onClick={props.onOpen}
    >充值</button>
    <span className="arkme-redesign-trailing-slot" aria-hidden />
  </div>
}

function AlipayIcon() {
  return <svg aria-hidden="true" focusable="false" className="arkme-billing-platform-icon is-alipay" viewBox="0 0 1024 1024">
    <path d="M1024.0512 701.0304V196.864A196.9664 196.9664 0 0 0 827.136 0H196.864A196.9664 196.9664 0 0 0 0 196.864v630.272A196.9152 196.9152 0 0 0 196.864 1024h630.272a197.12 197.12 0 0 0 193.8432-162.0992c-52.224-22.6304-278.528-120.32-396.4416-176.64-89.7024 108.6976-183.7056 173.9264-325.3248 173.9264s-236.1856-87.2448-224.8192-194.048c7.4752-70.0416 55.552-184.576 264.2944-164.9664 110.08 10.3424 160.4096 30.8736 250.1632 60.5184 23.1936-42.5984 42.496-89.4464 57.1392-139.264H248.064v-39.424h196.9152V311.1424H204.8V267.776h240.128V165.632s2.1504-15.9744 19.8144-15.9744h98.4576V267.776h256v43.4176h-256V381.952h208.8448a805.9904 805.9904 0 0 1-84.8384 212.6848c60.672 22.016 336.7936 106.3936 336.7936 106.3936zM283.5456 791.6032c-149.6576 0-173.312-94.464-165.376-133.9392 7.8336-39.3216 51.2-90.624 134.4-90.624 95.5904 0 181.248 24.4736 284.0576 74.5472-72.192 94.0032-160.9216 150.016-253.0816 150.016z" fill="#009FE8" />
  </svg>
}

function WechatIcon() {
  return <svg aria-hidden="true" focusable="false" className="arkme-billing-platform-icon is-wechat" viewBox="0 0 24 24" fill="currentColor">
    <path d="M9.55 4C4.82 4 1 7.12 1 10.96c0 2.17 1.23 4.1 3.15 5.38l-.8 2.45 2.89-1.43c1.03.36 2.14.56 3.31.56.25 0 .5-.01.74-.03a6.38 6.38 0 0 1-.28-1.86c0-3.7 3.25-6.73 7.43-7.05C16.39 6.07 13.32 4 9.55 4Zm-2.9 5.08a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Zm5.8 0a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z" />
    <path d="M23 16.02c0-3.3-3.25-5.98-7.26-5.98s-7.25 2.68-7.25 5.98S11.73 22 15.74 22c.99 0 1.94-.17 2.79-.47l2.45 1.2-.67-2.07C21.95 19.56 23 17.9 23 16.02Zm-9.7-1.48a.94.94 0 1 1 0-1.88.94.94 0 0 1 0 1.88Zm4.9 0a.94.94 0 1 1 0-1.88.94.94 0 0 1 0 1.88Z" />
  </svg>
}

const SHOW_WECHAT_PAYMENT_ENTRY = false

interface ArkmeRechargeDialogViewProps {
  quotaState: ArkmeQuotaViewState
  productsState: ArkmeProductsViewState
  selectedProductId: string | undefined
  creatingMethod: ArkmeBillingPaymentMethod | undefined
  purchaseError: string
  onClose(): void
  onRefreshQuota(): void
  onRetryProducts(): void
  onSelectProduct(productId: string): void
  onPurchase(paymentMethod: ArkmeBillingPaymentMethod): void
}

export function ArkmeRechargeDialogView(props: ArkmeRechargeDialogViewProps) {
  const enabledProducts = props.productsState.kind === 'ready'
    ? props.productsState.products.filter(product => product.enabled)
    : []
  const selected = enabledProducts.find(product => product.productId === props.selectedProductId)
  const creating = props.creatingMethod !== undefined
  const method = (paymentMethod: ArkmeBillingPaymentMethod) => selected?.paymentMethods.find(item => item.id === paymentMethod)

  return <div className="arkme-billing-backdrop">
    <section role="dialog" aria-modal="true" aria-label="余额充值" className="arkme-billing-recharge-dialog">
      <header className="arkme-billing-dialog-header">
        <div>
          <h2>余额充值</h2>
          <p>选择充值套餐和支付方式</p>
        </div>
        <button type="button" aria-label="关闭充值弹窗" onClick={props.onClose}>×</button>
      </header>

      <div className="arkme-billing-dialog-body">
        <div className="arkme-billing-dialog-balance">
          <span>当前余量</span>
          <strong>{props.quotaState.kind === 'ready'
            ? formatArkmeNanoCny(props.quotaState.quota.availableNanoCny)
            : props.quotaState.kind === 'loading' ? '正在加载…' : '读取失败'}</strong>
          <button type="button" onClick={props.onRefreshQuota}>刷新</button>
        </div>

        <div className="arkme-billing-products-section">
          <h3>充值套餐</h3>
          {props.productsState.kind === 'loading' && <p className="arkme-billing-state" aria-busy="true">正在加载充值套餐…</p>}
          {props.productsState.kind === 'error' && <div className="arkme-billing-error" role="alert">
            <span>{props.productsState.message}</span>
            <button type="button" onClick={props.onRetryProducts}>重试</button>
          </div>}
          {props.productsState.kind === 'ready' && enabledProducts.length === 0 && <p className="arkme-billing-state">暂无可购买套餐</p>}
          {enabledProducts.length > 0 && <div
            role="radiogroup"
            aria-label="充值套餐"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 10 }}
            className="arkme-billing-product-grid"
          >
            {enabledProducts.map(product => <button
              type="button"
              role="radio"
              aria-checked={product.productId === props.selectedProductId}
              className={product.productId === props.selectedProductId ? 'is-selected' : ''}
              key={product.productId}
              title={product.title}
              disabled={creating}
              onClick={() => props.onSelectProduct(product.productId)}
            >
              <span>{product.title}</span>
              <strong>{formatArkmeBillingPrice(product.priceMinor, product.currency)}</strong>
            </button>)}
          </div>}
        </div>

        {selected !== undefined && <div className="arkme-billing-payment-section">
          <h3>支付方式</h3>
          <div className="arkme-billing-payment-actions">
            <button
              type="button"
              disabled={creating || method('alipay_pc_web') === undefined}
              onClick={() => props.onPurchase('alipay_pc_web')}
            >
              <AlipayIcon />
              {props.creatingMethod === 'alipay_pc_web' ? '正在创建订单…' : '支付宝网页支付'}
            </button>
            {SHOW_WECHAT_PAYMENT_ENTRY && <button
              type="button"
              disabled={creating || method('wechat_native') === undefined}
              onClick={() => props.onPurchase('wechat_native')}
            >
              <WechatIcon />
              {props.creatingMethod === 'wechat_native' ? '正在创建订单…' : '微信扫码支付'}
            </button>}
          </div>
        </div>}
        {props.purchaseError !== '' && <div className="arkme-billing-error is-purchase" role="alert">{props.purchaseError}</div>}
      </div>
    </section>
  </div>
}

function countdownText(remainingMillis: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMillis / 1_000))
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

interface ArkmePaymentDialogProps {
  order: ArkmeBillingOrderSnapshot
  nowMillis: number
  statusError: string
  onClose(): void
  onRetryStatus(): void
  onRegenerate(): void
  onOpenPaymentUrl(url: string): void
}

export function ArkmePaymentDialog(props: ArkmePaymentDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const screen = billingOrderScreen(props.order, props.nowMillis)
  const paymentAction = screen === 'pending' ? props.order.paymentAction : undefined
  const qrDataUrl = paymentAction?.type === 'display_qr' ? billingQrDataUrl(paymentAction.qrContent) : ''
  const openUrl = paymentAction?.type === 'open_url' ? paymentAction.url : ''

  useEffect(() => { dialogRef.current?.focus() }, [])
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); props.onClose(); return }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
    if (focusable === undefined || focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return <div className="arkme-billing-backdrop">
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="arkme-payment-dialog-title"
      tabIndex={-1}
      className="arkme-billing-payment-dialog"
      onKeyDown={onKeyDown}
    >
      <header className="arkme-billing-dialog-header">
        <div>
          <h2 id="arkme-payment-dialog-title">{screen === 'crediting' ? '支付已确认' : screen === 'pending' ? '完成支付' : '订单状态'}</h2>
          <p>订单号：{props.order.orderId}</p>
        </div>
        <button type="button" aria-label="关闭支付弹窗" onClick={props.onClose}>×</button>
      </header>
      <div className="arkme-billing-payment-content">
        {screen === 'pending' && openUrl !== '' && <>
          <AlipayIcon />
          <strong>支付宝收银台已在浏览器中打开</strong>
          <p>请在浏览器中扫码或登录完成支付</p>
          <button type="button" className="arkme-billing-primary-action" onClick={() => props.onOpenPaymentUrl(openUrl)}>重新打开支付页面</button>
        </>}
        {screen === 'pending' && qrDataUrl !== '' && <>
          <img src={qrDataUrl} alt="微信支付二维码" />
          <strong>使用微信扫码支付</strong>
        </>}
        {screen === 'pending' && qrDataUrl === '' && openUrl === '' && <p className="arkme-billing-error" role="alert">支付操作暂不可用</p>}
        {screen === 'pending' && <p>支付金额 {formatArkmeBillingPrice(props.order.amountMinor, props.order.currency)} · 剩余 {countdownText(props.order.expiresAtMillis - props.nowMillis)}</p>}
        {screen === 'crediting' && <><strong>支付已确认，余额到账中…</strong><p>到账后会自动刷新当前余量。</p></>}
        {screen === 'paid' && <strong>支付成功，正在刷新余量…</strong>}
        {screen === 'expired' && <strong>支付凭据已过期，请重新生成。</strong>}
        {screen === 'closed' && <strong>订单已关闭。</strong>}
        {screen === 'failed' && <strong>订单支付失败。</strong>}
        {props.statusError !== '' && <p className="arkme-billing-error" role="alert">{props.statusError}</p>}
      </div>
      <footer className="arkme-billing-dialog-actions">
        {props.statusError !== '' && (screen === 'pending' || screen === 'crediting') && <button type="button" onClick={props.onRetryStatus}>重新查询</button>}
        {screen === 'expired' && <button type="button" className="arkme-billing-primary-action" onClick={props.onRegenerate}>重新生成</button>}
        <button type="button" onClick={props.onClose}>{screen === 'crediting' || screen === 'paid' ? '关闭' : '取消支付'}</button>
      </footer>
    </section>
  </div>
}

export function ArkmeBillingSettings() {
  const [open, setOpen] = useState(false)
  const [quotaState, setQuotaState] = useState<ArkmeQuotaViewState>({ kind: 'loading' })
  const [productsState, setProductsState] = useState<ArkmeProductsViewState>({ kind: 'loading' })
  const [selectedProductId, setSelectedProductId] = useState<string>()
  const [creatingMethod, setCreatingMethod] = useState<ArkmeBillingPaymentMethod>()
  const [purchaseError, setPurchaseError] = useState('')
  const [order, setOrder] = useState<ArkmeBillingOrderSnapshot>()
  const [orderStatusError, setOrderStatusError] = useState('')
  const [nowMillis, setNowMillis] = useState(Date.now())
  const pollerRef = useRef<ArkmeBillingOrderPoller>()
  const checkoutAttemptRef = useRef<ReturnType<typeof checkoutAttempt>>()
  const selectedProductIdRef = useRef<string>()

  const openPaymentUrl = useCallback((url: string) => { window.open(url, '_blank', 'noopener,noreferrer') }, [])
  const loadQuota = useCallback(async () => {
    setQuotaState({ kind: 'loading' })
    try { setQuotaState({ kind: 'ready', quota: await callArkme<ArkmeQuotaSnapshot>('billing.quota') }) }
    catch (error) { setQuotaState({ kind: 'error', message: errorMessage(error) }) }
  }, [])
  const loadProducts = useCallback(async () => {
    setProductsState({ kind: 'loading' })
    try {
      const result = await callArkme<ArkmeBillingProductList>('billing.products')
      setProductsState({ kind: 'ready', products: result.items })
      const current = result.items.find(product => product.enabled && product.productId === selectedProductIdRef.current)
      const next = current ?? selectDefaultBillingProduct(result.items)
      selectedProductIdRef.current = next?.productId
      setSelectedProductId(next?.productId)
      if (next?.productId !== checkoutAttemptRef.current?.productId) checkoutAttemptRef.current = undefined
    } catch (error) { setProductsState({ kind: 'error', message: errorMessage(error) }) }
  }, [])

  useEffect(() => {
    void loadQuota()
    return () => { pollerRef.current?.stop() }
  }, [loadQuota])
  useEffect(() => { if (open) void loadProducts() }, [loadProducts, open])
  useEffect(() => {
    if (order === undefined) return
    setNowMillis(Date.now())
    const timer = setInterval(() => { setNowMillis(Date.now()) }, 1_000)
    return () => clearInterval(timer)
  }, [order?.orderId])

  const startPolling = useCallback((nextOrder: ArkmeBillingOrderSnapshot) => {
    pollerRef.current?.stop()
    const poller = new ArkmeBillingOrderPoller({
      readStatus: async orderId => await callArkme<ArkmeBillingOrderSnapshot>('billing.order.status', { orderId }),
      onUpdate: latest => {
        setOrder(latest)
        setOrderStatusError('')
        checkoutAttemptRef.current = checkoutAttemptAfterOrder(checkoutAttemptRef.current, latest.status)
        if (latest.status === 'paid') { setOrder(undefined); void loadQuota() }
      },
      onError: error => { setOrderStatusError(errorMessage(error)) },
      onExpired: () => {
        checkoutAttemptRef.current = checkoutAttemptAfterOrder(checkoutAttemptRef.current, 'expired')
        setNowMillis(nextOrder.expiresAtMillis)
      },
    })
    pollerRef.current = poller
    poller.start(nextOrder.orderId, nextOrder.expiresAtMillis, nextOrder.pollIntervalMillis, nextOrder.status)
  }, [loadQuota])

  const createPayment = useCallback(async (paymentMethod: ArkmeBillingPaymentMethod, forceNew = false) => {
    if (productsState.kind !== 'ready') return
    const product = productsState.products.find(item => item.enabled && item.productId === selectedProductIdRef.current)
    if (product === undefined || !billingPaymentAvailable(product, paymentMethod)) return
    const attempt = checkoutAttempt(forceNew ? undefined : checkoutAttemptRef.current, product.productId, paymentMethod, createBillingClientRequestId)
    checkoutAttemptRef.current = attempt
    setCreatingMethod(paymentMethod)
    setPurchaseError('')
    setOrderStatusError('')
    try {
      const nextOrder = await createBillingOrderWithProcessingRetry(
        attempt,
        async input => await callArkme<ArkmeBillingOrderSnapshot>('billing.order.create', { ...input }),
      )
      checkoutAttemptRef.current = checkoutAttemptAfterOrder(attempt, nextOrder.status)
      setNowMillis(Date.now())
      activateBillingPaymentAction(nextOrder.paymentAction, openPaymentUrl)
      if (nextOrder.status === 'paid') { setOrder(undefined); void loadQuota() }
      else { setOrder(nextOrder); startPolling(nextOrder) }
    } catch (error) { setPurchaseError(errorMessage(error)) }
    finally { setCreatingMethod(undefined) }
  }, [loadQuota, openPaymentUrl, productsState, startPolling])

  const selectProduct = (productId: string) => {
    if (productId === selectedProductIdRef.current) return
    selectedProductIdRef.current = productId
    checkoutAttemptRef.current = undefined
    setSelectedProductId(productId)
    setPurchaseError('')
  }
  const closeRecharge = () => { if (order === undefined) setOpen(false) }
  const closePayment = () => { pollerRef.current?.stop(); setOrder(undefined); setOrderStatusError(''); setOpen(false) }
  const retryOrderStatus = () => { if (order !== undefined) { setOrderStatusError(''); startPolling(order) } }
  const regenerateOrder = () => {
    if (order === undefined) return
    const paymentMethod = order.paymentMethod
    pollerRef.current?.stop()
    setOrder(undefined)
    void createPayment(paymentMethod, true)
  }

  return <>
    <ArkmeBalanceSettingsRowView quotaState={quotaState} onOpen={() => setOpen(true)} />
    {open && order === undefined && <ArkmeRechargeDialogView
      quotaState={quotaState}
      productsState={productsState}
      selectedProductId={selectedProductId}
      creatingMethod={creatingMethod}
      purchaseError={purchaseError}
      onClose={closeRecharge}
      onRefreshQuota={() => { void loadQuota() }}
      onRetryProducts={() => { void loadProducts() }}
      onSelectProduct={selectProduct}
      onPurchase={paymentMethod => { void createPayment(paymentMethod) }}
    />}
    {order !== undefined && <ArkmePaymentDialog
      order={order}
      nowMillis={nowMillis}
      statusError={orderStatusError}
      onClose={closePayment}
      onRetryStatus={retryOrderStatus}
      onRegenerate={regenerateOrder}
      onOpenPaymentUrl={openPaymentUrl}
    />}
  </>
}
