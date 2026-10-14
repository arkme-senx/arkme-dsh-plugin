/** One trailing refresh per mounted conversation, shared by all notification sources. */
export class TimelineRefreshScheduler {
  private pending = false
  private readers = 0
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private retryKey = ''
  private retries = 0
  private pendingDelay = Infinity
  private dueAt = Infinity

  constructor(private readonly refresh: () => void, private readonly delayMillis = 250) {}

  request(delayMillis = this.delayMillis): void {
    this.pending = true
    this.pendingDelay = Math.min(this.pendingDelay, Math.max(0, delayMillis))
    this.schedule()
  }

  /** Only version races are replayed here; transport recovery belongs to the Host. */
  retry(key: string): boolean {
    if (key !== this.retryKey) { this.retryKey = key; this.retries = 0 }
    if (++this.retries > 2) return false
    this.request()
    return true
  }

  begin(consumesRefresh: boolean): () => void {
    const generation = this.generation
    this.readers++
    if (consumesRefresh) { this.pending = false; this.pendingDelay = Infinity }
    this.clearTimer()
    let finished = false
    return () => {
      if (finished || generation !== this.generation) return
      finished = true
      this.readers--
      this.schedule()
    }
  }

  reset(): void {
    this.generation++
    this.pending = false
    this.pendingDelay = Infinity
    this.readers = 0
    this.retryKey = ''
    this.retries = 0
    this.clearTimer()
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.dueAt = Infinity
  }

  private schedule(): void {
    if (!this.pending || this.readers) return
    const delay = this.pendingDelay
    const dueAt = Date.now() + delay
    if (this.timer !== undefined && this.dueAt <= dueAt) return
    this.clearTimer()
    this.dueAt = dueAt
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.dueAt = Infinity
      this.pending = false
      this.pendingDelay = Infinity
      this.refresh()
    }, delay)
  }
}
