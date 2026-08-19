import type { ArkmePluginUpdateInstallSnapshot, ArkmePluginUpdateStatus } from '../types.js'
import { callArkme } from './api.js'

export interface ArkmePluginUpdateStoreSnapshot {
  checked: boolean
  busy: boolean
  status?: ArkmePluginUpdateStatus
  install?: ArkmePluginUpdateInstallSnapshot
  error: string
  installError: string
}

type UpdateCall = <T>(
  operation:
    | 'plugin.update.status'
    | 'plugin.update.check'
    | 'plugin.update.acknowledge'
    | 'plugin.update.install'
    | 'plugin.update.install-status',
  params?: Record<string, unknown>,
) => Promise<T>

const POLL_INTERVAL_MS = 30 * 60_000
const FOLLOW_UP_DELAY_MS = 2_000
const MAX_STARTUP_FOLLOW_UPS = 3
const INSTALL_POLL_INTERVAL_MS = 1_000
const INSTALL_MONITOR_TIMEOUT_MS = 120_000
const TERMINAL_INSTALL_PHASES = new Set(['succeeded', 'failed', 'rolled-back'])

export class ArkmePluginUpdateStore {
  private readonly listeners = new Set<() => void>()
  private readonly call: UpdateCall
  private snapshot: ArkmePluginUpdateStoreSnapshot = {
    checked: false, busy: false, error: '', installError: '',
  }
  private pending: Promise<ArkmePluginUpdateStatus | undefined> | undefined
  private interval: ReturnType<typeof setInterval> | undefined
  private followUp: ReturnType<typeof setTimeout> | undefined
  private installPoll: ReturnType<typeof setTimeout> | undefined
  private installMonitorDeadline = 0
  private followUpCount = 0
  private running = false
  private readonly onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.followUpCount = 0
      void this.refresh(true)
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
    this.running = true
    this.followUpCount = 0
    void this.refresh(true)
    void this.refreshInstallStatus(false)
    this.interval = setInterval(() => { void this.refresh() }, POLL_INTERVAL_MS)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibilityChange)
    return () => this.stop()
  }

  stop(): void {
    const wasRunning = this.running
    this.running = false
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
    this.setSnapshot({ ...this.snapshot, busy: manual, error: '' })
    const task = this.call<ArkmePluginUpdateStatus>(manual ? 'plugin.update.check' : 'plugin.update.status')
      .then(status => {
        this.setSnapshot({ ...this.snapshot, checked: true, busy: false, status, error: '' })
        this.scheduleFollowUp(status)
        return status
      })
      .catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        this.setSnapshot({ ...this.snapshot, checked: true, busy: false, error: message })
        return undefined
      })
      .finally(() => { this.pending = undefined })
    this.pending = task
    return await task
  }

  async acknowledge(snoozeHours = 24): Promise<ArkmePluginUpdateStatus | undefined> {
    if (this.pending !== undefined) await this.pending
    this.setSnapshot({ ...this.snapshot, busy: true, error: '' })
    try {
      const status = await this.call<ArkmePluginUpdateStatus>('plugin.update.acknowledge', { snoozeHours })
      this.setSnapshot({ ...this.snapshot, checked: true, busy: false, status, error: '' })
      return status
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setSnapshot({ ...this.snapshot, checked: true, busy: false, error: message })
      return undefined
    }
  }

  async install(): Promise<ArkmePluginUpdateInstallSnapshot | undefined> {
    this.setSnapshot({ ...this.snapshot, busy: true, installError: '' })
    try {
      const install = await this.call<ArkmePluginUpdateInstallSnapshot>('plugin.update.install')
      this.installMonitorDeadline = Date.now() + INSTALL_MONITOR_TIMEOUT_MS
      this.setSnapshot({ ...this.snapshot, busy: false, install, installError: '' })
      this.scheduleInstallPoll()
      return install
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setSnapshot({ ...this.snapshot, busy: false, installError: message })
      return undefined
    }
  }

  async refreshInstallStatus(reloadOnSuccess = true): Promise<ArkmePluginUpdateInstallSnapshot | undefined> {
    try {
      const install = await this.call<ArkmePluginUpdateInstallSnapshot | undefined>('plugin.update.install-status')
      if (install !== undefined) {
        this.setSnapshot({ ...this.snapshot, install, installError: '' })
        if (install.phase === 'succeeded' && reloadOnSuccess && typeof location !== 'undefined') {
          location.reload()
          return install
        }
        if (!TERMINAL_INSTALL_PHASES.has(install.phase)) this.scheduleInstallPoll()
      }
      return install
    } catch (error) {
      if (this.installMonitorDeadline > 0 && typeof location !== 'undefined') {
        try {
          const root = await fetch(`${location.origin}/`, { cache: 'no-store' })
          if (root.ok) {
            location.reload()
            return undefined
          }
        } catch { /* DSH is still offline while the helper updates or restarts it. */ }
      }
      if (this.installMonitorDeadline > 0 && Date.now() >= this.installMonitorDeadline) {
        const message = error instanceof Error ? error.message : String(error)
        this.setSnapshot({ ...this.snapshot, installError: `等待 DSH 重启超时：${message}` })
        return undefined
      }
      if (this.installMonitorDeadline > 0) this.scheduleInstallPoll()
      return undefined
    }
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

  private scheduleInstallPoll(): void {
    if (this.installPoll !== undefined) clearTimeout(this.installPoll)
    this.installPoll = setTimeout(() => {
      this.installPoll = undefined
      void this.refreshInstallStatus()
    }, INSTALL_POLL_INTERVAL_MS)
  }
}

export const arkmePluginUpdateStore = new ArkmePluginUpdateStore()
