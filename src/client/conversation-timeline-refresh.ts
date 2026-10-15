import { refreshUnifiedTimelineWindow } from './unified-timeline-window.js'
import type { ArkmeTimelineCursor, ArkmeTimelineItem, ArkmeTimelinePage } from '../types.js'

/** The loaded read window, independent of cache storage and message enhancement state. */
export interface ConversationTimelineReadWindow {
  readonly unified?: import('../unified-chat-timeline.js').ArkmeUnifiedTimelineWindow | undefined
  readonly items: readonly ArkmeTimelineItem[]
  readonly mode?: 'latest' | 'around'
  readonly aroundSequenceRange?: { readonly minimumSequence: number; readonly maximumSequence: number }
}

/** Refresh the loaded records, not the navigation window. Apply only after all reads succeed. */
export async function readConversationTimelineWindow(
  snapshot: ConversationTimelineReadWindow,
  readPage: (cursor?: ArkmeTimelineCursor) => Promise<ArkmeTimelinePage>,
  signal: AbortSignal,
  followsLatest?: () => boolean,
  readingAnchor?: () => string | undefined,
): Promise<ArkmeTimelinePage> {
  // Following the live tail needs one bounded authoritative page. Re-reading
  // every previously visited page makes latency and response bytes grow forever.
  // Check again after I/O: a reader may have scrolled into history meanwhile.
  if (snapshot.unified && snapshot.mode !== 'around' && followsLatest?.()) {
    signal.throwIfAborted()
    const latest = await readPage()
    signal.throwIfAborted()
    if (latest.unified?.complete && followsLatest()) return latest
    // A partial source must not erase known events; retain the ordinary atomic
    // reconciliation, also when the user changed their reading intent.
  }
  if (snapshot.unified) return await refreshUnifiedTimelineWindow(snapshot.unified, readPage, signal,
    snapshot.mode !== 'around' && (snapshot.unified.windowTokens.length > 0 || followsLatest?.() !== false), readingAnchor)
  const records = snapshot.items.filter(item => item.status === 1 && item.awaitingTimelineProjection !== true)
  const aroundRange = snapshot.mode === 'around' ? snapshot.aroundSequenceRange : undefined
  const sequenced = aroundRange !== undefined || records.length > 0 && records.every(item => (item.sequence ?? 0) > 0)
  const oldest = records.reduce<typeof records[number] | undefined>((previous, item) => previous === undefined
    || (sequenced ? item.sequence! < previous.sequence! : item.sendAtMillis < previous.sendAtMillis
      || item.sendAtMillis === previous.sendAtMillis && item.itemUid < previous.itemUid) ? item : previous, undefined)
  const minimumSequence = aroundRange?.minimumSequence ?? oldest?.sequence ?? 0
  const maximumSequence = aroundRange?.maximumSequence ?? Math.max(...records.map(item => item.sequence ?? 0))
  let cursor: ArkmeTimelineCursor | undefined = snapshot.mode === 'around' && sequenced
    ? { beforeSequence: maximumSequence + 1 }
    : undefined
  const ids = new Set(snapshot.items.map(item => item.itemUid))
  const items = new Map<string, ArkmeTimelinePage['items'][number]>()
  const visited = new Set<string>()
  let first: ArkmeTimelinePage | undefined
  for (;;) {
    signal.throwIfAborted()
    if (visited.size >= 500 || items.size > 2000) throw new Error('消息列表刷新超过窗口上限，请重新定位')
    const key = JSON.stringify(cursor ?? null)
    if (visited.has(key)) throw new Error('消息列表刷新游标未推进')
    visited.add(key)
    const page = await readPage(cursor)
    signal.throwIfAborted()
    first ??= page
    for (const item of page.items) {
      if (aroundRange !== undefined && ((item.sequence ?? 0) < minimumSequence || (item.sequence ?? 0) > maximumSequence)) continue
      if (ids.has(item.itemUid) || oldest === undefined
        || (sequenced ? (item.sequence ?? 0) >= minimumSequence : item.sendAtMillis > oldest.sendAtMillis
          || item.sendAtMillis === oldest.sendAtMillis && item.itemUid >= oldest.itemUid)) {
        items.set(item.itemUid, item)
      }
    }
    const reachedBoundary = sequenced
      ? page.items.some(item => item.sequence === minimumSequence)
        || (page.nextCursor?.beforeSequence ?? Infinity) <= minimumSequence
      : oldest === undefined || page.items.some(item => item.itemUid === oldest.itemUid)
        || (page.nextCursor?.sendAtMillis ?? Infinity) < oldest.sendAtMillis
        || page.nextCursor?.sendAtMillis === oldest.sendAtMillis && page.nextCursor.itemUid !== undefined
          && page.nextCursor.itemUid <= oldest.itemUid
    if (reachedBoundary || !page.hasMore) return { ...first, items: [...items.values()] }
    if (page.nextCursor === undefined) throw new Error('消息列表刷新缺少分页游标')
    cursor = page.nextCursor
  }
}

/** A missing disposable cache must not turn saved history into a latest-tail entry. */
export async function readConversationTimelineEntry(
  viewport: import('./conversation-memory-cache.js').ArkmeConversationViewportSnapshot,
  readPage: (cursor?: ArkmeTimelineCursor) => Promise<ArkmeTimelinePage>,
  signal: AbortSignal,
): Promise<ArkmeTimelinePage> {
  signal.throwIfAborted()
  const anchor = !viewport.stickToBottom ? viewport.messageAnchor : undefined
  const page = await readPage(anchor ? { unified: { mode: 'around', ...anchor } } : undefined)
  signal.throwIfAborted()
  if (!viewport.stickToBottom && viewport.anchorId && !page.unified?.events.some(event => {
    const id = event.kind === 'message' ? `message:${event.eventId}`
      : event.kind === 'moment' ? `moment:${event.item.momentId}` : event.eventId
    return id === viewport.anchorId || event.kind === 'message' && `message:${event.item.timelineItemKey}` === viewport.anchorId
  })) throw new Error('已保留阅读位置，暂时无法恢复该历史消息，请重试或重新定位')
  return page
}
