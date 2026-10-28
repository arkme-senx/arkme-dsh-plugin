import { expect, it, vi } from 'vitest'
import type { ArkmeCallHistoryItem, ArkmeCallHistoryPage } from '../src/types.js'
import { refreshCallHistory } from '../src/client/call-history-refresh.js'

const item = (id: string, time = 1): ArkmeCallHistoryItem => ({
  stableId: id, callRef: `${id}-handle`, peerDisplayName: id, mediaType: 'audio',
  startedAtMillis: time, acceptedAtMillis: time, endedAtMillis: time + 1, durationSeconds: 1,
  callResult: 'NormalEnd', resultLabel: '已结束', summaryStatus: 'done', canOpenDetail: true, canRedial: true,
})
const page = (items: ArkmeCallHistoryItem[], nextCursor = ''): ArkmeCallHistoryPage => ({ items, hasMore: !!nextCursor, nextCursor })
const signal = () => new AbortController().signal

it('reads only the first page on initial entry', async () => {
  const read = vi.fn(async () => page([item('first')], 'next'))
  expect(await refreshCallHistory(undefined, read, signal())).toEqual(page([item('first')], 'next'))
  expect(read).toHaveBeenCalledOnce()
})

it('updates matching rows, preserves older pages/cursor, and sorts new records first', async () => {
  const previous = page([item('existing', 20), item('older', 10)], 'older-next')
  const updated = { ...item('existing', 20), callRef: 'new-handle', summaryPreview: 'ready' }
  const next = { ...page([item('new', 30), updated], 'head-next'), recentContacts: [{ userId: 2, displayName: 'Peer' }] }
  const result = await refreshCallHistory(previous, async () => next, signal())
  expect(result.items).toEqual([item('new', 30), updated, item('older', 10)])
  expect(result.nextCursor).toBe('older-next')
  expect(result.recentContacts).toEqual(next.recentContacts)
  expect(previous.items).toEqual([item('existing', 20), item('older', 10)])
})

it('keeps a previously reached end after refreshing the head', async () => {
  const result = await refreshCallHistory(page([item('head', 2), item('old')]), async () => page([item('head', 2)], 'head-next'), signal())
  expect(result.hasMore).toBe(false)
  expect(result.items).toHaveLength(2)
})

it('catches up across multiple new pages until it meets cached history', async () => {
  const read = vi.fn(async (cursor?: string) => cursor === 'next2' ? page([item('new2', 3)], 'next3')
    : cursor === 'next3' ? page([item('head', 2)], 'next4') : page([item('new1', 4)], 'next2'))
  const result = await refreshCallHistory(page([item('head', 2), item('old')], 'old-next'), read, signal())
  expect(read.mock.calls).toEqual([[], ['next2'], ['next3']])
  expect(result.items.map(i => i.stableId)).toEqual(['new1', 'new2', 'head', 'old'])
  expect(result.nextCursor).toBe('old-next')
})

it('reconciles a complete server response, including deleted records', async () => {
  const result = await refreshCallHistory(page([item('deleted'), item('retained')]), async () => page([item('retained')]), signal())
  expect(result.items.map(i => i.stableId)).toEqual(['retained'])
  expect(result.hasMore).toBe(false)
})

it.each(['', 'loop'])('rejects a missing or repeated catch-up cursor (%s)', async cursor => {
  const read = vi.fn(async () => ({ items: [item('new')], hasMore: true, nextCursor: cursor }))
  await expect(refreshCallHistory(page([item('cached')]), read, signal())).rejects.toThrow('分页游标无效')
  expect(read.mock.calls.length).toBeLessThanOrEqual(2)
})

it('stops catch-up when its account/page is disposed', async () => {
  const abort = new AbortController()
  const read = vi.fn(async () => { abort.abort(); return page([item('new')], 'next') })
  await expect(refreshCallHistory(page([item('cached')]), read, abort.signal)).rejects.toThrow('aborted')
  expect(read).toHaveBeenCalledOnce()
})
