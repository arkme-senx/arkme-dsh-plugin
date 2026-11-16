import { tr, useArkmeLocale } from './locale.js'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import backBottomIcon from '../../assets/icons/icon_back_bottom_green.svg'
import { arkmeTheme } from './arkme-theme.js'

interface Props {
  historical?: boolean
  showBackToBottom: boolean
  newMessageCount?: number
  unreadCount?: number
  onReturnToLatest: () => Promise<void>
}

const button: CSSProperties = {
  pointerEvents: 'auto', border: `1px solid ${arkmeTheme.border}`, borderRadius: 36,
  background: arkmeTheme.base, color: arkmeTheme.text, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}

/** Mount per conversation/account. Data loading and viewport movement belong to the caller. */
export function ArkmeConversationBottomControl({ showBackToBottom, newMessageCount = 0, unreadCount, onReturnToLatest, historical = false }: Props) {
  useArkmeLocale()
  const badgeCount = unreadCount ?? 0
  const showButton = showBackToBottom || badgeCount > 0
  const label = badgeCount > 0 ? tr('向下浏览未读消息') : historical ? tr('回到最新') : tr('回到底部')
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (!showButton && newMessageCount === 0 && failed) setFailed(false)
  }, [failed, newMessageCount, showButton])
  const activate = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setFailed(false)
    try {
      await onReturnToLatest()
    } catch {
      if (mounted.current) setFailed(true)
    } finally {
      inFlight.current = false
      if (mounted.current) setPending(false)
    }
  }
  if (!showButton && newMessageCount === 0 && !pending && !failed) return null
  return <div data-arkme-bottom-controls style={{ position: 'absolute', inset: 'auto 24px 10px', zIndex: 4, pointerEvents: 'none' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minHeight: 30 }}>
      {newMessageCount > 0 && <button data-arkme-feedback="neutral" type="button" disabled={pending} onClick={() => { void activate() }}
        style={{ ...button, position: 'absolute', left: '50%', transform: 'translateX(-50%)', padding: '7px 13px', fontSize: 12 }}>
        {newMessageCount} {tr("条新消息")}</button>}
      {(showButton || pending || failed) && <button data-arkme-feedback="neutral" type="button" aria-label={badgeCount ? `${label} · ${badgeCount}` : label}
        title={pending ? `${label}…` : label} aria-busy={pending} disabled={pending}
        onClick={() => { void activate() }} style={{ ...button, position: 'relative', flexShrink: 0, opacity: pending ? 0.6 : 1,
          minWidth: 50, height: 30, padding: historical && unreadCount === undefined ? '0 12px' : 0 }}>
        {badgeCount > 0 && <span data-arkme-unread-badge style={{ position: 'absolute', top: -7, right: -6, borderRadius: 10,
          minWidth: 18, padding: '1px 4px', lineHeight: '16px', background: arkmeTheme.accent, color: '#fff', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
          {badgeCount > 999 ? '999+' : badgeCount}
        </span>}
        {historical && unreadCount === undefined && <span style={{ fontSize: 12 }}>{label}</span>}
        <img src={`data:image/svg+xml;base64,${backBottomIcon}`} width={24} height={24} style={{ objectFit: 'none', filter: 'brightness(0)' }} alt="" aria-hidden />
      </button>}
    </div>
    {failed && <div role="alert" data-arkme-bottom-error style={{ textAlign: 'right', color: arkmeTheme.danger, background: arkmeTheme.base, fontSize: 12, marginTop: 6 }}>{badgeCount > 0 ? tr('暂时无法定位未读消息，请重试')
      : historical ? tr('暂时无法回到最新，请重试') : tr('暂时无法回到底部，请重试')}</div>}
  </div>
}
