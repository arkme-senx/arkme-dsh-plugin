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

export interface ArkmeChatDirectorySourceUpdate {
  source: ArkmeSourceItem
  sourceKey?: string
}

type ArkmeChatDirectoryMutation =
  | { type: 'upsert'; source: ArkmeSourceItem; sourceKey?: string }
  | { type: 'read-ack'; sourceRef: string; sourceKey?: string; effectiveReadSequence: number; unreadCount: number }

interface ArkmeChatReadTarget {
  sourceRef: string
  sourceKey?: string
  effectiveReadSequence: number
}

interface ArkmeChatReadWatermark {
  effectiveReadSequence: number
  unreadCount: number
}

interface ArkmeChatDirectoryIndexes {
  sourceKeysByRef: Map<string, string>
}

function normalizedCount(value: number): number {
  return Math.max(0, Math.trunc(value))
}

function normalizedSequence(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value ?? 0 : 0
}

function normalizedSourceKey(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized === undefined || normalized === '' ? undefined : normalized
}

function rememberSourceKey(indexes: ArkmeChatDirectoryIndexes, sourceRef: string, sourceKey: string | undefined): void {
  const normalized = normalizedSourceKey(sourceKey)
  if (normalized !== undefined) indexes.sourceKeysByRef.set(sourceRef, normalized)
}

function identityForSource(indexes: ArkmeChatDirectoryIndexes, sourceRef: string, sourceKey?: string): string {
  return normalizedSourceKey(sourceKey) ?? indexes.sourceKeysByRef.get(sourceRef) ?? sourceRef
}

function findSourceIndex(
  sources: readonly ArkmeSourceItem[],
  indexes: ArkmeChatDirectoryIndexes,
  sourceRef: string,
  sourceKey?: string,
): number {
  const identity = identityForSource(indexes, sourceRef, sourceKey)
  return sources.findIndex(item => identityForSource(indexes, item.sourceRef, item.sourceKey) === identity)
}

function recordReadWatermark(
  watermarks: Map<string, ArkmeChatReadWatermark>,
  indexes: ArkmeChatDirectoryIndexes,
  mutation: ArkmeChatReadTarget & { unreadCount: number },
): void {
  rememberSourceKey(indexes, mutation.sourceRef, mutation.sourceKey)
  const effectiveReadSequence = normalizedSequence(mutation.effectiveReadSequence)
  if (effectiveReadSequence <= 0) return
  const key = identityForSource(indexes, mutation.sourceRef, mutation.sourceKey)
  const unreadCount = normalizedCount(mutation.unreadCount)
  const existing = watermarks.get(key)
  if (existing === undefined || effectiveReadSequence > existing.effectiveReadSequence) {
    watermarks.set(key, { effectiveReadSequence, unreadCount })
    return
  }
  if (effectiveReadSequence === existing.effectiveReadSequence) {
    watermarks.set(key, {
      effectiveReadSequence,
      unreadCount: Math.min(existing.unreadCount, unreadCount),
    })
  }
}

function applyReadWatermark(
  source: ArkmeSourceItem,
  watermarks: ReadonlyMap<string, ArkmeChatReadWatermark>,
  indexes: ArkmeChatDirectoryIndexes,
  sourceKey?: string,
): ArkmeSourceItem {
  const effectiveSourceKey = sourceKey ?? source.sourceKey
  rememberSourceKey(indexes, source.sourceRef, effectiveSourceKey)
  const watermark = watermarks.get(identityForSource(indexes, source.sourceRef, effectiveSourceKey))
  if (watermark === undefined) return source
  const latestSequence = normalizedSequence(source.latestSequence)
  if (latestSequence > watermark.effectiveReadSequence) return source
  const unreadCount = Math.min(normalizedCount(source.unreadCount), watermark.unreadCount)
  return unreadCount === source.unreadCount ? source : { ...source, unreadCount }
}

function mergeSourceProjection(
  existing: ArkmeSourceItem | undefined,
  source: ArkmeSourceItem,
  watermarks: ReadonlyMap<string, ArkmeChatReadWatermark>,
  indexes: ArkmeChatDirectoryIndexes,
  sourceKey?: string,
): ArkmeSourceItem {
  const existingSequence = normalizedSequence(existing?.latestSequence)
  const sourceSequence = normalizedSequence(source.latestSequence)
  const merged = existing !== undefined && sourceSequence < existingSequence
    ? (() => {
        const latestPreview = existing.latestPreview ?? source.latestPreview
        return {
          ...source,
          ...(latestPreview === undefined ? {} : { latestPreview }),
          activeAtMillis: existing.activeAtMillis,
          unreadCount: existing.unreadCount,
          ...(existing.latestSequence === undefined ? {} : { latestSequence: existing.latestSequence }),
        }
      })()
    : {
        ...source,
        activeAtMillis: Math.max(existing?.activeAtMillis ?? 0, source.activeAtMillis),
      }
  return applyReadWatermark(merged, watermarks, indexes, sourceKey)
}

function sourceUpdate(update: ArkmeSourceItem | ArkmeChatDirectorySourceUpdate): ArkmeChatDirectorySourceUpdate {
  if ('source' in update) return update
  return { source: update, ...(update.sourceKey === undefined ? {} : { sourceKey: update.sourceKey }) }
}

function mergeReadWatermark(
  target: Map<string, ArkmeChatReadWatermark>,
  key: string,
  watermark: ArkmeChatReadWatermark,
): void {
  const existing = target.get(key)
  if (existing === undefined || watermark.effectiveReadSequence > existing.effectiveReadSequence) {
    target.set(key, { ...watermark })
    return
  }
  if (watermark.effectiveReadSequence === existing.effectiveReadSequence) {
    target.set(key, {
      effectiveReadSequence: watermark.effectiveReadSequence,
      unreadCount: Math.min(existing.unreadCount, watermark.unreadCount),
    })
  }
}

function applyDirectoryMutations(
  initialSources: readonly ArkmeSourceItem[],
  mutations: readonly ArkmeChatDirectoryMutation[],
  readWatermarks: Map<string, ArkmeChatReadWatermark>,
  indexes: ArkmeChatDirectoryIndexes,
): ArkmeSourceItem[] {
  let sources = initialSources.map(source => applyReadWatermark(source, readWatermarks, indexes))
  for (const mutation of mutations) {
    if (mutation.type === 'read-ack') {
      recordReadWatermark(readWatermarks, indexes, mutation)
      const index = findSourceIndex(sources, indexes, mutation.sourceRef, mutation.sourceKey)
      if (index >= 0) sources[index] = applyReadWatermark(sources[index]!, readWatermarks, indexes, mutation.sourceKey)
      continue
    }
    const source = mutation.source
    const sourceKey = mutation.sourceKey ?? source.sourceKey
    rememberSourceKey(indexes, source.sourceRef, sourceKey)
    const existingIndex = findSourceIndex(sources, indexes, source.sourceRef, sourceKey)
    const existing = existingIndex < 0 ? undefined : sources[existingIndex]
    const normalized = mergeSourceProjection(existing, source, readWatermarks, indexes, sourceKey)
    if (existing !== undefined && normalized.activeAtMillis <= existing.activeAtMillis) {
      sources[existingIndex] = normalized
      continue
    }
    const identity = identityForSource(indexes, source.sourceRef, sourceKey)
    sources = sources.filter(item => identityForSource(indexes, item.sourceRef, item.sourceKey) !== identity)
    const insertionIndex = sources.findIndex(item => item.activeAtMillis < normalized.activeAtMillis)
    sources.splice(insertionIndex < 0 ? sources.length : insertionIndex, 0, normalized)
  }
  return sources
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
  private baselineReady = false
  private pendingMutations: ArkmeChatDirectoryMutation[] = []
  private readonly readWatermarks = new Map<string, ArkmeChatReadWatermark>()
  private readonly optimisticReadWatermarks = new Map<string, ArkmeChatReadWatermark>()
  private readonly optimisticUnreadBackups = new Map<string, number>()
  private readonly sourceKeysByRef = new Map<string, string>()

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
    this.baselineReady = false
    this.pendingMutations = []
    this.readWatermarks.clear()
    this.optimisticReadWatermarks.clear()
    this.optimisticUnreadBackups.clear()
    this.sourceKeysByRef.clear()
    if (this.snapshot.sources.length > 0) this.commit([])
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
      return [...this.snapshot.sources]
    })()
    this.refreshInFlight = pending
    try {
      return await pending
    } finally {
      if (this.refreshInFlight === pending) this.refreshInFlight = undefined
    }
  }

  publish(sources: ArkmeSourceItem[]): void {
    const merged = applyDirectoryMutations(
      sources,
      this.pendingMutations,
      this.combinedReadWatermarks(),
      { sourceKeysByRef: this.sourceKeysByRef },
    )
    this.pendingMutations = []
    this.baselineReady = true
    this.commit(merged)
  }

  private commit(sources: ArkmeSourceItem[]): void {
    this.snapshot = { revision: this.snapshot.revision + 1, sources: [...sources] }
    for (const listener of this.listeners) listener()
  }

  upsert(source: ArkmeSourceItem, sourceKey?: string): void {
    this.upsertMany([{ source, ...(sourceKey === undefined ? {} : { sourceKey }) }])
  }

  upsertMany(updates: Array<ArkmeSourceItem | ArkmeChatDirectorySourceUpdate>): void {
    const mutations = updates.map(update => {
      const normalized = sourceUpdate(update)
      return {
        type: 'upsert' as const,
        source: normalized.source,
        ...(normalized.sourceKey === undefined ? {} : { sourceKey: normalized.sourceKey }),
      }
    })
    if (!this.baselineReady) {
      this.pendingMutations.push(...mutations)
      return
    }
    this.commit(applyDirectoryMutations(
      this.snapshot.sources,
      mutations,
      this.combinedReadWatermarks(),
      { sourceKeysByRef: this.sourceKeysByRef },
    ))
  }

  unreadCount(sourceRef: string): number {
    const indexes = { sourceKeysByRef: new Map(this.sourceKeysByRef) }
    const sources = applyDirectoryMutations(this.snapshot.sources, this.pendingMutations, this.combinedReadWatermarks(), indexes)
    const identity = identityForSource(indexes, sourceRef)
    return sources.find(item => identityForSource(indexes, item.sourceRef) === identity)?.unreadCount ?? 0
  }

  totalUnreadCount(): number {
    const sources = applyDirectoryMutations(
      this.snapshot.sources,
      this.pendingMutations,
      this.combinedReadWatermarks(),
      { sourceKeysByRef: new Map(this.sourceKeysByRef) },
    )
    return sources.reduce((sum, source) => sum + normalizedCount(source.unreadCount), 0)
  }

  markReadOptimistic(
    source: ArkmeSourceItem,
    sourceKey: string | undefined,
    effectiveReadSequence: number,
    seedSources: readonly ArkmeSourceItem[] = [],
  ): boolean {
    const target = this.normalizedReadTarget(source.sourceRef, sourceKey ?? source.sourceKey, effectiveReadSequence)
    if (target === undefined) return false
    const indexes = { sourceKeysByRef: this.sourceKeysByRef }
    const identity = identityForSource(indexes, target.sourceRef, target.sourceKey)
    const sourceIndex = findSourceIndex(this.snapshot.sources, indexes, target.sourceRef, target.sourceKey)
    const seedSourceIndex = sourceIndex < 0 ? findSourceIndex(seedSources, indexes, target.sourceRef, target.sourceKey) : -1
    const currentSource = sourceIndex >= 0
      ? this.snapshot.sources[sourceIndex]
      : seedSourceIndex >= 0 ? seedSources[seedSourceIndex] : source
    if (currentSource === undefined || normalizedCount(currentSource.unreadCount) <= 0) return false
    const existing = this.optimisticReadWatermarks.get(identity)
    if (existing !== undefined && existing.effectiveReadSequence >= target.effectiveReadSequence && existing.unreadCount === 0) return false
    if (!this.optimisticUnreadBackups.has(identity)) this.optimisticUnreadBackups.set(identity, normalizedCount(currentSource.unreadCount))
    this.optimisticReadWatermarks.set(identity, { effectiveReadSequence: target.effectiveReadSequence, unreadCount: 0 })
    const sources = sourceIndex >= 0
      ? this.snapshot.sources
      : seedSources.length > 0 ? [...seedSources] : [source, ...this.snapshot.sources]
    this.commit(applyDirectoryMutations(
      sources,
      [],
      this.combinedReadWatermarks(),
      { sourceKeysByRef: this.sourceKeysByRef },
    ))
    return true
  }

  hasOptimisticRead(sourceRef: string, sourceKey: string | undefined, effectiveReadSequence: number): boolean {
    const target = this.normalizedReadTarget(sourceRef, sourceKey, effectiveReadSequence)
    if (target === undefined) return false
    const identity = identityForSource({ sourceKeysByRef: this.sourceKeysByRef }, target.sourceRef, target.sourceKey)
    const watermark = this.optimisticReadWatermarks.get(identity)
    return watermark !== undefined && watermark.effectiveReadSequence >= target.effectiveReadSequence
  }

  rejectOptimisticRead(sourceRef: string, sourceKey: string | undefined, effectiveReadSequence: number): boolean {
    const target = this.normalizedReadTarget(sourceRef, sourceKey, effectiveReadSequence)
    if (target === undefined) return false
    const indexes = { sourceKeysByRef: this.sourceKeysByRef }
    const identity = identityForSource(indexes, target.sourceRef, target.sourceKey)
    const optimistic = this.optimisticReadWatermarks.get(identity)
    if (optimistic === undefined || optimistic.effectiveReadSequence > target.effectiveReadSequence) return false
    this.optimisticReadWatermarks.delete(identity)
    const backupUnreadCount = this.optimisticUnreadBackups.get(identity)
    this.optimisticUnreadBackups.delete(identity)
    const sources = this.snapshot.sources.map(source => {
      if (backupUnreadCount === undefined) return source
      if (identityForSource(indexes, source.sourceRef, source.sourceKey) !== identity) return source
      if (normalizedSequence(source.latestSequence) > target.effectiveReadSequence) return source
      return { ...source, unreadCount: backupUnreadCount }
    })
    this.commit(applyDirectoryMutations(
      sources,
      [],
      this.combinedReadWatermarks(),
      { sourceKeysByRef: this.sourceKeysByRef },
    ))
    return true
  }

  updateReadAck(sourceRef: string, sourceKey: string | undefined, effectiveReadSequence: number, unreadCount: number): void {
    const mutation = {
      type: 'read-ack' as const,
      sourceRef,
      ...(sourceKey === undefined ? {} : { sourceKey }),
      effectiveReadSequence,
      unreadCount,
    }
    if (!this.baselineReady) {
      this.pendingMutations.push(mutation)
      recordReadWatermark(this.readWatermarks, { sourceKeysByRef: this.sourceKeysByRef }, mutation)
      this.clearOptimisticRead(mutation)
      if (this.snapshot.sources.length > 0) {
        this.commit(applyDirectoryMutations(
          this.sourcesWithReadAckUnread(mutation),
          [],
          this.combinedReadWatermarks(),
          { sourceKeysByRef: this.sourceKeysByRef },
        ))
      }
      return
    }
    recordReadWatermark(this.readWatermarks, { sourceKeysByRef: this.sourceKeysByRef }, mutation)
    this.clearOptimisticRead(mutation)
    const sources = applyDirectoryMutations(
      this.sourcesWithReadAckUnread(mutation),
      [],
      this.combinedReadWatermarks(),
      { sourceKeysByRef: this.sourceKeysByRef },
    )
    const identity = identityForSource({ sourceKeysByRef: this.sourceKeysByRef }, sourceRef, sourceKey)
    if (sources.find(item => identityForSource({ sourceKeysByRef: this.sourceKeysByRef }, item.sourceRef) === identity) === undefined) return
    this.commit(sources)
  }

  clear(): void {
    this.generation += 1
    this.refreshInFlight = undefined
    this.refreshedAtMillis = 0
    this.baselineReady = false
    this.pendingMutations = []
    this.readWatermarks.clear()
    this.optimisticReadWatermarks.clear()
    this.optimisticUnreadBackups.clear()
    this.sourceKeysByRef.clear()
    if (this.snapshot.sources.length > 0) this.commit([])
  }

  private combinedReadWatermarks(): Map<string, ArkmeChatReadWatermark> {
    const combined = new Map<string, ArkmeChatReadWatermark>()
    for (const [key, watermark] of this.readWatermarks) mergeReadWatermark(combined, key, watermark)
    for (const [key, watermark] of this.optimisticReadWatermarks) mergeReadWatermark(combined, key, watermark)
    return combined
  }

  private normalizedReadTarget(
    sourceRef: string,
    sourceKey: string | undefined,
    effectiveReadSequence: number,
  ): ArkmeChatReadTarget | undefined {
    const normalizedSourceRef = sourceRef.trim()
    const normalizedSequenceValue = normalizedSequence(effectiveReadSequence)
    if (normalizedSourceRef === '' || normalizedSequenceValue <= 0) return undefined
    const normalizedSourceKeyValue = normalizedSourceKey(sourceKey)
    rememberSourceKey({ sourceKeysByRef: this.sourceKeysByRef }, normalizedSourceRef, normalizedSourceKeyValue)
    return {
      sourceRef: normalizedSourceRef,
      ...(normalizedSourceKeyValue === undefined ? {} : { sourceKey: normalizedSourceKeyValue }),
      effectiveReadSequence: normalizedSequenceValue,
    }
  }

  private clearOptimisticRead(target: ArkmeChatReadTarget): void {
    const identity = identityForSource({ sourceKeysByRef: this.sourceKeysByRef }, target.sourceRef, target.sourceKey)
    const optimistic = this.optimisticReadWatermarks.get(identity)
    if (optimistic === undefined || optimistic.effectiveReadSequence > target.effectiveReadSequence) return
    this.optimisticReadWatermarks.delete(identity)
    this.optimisticUnreadBackups.delete(identity)
  }

  private sourcesWithReadAckUnread(target: ArkmeChatReadTarget & { unreadCount: number }): ArkmeSourceItem[] {
    const indexes = { sourceKeysByRef: this.sourceKeysByRef }
    const identity = identityForSource(indexes, target.sourceRef, target.sourceKey)
    const unreadCount = normalizedCount(target.unreadCount)
    const effectiveReadSequence = normalizedSequence(target.effectiveReadSequence)
    return this.snapshot.sources.map(source => {
      if (identityForSource(indexes, source.sourceRef, source.sourceKey) !== identity) return source
      if (normalizedSequence(source.latestSequence) > effectiveReadSequence) return source
      return source.unreadCount === unreadCount ? source : { ...source, unreadCount }
    })
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
