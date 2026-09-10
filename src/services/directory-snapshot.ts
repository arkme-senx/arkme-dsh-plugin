import { randomUUID } from 'node:crypto'

export interface DirectorySnapshot<T> { id: string; value: T; expiresAt: number }
interface Scan<T> { controller: AbortController; promise: Promise<DirectorySnapshot<T>>; observers: number; refresh: boolean }
interface RetainedSnapshot<T> { key: string; snapshot: DirectorySnapshot<T>; retainedUntil: number }

/** One bounded owner snapshot; pagination never silently switches to another array. */
export class DirectorySnapshotStore<T> {
  private readonly snapshots = new Map<string, RetainedSnapshot<T>>()
  private readonly scans = new Map<string, Scan<T>>()

  clear(): void {
    this.snapshots.clear()
    for (const scan of this.scans.values()) scan.controller.abort()
    this.scans.clear()
  }

  /** A page keeps its original snapshot; freshness only controls new first-page reads. */
  get(key: string, id: string): DirectorySnapshot<T> | undefined {
    this.prune()
    const retained = this.snapshots.get(id)
    return retained?.key === key ? retained.snapshot : undefined
  }

  private prune(): void {
    for (const [id, value] of this.snapshots) if (value.retainedUntil <= Date.now()) this.snapshots.delete(id)
  }

  async read(key: string, load: (signal: AbortSignal) => Promise<T>, options: { signal?: AbortSignal; refresh?: boolean; ttl?: number } = {}): Promise<DirectorySnapshot<T>> {
    if (options.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
    this.prune()
    const cached = [...this.snapshots.values()].reverse().find(value => value.key === key && value.snapshot.expiresAt > Date.now())?.snapshot
    if (!options.refresh && cached !== undefined) return cached
    let scan = this.scans.get(key)
    if (scan === undefined || scan.controller.signal.aborted) {
      const controller = new AbortController()
      const promise = Promise.resolve().then(() => load(controller.signal)).then(value => {
        if (controller.signal.aborted) throw new DOMException('The operation was aborted', 'AbortError')
        const snapshot = { id: randomUUID(), value, expiresAt: Date.now() + (options.ttl ?? 30_000) }
        if (this.scans.get(key) === entry) {
          // An explicit refresh or owner revision starts a new traversal. Ordinary
          // cache expiry must not evict another consumer's ongoing pagination.
          if (entry.refresh) for (const [id, value] of this.snapshots) if (value.key === key) this.snapshots.delete(id)
          this.snapshots.set(snapshot.id, { key, snapshot, retainedUntil: Date.now() + 30 * 60_000 })
          while (this.snapshots.size > 4) this.snapshots.delete(this.snapshots.keys().next().value!)
        }
        return snapshot
      }).finally(() => { if (this.scans.get(key) === entry) this.scans.delete(key) })
      const entry: Scan<T> = { controller, observers: 0, promise, refresh: options.refresh === true }
      this.scans.set(key, entry)
      scan = entry
    }
    // A joining explicit refresh shares the work but must retain its invalidation intent.
    if (options.refresh) scan.refresh = true
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
