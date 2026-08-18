import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { ARKME_ICON_DATA_URL } from './arkme-assets.js'

export interface ArkmeFooterActionInjected {
  toggle(openedFromSession: SessionId | undefined, authenticated: boolean): void
  activate(openedFromSession: SessionId | undefined): void
  closeSurface(): void
  surfaceSession(): SessionId | undefined
}
export type ArkmeFooterActionProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<ArkmeFooterActionInjected> & {
  expanded?: boolean
  loggedOut?: boolean
  authenticated?: boolean
  authPending?: boolean
  unreadCount?: number
}

const buttonStyle: React.CSSProperties = {
  flex: 'none',
  height: 42,
  margin: '4px -2px',
  border: 0,
  borderRadius: 12,
  padding: '0 10px 0 8px',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 8,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #17191c)',
  cursor: 'pointer',
  overflow: 'hidden',
  fontFamily: 'inherit',
  fontSize: 14,
  lineHeight: '22px',
  position: 'relative',
}

const railButtonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  margin: '8px 0 10px',
  padding: 0,
  justifyContent: 'center',
  gap: 0,
  borderRadius: '50%',
}

const loggedOutBadgeStyle: React.CSSProperties = {
  flex: 'none', marginLeft: 'auto', padding: '1px 7px', borderRadius: 999,
  background: 'rgba(194, 65, 59, .1)', color: 'var(--dsw-alias-state-error-primary, #c2413b)',
  fontSize: 11, lineHeight: '18px', fontWeight: 500,
}

const unreadBadgeStyle: React.CSSProperties = {
  flex: 'none', marginLeft: 'auto', minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box',
  borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: '#ff4d4f', color: '#fff', fontSize: 10, lineHeight: '18px', fontWeight: 600,
}

export function ArkmeMark({ size = 18 }: { size?: number }) {
  return (
    <img
      aria-hidden
      alt=""
      src={ARKME_ICON_DATA_URL}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        display: 'block',
        objectFit: 'contain',
        flex: 'none',
      }}
    />
  )
}

export function ArkmeFooterAction({
  wide, toggle, useSessions, expanded = false, loggedOut = false, authenticated = false, authPending = false,
  unreadCount = 0,
}: ArkmeFooterActionProps) {
  const currentSession = useSessions(state => state.current)
  const normalizedUnread = Math.max(0, Math.trunc(unreadCount))
  const unreadLabel = normalizedUnread > 99 ? '99+' : String(normalizedUnread)
  return (
    <button
      type="button"
      disabled={authPending}
      style={{ ...buttonStyle, ...(wide ? { width: 'calc(100% + 4px)' } : railButtonStyle) }}
      aria-label={loggedOut ? 'Arkme · 未登录' : normalizedUnread > 0 ? `Arkme · ${unreadLabel} 条未读` : 'Arkme'}
      aria-controls={wide ? 'arkme-footer-directory' : undefined}
      aria-expanded={expanded}
      title={wide ? undefined : loggedOut ? 'Arkme · 未登录' : 'Arkme'}
      onMouseEnter={event => { event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, #eef1f5)' }}
      onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
      onClick={() => { toggle(currentSession, authenticated) }}
    >
      <ArkmeMark />
      {wide && <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textAlign: 'left' }}>Arkme</span>}
      {wide && loggedOut && <span style={loggedOutBadgeStyle}>未登录</span>}
      {!loggedOut && normalizedUnread > 0 && <span style={{
        ...unreadBadgeStyle,
        ...(wide ? {} : { position: 'absolute', top: -2, right: -3, marginLeft: 0 }),
      }}>{unreadLabel}</span>}
    </button>
  )
}
