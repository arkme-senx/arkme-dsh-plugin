/** One in-flight acknowledgement and one latest pending intent per conversation. */
export class ConversationReadAckQueue {
  private pending: { sequence: number; run: () => Promise<void> } | undefined
  private running: Promise<void> | undefined
  private activeSequence = 0
  private lastStarted = -Infinity
  private flushPending: (() => void) | undefined
  private closing = false

  constructor(private readonly intervalMillis = 1000) {}

  /** Already observed messages remain read when leaving; flush that one accepted intent. */
  close(): void { this.closing = true; this.flushPending?.() }

  enqueue(sequence: number, run: () => Promise<void>): Promise<void> {
    if (this.running && sequence <= this.activeSequence) return this.running
    if (!this.pending || sequence >= this.pending.sequence) this.pending = { sequence, run }
    return this.running ??= Promise.resolve().then(async () => {
      try {
        while (this.pending) {
          const wait = this.lastStarted + this.intervalMillis - Date.now()
          if (!this.closing && wait > 0) await new Promise<void>(resolve => {
            const timer = setTimeout(done, wait)
            const owner = this
            function done() { clearTimeout(timer); owner.flushPending = undefined; resolve() }
            this.flushPending = done
          })
          const next = this.pending
          this.pending = undefined
          this.activeSequence = next.sequence
          this.lastStarted = Date.now()
          await next.run()
        }
      } finally { this.activeSequence = 0; this.running = undefined }
    })
  }
}
