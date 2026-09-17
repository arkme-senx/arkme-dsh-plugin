import { expect, it, vi } from 'vitest'
import type { ArkmeConversationMemberRecordPage } from '../src/types.js'
import { readMemberRecordWindow } from '../src/client/member-records-loader.js'

function page(cursor?: number): ArkmeConversationMemberRecordPage {
  return { items: [], hasMore: true, ...(cursor === undefined ? {} : { nextCursor: { beforeSequence: cursor } }) } as ArkmeConversationMemberRecordPage
}

it.each([undefined, 0, -1])('rejects an unusable refresh cursor %s', async cursor => {
  const read = vi.fn().mockResolvedValue(page(cursor))
  await expect(readMemberRecordWindow(read, { refresh: true, signal: new AbortController().signal })).rejects.toThrow('分页游标无效')
  expect(read).toHaveBeenCalledTimes(1)
})

it('stops non-progressing pagination instead of retrying indefinitely', async () => {
  const read = vi.fn().mockResolvedValue(page(40))
  await expect(readMemberRecordWindow(read, { refresh: true, loadedCursor: 10, signal: new AbortController().signal })).rejects.toThrow('分页游标无效')
  expect(read).toHaveBeenCalledTimes(2)
})

it('does not publish a stale last page when cancellation races with the response', async () => {
  const controller = new AbortController()
  const read = vi.fn().mockImplementation(async () => {
    controller.abort()
    return { items: [], hasMore: false }
  })
  await expect(readMemberRecordWindow(read, { refresh: true, signal: controller.signal })).rejects.toThrow()
  expect(read).toHaveBeenCalledTimes(1)
})
