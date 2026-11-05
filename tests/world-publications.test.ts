import { afterEach, expect, it, vi } from 'vitest'
import { WorldPublicationStore } from '../src/client/world-publications.js'
afterEach(() => vi.useRealTimers())
it('batches visible source cards to at most 50 and shares the detail cache', async () => {
  vi.useFakeTimers()
  const call = vi.fn(async (_op, params) => ({
    items: params.targets.map((t) => ({ itemUid: t.itemUid, publications: [] })),
  }))
  const store = new WorldPublicationStore(call as never)
  for (let i = 0; i < 111; i++)
    store.subscribe('test:8', { source: { sourceRef: 's', messageActionRef: `a${i}`, itemUid: `i${i}` } }, () => {})
  const target = { source: { sourceRef: 's', messageActionRef: 'a0', itemUid: 'i0' } }
  store.subscribe('test:8', target, () => {})
  await vi.advanceTimersByTimeAsync(30)
  expect(call).toHaveBeenCalledTimes(3)
  expect(call.mock.calls.map((c) => c[1].targets.length)).toEqual([50, 50, 11])
  expect(store.snapshot(store.key('test:8', target))).toEqual({ loading: false, publications: [] })
})
it('discards stale results after publication invalidation and keeps failures explicit until retry', async () => {
  vi.useFakeTimers()
  let complete!: (v: unknown) => void
  const call = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ items: [{ itemUid: 'i', publications: [] }] })
  const store = new WorldPublicationStore(call as never),
    target = { source: { sourceRef: 's', messageActionRef: 'a', itemUid: 'i' } },
    key = store.key('test:8', target)
  store.subscribe('test:8', target, () => {})
  await vi.advanceTimersByTimeAsync(30)
  store.invalidate()
  await vi.advanceTimersByTimeAsync(30)
  complete({ items: [{ itemUid: 'i', publications: [{ requested: true }] }] })
  await Promise.resolve()
  expect(store.snapshot(key)).toMatchObject({ loading: false, error: 'offline', publications: [] })
  store.retry(key)
  await vi.advanceTimersByTimeAsync(30)
  expect(store.snapshot(key)).toEqual({ loading: false, publications: [] })
})
