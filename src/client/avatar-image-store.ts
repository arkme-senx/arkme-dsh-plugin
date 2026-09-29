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
  revalidateActive(imageRefs?: readonly string[]): Promise<void>
}

export interface ArkmeAvatarPersistentCache {
  read(scope: string, imageRef: string): Promise<ArkmeAvatarImagePayload | undefined>
  write(scope: string, imageRef: string, payload: ArkmeAvatarImagePayload): Promise<void>
}

/** These references identify immutable bytes, unlike mutable profile references. */
export function isImmutableAvatarRef(ref: string): boolean {
  return /^file_asset:\/\/[A-Za-z0-9_-]{8,128}$/.test(ref)
    || /^arkme-self-role-image-v1\.[A-Za-z0-9_-]+$/.test(ref)
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
  persistentCache?: ArkmeAvatarPersistentCache
  now?: () => number
  ttlMillis?: number
  jitterMillis?: number | (() => number)
  concurrency?: number
}

const DEFAULT_TTL_MILLIS = 10 * 60 * 1000
const DEFAULT_JITTER_MILLIS = 2 * 60 * 1000
// Leave capacity for interactive Host calls on HTTP/1.1 origins.
const DEFAULT_CONCURRENCY = 3
const IMMUTABLE_CONCURRENCY = 2
const MAX_RETAINED_AVATARS = 256
const MAX_QUEUED_AVATARS = 512
const AVATAR_IMAGE_SCOPE_CHANGED = 'Avatar image scope changed'

export class InMemoryArkmeAvatarImageStore implements ArkmeAvatarImagePort {
  private readonly entries = new Map<string, AvatarImageEntry>()
  private readonly listeners = new Map<string, Set<ArkmeAvatarImageListener>>()
  private readonly queue: Array<{ immutable: boolean; start(): void }> = []
  private readonly now: () => number
  private readonly ttlMillis: number
  private readonly jitterMillis: () => number
  private readonly concurrency: number
  private activeDownloads = 0
  private activeImmutableReads = 0
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
      this.pruneCache()
    }
  }

  async revalidateActive(imageRefs?: readonly string[]): Promise<void> {
    const activeRefs = [...this.listeners.entries()]
      .filter(([imageRef, listeners]) => listeners.size > 0 && (imageRefs === undefined || imageRefs.includes(imageRef)))
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
    const readRemote = () => this.schedule(isImmutableAvatarRef(imageRef), async () => {
      if (generation !== this.generation) throw new Error(AVATAR_IMAGE_SCOPE_CHANGED)
      return await this.options.reader(imageRef)
    })
    const persistent = scopeKey !== undefined && isImmutableAvatarRef(imageRef) ? this.options.persistentCache : undefined
    // Disk hits must not wait for remote readers to release the shared permits.
    const read = persistent === undefined ? readRemote() : (async () => {
      const cached = await persistent.read(scopeKey!, imageRef).catch(() => undefined)
      if (generation !== this.generation) throw new Error(AVATAR_IMAGE_SCOPE_CHANGED)
      if (cached !== undefined) return cached
      const payload = await readRemote()
      if (generation !== this.generation) throw new Error(AVATAR_IMAGE_SCOPE_CHANGED)
      // Persistence is best effort and must not delay the visible avatar.
      void persistent.write(scopeKey!, imageRef, payload).catch(() => undefined)
      return payload
    })()
    const pending = read
      .then(payload => {
        if (generation !== this.generation) throw new Error(AVATAR_IMAGE_SCOPE_CHANGED)
        const value = `data:${payload.mediaType};base64,${payload.dataBase64}`
        const previousValue = entry.value
        entry.value = value
        entry.expiresAtMillis = this.now() + this.ttlMillis + Math.max(0, this.jitterMillis())
        entry.pending = undefined
        this.entries.delete(imageRef)
        this.entries.set(imageRef, entry)
        this.pruneCache()
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

  private pruneCache(): void {
    for (const [ref, entry] of this.entries) {
      if (this.entries.size <= MAX_RETAINED_AVATARS) break
      if (entry.pending === undefined && !this.listeners.has(ref)) this.entries.delete(ref)
    }
  }

  private schedule<T>(immutable: boolean, load: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.queue.length >= MAX_QUEUED_AVATARS) { reject(new Error('Avatar loading queue is full')); return }
      this.queue.push({ immutable, start: () => {
        void load().then(resolve, reject).finally(() => {
          if (immutable) this.activeImmutableReads -= 1
          else this.activeDownloads -= 1
          this.drainQueue()
        })
      } })
      this.drainQueue()
    })
  }

  private drainQueue(): void {
    for (;;) {
      // A file-asset Host cache hit must not queue behind slow profile downloads.
      const index = this.queue.findIndex(job => job.immutable
        ? this.activeImmutableReads < IMMUTABLE_CONCURRENCY : this.activeDownloads < this.concurrency)
      if (index === -1) return
      const job = this.queue.splice(index, 1)[0]!
      if (job.immutable) this.activeImmutableReads += 1
      else this.activeDownloads += 1
      job.start()
    }
  }

  private notify(imageRef: string, value: string | undefined): void {
    for (const listener of this.listeners.get(imageRef) ?? []) listener(value)
  }
}
