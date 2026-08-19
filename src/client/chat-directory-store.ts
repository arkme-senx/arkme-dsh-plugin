import type { ArkmeSourceItem, ArkmeSourceList } from '../types.js'
import { callArkme } from './api.js'

const DEFAULT_ROOT_CACHE_MAX_AGE_MS = 30_000
const MAX_ROOT_PAGES = 10

interface ArkmeChatDirectoryStoreOptions {
  loadPage?: (cursor?: string, force?: boolean) => Promise<ArkmeSourceList>
  maxAgeMs?: number
  now?: () => number
}

export interface ArkmeChatDirectorySnapshot {
  revision: number
  sources: ArkmeSourceItem[]
}

export class ArkmeChatDirectoryStore {
  private snapshot: ArkmeChatDirectorySnapshot = { revision: 0, sources: [] }
  private readonly listeners = new Set<() => void>()
  private readonly loadPage: (cursor?: string, force?: boolean) => Promise<ArkmeSourceList>
  private readonly maxAgeMs: number
  private readonly now: () => number
  private refreshInFlight: Promise<ArkmeSourceItem[]> | undefined
  private refreshedAtMillis = 0
  private accountUserId: number | undefined
  private generation = 0

  constructor(options: ArkmeChatDirectoryStoreOptions = {}) {
    this.loadPage = options.loadPage ?? (async (cursor, force) => await callArkme<ArkmeSourceList>('sources.list', {
      directory: 'root', limit: 100, ...(cursor === undefined ? {} : { cursor }), ...(force === true ? { refresh: true } : {}),
    }))
    this.maxAgeMs = Math.max(0, Math.trunc(options.maxAgeMs ?? DEFAULT_ROOT_CACHE_MAX_AGE_MS))
    this.now = options.now ?? Date.now
  }

  readonly getSnapshot = (): ArkmeChatDirectorySnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  activateAccount(userId: number | undefined): void {
    const normalized = Number.isSafeInteger(userId) && (userId ?? 0) > 0 ? userId : undefined
    if (normalized === this.accountUserId) return
    this.accountUserId = normalized
    this.generation += 1
    this.refreshInFlight = undefined
    this.refreshedAtMillis = 0
    if (this.snapshot.sources.length > 0) this.publish([])
  }

  async refreshRoot(options: { force?: boolean } = {}): Promise<ArkmeSourceItem[]> {
    if (options.force !== true && this.refreshedAtMillis > 0
      && this.now() - this.refreshedAtMillis < this.maxAgeMs) return [...this.snapshot.sources]
    if (this.refreshInFlight !== undefined) return await this.refreshInFlight
    const generation = this.generation
    const pending = (async () => {
      const loaded: ArkmeSourceItem[] = []
      const seen = new Set<string>()
      let cursor: string | undefined
      for (let pageIndex = 0; pageIndex < MAX_ROOT_PAGES; pageIndex += 1) {
        const page = await this.loadPage(cursor, options.force === true)
        for (const source of page.items) {
          if (seen.has(source.sourceRef)) continue
          seen.add(source.sourceRef)
          loaded.push(source)
        }
        if (!page.hasMore || page.nextCursor === undefined) break
        cursor = page.nextCursor
      }
      if (generation !== this.generation) return [...this.snapshot.sources]
      this.refreshedAtMillis = this.now()
      this.publish(loaded)
      return [...loaded]
    })()
    this.refreshInFlight = pending
    try {
      return await pending
    } finally {
      if (this.refreshInFlight === pending) this.refreshInFlight = undefined
    }
  }

  publish(sources: ArkmeSourceItem[]): void {
    this.snapshot = { revision: this.snapshot.revision + 1, sources: [...sources] }
    for (const listener of this.listeners) listener()
  }

  upsert(source: ArkmeSourceItem): void {
    this.upsertMany([source])
  }

  upsertMany(updates: ArkmeSourceItem[]): void {
    let sources = [...this.snapshot.sources]
    for (const source of updates) {
      const existingIndex = sources.findIndex(item => item.sourceRef === source.sourceRef)
      const existing = existingIndex < 0 ? undefined : sources[existingIndex]
      const normalized = existing === undefined
        ? source
        : { ...source, activeAtMillis: Math.max(existing.activeAtMillis, source.activeAtMillis) }
      if (existing !== undefined && normalized.activeAtMillis <= existing.activeAtMillis) {
        sources[existingIndex] = normalized
        continue
      }
      sources = sources.filter(item => item.sourceRef !== source.sourceRef)
      const insertionIndex = sources.findIndex(item => item.activeAtMillis < normalized.activeAtMillis)
      sources.splice(insertionIndex < 0 ? sources.length : insertionIndex, 0, normalized)
    }
    this.publish(sources)
  }

  unreadCount(sourceRef: string): number {
    return this.snapshot.sources.find(item => item.sourceRef === sourceRef)?.unreadCount ?? 0
  }

  updateUnread(sourceRef: string, unreadCount: number): void {
    const index = this.snapshot.sources.findIndex(item => item.sourceRef === sourceRef)
    if (index < 0) return
    const sources = [...this.snapshot.sources]
    sources[index] = { ...sources[index]!, unreadCount: Math.max(0, Math.trunc(unreadCount)) }
    this.publish(sources)
  }

  clear(): void {
    this.generation += 1
    this.refreshInFlight = undefined
    this.refreshedAtMillis = 0
    if (this.snapshot.sources.length > 0) this.publish([])
  }
}

export const arkmeChatDirectory = new ArkmeChatDirectoryStore()

export interface ArkmeChatTimelineDeltaSnapshot {
  revision: number
  itemsBySourceRef: Record<string, import('../types.js').ArkmeTimelineItem[]>
}

export class ArkmeChatTimelineDeltaStore {
  private snapshot: ArkmeChatTimelineDeltaSnapshot = { revision: 0, itemsBySourceRef: {} }
  private readonly listeners = new Set<() => void>()
  readonly getSnapshot = (): ArkmeChatTimelineDeltaSnapshot => this.snapshot
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  publish(updates: Array<{ sourceRef: string; items: import('../types.js').ArkmeTimelineItem[] }>): void {
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      itemsBySourceRef: Object.fromEntries(updates.map(update => [update.sourceRef, [...update.items]])),
    }
    for (const listener of this.listeners) listener()
  }
}

export const arkmeChatTimelineDelta = new ArkmeChatTimelineDeltaStore()

export interface ArkmeInterwovenInvalidationSnapshot {
  revision: number
}

/** Realtime frames are invalidation hints only; interwoven content always comes from its owner read endpoint. */
export class ArkmeInterwovenInvalidationStore {
  private snapshot: ArkmeInterwovenInvalidationSnapshot = { revision: 0 }
  private readonly listeners = new Set<() => void>()
  readonly getSnapshot = (): ArkmeInterwovenInvalidationSnapshot => this.snapshot
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  invalidate(): void {
    this.snapshot = { revision: this.snapshot.revision + 1 }
    for (const listener of this.listeners) listener()
  }
}

export const arkmeInterwovenInvalidation = new ArkmeInterwovenInvalidationStore()
