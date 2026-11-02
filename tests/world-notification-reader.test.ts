import { expect, it, vi } from 'vitest'
import { readWorldNotifications } from '../src/client/world-notification-reader.js'
import type { callArkme } from '../src/client/api.js'

it('reads one bounded ledger page and leaves continuation to the user', async () => {
  const page = { items: [{ interactionRef: 'team-reply', unavailable: false }], hasMore: true, nextCursor: 'older' }
  const read = vi.fn(async () => page)
  expect(await readWorldNotifications(new AbortController().signal, read as typeof callArkme)).toBe(page)
  expect(read).toHaveBeenCalledExactlyOnceWith('world.comment-notifications', { limit: 20 }, expect.any(AbortSignal), { priority: 'background' })
})
it('preserves unavailable facts without reconstructing public trees', async () => {
  const page = { items: [{ interactionRef: 'withdrawn', unavailable: true }], hasMore: false }
  const read = vi.fn(async () => page)
  expect(await readWorldNotifications(new AbortController().signal, read as typeof callArkme, 'older')).toBe(page)
  expect(read).toHaveBeenCalledExactlyOnceWith('world.comment-notifications', { limit: 20, cursor: 'older' }, expect.any(AbortSignal), { priority: 'background' })
})
it('rejects a failed or non-advancing page and stops on cancellation', async () => {
  await expect(readWorldNotifications(new AbortController().signal, vi.fn(async () => { throw new Error('offline') }) as typeof callArkme)).rejects.toThrow('offline')
  await expect(readWorldNotifications(new AbortController().signal, vi.fn(async () => ({ items: [], hasMore: true, nextCursor: 'same' })) as typeof callArkme, 'same')).rejects.toThrow('分页')
  const c = new AbortController(); c.abort(); const read = vi.fn()
  await expect(readWorldNotifications(c.signal, read)).rejects.toThrow(); expect(read).not.toHaveBeenCalled()
})
