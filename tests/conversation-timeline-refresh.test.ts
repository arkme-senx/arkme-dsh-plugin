import { describe, expect, it, vi } from 'vitest'
import { readConversationTimelineWindow } from '../src/client/conversation-timeline-refresh.js'
import type { ArkmeConversationTimelineSnapshot } from '../src/client/conversation-memory-cache.js'
import type { ArkmeSourceItem, ArkmeTimelineItem, ArkmeTimelinePage } from '../src/types.js'

const source: ArkmeSourceItem = { sourceRef: 'source', kind: 'private_chat', displayName: 'test', activeAtMillis: 0, unreadCount: 0 }
const record = (sequence: number): ArkmeTimelineItem => ({ itemUid: `r${sequence}`, sequence,
  sendAtMillis: sequence, title: '', textContent: '', status: 1, isMe: true, senderName: '我', version: 1 })
const window = (items: ArkmeTimelineItem[], mode: 'latest' | 'around' = 'latest'): ArkmeConversationTimelineSnapshot => ({
  items, mode, aiPolishNotices: [], hasMore: true, nextCursor: { beforeSequence: 1 },
})
const page = (items: ArkmeTimelineItem[], next?: number): ArkmeTimelinePage => ({ source, items,
  hasMore: next !== undefined, ...(next === undefined ? {} : { nextCursor: { beforeSequence: next } }) })

describe('refresh the loaded conversation window', () => {
  it('refreshes the latest window through all loaded history, including new arrivals but not older pages', async () => {
    const snapshot = window([record(1), record(20), record(80)])
    const read = vi.fn().mockResolvedValueOnce(page([record(99), record(80)], 60))
      .mockResolvedValueOnce(page([record(20)], 10)).mockResolvedValueOnce(page([record(1), record(0)], 1))
    const refreshed = await readConversationTimelineWindow(snapshot, read, new AbortController().signal)
    expect(refreshed.items.map(item => item.itemUid)).toEqual(['r99', 'r80', 'r20', 'r1'])
    expect(read.mock.calls).toEqual([[undefined], [{ beforeSequence: 60 }], [{ beforeSequence: 10 }]])
    expect(snapshot.items.map(item => item.itemUid)).toEqual(['r1', 'r20', 'r80'])
  })

  it('starts an around window at its upper sequence and does not fetch the latest page', async () => {
    const read = vi.fn().mockResolvedValue(page([record(12), record(10), record(9)], 9))
    const refreshed = await readConversationTimelineWindow(window([record(10), record(12)], 'around'), read, new AbortController().signal)
    expect(read).toHaveBeenCalledExactlyOnceWith({ beforeSequence: 13 })
    expect(refreshed.items.map(item => item.itemUid)).toEqual(['r12', 'r10'])
  })

  it('stops beyond a deleted oldest record and does not restore it from the old snapshot', async () => {
    const read = vi.fn().mockResolvedValue(page([record(12), record(9)], 9))
    const refreshed = await readConversationTimelineWindow(window([record(10), record(12)]), read, new AbortController().signal)
    expect(refreshed.items.map(item => item.itemUid)).toEqual(['r12'])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('refreshes the saved around range after all visible rows were removed', async () => {
    const snapshot = { ...window([], 'around'), aroundSequenceRange: { minimumSequence: 10, maximumSequence: 120 } }
    const read = vi.fn().mockResolvedValueOnce(page([record(120)], 110))
      .mockResolvedValueOnce(page([record(10), record(9)], 9))
    const refreshed = await readConversationTimelineWindow(snapshot, read, new AbortController().signal)
    expect(refreshed.items.map(item => item.itemUid)).toEqual(['r120', 'r10'])
    expect(read.mock.calls).toEqual([[{ beforeSequence: 121 }], [{ beforeSequence: 110 }]])
  })

  it.each([undefined, 100])('does not expand an around range for a locally sent item: %s', async sequence => {
    const snapshot = { ...window([record(10), record(12), { ...record(100), sequence }], 'around'),
      aroundSequenceRange: { minimumSequence: 10, maximumSequence: 12 } }
    const read = vi.fn().mockResolvedValue(page([record(50), record(12), record(10), record(9)], 9))
    const refreshed = await readConversationTimelineWindow(snapshot, read, new AbortController().signal)
    expect(read).toHaveBeenCalledExactlyOnceWith({ beforeSequence: 13 })
    expect(refreshed.items.map(item => item.itemUid)).toEqual(['r12', 'r10'])
  })

  it('does not use an unsent item to select the chat pagination contract', async () => {
    const snapshot = window([record(10), record(12), { ...record(100), status: 0, sequence: undefined, sendAtMillis: 1 }])
    const read = vi.fn().mockResolvedValue(page([record(12), record(9)], 9))
    const refreshed = await readConversationTimelineWindow(snapshot, read, new AbortController().signal)
    expect(refreshed.items.map(item => item.itemUid)).toEqual(['r12'])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('uses the record UID to stop and filter when a same-timestamp boundary was deleted', async () => {
    const records = [1, 2, 3].map(value => ({ ...record(value), sequence: undefined, sendAtMillis: 10 }))
    const read = vi.fn().mockResolvedValue({ source, items: [records[0], records[2]], hasMore: true,
      nextCursor: { sendAtMillis: 10, itemUid: 'r1' } })
    const refreshed = await readConversationTimelineWindow(window(records.slice(1)), read, new AbortController().signal)
    expect(refreshed.items.map(item => item.itemUid)).toEqual(['r3'])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('uses the actual record cursor for same-timestamp self records regardless of display order: %s', async reversed => {
    const a = { ...record(1), sequence: undefined, sendAtMillis: 10 }
    const b = { ...record(2), sequence: undefined, sendAtMillis: 10 }
    const read = vi.fn().mockResolvedValueOnce({ source, items: [b], hasMore: true,
      nextCursor: { sendAtMillis: 10, itemUid: b.itemUid } }).mockResolvedValueOnce({ source, items: [a], hasMore: false })
    const refreshed = await readConversationTimelineWindow(window(reversed ? [b, a] : [a, b]), read, new AbortController().signal)
    expect(read.mock.calls[1]).toEqual([{ sendAtMillis: 10, itemUid: b.itemUid }])
    expect(refreshed.items.map(item => item.itemUid)).toEqual(['r2', 'r1'])
  })

  it('does not return a partial replacement when a later page fails', async () => {
    const snapshot = window([record(1), record(80)])
    const read = vi.fn().mockResolvedValueOnce(page([record(80)], 70)).mockRejectedValueOnce(new Error('offline'))
    await expect(readConversationTimelineWindow(snapshot, read, new AbortController().signal)).rejects.toThrow('offline')
    expect(snapshot.items).toEqual([record(1), record(80)])
  })

  it('rejects a stalled cursor instead of looping forever', async () => {
    const read = vi.fn().mockResolvedValue(page([record(80)], 70))
    await expect(readConversationTimelineWindow(window([record(1), record(80)]), read, new AbortController().signal)).rejects.toThrow('游标未推进')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('rejects a missing continuation cursor instead of treating incomplete reads as deletion', async () => {
    const read = vi.fn().mockResolvedValue({ source, items: [record(80)], hasMore: true })
    await expect(readConversationTimelineWindow(window([record(1), record(80)]), read, new AbortController().signal)).rejects.toThrow('缺少分页游标')
  })

  it('rejects a response after its source or navigation scope was cancelled', async () => {
    const controller = new AbortController()
    const read = vi.fn(async () => { controller.abort(); return page([record(1)]) })
    await expect(readConversationTimelineWindow(window([record(1)]), read, controller.signal)).rejects.toThrow()
    expect(read).toHaveBeenCalledTimes(1)
  })
})
