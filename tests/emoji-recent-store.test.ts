import { afterEach, describe, expect, it, vi } from 'vitest'
import { arkmeRecentEmojiStore } from '../src/client/emoji-recent-store.js'

const { callArkme } = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme }))
afterEach(() => { callArkme.mockReset() })

describe('recent emoji client persistence boundary', () => {
  it('reports a failed selection to its caller while letting readers and later selections recover', async () => {
    let fail!: (reason: Error) => void
    callArkme.mockImplementationOnce(async () => await new Promise((_resolve, reject) => { fail = reject }))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['joy_face'])
    const write = arkmeRecentEmojiStore.recordRecentEmoji('test:42', 'angry_face')
    const read = arkmeRecentEmojiStore.recentEmojiIds('test:42')
    const result = Promise.allSettled([write, read])
    await Promise.resolve()
    fail(new Error('write not confirmed'))
    expect(await result).toEqual([
      { status: 'rejected', reason: new Error('write not confirmed') },
      { status: 'fulfilled', value: [] },
    ])
    await expect(arkmeRecentEmojiStore.recordRecentEmoji('test:42', 'joy_face')).resolves.toEqual(['joy_face'])
  })

  it('keeps independent callers ordered without requiring a mounted picker', async () => {
    let finish!: () => void
    let ids: string[] = []
    callArkme.mockImplementation(async (operation: string, params: { emojiId: string }) => {
      if (operation === 'emoji.recent.list') return [...ids]
      if (params.emojiId === 'angry_face') await new Promise<void>(resolve => { finish = resolve })
      ids = [params.emojiId, ...ids.filter(id => id !== params.emojiId)]
      return [...ids]
    })
    const first = arkmeRecentEmojiStore.recordRecentEmoji('test:42', 'angry_face')
    const second = arkmeRecentEmojiStore.recordRecentEmoji('test:42', 'joy_face')
    const read = arkmeRecentEmojiStore.recentEmojiIds('test:42')
    await Promise.resolve()
    expect(callArkme).toHaveBeenCalledTimes(1)
    finish()
    await expect(first).resolves.toEqual(['angry_face'])
    await expect(second).resolves.toEqual(['joy_face', 'angry_face'])
    await expect(read).resolves.toEqual(['joy_face', 'angry_face'])
  })
})
