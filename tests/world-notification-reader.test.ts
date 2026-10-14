import { describe, expect, it, vi } from 'vitest'
import { readWorldNotifications } from '../src/client/world-notification-reader.js'
import type { callArkme } from '../src/client/api.js'

const reply = (id: string, parent: string, time: number, isSelf = false) => ({ interactionRef: id, parentRef: parent, authorName: '对方',
  textContent: id, createdAtMillis: time, publishedAtMillis: 0, isSelf })

describe('World notification recipient reconstruction', () => {
  it('includes replies to my comments in another World, paginates both sources and comments, excludes self/unrelated replies, and deduplicates', async () => {
    const read = vi.fn(async (operation, params) => {
      if (operation === 'world.notification-sources') return params.offset === 0
        ? { items: [{ recordRef: 'own-post', isComment: false }], hasMore: true, nextOffset: 20 }
        : { items: [{ recordRef: 'my-comment', isComment: true }], hasMore: false }
      if (params.recordRef === 'own-post') return { items: [reply('duplicate', 'my-comment', 5), reply('self', 'own-post', 20, true)], hasMore: false }
      return params.offset === 0
        ? { items: [reply('direct', 'my-comment', 10), reply('unrelated', 'someone-else', 30)], hasMore: true, nextOffset: 50 }
        : { items: [reply('duplicate', 'my-comment', 5)], hasMore: false }
    })
    const result = await readWorldNotifications(new AbortController().signal, read as typeof callArkme)
    expect(result.map(item => item.interactionRef)).toEqual(['direct', 'duplicate'])
    expect(result.every(item => item.replyToComment)).toBe(true)
    expect(read.mock.calls.some(call => call[1].offset === 50)).toBe(true)
    expect(read.mock.calls).toEqual(expect.arrayContaining([
      ['world.notification-sources', { offset: 0 }, expect.any(AbortSignal), { priority: 'background' }],
      ['world.interactions.list', { recordRef: 'my-comment', limit: 50, offset: 50 }, expect.any(AbortSignal), { priority: 'background' }],
    ]))
  })
  it('rejects a failed scan rather than claiming there are no notifications', async () => {
    const read = vi.fn(async operation => {
      if (operation === 'world.notification-sources') return { items: [{ recordRef: 'mine', isComment: true }], hasMore: false }
      throw new Error('offline')
    })
    await expect(readWorldNotifications(new AbortController().signal, read as typeof callArkme)).rejects.toThrow('offline')
  })
  it('rejects repeated cursors and stops when cancelled', async () => {
    const read = vi.fn(async () => ({ items: [], hasMore: true, nextOffset: 0 }))
    await expect(readWorldNotifications(new AbortController().signal, read as typeof callArkme)).rejects.toThrow('分页未推进')
    const controller = new AbortController(); controller.abort(); read.mockClear()
    await expect(readWorldNotifications(controller.signal, read as typeof callArkme)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
  })
})
