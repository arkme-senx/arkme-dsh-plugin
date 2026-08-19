import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ArkmePluginUpdateStatus } from '../types.js'
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
  bindingRequired?: boolean
  authenticated?: boolean
  authPending?: boolean
  unreadCount?: number
  updateStatus?: ArkmePluginUpdateStatus
  updateBusy?: boolean
  onUpdate?: () => void
}

const actionRowStyle: React.CSSProperties = {
  width: 'calc(100% + 4px)', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
  margin: '0 -2px',
}

const buttonStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  height: 42,
  margin: '4px 0',
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
  flex: 'none',
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

const updateDotStyle: React.CSSProperties = {
  position: 'absolute', top: -2, right: -3, width: 7, height: 7, borderRadius: '50%',
  background: '#1677ff', border: '2px solid var(--dsw-specific-sidebar-fill, #fff)', boxSizing: 'content-box',
}

const updateButtonStyle: React.CSSProperties = {
  flex: 'none', height: 28, minWidth: 50, margin: '4px 8px 4px 0', padding: '0 11px',
  border: '1px solid rgba(22, 119, 255, .24)', borderRadius: 8,
  background: 'rgba(22, 119, 255, .08)', color: '#1677ff', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 12, lineHeight: '26px', fontWeight: 500, whiteSpace: 'nowrap',
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
  wide, toggle, useSessions, expanded = false, loggedOut = false, bindingRequired = false,
  authenticated = false, authPending = false,
  unreadCount = 0,
  updateStatus,
  updateBusy = false,
  onUpdate,
}: ArkmeFooterActionProps) {
  const currentSession = useSessions(state => state.current)
  const normalizedUnread = Math.max(0, Math.trunc(unreadCount))
  const unreadLabel = normalizedUnread > 99 ? '99+' : String(normalizedUnread)
  const statusLabel = bindingRequired ? '待绑定' : loggedOut ? '未登录' : ''
  const updateAvailable = updateStatus?.availability === 'available'
  const showUpdateButton = wide && updateAvailable && updateStatus.canInstallInApp && onUpdate !== undefined
  const updateLabel = updateAvailable
    ? updateStatus.level === 'critical' ? '插件有重要更新' : '插件有可用更新'
    : ''
  const accessibleLabel = [
    'Arkme',
    ...(statusLabel === '' ? [] : [statusLabel]),
    ...(statusLabel !== '' || normalizedUnread === 0 ? [] : [`${unreadLabel} 条未读`]),
    ...(updateLabel === '' ? [] : [updateLabel]),
  ].join(' · ')
  return <div style={wide ? actionRowStyle : { width: 36 }}>
    <button
      type="button"
      disabled={authPending}
      style={{ ...buttonStyle, ...(wide ? {} : railButtonStyle) }}
      aria-label={accessibleLabel}
      aria-controls={wide ? 'arkme-footer-directory' : undefined}
      aria-expanded={expanded}
      title={wide ? undefined : accessibleLabel}
      onMouseEnter={event => { event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, #eef1f5)' }}
      onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
      onClick={() => { toggle(currentSession, authenticated) }}
    >
      <span style={{ position: 'relative', flex: 'none' }}>
        <ArkmeMark />
        {updateAvailable && <span
          aria-hidden
          data-arkme-update-level={updateStatus.level}
          style={{
            ...updateDotStyle,
            ...(updateStatus.level === 'important' ? { background: '#d97706' } : {}),
            ...(updateStatus.level === 'critical' ? { background: '#dc2626' } : {}),
          }}
        />}
      </span>
      {wide && <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textAlign: 'left' }}>Arkme</span>}
      {wide && statusLabel !== '' && <span style={loggedOutBadgeStyle}>{statusLabel}</span>}
      {statusLabel === '' && normalizedUnread > 0 && <span style={{
        ...unreadBadgeStyle,
        ...(wide ? {} : { position: 'absolute', top: -2, right: -3, marginLeft: 0 }),
      }}>{unreadLabel}</span>}
    </button>
    {showUpdateButton && <button
      type="button"
      style={{ ...updateButtonStyle, ...(updateBusy ? { opacity: 0.7, cursor: 'default' } : {}) }}
      disabled={updateBusy}
      aria-label={`更新 Arkme 插件到 ${updateStatus.latestVersion ?? '最新版本'}`}
      onMouseEnter={event => { if (!updateBusy) event.currentTarget.style.background = 'rgba(22, 119, 255, .14)' }}
      onMouseLeave={event => { event.currentTarget.style.background = 'rgba(22, 119, 255, .08)' }}
      onClick={onUpdate}
    >{updateBusy ? '更新中…' : '更新'}</button>}
  </div>
}
