import { describe, expect, it } from 'vitest'
import { mergeTimelineSendRows } from '../src/client/unified-timeline-send-overlay.js'
import { compareUnifiedTimelineEvents, mergeUnifiedTimelineWindow, type ArkmeUnifiedTimelineEvent, type ArkmeUnifiedTimelineWindow } from '../src/unified-chat-timeline.js'

function message(eventId: string, sequence: number, orderTie: string): ArkmeUnifiedTimelineEvent {
  return { kind: 'message', source: 'messages', eventId, occurredAtMillis: 100, orderTie, contentStatus: 'available',
    item: { itemUid: eventId, status: 1, title: '', textContent: eventId, sendAtMillis: 100, sequence } }
}
const card = message('card', 463, 'forward_rel_card')
const comment = message('comment', 464, 'forward_comment_rel_comment')
function page(events: ArkmeUnifiedTimelineEvent[]): ArkmeUnifiedTimelineWindow {
  return { protocolVersion: 2, events: [...events].sort(compareUnifiedTimelineEvents), sources: [{ source: 'messages', status: 'ready', itemCount: events.length }],
    complete: true, windowTokens: ['opaque-window'], olderCursor: 'opaque-older', newerCursor: 'opaque-newer', olderHasMore: true, newerHasMore: false, hasMore: true }
}
describe('forward card and comment in the unified display', () => {
  it('uses native sequence for same-time chat messages without changing protocol order, identities, or cursors', () => {
    const window = page([card, comment])
    const original = structuredClone(window)
    expect(window.events.map(event => event.eventId)).toEqual(['comment', 'card'])
    const rows = mergeTimelineSendRows(window.events, [])
    expect(rows.map(row => row.eventId)).toEqual(['card', 'comment'])
    expect(rows[0]).toBe(card); expect(rows[1]).toBe(comment)
    expect(window).toEqual(original)
  })
  it.each(['older', 'newer', 'refresh'] as const)('keeps forward before comment after %s pages arrive in reverse order and deduplicate', mode => {
    let window = mergeUnifiedTimelineWindow(undefined, page([comment]), 'initial')
    window = mergeUnifiedTimelineWindow(window, page(mode === 'refresh' ? [comment, card] : [card]), mode)
    window = mergeUnifiedTimelineWindow(window, page([card]), 'older')
    expect(mergeTimelineSendRows(window.events, []).map(row => row.eventId)).toEqual(['card', 'comment'])
    expect(window.events).toHaveLength(2)
    expect(window.windowTokens).toEqual(['opaque-window'])
    expect(window.olderCursor).toBe('opaque-older'); expect(window.newerCursor).toBe('opaque-newer')
  })
  it('leaves non-message and unknown-sequence slots in place without a mixed, non-transitive comparator', () => {
    const notice = { ...comment, eventId: 'notice', kind: 'notice', text: 'notice' } as ArkmeUnifiedTimelineEvent
    const unknown = message('unknown', 0, 'unknown')
    const rows = mergeTimelineSendRows([comment, notice, unknown, card], [])
    expect(rows.map(row => row.eventId)).toEqual(['card', 'notice', 'unknown', 'comment'])
    expect(rows[1]).toBe(notice); expect(rows[2]).toBe(unknown)
    expect(mergeTimelineSendRows(rows, [])).toEqual(rows)
  })
  it('does not move messages between timestamps or lose pending send rows', () => {
    const old = { ...comment, eventId: 'old', occurredAtMillis: 99 }
    const pending = { ...message('pending', 0, 'local'), occurredAtMillis: 100 }
    const later = { ...card, eventId: 'later', occurredAtMillis: 101 }
    expect(mergeTimelineSendRows([old, comment, card, later], [pending]).map(row => row.eventId))
      .toEqual(['old', 'card', 'comment', 'pending', 'later'])
  })
})
