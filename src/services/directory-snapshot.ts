import { randomUUID } from 'node:crypto'

export interface DirectorySnapshot<T> { id: string; value: T; expiresAt: number }
interface Scan<T> { controller: AbortController; promise: Promise<DirectorySnapshot<T>>; observers: number }

/** One bounded owner snapshot; pagination never silently switches to another array. */
export class DirectorySnapshotStore<T> {
  private readonly snapshots = new Map<string, DirectorySnapshot<T>>()
  private readonly scans = new Map<string, Scan<T>>()

  clear(): void {
    this.snapshots.clear()
    for (const scan of this.scans.values()) scan.controller.abort()
    this.scans.clear()
  }

  async read(key: string, load: (signal: AbortSignal) => Promise<T>, options: { signal?: AbortSignal; refresh?: boolean; ttl?: number } = {}): Promise<DirectorySnapshot<T>> {
    if (options.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
    for (const [scope, snapshot] of this.snapshots) if (snapshot.expiresAt <= Date.now()) this.snapshots.delete(scope)
    const cached = this.snapshots.get(key)
    if (!options.refresh && cached !== undefined) return cached
    let scan = this.scans.get(key)
    if (scan === undefined || scan.controller.signal.aborted) {
      const controller = new AbortController()
      const promise = Promise.resolve().then(() => load(controller.signal)).then(value => {
        if (controller.signal.aborted) throw new DOMException('The operation was aborted', 'AbortError')
        const snapshot = { id: randomUUID(), value, expiresAt: Date.now() + (options.ttl ?? 30_000) }
        if (this.scans.get(key) === entry) {
          this.snapshots.set(key, snapshot)
          while (this.snapshots.size > 4) this.snapshots.delete(this.snapshots.keys().next().value!)
        }
        return snapshot
      }).finally(() => { if (this.scans.get(key) === entry) this.scans.delete(key) })
      const entry: Scan<T> = { controller, observers: 0, promise }
      this.scans.set(key, entry)
      scan = entry
    }
    const current = scan
    current.observers += 1
    try {
      return await new Promise<DirectorySnapshot<T>>((resolve, reject) => {
        const abort = () => reject(new DOMException('The operation was aborted', 'AbortError'))
        options.signal?.addEventListener('abort', abort, { once: true })
        void current.promise.then(resolve, reject).finally(() => options.signal?.removeEventListener('abort', abort))
      })
    } finally {
      current.observers -= 1
      if (current.observers === 0) current.controller.abort()
    }
  }
}
