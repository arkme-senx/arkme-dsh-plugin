import type { ArkmeTimelineItem } from '../types.js'
import type { ArkmeUnifiedTimelineWindow } from '../unified-chat-timeline.js'

/** Displayed message coverage excludes composer receipts and unavailable bodies. */
export function unifiedTimelineMessageSequence(window: ArkmeUnifiedTimelineWindow): number {
  return Math.max(0, ...window.events.flatMap(event => event.kind === 'message' && event.contentStatus === 'available'
    && event.item.status === 1 ? [event.item.sequence ?? 0] : []))
}

/** A refresh replaces history, but cannot settle an in-flight composer send. */
export function pendingUnifiedTimelineSends(items: readonly ArkmeTimelineItem[]): ArkmeTimelineItem[] {
  return items.filter(item => item.isMe && item.timelineEventId === undefined
    && (item.status !== 1 || item.awaitingTimelineProjection === true))
}

/** Sending tasks are receipts, not another source of chat history. */
export function unifiedTimelineSendOverlay(
  window: ArkmeUnifiedTimelineWindow,
  items: readonly ArkmeTimelineItem[],
  historicalFileIds: ReadonlySet<string> = new Set(),
): ArkmeTimelineItem[] {
  const ids = new Set<string>()
  let firstSequence = Infinity
  let lastSequence = 0
  for (const event of window.events) {
    if (event.kind !== 'message') continue
    ids.add(event.item.itemUid)
    const sequence = event.item.sequence ?? 0
    if (sequence > 0) {
      firstSequence = Math.min(firstSequence, sequence)
      lastSequence = Math.max(lastSequence, sequence)
    }
  }
  const messagesReady = window.sources.some(source => source.source === 'messages' && source.status === 'ready')
  const firstMillis = window.events[0]?.occurredAtMillis
  return items.filter(item => {
    if (ids.has(item.itemUid) || item.timelineEventId !== undefined) return false
    // Preserve uploading, failed and uncertain sends, including their retry UI.
    if (item.status !== 1) return true
    const sequence = item.sequence ?? 0
    if (sequence > 0 && lastSequence > 0) {
      if (sequence < firstSequence || messagesReady && sequence <= lastSequence) return false
    } else if (firstMillis !== undefined && item.sendAtMillis < firstMillis) return false
    // A history window must not acquire a second, disconnected latest tail.
    return !window.newerHasMore || !historicalFileIds.has(item.itemUid)
  })
}

/** Keep event identities/cursors intact; native sequence orders equal-time chat message slots. */
export function mergeTimelineSendRows<T extends { occurredAtMillis: number }, U extends { occurredAtMillis: number }>(
  canonical: readonly T[],
  sending: readonly U[],
): Array<T | U> {
  const rows: Array<T | U> = []
  let index = 0
  for (const row of canonical) {
    while (index < sending.length && sending[index]!.occurredAtMillis < row.occurredAtMillis) {
      rows.push(sending[index++]!)
    }
    rows.push(row)
  }
  while (index < sending.length) rows.push(sending[index++]!)
  for (let start = 0; start < rows.length;) {
    let end = start + 1
    while (end < rows.length && rows[end]!.occurredAtMillis === rows[start]!.occurredAtMillis) end++
    const slots: number[] = []
    const messages: Array<{ row: T | U; sequence: number }> = []
    for (let slot = start; slot < end; slot++) {
      const row = rows[slot]!
      const message = row as { kind?: string; item?: { sequence?: number } }
      const sequence = message.item?.sequence
      if (message.kind === 'message' && sequence !== undefined && Number.isSafeInteger(sequence) && sequence > 0) {
        slots.push(slot); messages.push({ row, sequence })
      }
    }
    // Only permute message slots; mixing seq and opaque event ties in one comparator is not transitive.
    messages.sort((a, b) => a.sequence - b.sequence)
    slots.forEach((slot, offset) => { rows[slot] = messages[offset]!.row })
    start = end
  }
  return rows
}
