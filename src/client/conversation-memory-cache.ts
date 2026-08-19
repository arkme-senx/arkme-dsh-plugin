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
}

/**
 * Keeps conversation history immediately reusable while Arkme refreshes it in the background.
 * Interwoven moments are staged until the ordinary timeline has produced its first snapshot, so
 * they can never take over an otherwise empty conversation viewport during a cold load.
 */
export class ArkmeConversationMemoryCache {
  private readonly timelines = new Map<string, ArkmeConversationTimelineSnapshot>()
  private readonly interwovenMoments = new Map<string, ArkmeInterwovenMention[]>()
  private readonly pendingInterwovenMoments = new Map<string, ArkmeInterwovenMention[]>()
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
    this.timelines.set(sourceRef, snapshot)
    this.touch(sourceRef)
    const pending = this.pendingInterwovenMoments.get(sourceRef)
    if (pending === undefined) return undefined
    this.pendingInterwovenMoments.delete(sourceRef)
    this.interwovenMoments.set(sourceRef, pending)
    return pending
  }

  getInterwovenMoments(sourceRef: string): ArkmeInterwovenMention[] | undefined {
    const moments = this.interwovenMoments.get(sourceRef)
    if (moments !== undefined) this.touch(sourceRef)
    return moments
  }

  /** Returns true only when the ordinary timeline is ready and the result may be revealed. */
  storeInterwovenMoments(sourceRef: string, moments: ArkmeInterwovenMention[]): boolean {
    this.touch(sourceRef)
    if (!this.timelines.has(sourceRef)) {
      this.pendingInterwovenMoments.set(sourceRef, moments)
      return false
    }
    this.pendingInterwovenMoments.delete(sourceRef)
    this.interwovenMoments.set(sourceRef, moments)
    return true
  }

  clear(): void {
    this.timelines.clear()
    this.interwovenMoments.clear()
    this.pendingInterwovenMoments.clear()
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
      this.pendingInterwovenMoments.delete(oldest)
    }
  }
}
