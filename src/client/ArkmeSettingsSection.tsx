import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
} from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  ArkmeAuthSnapshot,
  ArkmeBillingOrderSnapshot,
  ArkmeBillingPaymentMethod,
  ArkmeBillingProduct,
  ArkmeBillingProductList,
  ArkmeQuotaSnapshot,
} from '../types.js'
import clientManifest from '../../../jotmo-harness/package.json' with { type: 'json' }
import harnessManifest from '../../../jotmo-harness/node_modules/@deepseek-ai/dsh/package.json' with { type: 'json' }
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import {
  ArkmeBillingOrderPoller, activateBillingPaymentAction, billingOrderScreen, billingPaymentAvailable,
  billingQrDataUrl, checkoutAttempt, checkoutAttemptAfterOrder, createBillingOrderWithProcessingRetry,
  createBillingClientRequestId, selectDefaultBillingProduct,
} from './arkme-billing.js'
import { clearLastNavigationCache } from './navigation-cache.js'
import {
  arkmeDesktopNotifications,
  type ArkmeDesktopNotificationPermission,
} from './desktop-notification-runtime.js'
import { arkmePluginUpdateStore } from './plugin-update-store.js'
import { arkmeUi } from './ui-controller.js'

export type ArkmeSettingsSectionProps = PropsRuntime<'settings.section'>

export type ArkmeQuotaViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; quota: ArkmeQuotaSnapshot }
  | { kind: 'error'; message: string }

export type ArkmeProductsViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; products: ArkmeBillingProduct[] }
  | { kind: 'error'; message: string }

export interface ArkmeSettingsSectionViewProps {
  quotaState: ArkmeQuotaViewState
  productsState: ArkmeProductsViewState
  selectedProductId: string | undefined
  creatingMethod: ArkmeBillingPaymentMethod | undefined
  purchaseError?: string
  installedVersion: string | undefined
  clientVersion: string | undefined
  harnessVersion: string | undefined
  authDescription: string
  authError?: boolean
  authenticated: boolean
  logoutBusy: boolean
  notificationPermission: ArkmeDesktopNotificationPermission
  notificationBusy: boolean
  onRefreshQuota(): void
  onRetryProducts(): void
  onSelectProduct(productId: string): void
  onPurchase(paymentMethod: ArkmeBillingPaymentMethod): void
  onEnableNotifications(): void
  onLogout(): void
}

const color = {
  text: 'var(--dsw-alias-label-primary, #17191c)',
  muted: 'var(--dsw-alias-label-secondary, #68707c)',
  border: 'var(--dsw-alias-border-l1, #e5e7eb)',
  borderStrong: 'var(--dsw-alias-border-l2, #d6d9de)',
  surface: 'var(--dsw-alias-bg-base, #fff)',
  subtle: 'var(--dsw-alias-bg-layer-1, #f7f8fa)',
  brand: 'var(--dsw-alias-state-info-primary, #3867d6)',
  danger: 'var(--dsw-alias-state-error-primary, #c2413b)',
}

const styles: Record<string, React.CSSProperties> = {
  page: { width: '100%', maxWidth: 720, padding: '2px 4px 28px', color: color.text },
  heading: { margin: '0 0 18px', fontSize: 20, lineHeight: '28px', fontWeight: 600 },
  card: {
    marginBottom: 16, padding: 18, border: `1px solid ${color.border}`, borderRadius: 12,
    background: color.surface,
  },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  cardTitle: { margin: 0, fontSize: 15, lineHeight: '22px', fontWeight: 600 },
  quota: { marginTop: 14, fontSize: 30, lineHeight: '38px', fontWeight: 650, letterSpacing: '-0.02em' },
  subtleButton: {
    border: `1px solid ${color.borderStrong}`, borderRadius: 8, padding: '6px 11px',
    background: color.surface, color: color.text, cursor: 'pointer', fontSize: 12,
  },
  state: { marginTop: 14, minHeight: 44, color: color.muted, fontSize: 13, lineHeight: '20px' },
  alert: { marginTop: 12, color: color.danger, fontSize: 13, lineHeight: '20px' },
  productsRegion: { marginTop: 18, paddingTop: 18, borderTop: `1px solid ${color.border}` },
  products: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 10,
    marginTop: 14,
  },
  product: {
    display: 'block', minWidth: 0, minHeight: 62, padding: '10px 12px', textAlign: 'left',
    border: `1px solid ${color.borderStrong}`, borderRadius: 10, background: color.surface,
    color: color.text, cursor: 'pointer',
  },
  productSelected: { borderColor: color.brand, boxShadow: `0 0 0 1px ${color.brand}` },
  productTitle: {
    display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 13, lineHeight: '18px', fontWeight: 600,
  },
  productPrice: { display: 'block', marginTop: 4, fontSize: 15, lineHeight: '20px', fontWeight: 650 },
  payActions: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  payButton: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    minWidth: 120, border: 0, borderRadius: 9, padding: '9px 15px',
    background: color.brand, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
  payIcon: { width: 17, height: 17, flex: 'none' },
  accountRow: { display: 'flex', alignItems: 'center', gap: 18 },
  accountText: { flex: 1, minWidth: 0 },
  versionList: { display: 'grid', gap: 10 },
  versionItem: { display: 'flex', alignItems: 'baseline', gap: 14 },
  versionLabel: {
    flex: '0 0 150px', fontSize: 13, lineHeight: '18px', fontWeight: 500,
    color: color.muted, overflowWrap: 'normal',
  },
  accountTitle: { fontSize: 14, lineHeight: '20px', fontWeight: 550 },
  description: { marginTop: 4, color: color.muted, fontSize: 12, lineHeight: '18px' },
  notificationButton: {
    marginLeft: 'auto', border: `1px solid ${color.borderStrong}`, borderRadius: 8,
    padding: '5px 10px', background: color.surface, color: color.text, cursor: 'pointer', fontSize: 12,
  },
  logout: {
    flex: 'none', border: `1px solid ${color.borderStrong}`, borderRadius: 9, padding: '7px 12px',
    background: color.surface, color: color.danger, cursor: 'pointer', fontSize: 13,
  },
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: 24, background: 'rgba(18, 21, 27, 0.48)',
  },
  dialog: {
    position: 'relative', width: 'min(380px, 100%)', padding: '22px 22px 20px',
    borderRadius: 14, background: color.surface, color: color.text,
    boxShadow: '0 18px 52px rgba(0, 0, 0, 0.22)', textAlign: 'center',
  },
  dialogTitle: { margin: 0, fontSize: 17, lineHeight: '24px', fontWeight: 600 },
  close: {
    position: 'absolute', top: 12, right: 12, width: 32, height: 32, border: 0,
    borderRadius: 8, background: 'transparent', color: color.muted, cursor: 'pointer', fontSize: 22,
  },
  qr: { display: 'block', width: 214, height: 214, margin: '20px auto 12px', borderRadius: 8 },
  countdown: { color: color.muted, fontSize: 13 },
  orderId: { marginTop: 7, color: color.muted, fontSize: 11, wordBreak: 'break-all' },
  dialogError: { marginTop: 12, color: color.danger, fontSize: 13 },
  dialogActions: { display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 10, marginTop: 18 },
}

export function arkmeSettingsTitle(installedVersion: string | undefined): string {
  return `Arkme v${installedVersion?.trim() || '…'}`
}

export function arkmeClientVersion(clientVersion: string | undefined): string {
  return `v${clientVersion?.trim() || '…'}`
}

export function arkmeNotificationStatus(permission: ArkmeDesktopNotificationPermission): string {
  if (permission === 'granted') return '已开启'
  if (permission === 'denied') return '已被系统阻止'
  if (permission === 'default') return '未开启'
  return '当前环境不支持'
}

export function formatArkmeBillingPrice(priceMinor: number, _currency: 'CNY'): string {
  return `¥${(priceMinor / 100).toFixed(2)}`
}

export function formatArkmeNanoCny(value: string): string {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return '—'
  const nano = BigInt(value)
  const roundedCents = (nano + 5_000_000n) / 10_000_000n
  const whole = roundedCents / 100n
  const fraction = (roundedCents % 100n).toString().padStart(2, '0')
  return `¥${whole.toLocaleString('zh-CN')}.${fraction}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : String(error)
}

export interface ArkmeLogoutActions {
  requestLogout(): Promise<ArkmeAuthSnapshot>
  closeSettings(): void
  publishAuth(snapshot: ArkmeAuthSnapshot): void
  clearNavigation(): void
  notifyAuthChanged(authenticated: false): void
}

export async function performArkmeLogout(actions: ArkmeLogoutActions): Promise<void> {
  const snapshot = await actions.requestLogout()
  actions.closeSettings()
  actions.publishAuth(snapshot)
  actions.clearNavigation()
  actions.notifyAuthChanged(false)
}

function QuotaRegion(props: Pick<ArkmeSettingsSectionViewProps, 'quotaState' | 'onRefreshQuota'>) {
  const { quotaState } = props
  return (
    <div role="region" aria-labelledby="arkme-quota-title">
      <div style={styles.cardHeader}>
        <h3 id="arkme-quota-title" style={styles.cardTitle}>当前余量</h3>
        <button type="button" style={styles.subtleButton} onClick={props.onRefreshQuota}>刷新</button>
      </div>
      {quotaState.kind === 'loading' && <div style={styles.state} aria-busy="true">正在加载余量…</div>}
      {quotaState.kind === 'error' && (
        <div style={styles.alert} role="alert">
          <div>{quotaState.message}</div>
          <button type="button" style={{ ...styles.subtleButton, marginTop: 9 }} onClick={props.onRefreshQuota}>重试</button>
        </div>
      )}
      {quotaState.kind === 'ready' && (
        <div style={styles.quota}>{formatArkmeNanoCny(quotaState.quota.availableNanoCny)}</div>
      )}
    </div>
  )
}

function ProductsRegion(props: Pick<ArkmeSettingsSectionViewProps,
  'productsState' | 'selectedProductId' | 'creatingMethod' | 'purchaseError'
  | 'onRetryProducts' | 'onSelectProduct' | 'onPurchase'>) {
  const enabledProducts = props.productsState.kind === 'ready'
    ? props.productsState.products.filter(product => product.enabled)
    : []
  const selected = enabledProducts.find(product => product.productId === props.selectedProductId)
  const creating = props.creatingMethod !== undefined
  const paymentLabel = (method: ArkmeBillingProduct['paymentMethods'][number]): string => {
    if (method.provider === 'alipay' && method.actionType === 'open_url') return '支付宝网页支付'
    return '微信扫码支付'
  }
  const paymentIcon = (provider: ArkmeBillingProduct['paymentMethods'][number]['provider']) => provider === 'alipay'
    ? (
      <svg aria-hidden="true" focusable="false" style={styles.payIcon} viewBox="0 0 24 24" fill="none">
        <path d="M5 6.25h14M12 3.5v7.75M7.25 10.25h9.5c-.8 4.1-4.3 7.3-9.2 9.25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.5 13.25c2.8 2.55 6.2 4.5 10.5 5.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
    : (
      <svg aria-hidden="true" focusable="false" style={styles.payIcon} viewBox="0 0 24 24" fill="currentColor">
        <path d="M9.55 4C4.82 4 1 7.12 1 10.96c0 2.17 1.23 4.1 3.15 5.38l-.8 2.45 2.89-1.43c1.03.36 2.14.56 3.31.56.25 0 .5-.01.74-.03a6.38 6.38 0 0 1-.28-1.86c0-3.7 3.25-6.73 7.43-7.05C16.39 6.07 13.32 4 9.55 4Zm-2.9 5.08a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Zm5.8 0a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z" />
        <path d="M23 16.02c0-3.3-3.25-5.98-7.26-5.98s-7.25 2.68-7.25 5.98S11.73 22 15.74 22c.99 0 1.94-.17 2.79-.47l2.45 1.2-.67-2.07C21.95 19.56 23 17.9 23 16.02Zm-9.7-1.48a.94.94 0 1 1 0-1.88.94.94 0 0 1 0 1.88Zm4.9 0a.94.94 0 1 1 0-1.88.94.94 0 0 1 0 1.88Z" />
      </svg>
    )
  return (
    <div role="region" style={styles.productsRegion} aria-labelledby="arkme-products-title">
      <h3 id="arkme-products-title" style={styles.cardTitle}>购买余量</h3>
      {props.productsState.kind === 'loading' && (
        <div style={styles.state} aria-busy="true">正在加载购买套餐…</div>
      )}
      {props.productsState.kind === 'error' && (
        <div style={styles.alert} role="alert">
          <div>{props.productsState.message}</div>
          <button type="button" style={{ ...styles.subtleButton, marginTop: 9 }} onClick={props.onRetryProducts}>重试</button>
        </div>
      )}
      {props.productsState.kind === 'ready' && enabledProducts.length === 0 && (
        <div style={styles.state}>暂无可购买套餐</div>
      )}
      {enabledProducts.length > 0 && (
        <>
          <div
            style={styles.products}
            role="radiogroup"
            aria-label="购买套餐"
            aria-orientation="horizontal"
          >
            {enabledProducts.map(product => {
              const selectedProduct = product.productId === props.selectedProductId
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedProduct}
                  key={product.productId}
                  title={product.title}
                  style={{ ...styles.product, ...(selectedProduct ? styles.productSelected : {}) }}
                  disabled={creating}
                  onClick={() => props.onSelectProduct(product.productId)}
                >
                  <span style={styles.productTitle}>{product.title}</span>
                  <span style={styles.productPrice}>{formatArkmeBillingPrice(product.priceMinor, product.currency)}</span>
                </button>
              )
            })}
          </div>
          <div style={styles.payActions}>
            {selected?.paymentMethods.map(method => (
              <button
                type="button"
                key={method.id}
                style={{ ...styles.payButton, opacity: !creating ? 1 : 0.45 }}
                disabled={creating}
                onClick={() => props.onPurchase(method.id)}
              >
                {paymentIcon(method.provider)}
                {props.creatingMethod === method.id ? '正在创建订单…' : paymentLabel(method)}
              </button>
            ))}
          </div>
        </>
      )}
      {props.purchaseError !== undefined && props.purchaseError !== '' && (
        <div style={styles.alert} role="alert">{props.purchaseError}</div>
      )}
    </div>
  )
}

export function ArkmeSettingsSectionView(props: ArkmeSettingsSectionViewProps) {
  return (
    <div style={styles.page}>
      <h2 style={styles.heading}>Arkme</h2>
      <section style={styles.card} aria-label="Arkme 余量与购买">
        <QuotaRegion quotaState={props.quotaState} onRefreshQuota={props.onRefreshQuota} />
        <ProductsRegion {...props} />
      </section>
      <section style={styles.card} aria-label="版本信息">
        <div style={styles.cardTitle}>版本信息</div>
        <div style={styles.accountRow}>
          <div style={styles.accountText}>
            <div style={styles.versionList}>
              <div style={styles.versionItem}>
                <div style={styles.versionLabel}>客户端</div>
                <div style={styles.description}>{arkmeClientVersion(props.clientVersion)}</div>
              </div>
              <div style={styles.versionItem}>
                <div style={styles.versionLabel}>Arkme 插件</div>
                <div style={styles.description}>{arkmeSettingsTitle(props.installedVersion)}</div>
              </div>
              <div style={styles.versionItem}>
                <div style={styles.versionLabel}>DeepSeek Harness</div>
                <div style={styles.description}>{arkmeClientVersion(props.harnessVersion)}</div>
              </div>
              <div style={styles.versionItem}>
                <div style={styles.versionLabel}>桌面通知</div>
                <div style={styles.description}>{arkmeNotificationStatus(props.notificationPermission)}</div>
                {props.notificationPermission === 'default' && (
                  <button
                    type="button"
                    style={styles.notificationButton}
                    disabled={props.notificationBusy}
                    onClick={props.onEnableNotifications}
                  >{props.notificationBusy ? '正在开启…' : '开启桌面通知'}</button>
                )}
              </div>
            </div>
          </div>
          {props.authenticated && (
            <button type="button" style={styles.logout} disabled={props.logoutBusy} onClick={props.onLogout}>
              {props.logoutBusy ? '正在退出…' : '退出登录'}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function countdownText(remainingMillis: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMillis / 1_000))
  const minutesPart = Math.floor(seconds / 60).toString().padStart(2, '0')
  const secondsPart = (seconds % 60).toString().padStart(2, '0')
  return `${minutesPart}:${secondsPart}`
}

export interface ArkmePaymentDialogProps {
  order: ArkmeBillingOrderSnapshot
  nowMillis: number
  statusError: string
  onClose(): void
  onRetryStatus(): void
  onRegenerate(): void
  onOpenPaymentUrl(url: string): void
}

export function ArkmePaymentDialog(props: ArkmePaymentDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const screen = billingOrderScreen(props.order, props.nowMillis)
  const paymentAction = screen === 'pending' ? props.order.paymentAction : undefined
  const qrDataUrl = paymentAction?.type === 'display_qr' ? billingQrDataUrl(paymentAction.qrContent) : ''
  const openUrl = paymentAction?.type === 'open_url' ? paymentAction.url : ''
  const methodLabel = props.order.paymentProvider === 'alipay' ? '支付宝' : '微信'

  useEffect(() => { dialogRef.current?.focus() }, [])

  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); props.onClose(); return }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
    if (focusable === undefined || focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div style={styles.backdrop}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="arkme-payment-title"
        tabIndex={-1}
        style={styles.dialog}
        onKeyDown={trapFocus}
      >
        <button type="button" aria-label="关闭支付弹窗" style={styles.close} onClick={props.onClose}>×</button>
        <h3 id="arkme-payment-title" style={styles.dialogTitle}>
          {screen === 'crediting' ? '支付已确认' : openUrl !== '' ? '支付宝支付' : `${methodLabel}扫码支付`}
        </h3>
        {screen === 'pending' && openUrl !== '' && (
          <div style={styles.state}>
            <div>已在系统浏览器打开支付宝收银台</div>
            <div>请在浏览器中扫码或登录完成支付</div>
          </div>
        )}
        {screen === 'pending' && qrDataUrl !== '' && (
          <img style={styles.qr} src={qrDataUrl} alt={`${methodLabel}支付二维码`} />
        )}
        {screen === 'pending' && qrDataUrl === '' && openUrl === '' && (
          <div style={styles.dialogError} role="alert">支付操作暂不可用</div>
        )}
        {screen === 'expired' && (
          <div style={styles.state}>{props.order.paymentMethod === 'wechat_native' ? '二维码' : '支付页面'}已过期，请重新生成。</div>
        )}
        {screen === 'closed' && <div style={styles.state}>订单已关闭。</div>}
        {screen === 'failed' && <div style={styles.state}>订单支付失败。</div>}
        {screen === 'crediting' && <div style={styles.state}>支付已确认，余额到账中…</div>}
        {screen === 'paid' && <div style={styles.state}>支付成功，正在刷新余量…</div>}
        {screen === 'pending' && (
          <>
            <div style={styles.countdown}>支付金额 {formatArkmeBillingPrice(props.order.amountMinor, props.order.currency)}</div>
            <div style={styles.countdown}>剩余 {countdownText(props.order.expiresAtMillis - props.nowMillis)}</div>
          </>
        )}
        <div style={styles.orderId}>订单号：{props.order.orderId}</div>
        {props.statusError !== '' && <div style={styles.dialogError} role="alert">{props.statusError}</div>}
        <div style={styles.dialogActions}>
          {screen === 'pending' && openUrl !== '' && (
            <button type="button" style={styles.payButton} onClick={() => props.onOpenPaymentUrl(openUrl)}>
              重新打开支付页面
            </button>
          )}
          {props.statusError !== '' && (screen === 'pending' || screen === 'crediting') && (
            <button type="button" style={styles.subtleButton} onClick={props.onRetryStatus}>重新查询</button>
          )}
          {screen === 'expired' && (
            <button type="button" style={styles.payButton} onClick={props.onRegenerate}>重新生成</button>
          )}
          <button type="button" style={styles.subtleButton} onClick={props.onClose}>
            {screen === 'crediting' || screen === 'paid' ? '关闭' : '取消支付'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ArkmeSettingsSection(props: ArkmeSettingsSectionProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot)
  const updateState = useSyncExternalStore(arkmePluginUpdateStore.subscribe, arkmePluginUpdateStore.getSnapshot)
  const [quotaState, setQuotaState] = useState<ArkmeQuotaViewState>({ kind: 'loading' })
  const [productsState, setProductsState] = useState<ArkmeProductsViewState>({ kind: 'loading' })
  const [selectedProductId, setSelectedProductId] = useState<string>()
  const [creatingMethod, setCreatingMethod] = useState<ArkmeBillingPaymentMethod>()
  const [purchaseError, setPurchaseError] = useState('')
  const [order, setOrder] = useState<ArkmeBillingOrderSnapshot>()
  const [orderStatusError, setOrderStatusError] = useState('')
  const [nowMillis, setNowMillis] = useState(Date.now())
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<ArkmeDesktopNotificationPermission>(
    () => arkmeDesktopNotifications.permission(),
  )
  const [authError, setAuthError] = useState('')
  const pollerRef = useRef<ArkmeBillingOrderPoller>()
  const checkoutAttemptRef = useRef<ReturnType<typeof checkoutAttempt>>()
  const selectedProductIdRef = useRef<string>()

  const openPaymentUrl = useCallback((url: string) => {
    void window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  const loadQuota = useCallback(async () => {
    setQuotaState({ kind: 'loading' })
    try {
      setQuotaState({ kind: 'ready', quota: await callArkme<ArkmeQuotaSnapshot>('billing.quota') })
    } catch (error) {
      setQuotaState({ kind: 'error', message: errorMessage(error) })
    }
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
    } catch (error) {
      setProductsState({ kind: 'error', message: errorMessage(error) })
    }
  }, [])

  useEffect(() => {
    void loadQuota()
    void loadProducts()
    return () => { pollerRef.current?.stop() }
  }, [loadProducts, loadQuota])

  useEffect(() => {
    void arkmeAuthStore.refresh().catch(error => { setAuthError(errorMessage(error)) })
  }, [ui.authRevision])

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
        if (latest.status === 'paid') {
          setOrder(undefined)
          void loadQuota()
        }
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
    const attempt = checkoutAttempt(
      forceNew ? undefined : checkoutAttemptRef.current,
      product.productId,
      paymentMethod,
      createBillingClientRequestId,
    )
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
      if (nextOrder.status === 'paid') {
        setOrder(undefined)
        void loadQuota()
      } else {
        setOrder(nextOrder)
        startPolling(nextOrder)
      }
    } catch (error) {
      setPurchaseError(errorMessage(error))
    } finally {
      setCreatingMethod(undefined)
    }
  }, [openPaymentUrl, productsState, startPolling])

  const selectProduct = (productId: string) => {
    if (productId === selectedProductIdRef.current) return
    selectedProductIdRef.current = productId
    checkoutAttemptRef.current = undefined
    setSelectedProductId(productId)
    setPurchaseError('')
  }

  const closePayment = () => {
    pollerRef.current?.stop()
    setOrder(undefined)
    setOrderStatusError('')
  }

  const retryOrderStatus = () => {
    if (order === undefined) return
    setOrderStatusError('')
    startPolling(order)
  }

  const regenerateOrder = () => {
    if (order === undefined) return
    const paymentMethod = order.paymentMethod
    pollerRef.current?.stop()
    setOrder(undefined)
    void createPayment(paymentMethod, true)
  }

  const logout = async () => {
    setLogoutBusy(true)
    setAuthError('')
    try {
      await performArkmeLogout({
        requestLogout: async () => await callArkme<ArkmeAuthSnapshot>('auth.logout'),
        closeSettings: props.close,
        publishAuth: snapshot => { arkmeAuthStore.setAuth(snapshot) },
        clearNavigation: clearLastNavigationCache,
        notifyAuthChanged: authenticated => { arkmeUi.authChanged(authenticated) },
      })
    } catch (error) {
      setAuthError(errorMessage(error))
    } finally {
      setLogoutBusy(false)
    }
  }

  const enableNotifications = async () => {
    setNotificationBusy(true)
    try {
      setNotificationPermission(await arkmeDesktopNotifications.requestPermission())
    } finally {
      setNotificationBusy(false)
    }
  }

  const auth = authState.auth
  const authenticated = auth?.status === 'authenticated'
  const bindingRequired = auth?.status === 'binding-required'
  const authDescription = authError !== ''
    ? authError
    : !authState.checked || auth === undefined
      ? '正在读取 Arkme 登录状态…'
      : authenticated
        ? '已登录'
        : bindingRequired
          ? '当前 Arkme 账号待绑定手机号，完成绑定后才会登录成功。'
          : '当前未登录 Arkme；首次打开“默认分类”时会进入登录引导。'

  return (
    <>
      <ArkmeSettingsSectionView
        quotaState={quotaState}
        productsState={productsState}
        selectedProductId={selectedProductId}
        creatingMethod={creatingMethod}
        purchaseError={purchaseError}
        installedVersion={updateState.status?.installedVersion}
        clientVersion={clientManifest.version}
        harnessVersion={harnessManifest.version}
        authDescription={authDescription}
        authError={authError !== ''}
        authenticated={authenticated}
        logoutBusy={logoutBusy}
        notificationPermission={notificationPermission}
        notificationBusy={notificationBusy}
        onRefreshQuota={() => { void loadQuota() }}
        onRetryProducts={() => { void loadProducts() }}
        onSelectProduct={selectProduct}
        onPurchase={paymentMethod => { void createPayment(paymentMethod) }}
        onEnableNotifications={() => { void enableNotifications() }}
        onLogout={() => { void logout() }}
      />
      {order !== undefined && (
        <ArkmePaymentDialog
          order={order}
          nowMillis={nowMillis}
          statusError={orderStatusError}
          onClose={closePayment}
          onRetryStatus={retryOrderStatus}
          onRegenerate={regenerateOrder}
          onOpenPaymentUrl={openPaymentUrl}
        />
      )}
    </>
  )
}
