export interface ArkmeMessagePreparingTarget {
  accountScope: string
  sourceKey: string
  sourceRef: string
}

export interface ArkmeMessagePreparingTransport {
  report(target: ArkmeMessagePreparingTarget, prepareAtMillis: number): Promise<void>
  cancel(target: ArkmeMessagePreparingTarget, cancelAtMillis: number): Promise<void>
}

export class ArkmeMessagePreparingReporter {
  private target: ArkmeMessagePreparingTarget | undefined
  private reportedTarget: ArkmeMessagePreparingTarget | undefined
  private desired: { target: ArkmeMessagePreparingTarget; revision: number } | undefined
  private revision = 0
  private sentRevision = 0
  private activityExpiresAt = 0
  private lastEventAt = 0
  private failures = 0
  private disabledUntil = 0
  private focused = false
  private disposed = false
  private inFlight = false
  private armTimer: ReturnType<typeof setTimeout> | undefined
  private emptyTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly transport: ArkmeMessagePreparingTransport, private readonly now = () => Date.now()) {}

  setTarget(target: ArkmeMessagePreparingTarget | undefined): void {
    if (this.disposed || sameTarget(this.target, target)) return
    this.stop()
    this.target = target === undefined ? undefined : { ...target }
    this.failures = 0
    this.disabledUntil = 0
  }

  setFocused(focused: boolean): void {
    if (this.disposed) return
    this.focused = focused
    if (!focused) this.stop()
  }

  /** Only genuine composer edits call this; restoring a draft must not publish presence. */
  input(text: string): void {
    if (this.disposed || !this.focused || this.target === undefined) return
    clearTimeout(this.emptyTimer)
    if (text.trim() === '') {
      clearTimeout(this.armTimer)
      this.armTimer = undefined
      if (this.desired !== undefined) {
        this.activityExpiresAt = Math.min(this.activityExpiresAt, this.now() + 300)
        this.emptyTimer = setTimeout(() => { this.stop() }, Math.max(0, this.activityExpiresAt - this.now()))
      }
      return
    }
    this.activityExpiresAt = this.now() + 5000
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => { this.stop() }, 5000)
    if (this.desired !== undefined || this.armTimer !== undefined) return
    this.armTimer = setTimeout(() => {
      this.armTimer = undefined
      this.requestReport()
      if (this.desired === undefined) return
      this.heartbeatTimer = setInterval(() => {
        if (this.now() >= this.activityExpiresAt) this.stop()
        else this.requestReport()
      }, 3000)
    }, 600)
  }

  stop(): void {
    this.clearActivity()
    void this.flush()
  }

  private clearActivity(): void {
    clearTimeout(this.armTimer)
    clearTimeout(this.emptyTimer)
    clearTimeout(this.idleTimer)
    clearInterval(this.heartbeatTimer)
    this.armTimer = this.emptyTimer = this.idleTimer = this.heartbeatTimer = undefined
    this.desired = undefined
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    this.target = undefined
  }

  private timestamp(): number {
    // Same-millisecond start/cancel still need distinct server state_version values.
    this.lastEventAt = Math.max(this.now(), this.lastEventAt + 1)
    return this.lastEventAt
  }

  private requestReport(): void {
    if (this.disposed || !this.focused || this.target === undefined) return
    this.desired = { target: this.target, revision: ++this.revision }
    void this.flush()
  }

  private async flush(): Promise<void> {
    if (this.desired !== undefined && this.now() >= this.activityExpiresAt) this.clearActivity()
    if (this.inFlight) return
    // Retain only the latest intent. A previously dispatched start must finish and
    // be canceled against its captured target before a different target starts.
    const cancelTarget = this.reportedTarget !== undefined
      && !sameTarget(this.reportedTarget, this.desired?.target) ? this.reportedTarget : undefined
    const report = cancelTarget === undefined && this.desired !== undefined
      && this.desired.revision > this.sentRevision && this.disabledUntil <= this.now()
      ? this.desired : undefined
    if (cancelTarget === undefined && report === undefined) return
    this.inFlight = true
    if (cancelTarget !== undefined) this.reportedTarget = undefined
    else if (report !== undefined) {
      this.reportedTarget = report.target
      this.sentRevision = report.revision
    }
    try {
      if (cancelTarget !== undefined) await this.transport.cancel(cancelTarget, this.timestamp())
      else if (report !== undefined) await this.transport.report(report.target, this.timestamp())
      if (report !== undefined && sameTarget(report.target, this.target)) this.failures = 0
    } catch {
      // Optional transient hints never fail the composer or enter the message queue.
      if (report !== undefined && sameTarget(report.target, this.target) && ++this.failures >= 3) {
        this.disabledUntil = this.now() + 30_000
      }
    } finally {
      this.inFlight = false
      void this.flush()
    }
  }
}

function sameTarget(left: ArkmeMessagePreparingTarget | undefined, right: ArkmeMessagePreparingTarget | undefined): boolean {
  return left === right || (left !== undefined && right !== undefined
    && left.accountScope === right.accountScope && left.sourceKey === right.sourceKey && left.sourceRef === right.sourceRef)
}
