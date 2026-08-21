import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { FileText } from '@phosphor-icons/react/dist/icons/FileText'
import { GearSix } from '@phosphor-icons/react/dist/icons/GearSix'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { LockKey } from '@phosphor-icons/react/dist/icons/LockKey'
import { Palette } from '@phosphor-icons/react/dist/icons/Palette'
import { ShieldCheck } from '@phosphor-icons/react/dist/icons/ShieldCheck'
import { SignOut } from '@phosphor-icons/react/dist/icons/SignOut'
import { UserCircle } from '@phosphor-icons/react/dist/icons/UserCircle'
import type {
  ArkmeAuthSnapshot,
  ArkmePluginUpdateStatus,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
} from '../types.js'
import { callArkme } from './api.js'
import { arkmeAppUpdateStore, type ArkmeAppUpdateSnapshot } from './app-update-store.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { clearLastNavigationCache } from './navigation-cache.js'
import { arkmePluginUpdateStore } from './plugin-update-store.js'
import { arkmeUi } from './ui-controller.js'

const styles: Record<string, CSSProperties> = {
  page: { height: '100%', overflowY: 'auto', background: '#fff', color: '#191b20' },
  content: { width: 'min(720px, calc(100% - 48px))', margin: '0 auto', padding: '44px 0 64px' },
  title: { margin: 0, fontSize: 27, lineHeight: '36px', letterSpacing: '-.03em', fontWeight: 680 },
  profile: { display: 'flex', alignItems: 'center', gap: 14, marginTop: 28, padding: '18px 20px', borderRadius: 18, background: '#f7f7f8' },
  profileText: { minWidth: 0, flex: 1 },
  profileName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 17, lineHeight: '24px', fontWeight: 650 },
  profileId: { marginTop: 3, color: '#858a94', fontSize: 12, lineHeight: '18px' },
  section: { marginTop: 30 },
  sectionTitle: { margin: '0 0 9px 4px', color: '#777c86', fontSize: 12, lineHeight: '18px', fontWeight: 550 },
  group: { overflow: 'hidden', border: '1px solid #e8e8eb', borderRadius: 16, background: '#fff' },
  row: { width: '100%', minHeight: 58, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 15px', boxSizing: 'border-box', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', font: 'inherit' },
  rowButton: { cursor: 'pointer' },
  rowBorder: { borderTop: '1px solid #ededf0' },
  icon: { width: 30, height: 30, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 9, background: '#f3f3f5', color: '#666c77' },
  rowText: { minWidth: 0, flex: 1 },
  rowTitle: { display: 'block', fontSize: 14, lineHeight: '20px', fontWeight: 520 },
  rowDescription: { display: 'block', marginTop: 2, color: '#9297a0', fontSize: 11, lineHeight: '16px' },
  trailing: { flex: 'none', color: '#8d929c', fontSize: 12 },
  danger: { color: '#b54841' },
  message: { marginTop: 12, borderRadius: 10, padding: '9px 12px', background: '#fff3f0', color: '#b54841', fontSize: 12 },
}

function SettingRow({
  icon, title, description, trailing, href, onClick, danger = false, border = false,
}: {
  icon: ReactNode; title: string; description: string; trailing?: string; href?: string; onClick?: () => void; danger?: boolean; border?: boolean
}) {
  const rowStyle = { ...styles.row, ...(href !== undefined || onClick !== undefined ? styles.rowButton : {}), ...(border ? styles.rowBorder : {}) }
  const body = <>
    <span style={styles.icon}>{icon}</span>
    <span style={styles.rowText}>
      <span style={{ ...styles.rowTitle, ...(danger ? styles.danger : {}) }}>{title}</span>
      <span style={styles.rowDescription}>{description}</span>
    </span>
    {trailing !== undefined && <span style={styles.trailing}>{trailing}</span>}
    {(href !== undefined || onClick !== undefined) && <CaretRight size={15} style={styles.trailing} aria-hidden />}
  </>
  if (href !== undefined) return <a href={href} target="_blank" rel="noreferrer" style={{ ...rowStyle, textDecoration: 'none' }}>{body}</a>
  if (onClick !== undefined) return <button type="button" style={rowStyle} onClick={onClick}>{body}</button>
  return <div style={rowStyle}>{body}</div>
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

export function updateVersionText(current: string, latest: string): string {
  return current === latest ? `当前 ${current} · 已是最新版本` : `当前 ${current} → 最新 ${latest}`
}

export function buildArkmeUpdateCenterRows(input: {
  app?: Pick<ArkmeAppUpdateSnapshot, 'status' | 'currentVersion' | 'noUpdateAvailable' | 'latestVersion' | 'error' | 'downloadedBytes' | 'totalBytes' | 'downloadedFilePath'>
  appError?: string
  plugin?: Pick<ArkmePluginUpdateStatus, 'availability' | 'installedVersion' | 'latestVersion' | 'checking' | 'checkFailed'>
  pluginBusy?: boolean
  pluginError?: string
}): ArkmeUpdateCenterRow[] {
  const appStatus = input.app?.status
  const appUnavailable = input.app === undefined && input.appError?.trim() !== undefined && input.appError.trim() !== ''
  const appAvailable = appStatus === 'available'
  const appBusy = appStatus === 'checking' || appStatus === 'downloading'
  const appFeedback = input.appError?.trim()
    ? `检查失败：${input.appError.trim()}`
    : appStatus === 'checking'
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
    button: appUnavailable ? '当前不可用' : appBusy ? (appStatus === 'checking' ? '检查中…' : '更新中…') : appStatus === 'downloaded' ? '打开所在文件夹' : appAvailable ? '下载更新包' : '检查更新',
    action: appUnavailable || appBusy ? 'busy' : appStatus === 'downloaded' ? 'open' : appAvailable ? 'download' : 'check',
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

export function ArkmeSettingsSurface() {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const updateState = useSyncExternalStore(arkmePluginUpdateStore.subscribe, arkmePluginUpdateStore.getSnapshot, arkmePluginUpdateStore.getSnapshot)
  const appUpdateState = useSyncExternalStore(arkmeAppUpdateStore.subscribe, arkmeAppUpdateStore.getSnapshot, arkmeAppUpdateStore.getSnapshot)
  const [profile, setProfile] = useState<ArkmeUserProfile>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notificationPermission, setNotificationPermission] = useState(() => arkmeDesktopNotifications.permission())

  useEffect(() => {
    let active = true
    void callArkme<ArkmeUserProfileSnapshot>('user.profile')
      .then(async snapshot => snapshot.profile === null
        ? await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh')
        : snapshot)
      .then(snapshot => { if (active && snapshot.profile !== null) setProfile(snapshot.profile) })
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : String(caught)) })
    return () => { active = false }
  }, [])

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
    setNotificationPermission(await arkmeDesktopNotifications.requestPermission())
  }
  const displayName = profile?.displayName.trim() || profile?.nickname.trim() || '我的账户'
  const contact = profile?.contact.phoneMasked ?? profile?.contact.emailMasked ?? '已通过 Arkme 登录'
  const notificationLabel = notificationPermission === 'granted' ? '已开启' : notificationPermission === 'denied' ? '已阻止' : '未开启'
  const version = updateState.status?.installedVersion ?? '…'
  const pluginInstallBusy = updateState.install !== undefined
    && ['preparing', 'downloading', 'verifying', 'installing', 'restarting'].includes(updateState.install.phase)
  const updateRows = buildArkmeUpdateCenterRows({
    ...(appUpdateState.status === undefined ? {} : { app: appUpdateState.status }),
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

  return <div style={styles.page} aria-label="Arkme 设置">
    <div style={styles.content}>
      <h1 style={styles.title}>设置</h1>
      <div style={styles.profile}>
        <ArkmeUserAvatar {...(profile?.avatarRef ? { avatarRef: profile.avatarRef } : {})} size={56} label="当前用户头像" />
        <div style={styles.profileText}>
          <div style={styles.profileName}>{displayName}</div>
          <div style={styles.profileId}>Arkme ID {profile?.arkmeId || '读取中…'}</div>
        </div>
      </div>

      <section id="arkme-settings-account" style={styles.section}>
        <h2 style={styles.sectionTitle}>账户</h2>
        <div style={styles.group}>
          <SettingRow icon={<UserCircle size={18} aria-hidden />} title="个人资料" description={profile === undefined ? '正在读取账户资料' : `${displayName} · Arkme ID ${profile.arkmeId || '未设置'}`} />
          <SettingRow border icon={<LockKey size={18} aria-hidden />} title="登录与安全" description={contact} />
          <SettingRow border danger icon={<SignOut size={18} aria-hidden />} title={busy ? '正在退出…' : '退出登录'} description="退出当前 Arkme 账户" onClick={() => { if (!busy) void logout() }} />
        </div>
      </section>

      <section id="arkme-settings-general" style={styles.section}>
        <h2 style={styles.sectionTitle}>通用</h2>
        <div style={styles.group}>
          <SettingRow icon={<Palette size={18} aria-hidden />} title="外观" description="跟随 DSH 的显示设置" trailing="跟随系统" />
          <SettingRow border icon={<Bell size={18} aria-hidden />} title="通知" description="Arkme 新消息桌面提醒" trailing={notificationLabel} {...(notificationPermission === 'default' ? { onClick: () => { void enableNotifications() } } : {})} />
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Arkme</h2>
        <div style={styles.group}>
          <SettingRow icon={<ShieldCheck size={18} aria-hidden />} title="执行前确认" description="敏感操作会在 DSH 对话中再次请求确认" trailing="已开启" />
          <SettingRow border icon={<GearSix size={18} aria-hidden />} title="可读取内容" description="对话、快记与录音仅在当前账户授权范围内读取" />
        </div>
      </section>

      <section id="arkme-settings-update" style={styles.section}>
        <h2 style={styles.sectionTitle}>更新</h2>
        <div style={styles.group}>
          {updateRows.map((row, index) => <SettingRow
            key={row.key}
            border={index > 0}
            icon={<GearSix size={18} aria-hidden />}
            title={row.label}
            description={`${updateVersionText(row.current, row.latest)} · ${row.feedback ?? '尚未检查'}`
              + (row.downloadedFilePath === undefined ? '' : ` · ${row.downloadedFilePath}`)}
            trailing={row.button}
            {...(row.action === 'busy' ? {} : { onClick: () => { runUpdateAction(row) } })}
          />)}
        </div>
      </section>

      <section id="arkme-settings-about" style={styles.section}>
        <h2 style={styles.sectionTitle}>关于</h2>
        <div style={styles.group}>
          <SettingRow icon={<Info size={18} aria-hidden />} title="关于 Arkme" description="Arkme，你的数字自我。" trailing={`版本 ${version}`} />
          <SettingRow border icon={<FileText size={18} aria-hidden />} title="用户协议" description="查看 Arkme 用户协议" href="https://www.arkme.ai/article/user-aggrement-v1.html" />
          <SettingRow border icon={<FileText size={18} aria-hidden />} title="隐私条款" description="查看 Arkme 隐私条款" href="https://www.arkme.ai/article/privacy-aggrement-v1.html" />
        </div>
      </section>
      {error !== '' && <div style={styles.message} role="alert">{error}</div>}
    </div>
  </div>
}
