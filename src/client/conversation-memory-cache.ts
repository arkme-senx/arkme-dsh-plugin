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
  /** Record-owner projection revision. Chat timelines must use latestSequence instead. */
  recordRevision?: number
  latestSequence?: number
}

export interface ArkmeConversationViewportSnapshot {
  scrollTop: number
  stickToBottom: boolean
  anchorId?: string
  anchorOffset?: number
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

function arkmeConversationTimelineExpired(
  snapshot: ArkmeConversationTimelineSnapshot | undefined,
  nowMillis: number,
): boolean {
  if (snapshot?.fetchedAtMillis === undefined) return true
  return nowMillis - snapshot.fetchedAtMillis >= ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS
}

export function arkmeShouldRefreshChatTimeline(
  snapshot: ArkmeConversationTimelineSnapshot | undefined,
  nowMillis: number,
  latestSequence?: number,
): boolean {
  if (arkmeConversationTimelineExpired(snapshot, nowMillis)) return true
  const cachedLatestSequence = Math.max(snapshot?.latestSequence ?? 0, latestTimelineSequence(snapshot?.items ?? []))
  return latestSequence !== undefined && latestSequence > cachedLatestSequence
}

export function arkmeShouldRefreshRecordTimeline(
  snapshot: ArkmeConversationTimelineSnapshot | undefined,
  nowMillis: number,
  recordRevision: number,
): boolean {
  if (arkmeConversationTimelineExpired(snapshot, nowMillis)) return true
  return snapshot?.recordRevision !== recordRevision
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

  getTimeline(conversationKey: string): ArkmeConversationTimelineSnapshot | undefined {
    const snapshot = this.timelines.get(conversationKey)
    if (snapshot !== undefined) this.touch(conversationKey)
    return snapshot
  }

  storeTimeline(
    conversationKey: string,
    snapshot: ArkmeConversationTimelineSnapshot,
  ): ArkmeInterwovenMention[] | undefined {
    const previous = this.timelines.get(conversationKey)
    const latestSequence = snapshot.latestSequence === undefined && previous?.latestSequence === undefined
      ? undefined
      : Math.max(snapshot.latestSequence ?? 0, previous?.latestSequence ?? 0)
    const next: ArkmeConversationTimelineSnapshot = {
      ...snapshot,
      ...(snapshot.fetchedAtMillis === undefined && previous?.fetchedAtMillis !== undefined
        ? { fetchedAtMillis: previous.fetchedAtMillis }
        : {}),
      ...(snapshot.recordRevision === undefined && previous?.recordRevision !== undefined
        ? { recordRevision: previous.recordRevision }
        : {}),
      ...(latestSequence === undefined ? {} : { latestSequence }),
    }
    this.timelines.set(conversationKey, next)
    this.touch(conversationKey)
    const pending = this.pendingInterwovenMoments.get(conversationKey)
    if (pending === undefined) return undefined
    const pendingRevision = this.pendingInterwovenRefreshRevisions.get(conversationKey) ?? 0
    this.pendingInterwovenMoments.delete(conversationKey)
    this.pendingInterwovenRefreshRevisions.delete(conversationKey)
    this.interwovenMoments.set(conversationKey, pending)
    this.interwovenRefreshRevisions.set(conversationKey, pendingRevision)
    return pending
  }

  getInterwovenMoments(conversationKey: string): ArkmeInterwovenMention[] | undefined {
    const moments = this.interwovenMoments.get(conversationKey)
    if (moments !== undefined) this.touch(conversationKey)
    return moments
  }

  /** Returns true only when the ordinary timeline is ready and the result may be revealed. */
  storeInterwovenMoments(conversationKey: string, moments: ArkmeInterwovenMention[], refreshRevision = 0): boolean {
    this.touch(conversationKey)
    if (!this.timelines.has(conversationKey)) {
      this.pendingInterwovenMoments.set(conversationKey, moments)
      this.pendingInterwovenRefreshRevisions.set(conversationKey, refreshRevision)
      return false
    }
    this.pendingInterwovenMoments.delete(conversationKey)
    this.pendingInterwovenRefreshRevisions.delete(conversationKey)
    this.interwovenMoments.set(conversationKey, moments)
    this.interwovenRefreshRevisions.set(conversationKey, refreshRevision)
    return true
  }

  isInterwovenFresh(conversationKey: string, refreshRevision: number): boolean {
    return this.interwovenMoments.has(conversationKey)
      && this.interwovenRefreshRevisions.get(conversationKey) === refreshRevision
  }

  getViewport(conversationKey: string): ArkmeConversationViewportSnapshot | undefined {
    const viewport = this.viewports.get(conversationKey)
    if (viewport !== undefined) this.touch(conversationKey)
    return viewport
  }

  storeViewport(conversationKey: string, viewport: ArkmeConversationViewportSnapshot): void {
    this.viewports.set(conversationKey, viewport)
    this.touch(conversationKey)
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

  private touch(conversationKey: string): void {
    this.recency.delete(conversationKey)
    this.recency.set(conversationKey, true)
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
