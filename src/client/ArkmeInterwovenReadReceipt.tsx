import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { ArkmeInterwovenMention } from '../types.js'
import { InterwovenReadReceiptStore } from './interwoven-read-receipt-store.js'
import { arkmeInterwovenInvalidation } from './chat-directory-store.js'
import { ArkmeReadReceiptIcon } from './ArkmeReadReceiptIcon.js'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js'

const Context = createContext<InterwovenReadReceiptStore | undefined>(undefined)
const noopSubscribe = () => () => {}

export function ArkmeInterwovenReadProvider({ sourceRef, scope, enabled, children }: {
  sourceRef: string; scope: string; enabled: boolean; children: ReactNode
}) {
  const store = useMemo(() => enabled ? new InterwovenReadReceiptStore(sourceRef) : undefined, [sourceRef, scope, enabled])
  useEffect(() => {
    if (!store || typeof document === 'undefined' || typeof window === 'undefined') return
    store.activate()
    const syncVisibility = () => { store.setForeground(document.visibilityState !== 'hidden') }
    syncVisibility()
    const release = arkmeInterwovenInvalidation.subscribe(store.refresh)
    document.addEventListener('visibilitychange', syncVisibility)
    window.addEventListener('focus', store.refresh)
    return () => {
      release(); store.dispose()
      document.removeEventListener('visibilitychange', syncVisibility)
      window.removeEventListener('focus', store.refresh)
    }
  }, [store])
  return <Context.Provider value={store}>{children}</Context.Provider>
}

export function useArkmeInterwovenReadReceipt(moment: ArkmeInterwovenMention) {
  useArkmeLocale()
  const store = useContext(Context)
  const ref = useRef<HTMLSpanElement>(null)
  const receipt = useSyncExternalStore(store?.subscribe ?? noopSubscribe, () => store?.get(moment.momentRef), () => undefined)
  useEffect(() => {
    if (!store || !ref.current) return
    const registration = store.register(moment.momentId, moment.momentRef)
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
      registration.setVisible(entries.some(entry => entry.isIntersecting))
    }, { rootMargin: '80px' })
    if (observer) observer.observe(ref.current)
    else registration.setVisible(true)
    return () => { observer?.disconnect(); registration.dispose() }
  }, [store, moment.momentId, moment.momentRef])
  const expectedReader = moment.senderIsMe ? 'peer' : 'self'
  const status = receipt?.reader === expectedReader ? receipt.status : 'unknown'
  const label = status === 'unknown' ? tr('群内原消息的已读状态暂不可用')
    : moment.senderIsMe ? (status === 'read' ? tr('对方已阅读群内原消息') : tr('对方尚未阅读群内原消息'))
      : (status === 'read' ? tr('你已阅读群内原消息') : tr('你尚未阅读群内原消息'))
  const timestamp = status === 'read' && receipt?.readAtMillis && receipt.readAtMillis > 0
    ? new Intl.DateTimeFormat(arkmeIntlLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(receipt.readAtMillis) : ''
  const text = timestamp ? `${label} · ${timestamp}` : label
  return { ref, enabled: store !== undefined, status, text }
}

/** The enclosing card owns one tooltip for both the summary and receipt. */
export function ArkmeInterwovenReadReceipt({ receipt, describedBy }: {
  receipt: ReturnType<typeof useArkmeInterwovenReadReceipt>; describedBy?: string | undefined
}) {
  const { ref, enabled, status, text } = receipt
  if (!enabled) return null
  return <span ref={ref} data-arkme-interwoven-receipt={status} aria-label={text}
    aria-describedby={describedBy} tabIndex={0}
    style={{ display: 'inline-grid', placeItems: 'center', width: 14, height: 18, flex: 'none' }}>
    {status === 'read' ? <ArkmeReadReceiptIcon checked style={{ opacity: .4 }} /> : status === 'unread'
      ? <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: arkmeTheme.info, opacity: .65 }} /> : null}
  </span>
}
