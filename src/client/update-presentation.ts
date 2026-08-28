import semverGt from 'semver/functions/gt.js'
import semverValid from 'semver/functions/valid.js'
import type { ArkmePluginUpdateInstallPhase, ArkmePluginUpdateStatus } from '../types.js'
import type { ArkmeAppUpdateStoreSnapshot } from './app-update-store.js'
import type { ArkmePluginUpdateStoreSnapshot } from './plugin-update-store.js'
import type { ArkmeUpdateTarget } from './update-ui-controller.js'

const ACTIVE_PLUGIN_PHASES = new Set<ArkmePluginUpdateInstallPhase>([
  'preparing', 'downloading', 'verifying', 'installing', 'restarting',
])

export interface ArkmeUpdateNote {
  title: string
  detail?: string
}

export interface ArkmeUpdateItem {
  target: ArkmeUpdateTarget
  instanceKey: string
  productLabel: string
  title: string
  currentVersion: string
  latestVersion: string
  packageSize?: string
  notes: ArkmeUpdateNote[]
  available: boolean
  active: boolean
  ready: boolean
  restarting: boolean
  failed: boolean
  uncertain?: boolean
  checkingStatus?: boolean
  blockedReason?: string
  error?: string
  phase?: ArkmePluginUpdateInstallPhase | 'app-downloading' | 'app-downloaded' | 'app-failed'
  phaseMessage?: string
  progress?: number
}

export interface ArkmeUpdatePresentation {
  items: ArkmeUpdateItem[]
  primary?: ArkmeUpdateItem
}

function versionLabel(version: string | undefined): string {
  return version?.trim() || '…'
}

function formatBytes(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function appUpdateProgress(downloaded: number | undefined, total: number | undefined): number | undefined {
  if (total === undefined || total <= 0) return undefined
  return Math.max(0, Math.min(100, Math.round((downloaded ?? 0) / total * 100)))
}

function pluginProgress(phase: ArkmePluginUpdateInstallPhase | undefined, busy: boolean): number | undefined {
  switch (phase) {
    case 'preparing': return 12
    case 'downloading': return 36
    case 'verifying': return 58
    case 'installing': return 78
    case 'restarting': return 94
    default: return busy ? 8 : undefined
  }
}

function pluginPhaseMessage(phase: ArkmePluginUpdateInstallPhase | undefined): string | undefined {
  switch (phase) {
    case 'preparing': return '正在准备更新'
    case 'downloading': return '正在下载更新包'
    case 'verifying': return '正在校验更新包'
    case 'installing': return '正在安装新版本'
    case 'restarting': return '完成后将自动返回新版本'
    case 'failed': return '更新未完成，请重试'
    case 'rolled-back': return '已恢复到更新前版本'
    default: return undefined
  }
}

function blockedReason(status: ArkmePluginUpdateStatus): string | undefined {
  if (status.canInstallInApp) return undefined
  switch (status.installBlockedReason) {
    case 'local-install': return '当前为本地开发插件，不能在应用内覆盖更新。'
    case 'update-disabled': return '插件自动更新当前未启用。'
    case 'profile-unavailable': return '当前插件 Profile 不支持应用内更新。'
    default: return '当前运行环境不支持应用内更新。'
  }
}

function updateNotes(summary: string | undefined): ArkmeUpdateNote[] {
  const lines = summary?.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 3) ?? []
  return lines.map(line => {
    const separator = line.search(/[：:—–]/)
    if (separator <= 0 || separator >= line.length - 1) return { title: line }
    return {
      title: line.slice(0, separator).trim(),
      detail: line.slice(separator + 1).trim(),
    }
  })
}

function appItem(snapshot: ArkmeAppUpdateStoreSnapshot): ArkmeUpdateItem | undefined {
  const status = snapshot.status
  if (status === undefined || !['available', 'downloading', 'downloaded', 'failed'].includes(status.status)) return undefined
  const latestVersion = versionLabel(status.latestVersion)
  const progress = appUpdateProgress(status.downloadedBytes, status.totalBytes)
  const packageSize = formatBytes(status.totalBytes)
  const failed = status.status === 'failed'
  const ready = status.status === 'downloaded'
  return {
    target: 'app',
    instanceKey: `app:${latestVersion}`,
    productLabel: 'Arkme APP',
    title: failed ? '更新未完成' : ready ? '安装包已下载' : '发现新版本',
    currentVersion: versionLabel(status.currentVersion),
    latestVersion,
    ...(packageSize === undefined ? {} : { packageSize }),
    notes: updateNotes(status.releaseNotes),
    available: status.status === 'available',
    active: status.status === 'downloading',
    ready,
    restarting: false,
    failed,
    ...(status.status === 'downloading' ? { phase: 'app-downloading' as const, phaseMessage: '可继续使用' } : {}),
    ...(ready ? { phase: 'app-downloaded' as const, phaseMessage: `已下载 ${latestVersion}` } : {}),
    ...(failed ? { phase: 'app-failed' as const, phaseMessage: '请重新尝试下载' } : {}),
    ...(status.error?.trim() || snapshot.error.trim() ? { error: status.error?.trim() || snapshot.error.trim() } : {}),
    ...(progress === undefined ? {} : { progress }),
  }
}

export function derivePluginUpdateItem(snapshot: ArkmePluginUpdateStoreSnapshot): ArkmeUpdateItem | undefined {
  const status = snapshot.status
  const installPending = snapshot.installPending === true
  // Version and job reads can arrive out of order across a Host restart.
  const obsoleteActive = !installPending && snapshot.install !== undefined
    && ACTIVE_PLUGIN_PHASES.has(snapshot.install.phase)
    && semverValid(status?.installedVersion) !== null
    && semverValid(snapshot.install.targetVersion) !== null
    && !semverGt(snapshot.install.targetVersion, status!.installedVersion)
  const installError = obsoleteActive ? '' : snapshot.installError.trim()
  const completed = !installPending && snapshot.install?.phase === 'succeeded' ? snapshot.install : undefined
  // The Host retains terminal jobs for recovery. They are not pending UI work;
  // also ignore a late status response still advertising the installed release.
  if (completed !== undefined && installError === ''
    && !(status?.availability === 'available'
      && semverValid(status.latestVersion) !== null
      && semverValid(completed.targetVersion) !== null
      && semverGt(status.latestVersion!, completed.targetVersion))) return undefined
  // A retry request supersedes the old terminal job only for presentation. Keep
  // the Host record intact so a rejected request can recover its retry surface.
  const install = !installPending && !obsoleteActive && completed === undefined ? snapshot.install : undefined
  if (status === undefined && install === undefined && !installPending && installError === '' && !snapshot.installStatusError) return undefined
  const active = install !== undefined && ACTIVE_PLUGIN_PHASES.has(install.phase)
  const uncertain = !obsoleteActive && (Boolean(snapshot.installWarning) && (active || installPending)
    || Boolean(snapshot.installStatusError) && !active && !installPending)
  const failed = !uncertain && !installPending && (install?.phase === 'failed' || install?.phase === 'rolled-back' || installError !== '')
  const activeDisplay = !failed && !uncertain && (active || installPending)
  const available = status?.availability === 'available' && !activeDisplay && !failed && !uncertain
  if (!available && !activeDisplay && !failed && !uncertain) return undefined
  const latestVersion = versionLabel(install?.targetVersion ?? status?.latestVersion ?? snapshot.install?.targetVersion)
  const error = failed ? installError || install?.message : undefined
  const installBlockedReason = status === undefined ? undefined : blockedReason(status)
  const progress = activeDisplay ? pluginProgress(install?.phase, installPending) : undefined
  return {
    target: 'plugin',
    instanceKey: `plugin:${installPending ? `pending:${latestVersion}` : install?.jobId ?? latestVersion}`,
    productLabel: 'Arkme 核心插件',
    title: uncertain ? '更新状态待确认' : failed ? '更新未完成' : '发现新版本',
    currentVersion: versionLabel(status?.installedVersion ?? install?.previousVersion),
    latestVersion,
    notes: updateNotes(status?.summary),
    available,
    active: activeDisplay,
    ready: false,
    restarting: activeDisplay && install?.phase === 'restarting',
    failed,
    uncertain,
    checkingStatus: snapshot.installStatusChecking === true,
    ...(installBlockedReason === undefined ? {} : { blockedReason: installBlockedReason }),
    ...(error === undefined || error === '' ? {} : { error }),
    ...(install?.phase === undefined ? {} : { phase: install.phase }),
    phaseMessage: uncertain ? snapshot.installStatusChecking ? '正在检查更新状态…'
      : snapshot.installStatusFeedback || snapshot.installWarning || snapshot.installStatusError || '请检查更新状态。'
      : installPending ? '正在准备更新' : error || install?.message || pluginPhaseMessage(install?.phase) || '正在准备更新',
    ...(progress === undefined ? {} : { progress }),
  }
}

/** Pure UI projection over the existing APP and plugin update stores. */
export function deriveArkmeUpdatePresentation(input: {
  app: ArkmeAppUpdateStoreSnapshot
  plugin: ArkmePluginUpdateStoreSnapshot
}): ArkmeUpdatePresentation {
  const items = [derivePluginUpdateItem(input.plugin), appItem(input.app)].filter((item): item is ArkmeUpdateItem => item !== undefined)
  const primary = items.find(item => item.active)
    ?? items.find(item => item.ready || item.failed || item.uncertain)
    ?? items.find(item => item.available)
  return { items, ...(primary === undefined ? {} : { primary }) }
}
