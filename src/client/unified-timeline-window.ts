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
  readingAnchor?: () => string | undefined,
): Promise<ArkmeTimelinePage> {
  signal.throwIfAborted()
  if (previous.windowTokens.length === 0) {
    // Message-only slices carry no remote coverage. Locate the same history.
    const messages = previous.events.filter(event => event.kind === 'message')
    const matches = (event: ArkmeUnifiedTimelineWindow['events'][number], id: string) => id === `message:${event.eventId}`
      || event.kind === 'message' && id === `message:${event.item.timelineItemKey}`
    const requestedAnchor = readingAnchor?.()
    const anchor = requestedAnchor ? messages.find(event => matches(event, requestedAnchor)) : messages[Math.floor(messages.length / 2)]
    const item = anchor?.kind === 'message' ? anchor.item : undefined
    if (!followTail && !item) throw new Error('已保留当前阅读位置，暂时无法恢复线上窗口')
    const page = await read({ unified: !followTail && item?.recordOwnerUserId && item.itemUid
      ? { mode: 'around', itemUid: item.itemUid, recordOwnerUserId: item.recordOwnerUserId } : { mode: 'initial' } })
    signal.throwIfAborted()
    const currentAnchor = readingAnchor?.()
    if (currentAnchor && !page.unified?.events.some(event => matches(event, currentAnchor))) throw new Error('阅读位置已变化，已保留当前窗口')
    return page
  }
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
