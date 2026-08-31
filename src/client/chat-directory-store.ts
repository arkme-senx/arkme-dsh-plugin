import type { ArkmeSourceItem, ArkmeSourceList } from '../types.js'
import { callArkme } from './api.js'
import { arkmeChatSourceIdentityKey, arkmeSourceIdentityKey } from './source-identity.js'

const DEFAULT_ROOT_CACHE_MAX_AGE_MS = 30_000
const ROOT_DIRECTORY_PAGE_LIMIT = 20
const MAX_ROOT_PAGES = 10

export type ArkmeClientAccountScope = number | string | undefined

function clientAccountScopeKey(scope: ArkmeClientAccountScope): string | undefined {
  if (typeof scope === 'number') return Number.isSafeInteger(scope) && scope > 0 ? String(scope) : undefined
  const normalized = scope?.trim()
  return normalized === undefined || normalized === '' || normalized.length > 256 ? undefined : normalized
}

interface ArkmeChatDirectoryStoreOptions {
  loadPage?: (cursor?: string, force?: boolean) => Promise<ArkmeSourceList>
  maxAgeMs?: number
  now?: () => number
}

export interface ArkmeChatDirectorySnapshot {
  revision: number
  sources: ArkmeSourceItem[]
  baselineReady: boolean
  isRefreshing: boolean
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
  const hasUnreadMention = unreadCount <= 0 && source.hasUnreadMention !== undefined ? false : source.hasUnreadMention
  return unreadCount === source.unreadCount && hasUnreadMention === source.hasUnreadMention
    ? source
    : { ...source, unreadCount, ...(hasUnreadMention === undefined ? {} : { hasUnreadMention }) }
}

function mergeUnreadMention(existing: ArkmeSourceItem | undefined, source: ArkmeSourceItem): boolean | undefined {
  const unreadCount = normalizedCount(source.unreadCount)
  if (unreadCount <= 0) {
    return existing?.hasUnreadMention !== undefined || source.hasUnreadMention !== undefined ? false : undefined
  }
  if (source.kind === 'group_chat') return source.hasUnreadMention ?? existing?.hasUnreadMention
  return source.hasUnreadMention
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
          ...(existing.hasUnreadMention === undefined ? {} : { hasUnreadMention: existing.hasUnreadMention }),
          ...(existing.latestSequence === undefined ? {} : { latestSequence: existing.latestSequence }),
        }
      })()
    : {
        ...(() => {
          const hasUnreadMention = mergeUnreadMention(existing, source)
          return {
            ...source,
            activeAtMillis: Math.max(existing?.activeAtMillis ?? 0, source.activeAtMillis),
            ...(hasUnreadMention === undefined ? {} : { hasUnreadMention }),
          }
        })(),
      }
  return applyReadWatermark(merged, watermarks, indexes, sourceKey)
}

function sourceUpdate(update: ArkmeSourceItem | ArkmeChatDirectorySourceUpdate): ArkmeChatDirectorySourceUpdate {
  if ('source' in update) return update
  return { source: update, ...(update.sourceKey === undefined ? {} : { sourceKey: update.sourceKey }) }
}

function directorySourceIdentity(source: ArkmeSourceItem): string {
  return normalizedSourceKey(source.sourceKey) ?? source.sourceRef
}

type DirectorySourceScalarField = Exclude<keyof ArkmeSourceItem, 'avatarRefs' | 'groupAvatar'>

const DIRECTORY_SOURCE_SCALAR_FIELDS: Record<DirectorySourceScalarField, true> = {
  sourceRef: true,
  sourceKey: true,
  peerUserId: true,
  parentSourceRef: true,
  topicHierarchyKey: true,
  parentTopicHierarchyKey: true,
  hasPendingChildren: true,
  siblingOrder: true,
  kind: true,
  displayName: true,
  avatarRef: true,
  latestPreview: true,
  activeAtMillis: true,
  unreadCount: true,
  hasUnreadMention: true,
  isMuted: true,
  isPinned: true,
  latestSequence: true,
  recordCount: true,
}

function sameOrderedAvatarRefs(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === right) return true
  return left !== undefined && right !== undefined
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}

function sameGroupAvatarPresentation(
  left: ArkmeSourceItem['groupAvatar'],
  right: ArkmeSourceItem['groupAvatar'],
): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  // computedAtMillis is freshness provenance; the remaining structured fields define projection identity.
  if (left.memberCount !== right.memberCount || left.strategy !== right.strategy
    || left.slots.length !== right.slots.length) return false
  return left.slots.every((slot, index) => {
    const other = right.slots[index]
    if (other === undefined || slot.avatarRef !== other.avatarRef || slot.fallback?.kind !== other.fallback?.kind) return false
    if (slot.fallback?.kind !== 'phone_default' || other.fallback?.kind !== 'phone_default') return true
    return slot.fallback.colorIndex === other.fallback.colorIndex && slot.fallback.label === other.fallback.label
  })
}

function sameDirectorySourcePresentation(left: ArkmeSourceItem, right: ArkmeSourceItem): boolean {
  for (const field of Object.keys(DIRECTORY_SOURCE_SCALAR_FIELDS) as DirectorySourceScalarField[]) {
    if (left[field] !== right[field]) return false
  }
  return sameOrderedAvatarRefs(left.avatarRefs, right.avatarRefs)
    && sameGroupAvatarPresentation(left.groupAvatar, right.groupAvatar)
}

function reconcileDirectorySources(
  current: readonly ArkmeSourceItem[],
  incoming: readonly ArkmeSourceItem[],
): ArkmeSourceItem[] | readonly ArkmeSourceItem[] {
  const currentByIdentity = new Map(current.map(source => [directorySourceIdentity(source), source]))
  const reconciled = incoming.map(source => {
    const previous = currentByIdentity.get(directorySourceIdentity(source))
    return previous !== undefined
      && sameDirectorySourcePresentation(previous, source)
      ? previous
      : source
  })
  return reconciled.length === current.length && reconciled.every((source, index) => source === current[index])
    ? current
    : reconciled
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
  private snapshot: ArkmeChatDirectorySnapshot = { revision: 0, sources: [], baselineReady: false, isRefreshing: false }
  private readonly listeners = new Set<() => void>()
  private readonly loadPage: (cursor?: string, force?: boolean) => Promise<ArkmeSourceList>
  private readonly maxAgeMs: number
  private readonly now: () => number
  private refreshInFlight: Promise<ArkmeSourceItem[]> | undefined
  private refreshedAtMillis = 0
  private accountScopeKey: string | undefined
  private generation = 0
  private baselineReady = false
  private isRefreshing = false
  private pendingMutations: ArkmeChatDirectoryMutation[] = []
  private readonly readWatermarks = new Map<string, ArkmeChatReadWatermark>()
  private readonly optimisticReadWatermarks = new Map<string, ArkmeChatReadWatermark>()
  private readonly optimisticUnreadBackups = new Map<string, number>()
  private readonly sourceKeysByRef = new Map<string, string>()

  constructor(options: ArkmeChatDirectoryStoreOptions = {}) {
    this.loadPage = options.loadPage ?? (async (cursor, force) => await callArkme<ArkmeSourceList>('sources.list', {
      directory: 'root', limit: ROOT_DIRECTORY_PAGE_LIMIT,
      ...(cursor === undefined ? {} : { cursor }), ...(force === true ? { refresh: true } : {}),
    }))
    this.maxAgeMs = Math.max(0, Math.trunc(options.maxAgeMs ?? DEFAULT_ROOT_CACHE_MAX_AGE_MS))
    this.now = options.now ?? Date.now
  }

  readonly getSnapshot = (): ArkmeChatDirectorySnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  activateAccount(scope: ArkmeClientAccountScope): void {
    const normalized = clientAccountScopeKey(scope)
    if (normalized === this.accountScopeKey) return
    this.accountScopeKey = normalized
    this.generation += 1
    this.refreshInFlight = undefined
    this.refreshedAtMillis = 0
    this.baselineReady = false
    this.isRefreshing = false
    this.pendingMutations = []
    this.readWatermarks.clear()
    this.optimisticReadWatermarks.clear()
    this.optimisticUnreadBackups.clear()
    this.sourceKeysByRef.clear()
    if (this.snapshot.sources.length > 0 || this.snapshot.baselineReady || this.snapshot.isRefreshing) this.commit([])
  }

  async refreshRoot(options: { force?: boolean; silent?: boolean } = {}): Promise<ArkmeSourceItem[]> {
    if (options.force !== true && this.refreshedAtMillis > 0
      && this.now() - this.refreshedAtMillis < this.maxAgeMs) {
      return [...this.snapshot.sources]
    }
    if (this.refreshInFlight !== undefined) {
      if (options.silent === true) return await this.refreshInFlight
      this.setRefreshing(true)
      try {
        return await this.refreshInFlight
      } finally {
        this.setRefreshing(false)
      }
    }
    if (options.silent !== true) this.setRefreshing(true)
    const generation = this.generation
    const pending = (async () => {
      const loaded: ArkmeSourceItem[] = []
      const seen = new Set<string>()
      let cursor: string | undefined
      for (let pageIndex = 0; pageIndex < MAX_ROOT_PAGES; pageIndex += 1) {
        const page = await this.loadPage(cursor, options.force === true)
        for (const source of page.items) {
          const identity = arkmeSourceIdentityKey(source)
          if (seen.has(identity)) continue
          seen.add(identity)
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
      if (this.refreshInFlight === pending) {
        this.refreshInFlight = undefined
        if (options.silent !== true) this.setRefreshing(false)
      }
    }
  }

  publish(sources: ArkmeSourceItem[]): void {
    const merged = applyDirectoryMutations(
      sources,
      this.pendingMutations,
      this.combinedReadWatermarks(),
      { sourceKeysByRef: this.sourceKeysByRef },
    )
    const reconciled = reconcileDirectorySources(this.snapshot.sources, merged)
    const baselineChanged = !this.baselineReady
    this.pendingMutations = []
    this.baselineReady = true
    if (baselineChanged || reconciled !== this.snapshot.sources) this.commit([...reconciled])
  }

  private commit(sources: ArkmeSourceItem[]): void {
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      sources: [...sources],
      baselineReady: this.baselineReady,
      isRefreshing: this.isRefreshing,
    }
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

  totalUnreadCount(options: { excludeMuted?: boolean } = {}): number {
    const sources = applyDirectoryMutations(
      this.snapshot.sources,
      this.pendingMutations,
      this.combinedReadWatermarks(),
      { sourceKeysByRef: new Map(this.sourceKeysByRef) },
    )
    return sources.reduce((sum, source) => options.excludeMuted === true && source.isMuted === true
      ? sum
      : sum + normalizedCount(source.unreadCount), 0)
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
    if (currentSource === undefined
      || (normalizedCount(currentSource.unreadCount) <= 0 && currentSource.hasUnreadMention !== true)) return false
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
    this.isRefreshing = false
    this.pendingMutations = []
    this.readWatermarks.clear()
    this.optimisticReadWatermarks.clear()
    this.optimisticUnreadBackups.clear()
    this.sourceKeysByRef.clear()
    if (this.snapshot.sources.length > 0 || this.snapshot.baselineReady || this.snapshot.isRefreshing) this.commit([])
  }

  private setRefreshing(isRefreshing: boolean): void {
    if (this.isRefreshing === isRefreshing) return
    this.isRefreshing = isRefreshing
    this.commit(this.snapshot.sources)
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
      const hasUnreadMention = unreadCount <= 0 && source.hasUnreadMention !== undefined ? false : source.hasUnreadMention
      return source.unreadCount === unreadCount && source.hasUnreadMention === hasUnreadMention
        ? source
        : { ...source, unreadCount, ...(hasUnreadMention === undefined ? {} : { hasUnreadMention }) }
    })
  }
}

export const arkmeChatDirectory = new ArkmeChatDirectoryStore()

export interface ArkmeChatTimelineDeltaSnapshot {
  revision: number
  itemsBySourceKey: Record<string, import('../types.js').ArkmeTimelineItem[]>
}

export interface ArkmeChatTimelineSourceDeltaSnapshot {
  revision: number
  items: import('../types.js').ArkmeTimelineItem[]
  latestSequence?: number
}

const EMPTY_CHAT_TIMELINE_SOURCE_DELTA: ArkmeChatTimelineSourceDeltaSnapshot = {
  revision: 0,
  items: [],
}
const MAX_SCOPED_REALTIME_SOURCES = 256

function retainNewestMapEntries<Value>(map: Map<string, Value>): void {
  while (map.size > MAX_SCOPED_REALTIME_SOURCES) {
    const oldest = map.keys().next().value as string | undefined
    if (oldest === undefined) return
    map.delete(oldest)
  }
}

export class ArkmeChatTimelineDeltaStore {
  private snapshot: ArkmeChatTimelineDeltaSnapshot = { revision: 0, itemsBySourceKey: {} }
  private readonly sourceSnapshots = new Map<string, ArkmeChatTimelineSourceDeltaSnapshot>()
  private accountScopeKey: string | undefined
  private readonly listeners = new Set<() => void>()
  readonly getSnapshot = (): ArkmeChatTimelineDeltaSnapshot => this.snapshot
  readonly getSnapshotForSource = (sourceKey: string): ArkmeChatTimelineSourceDeltaSnapshot => (
    this.sourceSnapshots.get(sourceKey) ?? EMPTY_CHAT_TIMELINE_SOURCE_DELTA
  )
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  activateAccount(scope: ArkmeClientAccountScope): void {
    const normalized = clientAccountScopeKey(scope)
    if (normalized === this.accountScopeKey) return
    this.accountScopeKey = normalized
    this.sourceSnapshots.clear()
    if (Object.keys(this.snapshot.itemsBySourceKey).length === 0) return
    this.snapshot = { revision: this.snapshot.revision + 1, itemsBySourceKey: {} }
    for (const listener of this.listeners) listener()
  }
  publish(updates: Array<{
    source: Pick<ArkmeSourceItem, 'sourceRef' | 'sourceKey' | 'latestSequence'>
    items: import('../types.js').ArkmeTimelineItem[]
  }>): void {
    if (updates.length === 0) this.sourceSnapshots.clear()
    for (const update of updates) {
      const sourceKey = arkmeChatSourceIdentityKey(update.source)
      const previous = this.sourceSnapshots.get(sourceKey)
      if (previous !== undefined && previous.latestSequence === update.source.latestSequence
        && JSON.stringify(previous.items) === JSON.stringify(update.items)) continue
      this.sourceSnapshots.delete(sourceKey)
      this.sourceSnapshots.set(sourceKey, {
        revision: (previous?.revision ?? 0) + 1,
        items: [...update.items],
        ...(update.source.latestSequence === undefined ? {} : { latestSequence: update.source.latestSequence }),
      })
    }
    retainNewestMapEntries(this.sourceSnapshots)
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      itemsBySourceKey: Object.fromEntries(updates.map(update => [arkmeChatSourceIdentityKey(update.source), [...update.items]])),
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
  private accountScopeKey: string | undefined
  private nextScopedRevision = 0
  private globalRevision = 0
  private readonly sourceRevisions = new Map<string, number>()
  private readonly sourceSnapshots = new Map<string, { globalRevision: number; sourceRevision: number; snapshot: ArkmeInterwovenInvalidationSnapshot }>()
  private readonly listeners = new Set<() => void>()
  readonly getSnapshot = (): ArkmeInterwovenInvalidationSnapshot => this.snapshot
  readonly getSnapshotForSource = (sourceKey: string): ArkmeInterwovenInvalidationSnapshot => {
    const sourceRevision = this.sourceRevisions.get(sourceKey) ?? 0
    const cached = this.sourceSnapshots.get(sourceKey)
    if (cached?.globalRevision === this.globalRevision && cached.sourceRevision === sourceRevision) return cached.snapshot
    const snapshot = { revision: Math.max(this.globalRevision, sourceRevision) }
    this.sourceSnapshots.delete(sourceKey)
    this.sourceSnapshots.set(sourceKey, { globalRevision: this.globalRevision, sourceRevision, snapshot })
    retainNewestMapEntries(this.sourceSnapshots)
    return snapshot
  }
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  activateAccount(scope: ArkmeClientAccountScope): void {
    const normalized = clientAccountScopeKey(scope)
    if (normalized === this.accountScopeKey) return
    this.accountScopeKey = normalized
    this.nextScopedRevision = 0
    this.globalRevision = 0
    this.sourceRevisions.clear()
    this.sourceSnapshots.clear()
    this.snapshot = { revision: this.snapshot.revision + 1 }
    for (const listener of this.listeners) listener()
  }
  invalidate(sourceKey?: string): void {
    if (sourceKey === undefined || sourceKey.trim() === '') {
      this.globalRevision = ++this.nextScopedRevision
      this.sourceSnapshots.clear()
    } else {
      const normalized = sourceKey.trim()
      const revision = ++this.nextScopedRevision
      this.sourceRevisions.delete(normalized)
      this.sourceRevisions.set(normalized, revision)
      this.sourceSnapshots.delete(normalized)
      retainNewestMapEntries(this.sourceRevisions)
    }
    this.snapshot = { revision: this.snapshot.revision + 1 }
    for (const listener of this.listeners) listener()
  }
}

export const arkmeInterwovenInvalidation = new ArkmeInterwovenInvalidationStore()
