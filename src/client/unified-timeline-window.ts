import type { ArkmeTimelineCursor, ArkmeTimelinePage } from '../types.js'
import { mergeUnifiedTimelineWindow, type ArkmeUnifiedTimelineWindow } from '../unified-chat-timeline.js'

export const MAX_ACTIVE_TIMELINE_EVENTS = 2000
export const MAX_ACTIVE_TIMELINE_TOKENS = 500

/** Host owns pagination and the durable commit; Browser only applies the completed projection. */
export async function refreshUnifiedTimelineWindow(
  previous: ArkmeUnifiedTimelineWindow,
  read: (cursor: ArkmeTimelineCursor) => Promise<ArkmeTimelinePage>,
  signal: AbortSignal,
  followTail: boolean,
): Promise<ArkmeTimelinePage> {
  signal.throwIfAborted()
  if (previous.windowTokens.length > MAX_ACTIVE_TIMELINE_TOKENS) throw new Error('已加载历史较多，请重新定位后继续')
  const page = await read({ unified: { mode: 'refresh', windowTokens: previous.windowTokens, reconcile: true,
    ...(followTail && previous.newerCursor ? { newerCursor: previous.newerCursor } : {}) } })
  signal.throwIfAborted()
  if (!page.unified) throw new Error('统一时间线响应缺失')
  const combined = mergeUnifiedTimelineWindow(previous, page.unified, 'refresh')
  if (followTail && previous.newerCursor) {
    combined.newerCursor = page.unified.newerCursor
    combined.newerHasMore = page.unified.newerHasMore
  }
  if (combined.events.length > MAX_ACTIVE_TIMELINE_EVENTS || combined.windowTokens.length > MAX_ACTIVE_TIMELINE_TOKENS) throw new Error('已加载历史较多，请重新定位后继续')
  const { nextCursor: _next, ...metadata } = page
  return { ...metadata, unified: combined, items: combined.events.flatMap(event => event.kind === 'message' ? [event.item] : []),
    hasMore: combined.olderHasMore, ...(combined.olderCursor ? { nextCursor: { unified: { mode: 'older' as const, cursor: combined.olderCursor } } } : {}) }
}
