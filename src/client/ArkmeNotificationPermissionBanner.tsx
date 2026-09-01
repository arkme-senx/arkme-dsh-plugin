import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { ArkmeDesktopNotificationPermission } from './desktop-notification-runtime.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { arkmeTheme } from './arkme-theme.js'

export interface ArkmeNotificationPermissionPrompt {
  message: string
  action: string
  kind: 'request' | 'settings'
}

export function arkmeNotificationPermissionPrompt(
  permission: ArkmeDesktopNotificationPermission,
): ArkmeNotificationPermissionPrompt | undefined {
  if (permission === 'default') {
    return { message: '开启系统通知，及时接收新消息', action: '开启', kind: 'request' }
  }
  if (permission === 'denied') {
    return { message: '系统通知未开启，可能错过新消息', action: '去开启', kind: 'settings' }
  }
  return undefined
}

const styles: Record<string, CSSProperties> = {
  root: {
    margin: '2px 4px 8px', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
    border: `1px solid color-mix(in srgb, ${arkmeTheme.danger} 20%, transparent)`, borderRadius: 10,
    background: `color-mix(in srgb, ${arkmeTheme.dangerSoft} 78%, transparent)`, color: arkmeTheme.secondary,
    fontSize: 11, lineHeight: '16px', boxSizing: 'border-box',
  },
  message: { flex: 1, minWidth: 0 },
  action: {
    flex: 'none', padding: 0, border: 0, background: 'transparent', color: arkmeTheme.danger,
    cursor: 'pointer', font: 'inherit', fontWeight: 600,
  },
}

export function ArkmeNotificationPermissionBanner() {
  const permission = useSyncExternalStore(
    arkmeDesktopNotifications.subscribePermission,
    arkmeDesktopNotifications.getPermissionSnapshot,
    arkmeDesktopNotifications.getPermissionSnapshot,
  ).permission
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const prompt = arkmeNotificationPermissionPrompt(permission)

  useEffect(() => {
    const refresh = () => { void arkmeDesktopNotifications.refreshPermission() }
    refresh()
    if (typeof window === 'undefined') return
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh) }
  }, [])

  if (prompt === undefined) return null
  const activate = async () => {
    if (busy) return
    setBusy(true)
    setFailure('')
    try {
      if (prompt.kind === 'request') await arkmeDesktopNotifications.requestPermission()
      else if (!await arkmeDesktopNotifications.openPermissionSettings()) setFailure('无法打开系统设置')
    } finally {
      setBusy(false)
    }
  }
  return <div style={styles.root} role="status" aria-live="polite">
    <span style={styles.message}>{failure || prompt.message}</span>
    <button type="button" style={styles.action} disabled={busy} onClick={() => { void activate() }}>
      {busy ? '处理中…' : prompt.action}
    </button>
  </div>
}
