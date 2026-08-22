import { useState, useSyncExternalStore, type CSSProperties } from 'react'
import { arkmeAppUpdateStore, type ArkmeAppUpdateSnapshot } from './app-update-store.js'

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'absolute', inset: 0, zIndex: 900, display: 'grid', placeItems: 'center', padding: 24,
    background: 'rgba(16, 20, 28, 0.42)', color: 'var(--dsw-alias-label-primary, #17191c)', pointerEvents: 'auto',
  },
  dialog: {
    width: 'min(480px, 100%)', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l1, #e2e5e9)',
    borderRadius: 20, padding: 28, background: 'var(--dsw-alias-bg-base, #fff)',
    boxShadow: '0 24px 72px rgba(15, 23, 42, 0.24)',
  },
  title: { margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600 },
  version: { margin: '10px 0 0', color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 14, lineHeight: '22px' },
  notes: { margin: '14px 0 0', color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 14, lineHeight: '22px', whiteSpace: 'pre-wrap' },
  progressTrack: { height: 8, marginTop: 22, borderRadius: 999, overflow: 'hidden', background: 'var(--dsw-alias-fill-l1, #edf0f4)' },
  progressValue: { height: '100%', borderRadius: 999, background: 'var(--dsw-alias-state-brand-primary, #3569e8)', transition: 'width 160ms linear' },
  progressText: { margin: '9px 0 0', color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 12, lineHeight: '18px' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 26 },
  button: {
    minHeight: 38, border: '1px solid var(--dsw-alias-border-l2, #d8dce2)', borderRadius: 9,
    padding: '0 14px', background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #17191c)',
    cursor: 'pointer', font: 'inherit', fontSize: 14,
  },
  primaryButton: {
    minHeight: 38, border: 0, borderRadius: 9, padding: '0 14px', background: 'var(--dsw-alias-state-brand-primary, #3569e8)',
    color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 600,
  },
}

function versionLabel(version: string | undefined): string {
  return `v${version?.trim() || '…'}`
}

function formatBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function progressText(status: ArkmeAppUpdateSnapshot): string {
  if (status.totalBytes !== undefined && status.totalBytes > 0) return `已下载 ${formatBytes(status.downloadedBytes)} / ${formatBytes(status.totalBytes)}`
  return `已下载 ${formatBytes(status.downloadedBytes)}`
}

function progressPercentage(status: ArkmeAppUpdateSnapshot): string {
  if (status.totalBytes === undefined || status.totalBytes <= 0) return '12%'
  const downloaded = status.downloadedBytes ?? 0
  return `${Math.max(0, Math.min(100, downloaded / status.totalBytes * 100))}%`
}

export function shouldShowArkmeAppUpdateDialog(
  status: ArkmeAppUpdateSnapshot | undefined,
  dismissedVersion: string | undefined,
): boolean {
  if (status === undefined || !['available', 'downloading', 'downloaded'].includes(status.status)) return false
  return dismissedVersion === undefined || status.latestVersion !== dismissedVersion
}

/** A centered update prompt shown after the desktop client finds a newer APP package. */
export function ArkmeAppUpdateDialog() {
  const state = useSyncExternalStore(arkmeAppUpdateStore.subscribe, arkmeAppUpdateStore.getSnapshot)
  const [dismissedVersion, setDismissedVersion] = useState<string | undefined>()
  const status = state.status

  if (!shouldShowArkmeAppUpdateDialog(status, dismissedVersion)) return null
  if (status === undefined) return null

  const dismiss = () => setDismissedVersion(status.latestVersion)
  const downloading = status.status === 'downloading'
  const downloaded = status.status === 'downloaded'

  return <div style={styles.backdrop} role="presentation">
    <section style={styles.dialog} role="dialog" aria-modal="true" aria-label="Arkme APP 更新">
      <h2 style={styles.title}>{downloaded ? '更新包下载完成' : downloading ? '正在下载更新包' : '发现新版本'}</h2>
      <p style={styles.version}>当前 {versionLabel(status.currentVersion)} → 最新 {versionLabel(status.latestVersion)}</p>
      {!downloading && !downloaded && status.releaseNotes?.trim() && <p style={styles.notes}>{status.releaseNotes.trim()}</p>}
      {downloading && <>
        <div style={styles.progressTrack} aria-label="下载进度"><div style={{ ...styles.progressValue, width: progressPercentage(status) }} /></div>
        <p style={styles.progressText}>{progressText(status)}</p>
      </>}
      {downloaded && <p style={styles.notes}>安装包已下载到本机，可打开所在文件夹进行安装。</p>}
      <div style={styles.actions}>
        {!downloading && <button type="button" style={styles.button} onClick={dismiss}>{downloaded ? '关闭' : '稍后'}</button>}
        {downloaded
          ? <button type="button" style={styles.primaryButton} onClick={() => { void arkmeAppUpdateStore.showDownloadedFile() }}>打开所在文件夹</button>
          : <button type="button" style={styles.primaryButton} disabled={state.busy} onClick={() => { void arkmeAppUpdateStore.download() }}>{downloading ? '正在下载…' : '下载更新包'}</button>}
      </div>
    </section>
  </div>
}
