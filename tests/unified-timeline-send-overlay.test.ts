import { describe, expect, it } from 'vitest'
import type { ArkmeTimelineItem } from '../src/types.js'
import type { ArkmeUnifiedTimelineWindow } from '../src/unified-chat-timeline.js'
import { mergeTimelineSendRows, unifiedTimelineMessageSequence, unifiedTimelineSendOverlay } from '../src/client/unified-timeline-send-overlay.js'
import { arkmeShouldRefreshChatTimeline } from '../src/client/conversation-memory-cache.js'
import { fileTaskTimelineItem } from '../src/client/file-send-tasks.js'
import type { ArkmeFileSendTask } from '../src/file-transfer-contract.js'

function item(sequence: number, extra: Partial<ArkmeTimelineItem> = {}): ArkmeTimelineItem {
  return { itemUid: `record-${sequence}`, sequence, sendAtMillis: sequence * 1000,
    textContent: '', senderName: '我', isMe: true, status: 1, ...extra }
}
function window(items = [item(1843), item(1882)]): ArkmeUnifiedTimelineWindow {
  return { protocolVersion: 1, events: items.map(item => ({ kind: 'message', item, eventId: `event-${item.itemUid}`,
    source: 'messages', occurredAtMillis: item.sendAtMillis, orderTie: item.itemUid, contentStatus: 'available' })),
    sources: [{ source: 'messages', status: 'ready', itemCount: items.length }], complete: true,
    windowTokens: ['opaque'], olderHasMore: true, newerHasMore: false, hasMore: true }
}

describe('unified timeline local sends', () => {
  it('does not let a newer send receipt suppress catch-up for an unseen incoming message', () => {
    const canonical = window([item(8), item(11, { status: 0 })])
    expect(unifiedTimelineMessageSequence(canonical)).toBe(8)
    expect(arkmeShouldRefreshChatTimeline({ unified: canonical, items: [item(8), item(10)],
      latestSequence: 10, fetchedAtMillis: 1000, aiPolishNotices: [], hasMore: false }, 1001, 9)).toBe(true)
  })
  it('does not append a successful historical receipt missing from the current page', () => {
    expect(unifiedTimelineSendOverlay(window(), [item(1834), item(1843), item(1882)])).toEqual([])
  })
  it('preserves the owner sequence on a file receipt, even when the local clock is ahead', () => {
    const task = { recordUid: 'local', content: { textContent: 'old image' }, createdAtMillis: 9999999, files: [],
      state: 'sent', result: { itemUid: 'confirmed', status: 1, sequence: 1834 } } as unknown as ArkmeFileSendTask
    const receipt = fileTaskTimelineItem(task)
    expect(receipt.sequence).toBe(1834)
    expect(unifiedTimelineSendOverlay(window(), [receipt])).toEqual([])
  })
  it('keeps a new accepted send through a stale read and replaces it with one canonical row', () => {
    const sent = item(1883)
    expect(unifiedTimelineSendOverlay(window(), [sent])).toEqual([sent])
    expect(unifiedTimelineSendOverlay(window([item(1882), sent]), [sent])).toEqual([])
  })
  it('does not revive a confirmed receipt omitted by a later complete read', () => {
    expect(unifiedTimelineSendOverlay(window([item(1882), item(1884)]), [item(1883)])).toEqual([])
  })
  it('keeps an unconfirmed send when there is a source gap', () => {
    const page = window(); page.complete = false; page.sources[0]!.status = 'gap'
    expect(unifiedTimelineSendOverlay(page, [item(1834), item(1850), item(1883)])).toEqual([item(1850), item(1883)])
  })
  it('does not attach a disconnected successful send to a history window', () => {
    const page = window(); page.newerHasMore = true
    expect(unifiedTimelineSendOverlay(page, [item(1834), item(1883)], new Set(['record-1883']))).toEqual([])
    // A send performed while reading history keeps its existing immediate feedback.
    expect(unifiedTimelineSendOverlay(page, [item(1883)])).toEqual([item(1883)])
  })
  it.each(['queued', 'uploading', 'sending', 'failed', 'uncertain'] as const)('preserves %s file tasks and their retry identity', state => {
    const task = { recordUid: state, content: {}, createdAtMillis: 1, files: [], state } as unknown as ArkmeFileSendTask
    const pending = fileTaskTimelineItem(task)
    expect(unifiedTimelineSendOverlay(window(), [pending])).toEqual([pending])
  })
  it('does not restore canonical items from an evicted window via retention', () => {
    expect(unifiedTimelineSendOverlay(window(), [item(1883, { timelineEventId: 'old-window-event' })])).toEqual([])
  })
  it('uses time only for legacy receipts without a sequence and keeps a first send in an empty chat', () => {
    expect(unifiedTimelineSendOverlay(window(), [item(1834, { sequence: undefined }), item(1883, { sequence: undefined })]))
      .toEqual([item(1883, { sequence: undefined })])
    expect(unifiedTimelineSendOverlay(window([]), [item(1)])).toEqual([item(1)])
  })
  it('interleaves pending sends without reordering equal-time canonical events or changing their identities', () => {
    const canonical = [{ id: 'first', occurredAtMillis: 10 }, { id: 'public', occurredAtMillis: 20 }, { id: 'message', occurredAtMillis: 20 }]
    const sending = [{ id: 'pending', occurredAtMillis: 15 }, { id: 'new', occurredAtMillis: 20 }]
    const merged = mergeTimelineSendRows(canonical, sending)
    expect(merged.map(row => row.id)).toEqual(['first', 'pending', 'public', 'message', 'new'])
    expect(merged[0]).toBe(canonical[0]); expect(merged[2]).toBe(canonical[1]); expect(merged[3]).toBe(canonical[2])
  })
})
