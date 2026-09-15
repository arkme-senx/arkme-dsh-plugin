import semverGt from 'semver/functions/gt.js'
import semverValid from 'semver/functions/valid.js'
import type { ArkmePluginUpdateInstallPhase, ArkmePluginUpdateStatus } from '../types.js'
import type { ArkmePluginUpdateStoreSnapshot } from './plugin-update-store.js'

const ACTIVE_PLUGIN_PHASES = new Set<ArkmePluginUpdateInstallPhase>([
  'preparing', 'downloading', 'verifying', 'installing', 'restarting',
])

export interface ArkmeUpdateNote {
  title: string
  detail?: string
}

export interface ArkmeUpdateItem {
  target: 'plugin'
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
  phase?: ArkmePluginUpdateInstallPhase
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

/** Pure UI projection over the plugin update store. APP update UI is owned by the desktop shell. */
export function deriveArkmeUpdatePresentation(input: {
  plugin: ArkmePluginUpdateStoreSnapshot
}): ArkmeUpdatePresentation {
  const items = [derivePluginUpdateItem(input.plugin)].filter((item): item is ArkmeUpdateItem => item !== undefined)
  const primary = items.find(item => item.active)
    ?? items.find(item => item.ready || item.failed || item.uncertain)
    ?? items.find(item => item.available)
  return { items, ...(primary === undefined ? {} : { primary }) }
}
