import type {
  ArkmeGroupAiPolishNotice,
  ArkmeGroupAiPolishSnapshot,
  ArkmeInterwovenMention,
  ArkmeTimelineCursor,
  ArkmeTimelineItem,
} from '../types.js'

export interface ArkmeConversationTimelineSnapshot {
  items: ArkmeTimelineItem[]
  aiPolishNotices: ArkmeGroupAiPolishNotice[]
  aiPolishSettings?: ArkmeGroupAiPolishSnapshot
  nextCursor?: ArkmeTimelineCursor
  hasMore: boolean
  /** Client-only freshness metadata. It is never sent across the Host boundary. */
  fetchedAtMillis?: number
  refreshRevision?: number
  latestSequence?: number
}

export interface ArkmeConversationViewportSnapshot {
  scrollTop: number
  stickToBottom: boolean
  anchorId?: string
  anchorOffset?: number
}

export interface ArkmeConversationTimelineRefreshContext {
  nowMillis: number
  refreshRevision: number
  latestSequence?: number
}

export const ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS = 15_000

function latestTimelineSequence(items: readonly ArkmeTimelineItem[]): number {
  return items.reduce((latest, item) => Math.max(latest, item.sequence ?? 0), 0)
}

export function arkmeConversationTimelineContentEqual(
  left: ArkmeConversationTimelineSnapshot | undefined,
  right: ArkmeConversationTimelineSnapshot | undefined,
): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  return left.hasMore === right.hasMore
    && JSON.stringify(left.nextCursor) === JSON.stringify(right.nextCursor)
    && JSON.stringify(left.items) === JSON.stringify(right.items)
    && JSON.stringify(left.aiPolishNotices) === JSON.stringify(right.aiPolishNotices)
    && JSON.stringify(left.aiPolishSettings) === JSON.stringify(right.aiPolishSettings)
}

export function arkmeShouldRefreshConversationTimeline(
  snapshot: ArkmeConversationTimelineSnapshot | undefined,
  context: ArkmeConversationTimelineRefreshContext,
): boolean {
  if (snapshot?.fetchedAtMillis === undefined) return true
  if (snapshot.refreshRevision !== context.refreshRevision) return true
  const cachedLatestSequence = Math.max(snapshot.latestSequence ?? 0, latestTimelineSequence(snapshot.items))
  if (context.latestSequence !== undefined && context.latestSequence > cachedLatestSequence) return true
  return context.nowMillis - snapshot.fetchedAtMillis >= ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS
}

export function arkmeConversationRestoredScrollTop(
  snapshot: ArkmeConversationViewportSnapshot | undefined,
  layout: { currentScrollTop: number; scrollHeight: number; anchorOffset?: number },
): number {
  if (snapshot === undefined || snapshot.stickToBottom) return layout.scrollHeight
  const anchored = snapshot.anchorOffset !== undefined && layout.anchorOffset !== undefined
    ? layout.currentScrollTop + layout.anchorOffset - snapshot.anchorOffset
    : snapshot.scrollTop
  return Math.max(0, Math.min(layout.scrollHeight, anchored))
}

/**
 * Keeps conversation history immediately reusable while Arkme refreshes it in the background.
 * Interwoven moments are staged until the ordinary timeline has produced its first snapshot, so
 * they can never take over an otherwise empty conversation viewport during a cold load.
 */
export class ArkmeConversationMemoryCache {
  private readonly timelines = new Map<string, ArkmeConversationTimelineSnapshot>()
  private readonly interwovenMoments = new Map<string, ArkmeInterwovenMention[]>()
  private readonly interwovenRefreshRevisions = new Map<string, number>()
  private readonly pendingInterwovenMoments = new Map<string, ArkmeInterwovenMention[]>()
  private readonly pendingInterwovenRefreshRevisions = new Map<string, number>()
  private readonly viewports = new Map<string, ArkmeConversationViewportSnapshot>()
  private readonly recency = new Map<string, true>()

  constructor(private readonly maxSources = 20) {}

  getTimeline(sourceRef: string): ArkmeConversationTimelineSnapshot | undefined {
    const snapshot = this.timelines.get(sourceRef)
    if (snapshot !== undefined) this.touch(sourceRef)
    return snapshot
  }

  storeTimeline(
    sourceRef: string,
    snapshot: ArkmeConversationTimelineSnapshot,
  ): ArkmeInterwovenMention[] | undefined {
    const previous = this.timelines.get(sourceRef)
    const computedLatestSequence = latestTimelineSequence(snapshot.items)
    const next: ArkmeConversationTimelineSnapshot = {
      ...snapshot,
      ...(snapshot.fetchedAtMillis === undefined && previous?.fetchedAtMillis !== undefined
        ? { fetchedAtMillis: previous.fetchedAtMillis }
        : {}),
      ...(snapshot.refreshRevision === undefined && previous?.refreshRevision !== undefined
        ? { refreshRevision: previous.refreshRevision }
        : {}),
      latestSequence: Math.max(snapshot.latestSequence ?? 0, previous?.latestSequence ?? 0, computedLatestSequence),
    }
    this.timelines.set(sourceRef, next)
    this.touch(sourceRef)
    const pending = this.pendingInterwovenMoments.get(sourceRef)
    if (pending === undefined) return undefined
    const pendingRevision = this.pendingInterwovenRefreshRevisions.get(sourceRef) ?? 0
    this.pendingInterwovenMoments.delete(sourceRef)
    this.pendingInterwovenRefreshRevisions.delete(sourceRef)
    this.interwovenMoments.set(sourceRef, pending)
    this.interwovenRefreshRevisions.set(sourceRef, pendingRevision)
    return pending
  }

  getInterwovenMoments(sourceRef: string): ArkmeInterwovenMention[] | undefined {
    const moments = this.interwovenMoments.get(sourceRef)
    if (moments !== undefined) this.touch(sourceRef)
    return moments
  }

  /** Returns true only when the ordinary timeline is ready and the result may be revealed. */
  storeInterwovenMoments(sourceRef: string, moments: ArkmeInterwovenMention[], refreshRevision = 0): boolean {
    this.touch(sourceRef)
    if (!this.timelines.has(sourceRef)) {
      this.pendingInterwovenMoments.set(sourceRef, moments)
      this.pendingInterwovenRefreshRevisions.set(sourceRef, refreshRevision)
      return false
    }
    this.pendingInterwovenMoments.delete(sourceRef)
    this.pendingInterwovenRefreshRevisions.delete(sourceRef)
    this.interwovenMoments.set(sourceRef, moments)
    this.interwovenRefreshRevisions.set(sourceRef, refreshRevision)
    return true
  }

  isInterwovenFresh(sourceRef: string, refreshRevision: number): boolean {
    return this.interwovenMoments.has(sourceRef)
      && this.interwovenRefreshRevisions.get(sourceRef) === refreshRevision
  }

  getViewport(sourceRef: string): ArkmeConversationViewportSnapshot | undefined {
    const viewport = this.viewports.get(sourceRef)
    if (viewport !== undefined) this.touch(sourceRef)
    return viewport
  }

  storeViewport(sourceRef: string, viewport: ArkmeConversationViewportSnapshot): void {
    this.viewports.set(sourceRef, viewport)
    this.touch(sourceRef)
  }

  clear(): void {
    this.timelines.clear()
    this.interwovenMoments.clear()
    this.interwovenRefreshRevisions.clear()
    this.pendingInterwovenMoments.clear()
    this.pendingInterwovenRefreshRevisions.clear()
    this.viewports.clear()
    this.recency.clear()
  }

  private touch(sourceRef: string): void {
    this.recency.delete(sourceRef)
    this.recency.set(sourceRef, true)
    while (this.recency.size > Math.max(1, this.maxSources)) {
      const oldest = this.recency.keys().next().value as string | undefined
      if (oldest === undefined) return
      this.recency.delete(oldest)
      this.timelines.delete(oldest)
      this.interwovenMoments.delete(oldest)
      this.interwovenRefreshRevisions.delete(oldest)
      this.pendingInterwovenMoments.delete(oldest)
      this.pendingInterwovenRefreshRevisions.delete(oldest)
      this.viewports.delete(oldest)
    }
  }
}
