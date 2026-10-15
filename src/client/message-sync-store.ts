import type { ArkmeMessageSyncProgress } from '../chat-message-sync.js'

export interface MessageSyncView { visible: boolean; progress?: ArkmeMessageSyncProgress }
/** Presentation time only. Never schedules business work or changes read positions. */
export class MessageSyncDisplay {
  private account: string | undefined
  private latest: ArkmeMessageSyncProgress | undefined
  private view: MessageSyncView = { visible: false }
  private timer: ReturnType<typeof setTimeout> | undefined
  private hiding = false
  private listeners = new Set<() => void>()
  readonly snapshot = (): MessageSyncView => this.view
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private publish(view: MessageSyncView): void { this.view = view; for (const listener of this.listeners) listener() }
  private cancel(): void { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined }
  activateAccount(account: string | undefined, force = false): void {
    if (!force && this.account === account) return
    this.cancel(); this.account = account; this.latest = undefined; this.hiding = false; this.publish({ visible: false })
  }
  apply(progress: ArkmeMessageSyncProgress): void {
    if (progress.accountKey !== this.account || this.latest && progress.revision < this.latest.revision) return
    if (!Number.isSafeInteger(progress.total) || !Number.isSafeInteger(progress.completed) || progress.total < 0 || progress.completed < 0 || progress.completed > progress.total) return
    this.latest = progress
    const active = (progress.phase === 'syncing' || progress.phase === 'paused') && progress.total > progress.completed
    if (active) {
      if (this.hiding) { this.cancel(); this.hiding = false }
      if (this.view.visible) { this.publish({ visible: true, progress }); return }
      if (this.timer === undefined) this.timer = setTimeout(() => {
        this.timer = undefined
        if (this.latest) this.publish({ visible: true, progress: this.latest })
      }, 300)
    } else {
      if (!this.view.visible) { this.cancel(); return }
      if (this.hiding) return
      // Discovery of the next cohort is silent; preserve the completed label.
      const completed = progress.total > 0 && progress.completed === progress.total
      this.publish({ visible: true, progress: completed ? progress : this.view.progress! })
      this.hiding = true
      this.timer = setTimeout(() => {
        this.timer = undefined; this.hiding = false
        this.publish({ ...this.view, visible: false })
      }, 350)
    }
  }
  dispose(): void { this.cancel(); this.listeners.clear() }
}
export const arkmeMessageSync = new MessageSyncDisplay()
