import type { ArkmeTimelineCursor, ArkmeTimelinePage } from '../types.js'
import type { ArkmeConversationTimelineSnapshot } from './conversation-memory-cache.js'

/** Refresh the loaded records, not the navigation window. Apply only after all reads succeed. */
export async function readConversationTimelineWindow(
  snapshot: ArkmeConversationTimelineSnapshot,
  readPage: (cursor?: ArkmeTimelineCursor) => Promise<ArkmeTimelinePage>,
  signal: AbortSignal,
): Promise<ArkmeTimelinePage> {
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
