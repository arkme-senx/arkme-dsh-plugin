import type { ArkmePluginUpdateInstallSnapshot, ArkmePluginUpdateStatus } from '../types.js'
import { PLUGIN_UPDATE_TERMINAL_STATE_TTL_MS } from '../plugin-update-policy.js'
import { callArkme } from './api.js'
import semverGte from 'semver/functions/gte.js'
import semverValid from 'semver/functions/valid.js'

export interface ArkmePluginUpdateStoreSnapshot {
  checked: boolean
  busy: boolean
  /** Only the install command is pending, not a version check or acknowledgement. */
  installPending?: boolean
  status?: ArkmePluginUpdateStatus
  install?: ArkmePluginUpdateInstallSnapshot
  error: string
  installError: string
  /** Missing progress is not proof that the Host has failed or stopped installing. */
  installWarning?: string
  installStatusError?: string
  installStatusChecking?: boolean
  installStatusFeedback?: string
}

type UpdateCall = <T>(
  operation:
    | 'plugin.update.status'
    | 'plugin.update.check'
    | 'plugin.update.acknowledge'
    | 'plugin.update.install'
    | 'plugin.update.install-status',
  params?: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<T>

const POLL_INTERVAL_MS = 30 * 60_000
const FOLLOW_UP_DELAY_MS = 2_000
const MAX_STARTUP_FOLLOW_UPS = 3
const INSTALL_POLL_INTERVAL_MS = 1_000
const INSTALL_MONITOR_TIMEOUT_MS = 120_000
const STALLED_INSTALL_POLL_INTERVAL_MS = 10_000
const STATUS_TIMEOUT_MS = 15_000
const TERMINAL_INSTALL_PHASES = new Set(['succeeded', 'failed', 'rolled-back'])
const ACTIVE_INSTALL_PHASES = ['preparing', 'downloading', 'verifying', 'installing', 'restarting']

function isOlderInstall(next: ArkmePluginUpdateInstallSnapshot, current: ArkmePluginUpdateInstallSnapshot | undefined): boolean {
  if (current === undefined) return false
  if (next.updatedAtMillis < current.updatedAtMillis) return true
  return next.jobId === current.jobId && ACTIVE_INSTALL_PHASES.includes(next.phase)
    && (TERMINAL_INSTALL_PHASES.has(current.phase)
      || ACTIVE_INSTALL_PHASES.indexOf(next.phase) < ACTIVE_INSTALL_PHASES.indexOf(current.phase))
}

export class ArkmePluginUpdateStore {
  private readonly listeners = new Set<() => void>()
  private readonly call: UpdateCall
  private snapshot: ArkmePluginUpdateStoreSnapshot = {
    checked: false, busy: false, error: '', installError: '',
  }
  private pending: Promise<ArkmePluginUpdateStatus | undefined> | undefined
  private pendingInstall: Promise<ArkmePluginUpdateInstallSnapshot | undefined> | undefined
  private pendingStatusCheck: Promise<void> | undefined
  private readonly cancelQueries = new Set<() => void>()
  private requestedTargetVersion: string | undefined
  private installStatusFailures = 0
  private interval: ReturnType<typeof setInterval> | undefined
  private followUp: ReturnType<typeof setTimeout> | undefined
  private installPoll: ReturnType<typeof setTimeout> | undefined
  private installMonitor: ReturnType<typeof setTimeout> | undefined
  private installMonitorDeadline = 0
  private installProgressKey = ''
  private installRevision = 0
  private installReadSequence = 0
  private lifecycleRevision = 0
  private stopped = false
  private pendingPreviousJobId: string | undefined
  private followUpCount = 0
  private running = false
  private readonly onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.followUpCount = 0
      this.installStatusFailures = 0
      void this.refresh(true)
      void this.refreshInstallStatus()
    }
  }

  constructor(call: UpdateCall = callArkme) {
    this.call = call
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ArkmePluginUpdateStoreSnapshot => this.snapshot

  start(): () => void {
    if (this.running) return () => undefined
    this.stopped = false
    this.running = true
    this.followUpCount = 0
    this.installStatusFailures = 0
    void this.refresh(true)
    void this.refreshInstallStatus(false)
    this.interval = setInterval(() => { void this.refresh() }, POLL_INTERVAL_MS)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibilityChange)
    return () => this.stop()
  }

  stop(): void {
    const wasRunning = this.running
    this.running = false
    this.stopped = true
    this.lifecycleRevision += 1
    this.installRevision += 1
    this.installReadSequence += 1
    this.resetInstallMonitor()
    this.pending = undefined
    this.pendingInstall = undefined
    this.pendingStatusCheck = undefined
    for (const cancel of this.cancelQueries) cancel()
    this.snapshot = { ...this.snapshot, busy: false, installPending: false, installStatusChecking: false, installWarning: '' }
    if (this.interval !== undefined) clearInterval(this.interval)
    if (this.followUp !== undefined) clearTimeout(this.followUp)
    if (this.installPoll !== undefined) clearTimeout(this.installPoll)
    this.interval = undefined
    this.followUp = undefined
    this.installPoll = undefined
    if (wasRunning && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange)
    }
  }

  async refresh(manual = false): Promise<ArkmePluginUpdateStatus | undefined> {
    if (this.pending !== undefined) return await this.pending
    const lifecycle = this.lifecycleRevision
    this.setSnapshot({ ...this.snapshot, busy: manual || this.snapshot.installPending === true, error: '' })
    const task = this.query<ArkmePluginUpdateStatus>(manual ? 'plugin.update.check' : 'plugin.update.status')
      .then(status => {
        if (lifecycle !== this.lifecycleRevision) return undefined
        const previousVersion = this.snapshot.status?.installedVersion
        const reconciled = this.reconcileRunningVersion(status)
        this.setSnapshot({ ...this.snapshot, checked: true, busy: this.snapshot.installPending === true, status, error: '' })
        this.scheduleFollowUp(status)
        if (reconciled && previousVersion !== undefined && status.installedVersion !== previousVersion
          && typeof location !== 'undefined') location.reload()
        return status
      })
      .catch(error => {
        if (lifecycle !== this.lifecycleRevision) return undefined
        const message = error instanceof Error ? error.message : String(error)
        this.setSnapshot({ ...this.snapshot, checked: true, busy: this.snapshot.installPending === true, error: message })
        return undefined
      })
      .finally(() => { if (this.pending === task) this.pending = undefined })
    this.pending = task
    return await task
  }

  async acknowledge(snoozeHours = 24): Promise<ArkmePluginUpdateStatus | undefined> {
    if (this.pending !== undefined) await this.pending
    this.setSnapshot({ ...this.snapshot, busy: true, error: '' })
    try {
      const status = await this.call<ArkmePluginUpdateStatus>('plugin.update.acknowledge', { snoozeHours })
      this.setSnapshot({ ...this.snapshot, checked: true, busy: this.snapshot.installPending === true, status, error: '' })
      return status
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setSnapshot({ ...this.snapshot, checked: true, busy: this.snapshot.installPending === true, error: message })
      return undefined
    }
  }

  async install(): Promise<ArkmePluginUpdateInstallSnapshot | undefined> {
    if (this.pendingInstall !== undefined) return await this.pendingInstall
    if (this.snapshot.install !== undefined && ACTIVE_INSTALL_PHASES.includes(this.snapshot.install.phase)) return this.snapshot.install
    if (this.snapshot.installStatusError) return undefined
    const revision = ++this.installRevision
    this.installReadSequence += 1
    this.pendingPreviousJobId = this.snapshot.install?.jobId
    this.requestedTargetVersion = this.snapshot.status?.latestVersion ?? this.snapshot.install?.targetVersion
    if (this.installPoll !== undefined) clearTimeout(this.installPoll)
    this.installPoll = undefined
    this.monitorInstallProgress('pending')
    // Publish the shared request before notifying subscribers so repeated actions
    // cannot send a second command while the Host is preparing the first one.
    const task = Promise.resolve().then(async () => {
      if (revision !== this.installRevision) return undefined
      try {
        const install = await this.call<ArkmePluginUpdateInstallSnapshot>('plugin.update.install')
        if (revision !== this.installRevision) return undefined
        this.installReadSequence += 1
        // The command's new job is authoritative even if the Host clock moved.
        // A poll may already have advanced that same job while the command waited.
        const current = install.jobId === this.snapshot.install?.jobId && isOlderInstall(install, this.snapshot.install)
          ? this.snapshot.install! : install
        this.requestedTargetVersion = current.targetVersion
        this.monitorInstall(current)
        this.setSnapshot({ ...this.snapshot, busy: this.pending !== undefined, installPending: false, install: current, installError: '' })
        this.scheduleInstallPoll()
        return install
      } catch (error) {
        if (revision !== this.installRevision) return undefined
        this.installReadSequence += 1
        const observed = this.snapshot.install
        if (observed !== undefined && observed.jobId !== this.pendingPreviousJobId) {
          // A status read can confirm acceptance before the command connection
          // closes during restart. Its newer Host result wins over that error.
          this.monitorInstall(observed)
          this.setSnapshot({ ...this.snapshot, busy: this.pending !== undefined, installPending: false, installError: '' })
          this.scheduleInstallPoll()
          return observed
        }
        this.resetInstallMonitor()
        const message = error instanceof Error ? error.message : String(error)
        this.setSnapshot({ ...this.snapshot, busy: this.pending !== undefined, installPending: false, installWarning: '', installError: message })
        return undefined
      }
    }).finally(() => { if (this.pendingInstall === task) this.pendingInstall = undefined })
    this.pendingInstall = task
    this.setSnapshot({ ...this.snapshot, busy: true, installPending: true, installError: '', installWarning: '' })
    this.scheduleInstallPoll()
    return await task
  }

  /** Recovery checks are read-only, bounded and shared across all UI entries. */
  async checkInstallStatus(): Promise<void> {
    if (this.pendingStatusCheck !== undefined) return await this.pendingStatusCheck
    const lifecycle = this.lifecycleRevision
    this.installStatusFailures = 0
    const task = Promise.resolve().then(async () => {
      if (lifecycle !== this.lifecycleRevision) return
      await this.refreshInstallStatus()
      if (lifecycle !== this.lifecycleRevision) return
      await this.refresh(true)
    }).finally(() => {
      if (this.pendingStatusCheck !== task) return
      this.pendingStatusCheck = undefined
      this.setSnapshot({ ...this.snapshot, installStatusChecking: false,
        installStatusFeedback: this.snapshot.installStatusError ? '暂时无法连接更新服务，请稍后再检查。'
          : this.snapshot.installWarning ? '已检查，暂未收到新的更新结果。可稍后再检查。' : '' })
    })
    this.pendingStatusCheck = task
    this.setSnapshot({ ...this.snapshot, installStatusChecking: true, installStatusFeedback: '' })
    return await task
  }

  async refreshInstallStatus(reloadOnSuccess = true): Promise<ArkmePluginUpdateInstallSnapshot | undefined> {
    const revision = this.installRevision
    const sequence = ++this.installReadSequence
    const isCurrent = () => revision === this.installRevision && sequence === this.installReadSequence
    try {
      const install = await this.query<ArkmePluginUpdateInstallSnapshot | undefined>('plugin.update.install-status')
      if (!isCurrent()) return undefined
      this.installStatusFailures = 0
      this.setSnapshot({ ...this.snapshot, installStatusError: '', installStatusFeedback: '' })
      // While the command is pending the Host can still return its previous job,
      // including one the page has never seen. An older target cannot confirm it.
      const olderTarget = install !== undefined && this.requestedTargetVersion !== undefined
        && semverValid(install.targetVersion) && semverValid(this.requestedTargetVersion)
        && !semverGte(install.targetVersion, this.requestedTargetVersion)
      if (this.snapshot.installPending && (install === undefined || install.jobId === this.pendingPreviousJobId || olderTarget)) {
        // A replacement Host may already run the target without retaining a job.
        await this.refresh()
        if (!isCurrent()) return undefined
        this.scheduleInstallPoll()
        return undefined
      }
      if (install !== undefined) {
        if ((!this.snapshot.installPending || install.jobId === this.pendingPreviousJobId) && isOlderInstall(install, this.snapshot.install)) {
          this.scheduleInstallPoll()
          return undefined
        }
        this.monitorInstall(install)
        this.requestedTargetVersion = install.targetVersion
        if (this.snapshot.status !== undefined && this.reconcileRunningVersion(this.snapshot.status)) {
          this.setSnapshot({ ...this.snapshot, busy: this.pending !== undefined })
          return undefined
        }
        if (TERMINAL_INSTALL_PHASES.has(install.phase)) this.releaseInstallCommand()
        this.setSnapshot({ ...this.snapshot, install, installPending: false, busy: this.pending !== undefined, installError: '' })
        if (install.phase === 'succeeded' && reloadOnSuccess && typeof location !== 'undefined') {
          location.reload()
          return install
        }
        if (TERMINAL_INSTALL_PHASES.has(install.phase)) {
          const expiresIn = PLUGIN_UPDATE_TERMINAL_STATE_TTL_MS - (Date.now() - install.updatedAtMillis)
          this.scheduleInstallPoll(Math.max(1, expiresIn + 1))
        } else {
          this.scheduleInstallPoll()
        }
      } else if (this.snapshot.install !== undefined) {
        const { install: previousInstall, ...snapshot } = this.snapshot
        const previousVersion = snapshot.status?.installedVersion
        this.resetInstallMonitor()
        this.setSnapshot({ ...snapshot, installError: '', installWarning: '' })
        if (!TERMINAL_INSTALL_PHASES.has(previousInstall.phase) && previousInstall.phase !== 'idle') {
          // The replacement Host may retire the job before the helper writes
          // its terminal result. Load the new client without requiring that race.
          if (this.pending !== undefined) await this.pending
          if (!isCurrent()) return undefined
          const status = await this.refresh()
          if (isCurrent() && reloadOnSuccess && previousVersion !== undefined && status !== undefined
            && status.installedVersion !== previousVersion && typeof location !== 'undefined') location.reload()
        }
      } else if (this.requestedTargetVersion !== undefined) {
        await this.refresh()
      }
      return install
    } catch {
      if (!isCurrent()) return undefined
      this.installStatusFailures += 1
      this.setSnapshot({ ...this.snapshot, installStatusError: '暂时无法获取更新状态，请检查状态后再更新。' })
      if (this.installMonitorDeadline > 0) {
        // A healthy root page alone does not prove a restart completed. Otherwise
        // an API error can cause an endless reload loop and reset the watchdog.
        const previousVersion = this.snapshot.status?.installedVersion
        const status = await this.refresh()
        if (!isCurrent()) return undefined
        if (reloadOnSuccess && previousVersion !== undefined && status !== undefined
          && status.installedVersion !== previousVersion && typeof location !== 'undefined') {
          location.reload()
          return undefined
        }
        this.scheduleInstallPoll()
      } else if (this.installStatusFailures <= MAX_STARTUP_FOLLOW_UPS) {
        this.scheduleInstallPoll(FOLLOW_UP_DELAY_MS * 2 ** (this.installStatusFailures - 1))
      }
      return undefined
    }
  }

  private releaseInstallCommand(): void {
    // Detach the old connection only after a Host result proves it has ended.
    // Its late response/finally must not mutate or unlock a later retry.
    this.installRevision += 1
    this.pendingInstall = undefined
    this.pendingPreviousJobId = undefined
  }

  private reconcileRunningVersion(status: ArkmePluginUpdateStatus): boolean {
    const target = this.requestedTargetVersion ?? this.snapshot.install?.targetVersion
    if (!target || !semverValid(target) || !semverValid(status.installedVersion)
      || !semverGte(status.installedVersion, target)) return false
    this.releaseInstallCommand()
    this.requestedTargetVersion = undefined
    this.resetInstallMonitor()
    if (this.installPoll !== undefined) clearTimeout(this.installPoll)
    this.installPoll = undefined
    const { install: _install, ...snapshot } = this.snapshot
    this.snapshot = { ...snapshot, installPending: false, installError: '', installWarning: '', installStatusError: '', installStatusFeedback: '' }
    return true
  }

  private async query<T>(operation: 'plugin.update.status' | 'plugin.update.check' | 'plugin.update.install-status'): Promise<T> {
    const controller = new AbortController()
    let cancel!: () => void
    const timeout = new Promise<never>((_, reject) => {
      cancel = () => { controller.abort(); reject(new Error('更新状态查询超时')) }
    })
    const timer = setTimeout(cancel, STATUS_TIMEOUT_MS)
    this.cancelQueries.add(cancel)
    try {
      return await Promise.race([this.call<T>(operation, undefined, controller.signal), timeout])
    } finally {
      clearTimeout(timer)
      this.cancelQueries.delete(cancel)
    }
  }

  private resetInstallMonitor(): void {
    if (this.installMonitor !== undefined) clearTimeout(this.installMonitor)
    this.installMonitor = undefined
    this.installMonitorDeadline = 0
    this.installProgressKey = ''
  }

  private monitorInstall(install: ArkmePluginUpdateInstallSnapshot): void {
    if (!ACTIVE_INSTALL_PHASES.includes(install.phase)) {
      this.resetInstallMonitor()
      this.snapshot = { ...this.snapshot, installWarning: '' }
      return
    }
    this.monitorInstallProgress(`${install.jobId}:${install.phase}:${install.updatedAtMillis}`)
  }

  private monitorInstallProgress(key: string): void {
    if (key === this.installProgressKey) return
    this.resetInstallMonitor()
    this.installProgressKey = key
    this.installMonitorDeadline = Date.now() + INSTALL_MONITOR_TIMEOUT_MS
    this.snapshot = { ...this.snapshot, installWarning: '' }
    this.installMonitor = setTimeout(() => {
      this.installMonitor = undefined
      this.setSnapshot({ ...this.snapshot, installWarning: '更新长时间没有新进展，结果待确认。你可以继续使用，稍后检查状态。' })
    }, INSTALL_MONITOR_TIMEOUT_MS)
  }

  private scheduleFollowUp(status: ArkmePluginUpdateStatus): void {
    if (!this.running || this.followUpCount >= MAX_STARTUP_FOLLOW_UPS
      || (!status.checking && !status.stale && status.availability !== 'unknown')) return
    if (this.followUp !== undefined) clearTimeout(this.followUp)
    this.followUpCount += 1
    this.followUp = setTimeout(() => {
      this.followUp = undefined
      void this.refresh()
    }, FOLLOW_UP_DELAY_MS)
  }

  private setSnapshot(snapshot: ArkmePluginUpdateStoreSnapshot): void {
    this.snapshot = snapshot
    for (const listener of [...this.listeners]) listener()
  }

  private scheduleInstallPoll(delayMs = this.snapshot.installWarning ? STALLED_INSTALL_POLL_INTERVAL_MS : INSTALL_POLL_INTERVAL_MS): void {
    if (this.stopped) return
    if (this.installPoll !== undefined) clearTimeout(this.installPoll)
    this.installPoll = setTimeout(() => {
      this.installPoll = undefined
      void this.refreshInstallStatus()
    }, delayMs)
  }
}

export const arkmePluginUpdateStore = new ArkmePluginUpdateStore()
