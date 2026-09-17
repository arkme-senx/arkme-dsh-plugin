import { describe, expect, it } from 'vitest'
import type { ArkmeTimelineItem } from '../src/types.js'
import { compareTimelineMessages } from '../src/client/timeline-message-order.js'

function item(itemUid: string, sendAtMillis: number, sequence?: number): ArkmeTimelineItem {
  return { itemUid, sendAtMillis, ...(sequence === undefined ? {} : { sequence }),
    senderName: '我', isMe: true, status: 1, title: '', textContent: itemUid }
}

describe('timeline message order', () => {
  it('uses target conversation sequence independently of IDs and record versions', () => {
    const card = { ...item('forward_record_x', 100, 7), recordVersion: 1 }
    const comment = { ...item('forward_comment_record_x', 100, 8), recordVersion: 100 }
    expect([comment, card].sort(compareTimelineMessages)).toEqual([card, comment])
  })

  it('keeps time primary even when sequence order disagrees', () => {
    const early = item('early', 100, 10), late = item('late', 101, 9)
    expect([late, early].sort(compareTimelineMessages)).toEqual([early, late])
  })

  it('treats missing local sequence like zero without losing pending or failed rows', () => {
    const pending = { ...item('z-local', 100), status: 0 }
    const failed = { ...item('a-failed', 100, 0), status: -1 }
    const confirmed = item('a-confirmed', 100, 5)
    expect([confirmed, pending, failed].sort(compareTimelineMessages)).toEqual([failed, pending, confirmed])
  })

  it('falls back to stable identity for equal sequences and non-chat records', () => {
    expect([item('z', 1, 3), item('a', 1, 3)].sort(compareTimelineMessages).map(x => x.itemUid)).toEqual(['a', 'z'])
    expect([item('z', 1), item('a', 1)].sort(compareTimelineMessages).map(x => x.itemUid)).toEqual(['a', 'z'])
  })

  it('is antisymmetric and transitive across local, confirmed, and different-time messages', () => {
    const values = [item('z', 1), item('a', 1, 0), item('z', 1, 1), item('a', 1, 2), item('b', 2, 1)]
    for (const a of values) for (const b of values) {
      expect(compareTimelineMessages(a, b) + compareTimelineMessages(b, a)).toBe(0)
      for (const c of values) {
        if (compareTimelineMessages(a, b) <= 0 && compareTimelineMessages(b, c) <= 0) {
          expect(compareTimelineMessages(a, c)).toBeLessThanOrEqual(0)
        }
      }
    }
  })
})
