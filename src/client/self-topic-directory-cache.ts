import type { ArkmeEnvironment, ArkmeSourceItem, ArkmeSourceList } from '../types.js'
import { callArkme } from './api.js'
import { readNavigationCache, writeNavigationCache, type ArkmeNavigationCache } from './navigation-cache.js'
import { withArkmeReadDeadline } from './read-deadline.js'

export interface SelfTopicDirectorySnapshot {
  sources: ArkmeSourceItem[]
  complete: boolean
  loading: boolean
  error: string
  refreshedAtMillis: number
}
const FRESH_MS = 60_000
const RETAIN_MS = 7 * 86_400_000
const identity = (source: ArkmeSourceItem) => source.topicHierarchyKey ?? source.sourceRef
export function mergeSelfTopicSources(current: readonly ArkmeSourceItem[], incoming: readonly ArkmeSourceItem[]): ArkmeSourceItem[] {
  const byKey = new Map(current.map(source => [identity(source), source]))
  for (const source of incoming) byKey.set(identity(source), source)
  return [...byKey.values()]
}

/** One account-owned read survives menu unmounts; complete snapshots are replaced atomically. */
export class SelfTopicDirectoryCache {
  private snapshot: SelfTopicDirectorySnapshot
  private listeners = new Set<() => void>()
  private pending: Promise<void> | undefined
  private controller: AbortController | undefined
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private patches = new Map<string, ArkmeSourceItem>()
  constructor(
    readonly userId: number,
    readonly environment: ArkmeEnvironment,
    private readonly readPage: (cursor: string | undefined, signal: AbortSignal, refresh: boolean) => Promise<ArkmeSourceList>
      = (cursor, signal, refresh) => withArkmeReadDeadline(inner => callArkme('sources.list', {
        directory: 'send_to_self', limit: 100, ...(cursor ? { cursor } : {}), ...(refresh ? { refresh: true } : {}),
      }, inner), signal),
    private readonly readCache = readNavigationCache,
    private readonly writeCache = writeNavigationCache,
    private readonly now = Date.now,
  ) {
    const cached = readCache(userId)
    const metadata = cached?.selfTopics
    const valid = metadata?.environment === environment && metadata.refreshedAtMillis <= now()
      && now() - metadata.refreshedAtMillis < RETAIN_MS
    this.snapshot = { sources: valid ? cached?.sources.send_to_self ?? [] : [],
      complete: valid && metadata.complete, refreshedAtMillis: valid ? metadata.refreshedAtMillis : 0,
      loading: false, error: '' }
  }
  readonly getSnapshot = () => this.snapshot
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(patch: Partial<SelfTopicDirectorySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
  private persist(): void {
    const previous = this.readCache(this.userId)
    this.writeCache({ ...(previous ?? { version: 1, userId: this.userId, directory: 'root', sources: {} }),
      sources: { ...previous?.sources, send_to_self: this.snapshot.sources }, updatedAtMillis: this.now(),
      selfTopics: { environment: this.environment, complete: this.snapshot.complete, refreshedAtMillis: this.snapshot.refreshedAtMillis },
    } satisfies ArkmeNavigationCache)
  }
  ensure(force = false): Promise<void> {
    if (this.pending) { this.dirty ||= force; return this.pending }
    if (!force && !this.dirty && this.snapshot.complete && this.now() - this.snapshot.refreshedAtMillis < FRESH_MS) return Promise.resolve()
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    this.dirty = false
    const controller = new AbortController()
    this.controller = controller
    const current = () => this.controller === controller && !controller.signal.aborted
    this.publish({ loading: true, error: '' })
    const task = async () => {
      let loaded: ArkmeSourceItem[] = [], cursor: string | undefined
      const visited = new Set<string>()
      try {
        for (let index = 0; index < 100; index++) {
          const page = await this.readPage(cursor, controller.signal, force)
          if (!current()) return
          loaded = mergeSelfTopicSources(loaded, page.items)
          if (!this.snapshot.complete) this.publish({ sources: mergeSelfTopicSources(loaded, [...this.patches.values()]) })
          if (!page.hasMore) break
          if (!page.nextCursor || visited.has(page.nextCursor) || index === 99) throw Error('主题加载未完成，请重试')
          cursor = page.nextCursor; visited.add(cursor)
        }
        if (!loaded.some(source => source.kind === 'send_to_self') || !loaded.some(source => source.kind === 'default_category')) {
          throw Error('未找到发给自己或未分类，请重试')
        }
        this.publish({ sources: mergeSelfTopicSources(loaded, [...this.patches.values()]), complete: true, refreshedAtMillis: this.now() })
        this.persist()
      } catch (error) {
        if (!current()) return
        const code = (error as { body?: { code?: string } })?.body?.code ?? ''
        if (/privacy|login-required|account-changed|source-invalid|ref-invalid/.test(code)) {
          this.publish({ sources: [], complete: false, refreshedAtMillis: 0 }); this.persist()
        }
        this.publish({ error: error instanceof Error ? error.message : String(error) })
      } finally {
        if (current()) {
          this.controller = undefined; this.pending = undefined; this.patches.clear()
          this.publish({ loading: false })
          if (this.dirty && this.listeners.size) this.schedule()
        }
      }
    }
    this.pending = Promise.resolve().then(task)
    return this.pending
  }
  /** Use confirmed mutation results, never guessed count deltas. Preserve them against an older read. */
  upsert(source: ArkmeSourceItem): void {
    const next = { ...this.snapshot.sources.find(item => identity(item) === identity(source)), ...source }
    if (this.pending) this.patches.set(identity(next), next)
    this.publish({ sources: mergeSelfTopicSources(this.snapshot.sources, [next]) })
    this.persist()
  }
  invalidate(hard = false): void {
    this.dirty = true
    if (hard) {
      this.controller?.abort(); this.controller = undefined; this.pending = undefined; this.patches.clear()
      this.publish({ sources: [], complete: false, loading: false, error: '', refreshedAtMillis: 0 }); this.persist()
    }
    if (this.listeners.size) this.schedule()
  }
  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => { this.timer = undefined; if (this.listeners.size) void this.ensure(true) }, 250)
  }
  dispose(): void {
    this.controller?.abort(); this.controller = undefined; this.pending = undefined
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}

const caches = new Map<string, SelfTopicDirectoryCache>()
export function activateSelfTopicDirectoryAccount(account: string): void {
  for (const [key, cache] of caches) {
    if (key === account) continue
    cache.dispose(); caches.delete(key)
  }
}
export function selfTopicDirectory(userId: number, environment: ArkmeEnvironment): SelfTopicDirectoryCache {
  const key = `${environment}:${String(userId)}`
  let cache = caches.get(key)
  if (!cache) { cache = new SelfTopicDirectoryCache(userId, environment); caches.set(key, cache) }
  return cache
}
export function invalidateSelfTopicDirectories(hard = false): void {
  for (const cache of caches.values()) cache.invalidate(hard)
}
export function resetSelfTopicDirectories(): void {
  for (const cache of caches.values()) { cache.dispose() }
  caches.clear()
}
