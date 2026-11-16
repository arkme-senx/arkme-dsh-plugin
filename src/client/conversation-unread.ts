import type { ArkmeUnifiedTimelineWindow } from '../unified-chat-timeline.js'
import type { ArkmeTimelineItem, ArkmeTimelinePage } from '../types.js'

/** Count only an uninterrupted sequence of confirmed, visible Chat rows. */
export function buildConversationUnreadCoverage(
  rows: readonly { readSequence: number; item: ArkmeTimelineItem }[],
  through: number,
): { from: number; counts: number[]; firstUnread?: ArkmeTimelineItem } {
  const counts: number[] = []
  let firstUnread: ArkmeTimelineItem | undefined
  const bySequence = new Map(rows.map(row => [row.readSequence, row]))
  for (let sequence = through + 1; ; sequence += 1) {
    const row = bySequence.get(sequence)
    if (!row) break
    if (isIncomingForRead(row.item)) firstUnread ??= row.item
    counts.push((counts.at(-1) ?? 0) + Number(isIncomingForRead(row.item)))
  }
  return { from: through + 1, counts, ...(firstUnread ? { firstUnread } : {}) }
}

export function isIncomingForRead(item: ArkmeTimelineItem): boolean {
  return item.isIncomingForRead ?? !item.isMe
}

export function findCachedConversationFirstUnread(
  window: ArkmeUnifiedTimelineWindow | undefined,
  through: number,
): ArkmeTimelineItem | undefined {
  if (!window?.windowTokens.length || window.sources.find(status => status.source === 'messages')?.status !== 'ready') return undefined
  const rows = window.events.flatMap(event => event.kind === 'message' && event.contentStatus === 'available'
    && event.item.status === 1 && event.item.sequence !== undefined ? [{ readSequence: event.item.sequence, item: event.item }] : [])
  const { firstUnread } = buildConversationUnreadCoverage(rows, through)
  return firstUnread?.recordOwnerUserId ? firstUnread : undefined
}

/** A forward read starts at the cursor even when the unread backlog is outside the open window. */
export async function findConversationFirstUnread(
  through: number,
  frontier: number | undefined,
  read: (afterSequence: number) => Promise<ArkmeTimelinePage>,
  signal: AbortSignal,
): Promise<ArkmeTimelineItem | undefined> {
  let after = through
  for (let pageIndex = 0; pageIndex < 8; pageIndex += 1) {
    signal.throwIfAborted()
    const page = await read(after)
    signal.throwIfAborted()
    let first: ArkmeTimelineItem | undefined
    for (const item of page.items) {
      const sequence = item.sequence
      if (sequence === undefined || sequence <= after || frontier !== undefined && sequence > frontier
        || !isIncomingForRead(item) || item.status !== 1) continue
      if (first === undefined || sequence < first.sequence!) first = item
    }
    if (first) {
      if (!first.recordOwnerUserId) throw new Error('未读消息缺少定位信息')
      return first
    }
    const next = page.nextCursor?.afterSequence
    if (!page.hasMore || next === undefined || frontier !== undefined && next >= frontier) return undefined
    if (next <= after) break
    after = next
  }
  throw new Error('未能定位到第一条未读消息')
}
