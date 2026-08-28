import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { CaretRight } from '@phosphor-icons/react/CaretRight'
import { CircleNotch } from '@phosphor-icons/react/CircleNotch'
import type {
  ArkmeAuthSnapshot,
  ArkmePluginUpdateStatus,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
} from '../types.js'
import { callArkme } from './api.js'
import { ArkmeBillingSettings } from './ArkmeBillingSettings.js'
import { arkmeAppUpdateStore, type ArkmeAppUpdateSnapshot } from './app-update-store.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { clearLastNavigationCache } from './navigation-cache.js'
import { arkmePluginUpdateStore, type ArkmePluginUpdateStoreSnapshot } from './plugin-update-store.js'
import { derivePluginUpdateItem } from './update-presentation.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeUpdateUi } from './update-ui-controller.js'

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
  actionLabel?: '检查更新' | '检查中…' | '立即更新'
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

type OverflowYReader = (element: HTMLElement) => string

function browserOverflowY(element: HTMLElement): string {
  return typeof window === 'undefined' ? '' : window.getComputedStyle(element).overflowY
}

export function scrollArkmeSettingsSurface(
  surface: HTMLElement | null,
  readOverflowY: OverflowYReader = browserOverflowY,
): void {
  if (surface === null) return
  let scrollOwner = surface.parentElement
  while (scrollOwner !== null && !['auto', 'scroll', 'overlay'].includes(readOverflowY(scrollOwner))) {
    scrollOwner = scrollOwner.parentElement
  }
  const target = scrollOwner ?? surface
  target.scrollTop = 0
}

export interface ArkmePluginUpdateRow {
  label: string
  current: string
  latest: string
  action: 'check' | 'install' | 'busy' | 'view'
  feedback?: string
}

export interface ArkmeAppUpdateRow {
  label: string
  current: string
  latest: string
  action: 'check' | 'download' | 'open' | 'busy'
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
  if (current === 'v…') return '当前版本读取中…'
  if (latest === 'v…') return `当前 ${current}`
  return current === latest ? `当前 ${current} · 已是最新版本` : `当前 ${current} → 最新 ${latest}`
}

export function buildArkmeAppUpdateRow(input: {
  app?: Pick<ArkmeAppUpdateSnapshot, 'status' | 'currentVersion' | 'noUpdateAvailable' | 'latestVersion' | 'error' | 'downloadedFilePath'>
  appError?: string
}): ArkmeAppUpdateRow {
  const status = input.app?.status
  const unavailable = input.app === undefined && input.appError?.trim() !== undefined && input.appError.trim() !== ''
  const busy = status === 'checking' || status === 'downloading'
  const feedback = input.appError?.trim()
    ? `检查失败：${input.appError.trim()}`
    : status === 'checking'
      ? '正在检查更新…'
      : status === 'current'
        ? input.app?.noUpdateAvailable === true ? '已检查 · 暂无可用版本' : '已检查 · 当前已是最新版本'
        : status === 'available'
          ? '发现新版本，可以下载更新包'
          : status === 'downloading'
            ? '正在下载更新包'
            : status === 'downloaded'
              ? '下载完成，可打开所在文件夹定位安装包'
              : status === 'failed'
                ? `检查失败：${input.app?.error || '请稍后重试'}`
                : undefined
  return {
    label: 'APP',
    current: versionLabel(input.app?.currentVersion),
    latest: versionLabel(input.app?.latestVersion ?? input.app?.currentVersion),
    action: unavailable || busy ? 'busy' : status === 'downloaded' ? 'open' : status === 'available' ? 'download' : 'check',
    ...(feedback === undefined ? {} : { feedback }),
    ...(input.app?.downloadedFilePath === undefined ? {} : { downloadedFilePath: input.app.downloadedFilePath }),
  }
}

export function buildArkmePluginUpdateRow(input: {
  snapshot?: ArkmePluginUpdateStoreSnapshot
  plugin?: Pick<ArkmePluginUpdateStatus, 'availability' | 'installedVersion' | 'latestVersion' | 'checking' | 'checkFailed'>
  pluginBusy?: boolean
  pluginError?: string
}): ArkmePluginUpdateRow {
  if (input.snapshot !== undefined) {
    const snapshot = input.snapshot
    const item = derivePluginUpdateItem(snapshot)
    if (item?.active || item?.uncertain || item?.failed) return {
      label: '核心插件', current: item.currentVersion, latest: item.latestVersion, action: 'view',
      feedback: item.uncertain ? `${item.checkingStatus ? '正在检查更新状态…' : '更新状态待确认'} · 查看状态`
        : item.failed ? '更新未完成 · 查看结果' : `${item.phaseMessage} · 查看进度`,
    }
    return buildArkmePluginUpdateRow({
      ...(snapshot.status === undefined ? {} : { plugin: { ...snapshot.status,
        ...(item === undefined && snapshot.install?.phase === 'succeeded' ? { availability: 'current' as const } : {}),
      } }),
      pluginBusy: snapshot.busy || snapshot.installStatusChecking === true,
      pluginError: snapshot.error,
    })
  }
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
  return {
    label: '核心插件',
    current: versionLabel(input.plugin?.installedVersion),
    latest: versionLabel(input.plugin?.latestVersion),
    action: pluginBusy ? 'busy' : pluginAvailable ? 'install' : 'check',
    ...(pluginFeedback === undefined ? {} : { feedback: pluginFeedback }),
  }
}

export function ArkmeSettingsSurface() {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const updateState = useSyncExternalStore(arkmePluginUpdateStore.subscribe, arkmePluginUpdateStore.getSnapshot, arkmePluginUpdateStore.getSnapshot)
  const appUpdateState = useSyncExternalStore(arkmeAppUpdateStore.subscribe, arkmeAppUpdateStore.getSnapshot, arkmeAppUpdateStore.getSnapshot)
  const [profile, setProfile] = useState<ArkmeUserProfile>()
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [error, setError] = useState('')
  const [notificationPermission, setNotificationPermission] = useState(() => arkmeDesktopNotifications.permission())

  useEffect(() => {
    if (authState.auth?.status !== 'authenticated') {
      setProfile(undefined)
      setError('')
      return
    }
    let active = true
    const controller = new AbortController()
    setProfile(undefined)
    setError('')
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

  useLayoutEffect(() => {
    scrollArkmeSettingsSurface(surfaceRef.current)
  }, [])

  const logout = async () => {
    setLogoutBusy(true)
    setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.logout')
      arkmeAuthStore.setAuth(snapshot)
      clearLastNavigationCache()
      arkmeUi.authChanged(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
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

  const authenticated = authState.auth?.status === 'authenticated'
  const bindingRequired = authState.auth?.status === 'binding-required'
  const displayName = authenticated
    ? profile?.displayName.trim() || profile?.nickname.trim() || '我的账户'
    : bindingRequired ? '待完成登录' : authState.checked ? '当前未登录' : '我的账户'
  const accountDescription = authenticated
    ? profile?.arkmeId ? `即我号 ${profile.arkmeId}` : '即我号读取中…'
    : bindingRequired ? '请完成手机号绑定' : authState.checked ? '登录后显示账户信息' : '正在读取账户状态…'
  const notificationLabel = notificationPermission === 'granted'
    ? '已开启'
    : notificationPermission === 'denied' ? '已阻止' : notificationPermission === 'default' ? '未开启' : '不可用'
  const harnessVersion = aboutHarnessVersion()
  const appUpdateRow = buildArkmeAppUpdateRow({
    ...(appUpdateState.status === undefined ? {} : { app: appUpdateState.status }),
    ...(appUpdateState.error === '' ? {} : { appError: appUpdateState.error }),
  })
  const pluginUpdateRow = buildArkmePluginUpdateRow({ snapshot: updateState })

  const runPluginUpdateAction = (row: ArkmePluginUpdateRow) => {
    if (row.action === 'busy') return
    if (row.action === 'install' || row.action === 'view') arkmeUpdateUi.open('plugin')
    else void arkmePluginUpdateStore.checkInstallStatus()
  }

  const runAppUpdateAction = (row: ArkmeAppUpdateRow) => {
    if (row.action === 'busy') return
    if (row.action === 'download') arkmeUpdateUi.open('app')
    else if (row.action === 'open') void arkmeAppUpdateStore.showDownloadedFile()
    else void arkmeAppUpdateStore.refresh(true)
  }

  return <div ref={surfaceRef} className="arkme-redesign-settings-surface" data-arkme-settings-surface aria-label="Arkme 设置">
    <div className="arkme-redesign-settings-shell">
      <div className="arkme-redesign-settings-profile">
        <ArkmeUserAvatar {...(profile?.avatarRef ? { avatarRef: profile.avatarRef } : {})} size={56} label="当前用户头像" />
        <div>
          <h1>{displayName}</h1>
          <p>{accountDescription}</p>
        </div>
      </div>

      {!authenticated && <SettingsGroup title="账户">
        <SettingsRow
          title={bindingRequired ? '待完成登录' : authState.checked ? '当前未登录' : '正在读取登录状态…'}
          description={bindingRequired ? '完成手机号绑定后即可登录' : '登录 Arkme 后可管理账户'}
        />
      </SettingsGroup>}

      {authenticated && <SettingsGroup title="账户">
        <ArkmeBillingSettings />
      </SettingsGroup>}

      <SettingsGroup title="通用">
        <SettingsRow
          title="通知"
          description={notificationLabel}
          disabled={notificationBusy}
          {...(notificationPermission === 'default' ? { onClick: () => { void enableNotifications() } } : {})}
        />
      </SettingsGroup>

      <SettingsGroup title="更新" id="arkme-settings-about">
        <SettingsRow
          title="ArkME 客户端"
          description={`${updateVersionText(appUpdateRow.current, appUpdateRow.latest)} · ${appUpdateRow.feedback ?? '尚未检查'}`
            + (appUpdateRow.downloadedFilePath === undefined ? '' : ` · ${appUpdateRow.downloadedFilePath}`)}
          disabled={appUpdateRow.action === 'busy'}
          {...(appUpdateRow.action === 'busy' ? {} : { onClick: () => { runAppUpdateAction(appUpdateRow) } })}
        />
        <SettingsRow
          title="ArkME 插件"
          description={`${updateVersionText(pluginUpdateRow.current, pluginUpdateRow.latest)} · ${pluginUpdateRow.feedback ?? '尚未检查'}`}
          disabled={pluginUpdateRow.action === 'busy'}
          {...(pluginUpdateRow.action === 'busy' ? {} : { onClick: () => { runPluginUpdateAction(pluginUpdateRow) } })}
        />
        <VersionSettingsRow title="DeepSeek Harness" version={harnessVersion} />
        <SettingsRow title="用户协议" description="查看 Arkme 用户协议" href="https://www.arkme.ai/article/user-aggrement-v1.html" />
        <SettingsRow title="隐私条款" description="查看 Arkme 隐私条款" href="https://www.arkme.ai/article/privacy-aggrement-v1.html" />
      </SettingsGroup>

      {authenticated && <SettingsGroup title="账户操作">
        <SettingsRow danger title={logoutBusy ? '正在退出…' : '退出登录'} description="退出当前 Arkme 账户" disabled={logoutBusy} onClick={() => { void logout() }} />
      </SettingsGroup>}

      {error !== '' && <div className="arkme-redesign-settings-error" role="alert">{error}</div>}
    </div>
  </div>
}
