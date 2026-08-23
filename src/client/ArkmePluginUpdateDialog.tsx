import type { CSSProperties } from 'react'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmePluginUpdateInstallSnapshot, ArkmePluginUpdateStatus } from '../types.js'

export interface ArkmePluginUpdateDialogProps {
  status: ArkmePluginUpdateStatus
  install?: ArkmePluginUpdateInstallSnapshot
  busy: boolean
  error: string
  onDismiss(): void
  onInstall(): void
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 950, display: 'grid', placeItems: 'center', padding: 24,
    background: 'rgba(16, 20, 28, 0.42)', color: 'var(--dsw-alias-label-primary, #17191c)',
  },
  dialog: {
    width: 'min(480px, 100%)', maxHeight: 'min(620px, calc(100vh - 48px))', overflow: 'auto',
    boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l1, #e2e5e9)',
    borderRadius: 20, padding: 28, background: 'var(--dsw-alias-bg-base, #fff)',
    boxShadow: '0 24px 72px rgba(15, 23, 42, 0.24)',
  },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 },
  title: { margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600 },
  closeButton: {
    width: 32, height: 32, flex: 'none', display: 'grid', placeItems: 'center', padding: 0,
    border: 0, borderRadius: 9, background: 'transparent', color: 'var(--dsw-alias-label-secondary, #68707c)',
    cursor: 'pointer',
  },
  version: { margin: '10px 0 0', color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 14, lineHeight: '22px' },
  notes: {
    marginTop: 20, padding: '16px 18px', borderRadius: 12,
    background: 'var(--dsw-alias-fill-l1, #f3f4f6)',
  },
  notesTitle: { margin: 0, fontSize: 14, lineHeight: '22px', fontWeight: 600 },
  notesBody: {
    margin: '6px 0 0', color: 'var(--dsw-alias-label-secondary, #68707c)',
    fontSize: 14, lineHeight: '22px', whiteSpace: 'pre-wrap',
  },
  releaseLink: {
    display: 'inline-block', marginTop: 9, color: 'var(--dsw-alias-state-brand-primary, #3569e8)',
    fontSize: 12, lineHeight: '18px', textDecoration: 'none',
  },
  status: { margin: '16px 0 0', color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 13, lineHeight: '20px' },
  error: { margin: '16px 0 0', color: 'var(--dsw-alias-state-error-primary, #c2413b)', fontSize: 13, lineHeight: '20px' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 26 },
  button: {
    minHeight: 38, border: '1px solid var(--dsw-alias-border-l2, #d8dce2)', borderRadius: 9,
    padding: '0 14px', background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #17191c)',
    cursor: 'pointer', font: 'inherit', fontSize: 14,
  },
  primaryButton: {
    minHeight: 38, border: 0, borderRadius: 9, padding: '0 14px',
    background: 'var(--dsw-alias-state-brand-primary, #3569e8)', color: '#fff',
    cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 600,
  },
}

const ACTIVE_INSTALL_PHASES = new Set(['preparing', 'downloading', 'verifying', 'installing', 'restarting'])

function blockedReason(status: ArkmePluginUpdateStatus): string | undefined {
  if (status.canInstallInApp) return undefined
  switch (status.installBlockedReason) {
    case 'local-install': return '当前为本地开发插件，不能在应用内覆盖更新。'
    case 'update-disabled': return '插件自动更新当前未启用。'
    case 'profile-unavailable': return '当前插件 Profile 不支持应用内更新。'
    default: return '当前运行环境不支持应用内更新。'
  }
}

function progressLabel(install: ArkmePluginUpdateInstallSnapshot | undefined): string {
  switch (install?.phase) {
    case 'preparing': return '正在准备…'
    case 'downloading': return '正在下载…'
    case 'verifying': return '正在校验…'
    case 'installing': return '正在安装…'
    case 'restarting': return '正在重启…'
    default: return '更新并重启'
  }
}

export function ArkmePluginUpdateDialog({
  status, install, busy, error, onDismiss, onInstall,
}: ArkmePluginUpdateDialogProps) {
  const installActive = install !== undefined && ACTIVE_INSTALL_PHASES.has(install.phase)
  const actionBusy = busy || installActive
  const reason = blockedReason(status)
  const updateSummary = status.summary?.trim() || '此版本包含功能改进与问题修复。'

  return <div style={styles.backdrop} role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget && !actionBusy) onDismiss()
  }}>
    <section style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="arkme-plugin-update-title">
      <div style={styles.header}>
        <div>
          <h2 id="arkme-plugin-update-title" style={styles.title}>发现插件新版本</h2>
          <p style={styles.version}>当前 v{status.installedVersion} → 最新 v{status.latestVersion ?? '…'}</p>
        </div>
        <button type="button" style={{ ...styles.closeButton, ...(actionBusy ? { opacity: 0.5, cursor: 'default' } : {}) }}
          aria-label="关闭插件更新" disabled={actionBusy} onClick={onDismiss}><X size={18} /></button>
      </div>
      <div style={styles.notes}>
        <h3 style={styles.notesTitle}>更新说明</h3>
        <p style={styles.notesBody}>{updateSummary}</p>
        {status.releaseNotesUrl !== undefined && <a style={styles.releaseLink} href={status.releaseNotesUrl}
          target="_blank" rel="noreferrer">查看完整更新说明</a>}
      </div>
      {reason !== undefined && <p style={styles.status}>{reason}</p>}
      {installActive && <p style={styles.status} role="status">{install.message}</p>}
      {error.trim() !== '' && <p style={styles.error} role="alert">{error.trim()}</p>}
      <div style={styles.actions}>
        <button type="button" style={styles.button} disabled={actionBusy} onClick={onDismiss}>稍后</button>
        <button type="button" disabled={actionBusy || reason !== undefined}
          style={{ ...styles.primaryButton, ...((actionBusy || reason !== undefined) ? { opacity: 0.5, cursor: 'default' } : {}) }}
          onClick={onInstall}>{progressLabel(install)}</button>
      </div>
    </section>
  </div>
}
