export interface ArkmeAvatarImagePayload {
  mediaType: string
  dataBase64: string
}

export type ArkmeAvatarImageListener = (imageDataUrl: string | undefined) => void

export interface ArkmeAvatarImagePort {
  activateScope(scopeKey: string | undefined): void
  current(imageRef: string): string | undefined
  load(imageRef: string): Promise<string>
  subscribe(imageRef: string, listener: ArkmeAvatarImageListener): () => void
  revalidateActive(): Promise<void>
}

interface AvatarImageEntry {
  expiresAtMillis: number
  pending: Promise<string> | undefined
  value?: string
}

interface InMemoryArkmeAvatarImageStoreOptions {
  reader: (imageRef: string) => Promise<ArkmeAvatarImagePayload>
  onLoadFailure?: (failure: {
    imageRef: string
    scopeKey: string | undefined
    trigger: 'load' | 'revalidate'
    hasCachedImage: boolean
    durationMillis: number
    error: unknown
  }) => void
  now?: () => number
  ttlMillis?: number
  jitterMillis?: number | (() => number)
  concurrency?: number
}

const DEFAULT_TTL_MILLIS = 10 * 60 * 1000
const DEFAULT_JITTER_MILLIS = 2 * 60 * 1000
const DEFAULT_CONCURRENCY = 6
const AVATAR_IMAGE_SCOPE_CHANGED = 'Avatar image scope changed'

export class InMemoryArkmeAvatarImageStore implements ArkmeAvatarImagePort {
  private readonly entries = new Map<string, AvatarImageEntry>()
  private readonly listeners = new Map<string, Set<ArkmeAvatarImageListener>>()
  private readonly queue: Array<() => void> = []
  private readonly now: () => number
  private readonly ttlMillis: number
  private readonly jitterMillis: () => number
  private readonly concurrency: number
  private activeDownloads = 0
  private generation = 0
  private scopeKey: string | undefined

  constructor(private readonly options: InMemoryArkmeAvatarImageStoreOptions) {
    this.now = options.now ?? Date.now
    this.ttlMillis = options.ttlMillis ?? DEFAULT_TTL_MILLIS
    this.concurrency = Math.max(1, Math.trunc(options.concurrency ?? DEFAULT_CONCURRENCY))
    const jitterMillis = options.jitterMillis ?? DEFAULT_JITTER_MILLIS
    this.jitterMillis = typeof jitterMillis === 'function'
      ? jitterMillis
      : () => Math.floor(Math.random() * jitterMillis)
  }

  activateScope(scopeKey: string | undefined): void {
    const normalizedScopeKey = scopeKey?.trim() || undefined
    if (normalizedScopeKey === this.scopeKey) return
    this.scopeKey = normalizedScopeKey
    this.generation += 1
    this.entries.clear()
    for (const listeners of this.listeners.values()) {
      for (const listener of listeners) listener(undefined)
    }
    if (normalizedScopeKey !== undefined) void this.revalidateActive()
  }

  current(imageRef: string): string | undefined {
    return this.entries.get(imageRef)?.value
  }

  load(imageRef: string): Promise<string> {
    return this.loadInternal(imageRef, false)
  }

  subscribe(imageRef: string, listener: ArkmeAvatarImageListener): () => void {
    let listeners = this.listeners.get(imageRef)
    if (listeners === undefined) {
      listeners = new Set()
      this.listeners.set(imageRef, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0) this.listeners.delete(imageRef)
    }
  }

  async revalidateActive(): Promise<void> {
    const activeRefs = [...this.listeners.entries()]
      .filter(([, listeners]) => listeners.size > 0)
      .map(([imageRef]) => imageRef)
    await Promise.allSettled(activeRefs.map(async imageRef => await this.loadInternal(imageRef, true)))
  }

  private loadInternal(imageRef: string, force: boolean): Promise<string> {
    const existing = this.entries.get(imageRef)
    if (existing?.pending !== undefined) return existing.pending
    if (!force && existing?.value !== undefined && existing.expiresAtMillis > this.now()) {
      return Promise.resolve(existing.value)
    }

    const generation = this.generation
    const scopeKey = this.scopeKey
    const startedAtMillis = this.now()
    const entry = existing ?? { expiresAtMillis: 0, pending: undefined }
    const pending = this.schedule(async () => {
      if (generation !== this.generation) throw new Error(AVATAR_IMAGE_SCOPE_CHANGED)
      return await this.options.reader(imageRef)
    })
      .then(payload => {
        if (generation !== this.generation) throw new Error(AVATAR_IMAGE_SCOPE_CHANGED)
        const value = `data:${payload.mediaType};base64,${payload.dataBase64}`
        const previousValue = entry.value
        entry.value = value
        entry.expiresAtMillis = this.now() + this.ttlMillis + Math.max(0, this.jitterMillis())
        entry.pending = undefined
        this.entries.set(imageRef, entry)
        if (previousValue !== value) this.notify(imageRef, value)
        return value
      })
      .catch(error => {
        if (generation === this.generation && this.entries.get(imageRef) === entry) {
          entry.pending = undefined
          if (entry.value === undefined) this.entries.delete(imageRef)
          try {
            this.options.onLoadFailure?.({
              imageRef, scopeKey, error,
              trigger: force ? 'revalidate' : 'load',
              hasCachedImage: entry.value !== undefined,
              durationMillis: Math.max(0, this.now() - startedAtMillis),
            })
          } catch { /* A diagnostic sink must not alter cache behavior or the rejection. */ }
        }
        throw error
      })
    entry.pending = pending
    this.entries.set(imageRef, entry)
    return pending
  }

  private schedule<T>(load: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        void load().then(resolve, reject).finally(() => {
          this.activeDownloads -= 1
          this.drainQueue()
        })
      })
      this.drainQueue()
    })
  }

  private drainQueue(): void {
    while (this.activeDownloads < this.concurrency) {
      const start = this.queue.shift()
      if (start === undefined) return
      this.activeDownloads += 1
      start()
    }
  }

  private notify(imageRef: string, value: string | undefined): void {
    for (const listener of this.listeners.get(imageRef) ?? []) listener(value)
  }
}
