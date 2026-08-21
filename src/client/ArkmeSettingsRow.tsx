import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { callArkme } from './api.js'
import { arkmeAppUpdateStore, type ArkmeAppUpdateSnapshot } from './app-update-store.js'
import { arkmeAuthStore } from './auth-store.js'
import { clearLastNavigationCache } from './navigation-cache.js'
import { arkmeUi } from './ui-controller.js'
import type { ArkmeAuthSnapshot, ArkmePluginUpdateStatus } from '../types.js'
import { arkmePluginUpdateStore } from './plugin-update-store.js'

export type ArkmeSettingsRowProps = PropsRuntime<'settings.general.item'>

const styles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex', flexDirection: 'column', gap: 10, minHeight: 58,
    padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l1, #eceef1)',
  },
  account: { display: 'flex', alignItems: 'center', gap: 20 },
  text: { flex: 1, minWidth: 0 },
  title: { color: 'var(--dsw-alias-label-primary, #17191c)', fontSize: 14, fontWeight: 500 },
  desc: { marginTop: 3, color: 'var(--dsw-alias-label-secondary, #68707c)', fontSize: 12, lineHeight: '18px' },
  button: {
    flex: 'none', border: '1px solid var(--dsw-alias-border-l2, #e2e5e9)', borderRadius: 9,
    padding: '7px 12px', background: 'var(--dsw-alias-bg-base, #fff)',
    color: 'var(--dsw-alias-state-error-primary, #c2413b)', cursor: 'pointer', fontSize: 13,
  },
  updateCenter: {
    border: '1px solid var(--dsw-alias-border-l1, #e2e5e9)', borderRadius: 10,
    padding: '8px 10px', background: 'var(--dsw-specific-sidebar-fill, #fff)',
  },
  updateTitle: { fontSize: 13, fontWeight: 600, marginBottom: 6 },
  updateRow: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 30, flexWrap: 'wrap', fontSize: 12 },
  updateName: { width: 72, color: 'var(--dsw-alias-label-primary, #17191c)', fontWeight: 500 },
  updateVersion: { flex: 1, color: 'var(--dsw-alias-label-secondary, #68707c)' },
  updateButton: {
    flex: 'none', border: '1px solid var(--dsw-alias-border-l2, #d8dce2)', borderRadius: 8,
    padding: '4px 9px', background: 'var(--dsw-alias-bg-base, #fff)', cursor: 'pointer', fontSize: 12,
  },
  updateFeedback: { flexBasis: '100%', paddingLeft: 80, color: 'var(--dsw-alias-label-secondary, #68707c)' },
  updateDownloadPath: { flexBasis: '100%', paddingLeft: 80, color: 'var(--dsw-alias-label-secondary, #68707c)', overflowWrap: 'anywhere' },
}

export function arkmeSettingsTitle(installedVersion: string | undefined): string {
  return `Arkme v${installedVersion?.trim() || '…'}`
}

export interface ArkmeUpdateCenterRow {
  key: 'app' | 'plugin'
  label: string
  current: string
  latest: string
  button: '检查更新' | '检查中…' | '下载更新包' | '打开所在文件夹' | '立即更新' | '更新中…'
  action: 'check' | 'download' | 'open' | 'install' | 'busy'
  feedback?: string
  downloadedFilePath?: string
}

function versionLabel(version: string | undefined): string {
  return `v${version?.trim() || '…'}`
}

export function updateVersionText(current: string, latest: string): string {
  return current === latest ? `当前 ${current} · 已是最新版本` : `当前 ${current} → 最新 ${latest}`
}

export function buildArkmeUpdateCenterRows(input: {
  app?: Pick<ArkmeAppUpdateSnapshot, 'status' | 'currentVersion' | 'noUpdateAvailable' | 'latestVersion' | 'error' | 'downloadedBytes' | 'totalBytes' | 'downloadedFilePath'> | undefined
  plugin?: Pick<ArkmePluginUpdateStatus, 'availability' | 'installedVersion' | 'latestVersion' | 'checking' | 'checkFailed'> | undefined
  pluginBusy?: boolean
  pluginError?: string
}): ArkmeUpdateCenterRow[] {
  const appStatus = input.app?.status
  const appAvailable = appStatus === 'available'
  const appBusy = appStatus === 'checking' || appStatus === 'downloading'
  const appFeedback = appStatus === 'checking'
    ? '正在检查更新…'
    : appStatus === 'current'
      ? input.app?.noUpdateAvailable === true
        ? '已检查 · 暂无可用版本'
        : '已检查 · 当前已是最新版本'
    : appStatus === 'available'
      ? '发现新版本，可以下载更新包'
      : appStatus === 'downloading'
        ? '正在下载更新包'
        : appStatus === 'downloaded'
          ? '下载完成，可打开所在文件夹定位安装包'
        : appStatus === 'failed'
          ? `检查失败：${input.app?.error || '请稍后重试'}`
          : undefined
  const pluginAvailable = input.plugin?.availability === 'available'
  const pluginBusy = input.pluginBusy === true || input.plugin?.checking === true
  const pluginFeedback = pluginBusy
    ? '正在检查更新…'
    : input.pluginError?.trim()
      ? `检查失败：${input.pluginError.trim()}`
      : input.plugin?.checkFailed === true
        ? '检查失败：请稍后重试'
      : input.plugin?.availability === 'current'
        ? '已检查 · 当前已是最新版本'
        : input.plugin?.availability === 'available'
          ? '发现新版本，可以立即更新'
          : undefined
  return [
    {
      key: 'app',
      label: 'APP',
      current: versionLabel(input.app?.currentVersion),
      latest: versionLabel(input.app?.latestVersion ?? input.app?.currentVersion),
      button: appBusy ? (appStatus === 'checking' ? '检查中…' : '更新中…') : appStatus === 'downloaded' ? '打开所在文件夹' : appAvailable ? '下载更新包' : '检查更新',
      action: appBusy ? 'busy' : appStatus === 'downloaded' ? 'open' : appAvailable ? 'download' : 'check',
      ...(appFeedback === undefined ? {} : { feedback: appFeedback }),
      ...(input.app?.downloadedFilePath === undefined ? {} : { downloadedFilePath: input.app.downloadedFilePath }),
    },
    {
      key: 'plugin',
      label: '核心插件',
      current: versionLabel(input.plugin?.installedVersion),
      latest: versionLabel(input.plugin?.latestVersion ?? input.plugin?.installedVersion),
      button: pluginBusy ? '检查中…' : pluginAvailable ? '立即更新' : '检查更新',
      action: pluginBusy ? 'busy' : pluginAvailable ? 'install' : 'check',
      ...(pluginFeedback === undefined ? {} : { feedback: pluginFeedback }),
    },
  ]
}

export function ArkmeSettingsRow(_props: ArkmeSettingsRowProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot)
  const updateState = useSyncExternalStore(arkmePluginUpdateStore.subscribe, arkmePluginUpdateStore.getSnapshot)
  const appUpdateState = useSyncExternalStore(arkmeAppUpdateStore.subscribe, arkmeAppUpdateStore.getSnapshot)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const auth = authState.auth

  useEffect(() => {
    void arkmeAuthStore.refresh().catch(caught => {
      setError(caught instanceof Error ? caught.message : String(caught))
    })
  }, [ui.authRevision])

  const authenticated = auth?.status === 'authenticated'
  const bindingRequired = auth?.status === 'binding-required'
  const description = error !== ''
    ? error
    : !authState.checked || auth === undefined
      ? '正在读取 Arkme 登录状态…'
      : authenticated
        ? '已登录'
        : bindingRequired
          ? '当前 Arkme 账号待绑定手机号，完成绑定后才会登录成功。'
          : '当前未登录 Arkme；首次打开“默认分类”时会进入登录引导。'
  const update = updateState.status
  const pluginInstallBusy = updateState.install !== undefined
    && ['preparing', 'downloading', 'verifying', 'installing', 'restarting'].includes(updateState.install.phase)
  const updateRows = buildArkmeUpdateCenterRows({
    app: appUpdateState.status,
    plugin: update,
    pluginBusy: updateState.busy,
    pluginError: updateState.error,
  })

  const handleAppUpdate = () => {
    if (appUpdateState.status?.status === 'downloaded') {
      void arkmeAppUpdateStore.showDownloadedFile()
      return
    }
    if (appUpdateState.status?.status === 'available') {
      void arkmeAppUpdateStore.download()
      return
    }
    void arkmeAppUpdateStore.refresh(true)
  }

  const logout = async () => {
    setBusy(true)
    setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.logout')
      arkmeAuthStore.setAuth(snapshot)
      clearLastNavigationCache()
      arkmeUi.authChanged(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={styles.row}>
      <div style={styles.account}>
        <div style={styles.text}>
          <div style={styles.title}>{arkmeSettingsTitle(update?.installedVersion)}</div>
          <div style={styles.desc} role={error === '' ? undefined : 'alert'}>{description}</div>
        </div>
        {authenticated && (
          <button type="button" style={styles.button} disabled={busy} onClick={() => { void logout() }}>
            {busy ? '正在退出…' : '退出登录'}
          </button>
        )}
      </div>
      <div style={styles.updateCenter} role="region" aria-label="Arkme 更新中心">
        <div style={styles.updateTitle}>Arkme 更新中心</div>
        {updateRows.map(row => <div key={row.key} style={styles.updateRow}>
          <span style={styles.updateName}>{row.label}</span>
          <span style={styles.updateVersion}>{updateVersionText(row.current, row.latest)}</span>
          <button
            type="button"
            style={styles.updateButton}
            disabled={row.action === 'busy'
              || (row.key === 'plugin' && (updateState.busy || pluginInstallBusy))
              || (row.key === 'app' && appUpdateState.busy)}
            onClick={() => {
              if (row.key === 'app') handleAppUpdate()
              else if (row.action === 'install') void arkmePluginUpdateStore.install()
              else void arkmePluginUpdateStore.refresh(true)
            }}
          >{row.button}</button>
          {row.feedback !== undefined && <span style={styles.updateFeedback}>{row.feedback}</span>}
          {row.downloadedFilePath !== undefined && <span style={styles.updateDownloadPath}>已下载至：{row.downloadedFilePath}</span>}
        </div>)}
      </div>
    </div>
  )
}
