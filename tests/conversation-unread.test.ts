import { expect, it, vi } from 'vitest'
import { buildConversationUnreadCoverage, findConversationFirstUnread } from '../src/client/conversation-unread.js'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'

const message = (sequence: number, isMe = false): ArkmeTimelineItem => ({
  itemUid: String(sequence), recordOwnerUserId: 7, sequence, isMe, status: 1,
  senderName: '成员', title: '', textContent: '', sendAtMillis: sequence,
})
const source: ArkmeSourceItem = { sourceRef: 'ref', kind: 'group_chat', displayName: '群', activeAtMillis: 0, unreadCount: 1 }

it('counts confirmed incoming messages through a contiguous range and stops at the first hole', () => {
  const rows = [message(18), message(13), message(11, true), message(12)].map(item => ({ readSequence: item.sequence!, item }))
  const coverage = buildConversationUnreadCoverage(rows, 10)
  expect(coverage.counts).toEqual([0, 1, 2])
  expect(coverage.firstUnread?.sequence).toBe(12)
  expect(coverage.counts[18 - coverage.from]).toBeUndefined()
})

it('reads forward from zero, ignores own and withdrawn rows, and follows the returned cursor', async () => {
  const read = vi.fn()
    .mockResolvedValueOnce({ source, items: [message(2, true), { ...message(3), status: 2 }], hasMore: true, nextCursor: { afterSequence: 4 } })
    .mockResolvedValueOnce({ source, items: [message(10), message(6), message(8)], hasMore: false })
  const item = await findConversationFirstUnread(0, 8, read, new AbortController().signal)
  expect(read.mock.calls).toEqual([[0], [4]])
  expect(item?.sequence).toBe(6)
})

it('does not read another page after switching conversations', async () => {
  const controller = new AbortController()
  const read = vi.fn(async () => {
    controller.abort()
    return { source, items: [], hasMore: true, nextCursor: { afterSequence: 12 } }
  })
  await expect(findConversationFirstUnread(10, 20, read, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(read).toHaveBeenCalledOnce()
})
