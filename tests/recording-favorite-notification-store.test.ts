// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { RecordingFavoriteNotificationStore } from '../src/client/recording-favorite-notification-store.js'
const item = { favoriteRef: 'notice-1', accountKey: 'test:42', readAtMillis: 0, createdAtMillis: 100, audience: 'sharer' } as any
let store: RecordingFavoriteNotificationStore, release: () => void
beforeEach(() => {
  vi.useFakeTimers(); arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  mocks.call.mockReset().mockImplementation(async (_op, input) => input.action === 'summary' ? { accountKey: 'test:42', unreadCount: 1, readThrough: 'watermark' } : input.action === 'read' ? { acknowledged: true } : { accountKey: 'test:42', items: [item], readThrough: 'watermark' })
  store = new RecordingFavoriteNotificationStore()
})
afterEach(() => { release?.(); vi.useRealTimers(); arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }) })
it('shares a bounded subscription without periodic polling or implicit read acknowledgements', async () => {
  release = store.acquire('test:42'); await store.refresh()
  expect(store.getSnapshot().unreadCount).toBe(1)
  await vi.advanceTimersByTimeAsync(600_000)
  expect(mocks.call).toHaveBeenCalledTimes(2)
  expect(mocks.call.mock.calls.some(([, input]) => input.action === 'read')).toBe(false)
  await store.read('test:42', [item], new AbortController().signal)
  expect(mocks.call.mock.calls.find(([, input]) => input.action === 'read')?.[1]).toEqual({ action: 'read', accountKey: 'test:42', favoriteRef: 'notice-1' })
  expect(store.getSnapshot().items[0]?.readAtMillis).toBeGreaterThan(0)
})
it('coalesces invalidations during a read and discards late replies after account replacement', async () => {
  let resolve!: (value: unknown) => void
  mocks.call.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  release = store.acquire('test:42')
  await Promise.resolve()
  for (let index = 0; index < 10; index++) store.invalidate('test:42')
  expect(mocks.call).toHaveBeenCalledTimes(2)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 })
  resolve({ accountKey: 'test:42', items: [item], readThrough: 'watermark' })
  await store.refresh()
  const other = store.acquire('test:43')
  expect(store.getSnapshot().items).toEqual([])
  other()
})
