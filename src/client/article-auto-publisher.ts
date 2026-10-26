/** One writer per open article. Timers only exist while there are unsent edits. */
export class ArticleAutoPublisher {
  private idle: ReturnType<typeof setTimeout> | undefined
  private deadline: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | undefined
  private stopped = false
  private failed = false
  constructor(private readonly io: {
    dirty(): boolean
    ready(): boolean
    publish(): Promise<void>
    onError(error: unknown): void
  }) {}
  changed() {
    if (this.stopped) return
    this.failed = false
    this.schedule()
  }
  readyChanged() { if (!this.failed) this.schedule() }
  private schedule() {
    if (this.stopped || !this.io.dirty()) { this.clear(); return }
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => this.attempt(), 5_000)
    this.deadline ??= setTimeout(() => this.attempt(), 30_000)
  }
  private attempt() {
    this.clear()
    if (!this.io.ready()) return // composition/image completion schedules the next attempt
    void this.flush().catch(() => {})
  }
  /** Leave/share is a barrier: include edits made while a previous write was in flight. */
  flush(): Promise<void> {
    this.clear()
    if (this.running) return this.running
    this.running = Promise.resolve().then(async () => {
      while (this.io.dirty()) {
        if (!this.io.ready()) throw new Error('当前修改尚未准备完成，请等待输入或图片处理完成')
        await this.io.publish()
      }
      this.failed = false
    }).catch(error => { this.failed = true; this.io.onError(error); throw error })
      .finally(() => { this.running = undefined })
    return this.running
  }
  stop() { this.stopped = true; this.clear() }
  private clear() {
    if (this.idle) clearTimeout(this.idle)
    if (this.deadline) clearTimeout(this.deadline)
    this.idle = this.deadline = undefined
  }
}
