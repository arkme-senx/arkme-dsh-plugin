/** Transport-independent query snapshots. Defaults and business permissions belong to consumers. */
export interface ResourceSnapshot<T> {
  readonly value: T | undefined
  readonly updatedAt: number
  readonly stale: boolean
  readonly refreshing: boolean
  readonly mutating: boolean
  readonly error: unknown
  readonly operationError: unknown
}

export interface ResourceAdapter<T, B> {
  load(binding: B, signal: AbortSignal): Promise<T>
  accept?(current: T, next: T): boolean
  restore?(binding: B): T | undefined
  persist?(binding: B, value: T): void
  freshForMs?: number
}

export interface ResourceMutation<T, B> {
  readonly binding: B
  readonly signal: AbortSignal
  value(): T | undefined
  current(): boolean
  read(): Promise<T>
  commit(value: T): void
  invalidate(): void
}

interface Entry<T, B> {
  binding: B
  snapshot: ResourceSnapshot<T>
  listeners: Set<() => void>
  version: number
  pending: Promise<T> | undefined
  reader: AbortController | undefined
  writer: AbortController | undefined
  timer: ReturnType<typeof setTimeout> | undefined
  dirty: boolean
}

export function resourceCancelled(): Error { return new DOMException('操作已取消', 'AbortError') }
export function isResourceCancelled(error: unknown): boolean { return error instanceof Error && error.name === 'AbortError' }
class OlderResourceValue extends Error { constructor() { super('读取到较旧的状态，请重试') } }

export class ResourceStore<T, B> {
  readonly empty: ResourceSnapshot<T> = { value: undefined, updatedAt: 0, stale: true, refreshing: false,
    mutating: false, error: undefined, operationError: undefined }
  private entries = new Map<string, Entry<T, B>>()

  constructor(private readonly adapter: ResourceAdapter<T, B>, private readonly now = Date.now, private readonly capacity = 100) {}

  get(key: string, binding?: B): ResourceSnapshot<T> {
    return this.entries.get(key)?.snapshot ?? (binding === undefined ? this.empty : this.entry(key, binding).snapshot)
  }

  subscribe(key: string, binding: B, listener: () => void): () => void {
    const entry = this.entry(key, binding)
    entry.listeners.add(listener)
    this.prune()
    return () => { entry.listeners.delete(listener); this.prune() }
  }

  private entry(key: string, binding: B): Entry<T, B> {
    let entry = this.entries.get(key)
    if (entry === undefined) {
      let value: T | undefined
      try { value = this.adapter.restore?.(binding) } catch { /* Optional storage must not block a query. */ }
      entry = { binding, snapshot: { ...this.empty, value }, listeners: new Set(), version: 0,
        pending: undefined, reader: undefined, writer: undefined, timer: undefined, dirty: false }
    }
    entry.binding = binding
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  private publish(entry: Entry<T, B>, patch: Partial<ResourceSnapshot<T>>): void {
    entry.snapshot = { ...entry.snapshot, ...patch }
    for (const listener of entry.listeners) listener()
  }

  private commit(entry: Entry<T, B>, value: T): void {
    const previous = entry.snapshot.value
    if (previous !== undefined && this.adapter.accept?.(previous, value) === false) throw new OlderResourceValue()
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    this.publish(entry, { value, updatedAt: this.now(), stale: false, error: undefined })
    try { this.adapter.persist?.(entry.binding, value) } catch { /* A persistence failure is not a failed server command. */ }
    const age = this.adapter.freshForMs
    if (age !== undefined) entry.timer = setTimeout(() => {
      entry.timer = undefined
      this.publish(entry, { stale: true })
    }, age)
  }

  refresh(key: string, binding: B, force = true, recheck = false): Promise<T> {
    const entry = this.entry(key, binding)
    if (entry.writer !== undefined) { entry.dirty = true; return Promise.reject(resourceCancelled()) }
    if (entry.pending !== undefined) return entry.pending
    if (!force && !entry.snapshot.stale && entry.snapshot.value !== undefined) return Promise.resolve(entry.snapshot.value)
    const controller = new AbortController()
    const version = ++entry.version
    const current = () => !controller.signal.aborted && this.entries.get(key) === entry && entry.version === version
    entry.reader = controller
    entry.dirty = false
    const pending = Promise.resolve().then(() => this.adapter.load(binding, controller.signal)).then(value => {
      if (!current()) throw resourceCancelled()
      this.commit(entry, value)
      return value
    }).catch(error => {
      if (current() && !isResourceCancelled(error)) {
        this.publish(entry, { error, stale: true })
        if (error instanceof OlderResourceValue && !recheck) entry.dirty = true
      }
      throw error
    }).finally(() => {
      if (entry.reader !== controller) return
      entry.reader = undefined
      entry.pending = undefined
      this.publish(entry, { refreshing: false })
      if (entry.dirty && entry.listeners.size > 0) void this.refresh(key, entry.binding, true, true).catch(() => undefined)
      this.prune()
    })
    entry.pending = pending
    this.publish(entry, { refreshing: true, error: undefined })
    return pending
  }

  invalidate(key?: string): void {
    // Refresh updates LRU order; iterate a snapshot so a moved entry is not invalidated twice.
    for (const [identity, entry] of [...this.entries]) {
      if (key !== undefined && identity !== key) continue
      entry.dirty = true
      this.publish(entry, { stale: true })
      if (entry.pending === undefined && entry.writer === undefined && entry.listeners.size > 0) {
        void this.refresh(identity, entry.binding).catch(() => undefined)
      }
    }
  }

  async mutate<R>(key: string, binding: B, operation: (context: ResourceMutation<T, B>) => Promise<R>): Promise<R | undefined> {
    const entry = this.entry(key, binding)
    if (entry.writer !== undefined) return undefined
    const controller = new AbortController()
    const version = ++entry.version
    entry.reader?.abort()
    entry.reader = undefined
    entry.pending = undefined
    entry.writer = controller
    const current = () => !controller.signal.aborted && this.entries.get(key) === entry && entry.version === version
    const commit = (value: T) => {
      if (!current()) throw resourceCancelled()
      this.commit(entry, value)
      this.publish(entry, { operationError: undefined })
    }
    this.publish(entry, { mutating: true, refreshing: false })
    try {
      return await operation({ binding, signal: controller.signal, current, value: () => entry.snapshot.value, commit,
        read: async () => {
          const value = await this.adapter.load(binding, controller.signal)
          if (!current()) throw resourceCancelled()
          this.commit(entry, value)
          return value
        },
        invalidate: () => { entry.dirty = true },
      })
    } catch (error) {
      if (current() && !isResourceCancelled(error)) this.publish(entry, { operationError: error })
      throw error
    } finally {
      if (entry.writer === controller) {
        entry.writer = undefined
        this.publish(entry, { mutating: false })
        if (current() && entry.dirty && entry.listeners.size > 0) void this.refresh(key, entry.binding).catch(() => undefined)
        this.prune()
      }
    }
  }

  reset(matches: (key: string) => boolean = () => true): void {
    for (const [key, entry] of this.entries) {
      if (!matches(key)) continue
      entry.reader?.abort(); entry.writer?.abort()
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      entry.version += 1
      entry.reader = undefined; entry.writer = undefined; entry.pending = undefined; entry.timer = undefined
      entry.dirty = false
      if (entry.listeners.size === 0) this.entries.delete(key)
      else this.publish(entry, this.empty)
    }
  }

  private prune(): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.capacity) break
      if (entry.listeners.size > 0 || entry.pending !== undefined || entry.writer !== undefined) continue
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      this.entries.delete(key)
    }
  }
}
