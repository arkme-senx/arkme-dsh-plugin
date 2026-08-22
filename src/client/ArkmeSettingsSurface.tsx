import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { CaretRight } from '@phosphor-icons/react/CaretRight'
import { CircleNotch } from '@phosphor-icons/react/CircleNotch'
import type {
  ArkmeAuthSnapshot,
  ArkmePluginUpdateStatus,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
} from '../types.js'
import { callArkme } from './api.js'
import { arkmeAppUpdateStore, type ArkmeAppUpdateSnapshot } from './app-update-store.js'
import { ArkmeBillingSettings } from './ArkmeBillingSettings.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { clearLastNavigationCache } from './navigation-cache.js'
import { arkmePluginUpdateStore } from './plugin-update-store.js'
import { arkmeUi } from './ui-controller.js'

interface SettingsRowProps {
  title: string
  description: string
  href?: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
}

function SettingsRow({ title, description, href, onClick, danger = false, disabled = false }: SettingsRowProps) {
  const interactive = href !== undefined || onClick !== undefined
  const body: ReactNode = <>
    <strong className={danger ? 'is-danger' : ''}>{title}</strong>
    <span className="arkme-redesign-setting-summary">{description}</span>
    {interactive ? <CaretRight size={15} aria-hidden /> : <span className="arkme-redesign-trailing-slot" aria-hidden />}
  </>

  if (href !== undefined) {
    return <a className="arkme-redesign-setting-row" href={href} target="_blank" rel="noreferrer">{body}</a>
  }
  if (onClick !== undefined) {
    return <button type="button" className="arkme-redesign-setting-row" disabled={disabled} onClick={onClick}>{body}</button>
  }
  return <div className="arkme-redesign-setting-row">{body}</div>
}

interface VersionSettingsRowProps {
  title: string
  version: string
  feedback?: string
  actionLabel?: ArkmeUpdateCenterRow['button']
  disabled?: boolean
  loading?: boolean
  onAction?: () => void
}

export function VersionSettingsRow({
  title,
  version,
  feedback,
  actionLabel,
  disabled = false,
  loading = false,
  onAction,
}: VersionSettingsRowProps) {
  const hasAction = actionLabel !== undefined && onAction !== undefined
  return <div className={`arkme-redesign-setting-row arkme-redesign-version-row${hasAction ? '' : ' is-without-action'}`}>
    <span className="arkme-redesign-version-copy">
      <strong>{title}</strong>
      {feedback === undefined ? null : <small>{feedback}</small>}
    </span>
    {hasAction ?
      <span className="arkme-redesign-version-action-slot">
      <button
        type="button"
        className="arkme-redesign-update-button"
        aria-label={loading ? `正在检查 ${title}更新` : actionLabel === '检查更新' ? `检查 ${title}更新` : `${actionLabel}：${title}`}
        aria-busy={loading}
        disabled={disabled}
        onClick={onAction}
      >
        {loading ? <CircleNotch className="arkme-icon-spin" size={13} aria-hidden /> : null}
        {actionLabel}
      </button>
      </span> : null}
    <span className="arkme-redesign-version-value">{version}</span>
    <span className="arkme-redesign-trailing-slot" aria-hidden />
  </div>
}

function SettingsGroup({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return <section className="arkme-redesign-settings-group" {...(id === undefined ? {} : { id })}>
    <h2>{title}</h2>
    <div>{children}</div>
  </section>
}

export interface ArkmeSettingsSurfaceProps {
  onOpenModels?: () => void
}

export interface ArkmeUpdateCenterRow {
  key: 'app' | 'plugin'
  label: string
  current: string
  latest: string
  button: '检查更新' | '检查中…' | '下载更新包' | '打开所在文件夹' | '立即更新' | '更新中…' | '当前不可用'
  action: 'check' | 'download' | 'open' | 'install' | 'busy'
  feedback?: string
  downloadedFilePath?: string
}

function versionLabel(version: string | undefined): string {
  return `v${version?.trim() || '…'}`
}

interface ArkmeDesktopVersionScope {
  readonly arkmeDesktop?: Readonly<{ appVersion?: string; harnessVersion?: string }>
}

export function aboutArkmeVersion(
  currentVersion: string | undefined,
  scope: ArkmeDesktopVersionScope = globalThis as unknown as ArkmeDesktopVersionScope,
): string {
  return versionLabel(scope.arkmeDesktop?.appVersion ?? currentVersion)
}

export function aboutHarnessVersion(
  scope: ArkmeDesktopVersionScope = globalThis as unknown as ArkmeDesktopVersionScope,
): string {
  return versionLabel(scope.arkmeDesktop?.harnessVersion)
}

export function updateVersionText(current: string, latest: string): string {
  return current === latest ? `当前 ${current} · 已是最新版本` : `当前 ${current} → 最新 ${latest}`
}

export function buildArkmeUpdateCenterRows(input: {
  app?: Pick<ArkmeAppUpdateSnapshot, 'status' | 'currentVersion' | 'noUpdateAvailable' | 'latestVersion' | 'error' | 'downloadedBytes' | 'totalBytes' | 'downloadedFilePath'>
  appBusy?: boolean
  appError?: string
  plugin?: Pick<ArkmePluginUpdateStatus, 'availability' | 'installedVersion' | 'latestVersion' | 'checking' | 'checkFailed'>
  pluginBusy?: boolean
  pluginError?: string
}): ArkmeUpdateCenterRow[] {
  const appStatus = input.app?.status
  const appAvailable = appStatus === 'available'
  const appChecking = appStatus === 'checking' || (input.appBusy === true && appStatus !== 'downloading')
  const appBusy = appChecking || appStatus === 'downloading'
  const appFeedback = input.appError?.trim()
    ? `检查失败：${input.appError.trim()}`
    : appChecking
      ? '正在检查更新…'
      : appStatus === 'current'
        ? input.app?.noUpdateAvailable === true ? '已检查 · 暂无可用版本' : '已检查 · 当前已是最新版本'
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
  return [{
    key: 'app',
    label: 'APP',
    current: versionLabel(input.app?.currentVersion),
    latest: versionLabel(input.app?.latestVersion ?? input.app?.currentVersion),
    button: appBusy ? (appChecking ? '检查中…' : '更新中…') : appStatus === 'downloaded' ? '打开所在文件夹' : appAvailable ? '下载更新包' : '检查更新',
    action: appBusy ? 'busy' : appStatus === 'downloaded' ? 'open' : appAvailable ? 'download' : 'check',
    ...(appFeedback === undefined ? {} : { feedback: appFeedback }),
    ...(input.app?.downloadedFilePath === undefined ? {} : { downloadedFilePath: input.app.downloadedFilePath }),
  }, {
    key: 'plugin',
    label: '核心插件',
    current: versionLabel(input.plugin?.installedVersion),
    latest: versionLabel(input.plugin?.latestVersion ?? input.plugin?.installedVersion),
    button: pluginBusy ? '检查中…' : pluginAvailable ? '立即更新' : '检查更新',
    action: pluginBusy ? 'busy' : pluginAvailable ? 'install' : 'check',
    ...(pluginFeedback === undefined ? {} : { feedback: pluginFeedback }),
  }]
}

export function ArkmeSettingsSurface({ onOpenModels }: ArkmeSettingsSurfaceProps = {}) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const updateState = useSyncExternalStore(arkmePluginUpdateStore.subscribe, arkmePluginUpdateStore.getSnapshot, arkmePluginUpdateStore.getSnapshot)
  const appUpdateState = useSyncExternalStore(arkmeAppUpdateStore.subscribe, arkmeAppUpdateStore.getSnapshot, arkmeAppUpdateStore.getSnapshot)
  const [profile, setProfile] = useState<ArkmeUserProfile>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notificationPermission, setNotificationPermission] = useState(() => arkmeDesktopNotifications.permission())

  useEffect(() => {
    if (authState.auth?.status !== 'authenticated') {
      setProfile(undefined)
      return
    }
    let active = true
    const controller = new AbortController()
    void callArkme<ArkmeUserProfileSnapshot>('user.profile', undefined, controller.signal)
      .then(async snapshot => snapshot.profile === null
        ? await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh', undefined, controller.signal)
        : snapshot)
      .then(snapshot => { if (active && snapshot.profile !== null) setProfile(snapshot.profile) })
      .catch(caught => {
        if (active && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => { active = false; controller.abort() }
  }, [authState.auth?.status, authState.auth?.status === 'authenticated' ? authState.auth.userId : undefined])

  useEffect(() => {
    const element = document.getElementById(`arkme-settings-${ui.settingsSection ?? 'account'}`)
    element?.scrollIntoView({ block: 'start' })
  }, [ui.settingsSection])

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

  const enableNotifications = async () => {
    setBusy(true)
    try {
      setNotificationPermission(await arkmeDesktopNotifications.requestPermission())
    } finally {
      setBusy(false)
    }
  }

  const displayName = profile?.displayName.trim() || profile?.nickname.trim() || '我的账户'
  const contact = profile?.contact.phoneMasked ?? profile?.contact.emailMasked ?? '已通过 Arkme 登录'
  const notificationLabel = notificationPermission === 'granted'
    ? '已开启'
    : notificationPermission === 'denied' ? '已阻止' : notificationPermission === 'default' ? '未开启' : '不可用'
  const version = aboutArkmeVersion(appUpdateState.status?.currentVersion)
  const harnessVersion = aboutHarnessVersion()
  const pluginInstallBusy = updateState.install !== undefined
    && ['preparing', 'downloading', 'verifying', 'installing', 'restarting'].includes(updateState.install.phase)
  const updateRows = buildArkmeUpdateCenterRows({
    ...(appUpdateState.status === undefined ? {} : { app: appUpdateState.status }),
    appBusy: appUpdateState.busy,
    ...(appUpdateState.error === '' ? {} : { appError: appUpdateState.error }),
    ...(updateState.status === undefined ? {} : { plugin: updateState.status }),
    pluginBusy: updateState.busy || pluginInstallBusy,
    ...(updateState.error === '' ? {} : { pluginError: updateState.error }),
  })

  const runUpdateAction = (row: ArkmeUpdateCenterRow) => {
    if (row.action === 'busy') return
    if (row.key === 'plugin') {
      if (row.action === 'install') void arkmePluginUpdateStore.install()
      else void arkmePluginUpdateStore.refresh(true)
      return
    }
    if (row.action === 'download') void arkmeAppUpdateStore.download()
    else if (row.action === 'open') void arkmeAppUpdateStore.showDownloadedFile()
    else void arkmeAppUpdateStore.refresh(true)
  }

  return <div className="arkme-redesign-settings-surface" aria-label="Arkme 设置">
    <div className="arkme-redesign-settings-shell">
      <div className="arkme-redesign-settings-profile">
        <ArkmeUserAvatar {...(profile?.avatarRef ? { avatarRef: profile.avatarRef } : {})} size={56} label="当前用户头像" />
        <div>
          <h1>{displayName}</h1>
          <p>{profile?.arkmeId ? `即我号 ${profile.arkmeId}` : '即我号读取中…'}</p>
        </div>
      </div>

      <SettingsGroup title="账户" id="arkme-settings-account">
        <SettingsRow title="个人资料" description={profile === undefined ? '正在读取账户资料' : '头像、昵称与即我号'} />
        <ArkmeBillingSettings />
        <SettingsRow title="登录与安全" description={contact} />
        <SettingsRow danger title={busy ? '正在退出…' : '退出登录'} description="退出当前 Arkme 账户" disabled={busy} onClick={() => { void logout() }} />
      </SettingsGroup>

      <SettingsGroup title="通用" id="arkme-settings-general">
        <SettingsRow title="模型与 API Key" description="配置模型与访问凭据" {...(onOpenModels === undefined ? {} : { onClick: onOpenModels })} />
        <SettingsRow title="外观" description="跟随系统" />
        <SettingsRow
          title="通知"
          description={notificationLabel}
          disabled={busy}
          {...(notificationPermission === 'default' ? { onClick: () => { void enableNotifications() } } : {})}
        />
      </SettingsGroup>

      <SettingsGroup title="Arkme">
        <SettingsRow title="执行前确认" description="发送、发布和安装时确认" />
        <SettingsRow title="可读取内容" description="对话、任务与录音" />
      </SettingsGroup>

      <SettingsGroup title="关于" id="arkme-settings-about">
        {updateRows.map(row => {
          const current = row.key === 'app' ? version : row.current
          const displayedVersion = row.latest === row.current || row.latest === 'v…'
            ? current
            : `${current} → ${row.latest}`
          const title = row.key === 'app' ? 'ArkME 客户端' : 'ArkME 插件'
          return <VersionSettingsRow
            key={row.key}
            title={title}
            version={displayedVersion}
            feedback={(row.feedback ?? '尚未检查')
              + (row.downloadedFilePath === undefined ? '' : ` · ${row.downloadedFilePath}`)}
            actionLabel={row.button}
            disabled={row.action === 'busy'}
            loading={row.button === '检查中…'}
            onAction={() => { runUpdateAction(row) }}
          />
        })}
        <VersionSettingsRow title="DeepSeek Harness" version={harnessVersion} />
        <SettingsRow title="用户协议" description="查看 Arkme 用户协议" href="https://www.arkme.ai/article/user-aggrement-v1.html" />
        <SettingsRow title="隐私条款" description="查看 Arkme 隐私条款" href="https://www.arkme.ai/article/privacy-aggrement-v1.html" />
      </SettingsGroup>

      {error !== '' && <div className="arkme-redesign-settings-error" role="alert">{error}</div>}
    </div>
  </div>
}
