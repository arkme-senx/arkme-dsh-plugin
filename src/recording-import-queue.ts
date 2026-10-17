/** Admission is independent of execution capacity. Queued work retains its FIFO position. */
export class RecordingImportQueue {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly concurrency: number) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Invalid import concurrency')
  }

  run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return }
      const abort = () => {
        const index = this.waiting.indexOf(start)
        if (index >= 0) this.waiting.splice(index, 1)
        reject(signal.reason)
      }
      const start = () => {
        signal.removeEventListener('abort', abort)
        this.active++
        void Promise.resolve().then(() => {
          signal.throwIfAborted()
          return work()
        }).then(resolve, reject).finally(() => {
          this.active--
          this.drain()
        })
      }
      signal.addEventListener('abort', abort, { once: true })
      this.waiting.push(start)
      this.drain()
    })
  }

  private drain(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) this.waiting.shift()!()
  }
}
