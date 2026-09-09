import { describe, expect, it, vi } from 'vitest'
import { DirectorySnapshotStore } from '../src/services/directory-snapshot.js'

describe('directory owner snapshot', () => {
  it('bounds retained snapshots and does not resurrect cleared account data', async () => {
    const store = new DirectorySnapshotStore<number>()
    const first = await store.read('u:1', async () => 1)
    for (let user = 2; user <= 5; user++) await store.read(`u:${user}`, async () => user)
    expect(store.get('u:1', first.id)).toBeUndefined()
    const current = await store.read('u:5', async () => 5)
    store.clear()
    expect(store.get('u:5', current.id)).toBeUndefined()
  })
  it('separates fresh lookup from bounded pagination retention and preserves active pages across a new read', async () => {
    vi.useFakeTimers()
    try {
      const store = new DirectorySnapshotStore<number[]>()
      const load = vi.fn(async () => [load.mock.calls.length])
      const first = await store.read('user:1:r0', load)
      await vi.advanceTimersByTimeAsync(31_000)
      const fresh = await store.read('user:1:r0', load)
      expect(fresh.id).not.toBe(first.id)
      expect(store.get('user:1:r0', first.id)).toEqual(first)
      expect(store.get('user:2:r0', first.id)).toBeUndefined()
      expect(store.get('user:1:r1', first.id)).toBeUndefined()
      await vi.advanceTimersByTimeAsync(30 * 60_000)
      expect(store.get('user:1:r0', first.id)).toBeUndefined()
      store.clear()
    } finally { vi.useRealTimers() }
  })
  it('shares one scan and stable snapshot until explicitly refreshed', async () => {
    const store = new DirectorySnapshotStore<number[]>()
    const load = vi.fn(async () => [load.mock.calls.length])
    const [a, b] = await Promise.all([store.read('user:1', load), store.read('user:1', load)])
    expect(a.id).toBe(b.id)
    expect((await store.read('user:1', load)).id).toBe(a.id)
    const fresh = await store.read('user:1', load, { refresh: true })
    expect(fresh.id).not.toBe(a.id)
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('cancels a shared scan only when its final observer leaves', async () => {
    const store = new DirectorySnapshotStore<number>()
    const a = new AbortController(), b = new AbortController()
    let scanSignal!: AbortSignal
    const load = vi.fn(async (signal: AbortSignal) => {
      scanSignal = signal
      return await new Promise<number>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    const first = store.read('user:1', load, { signal: a.signal })
    const second = store.read('user:1', load, { signal: b.signal })
    const firstCheck = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const secondCheck = expect(second).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    a.abort(); await firstCheck
    expect(scanSignal.aborted).toBe(false)
    b.abort(); await secondCheck
    expect(scanSignal.aborted).toBe(true)
    expect(load).toHaveBeenCalledOnce()
  })
  it('never caches a failed scan, and keeps account and read revision separate', async () => {
    const store = new DirectorySnapshotStore<number>()
    const load = vi.fn().mockRejectedValueOnce(new Error('failure')).mockResolvedValue(2)
    await expect(store.read('user:1:r0', load)).rejects.toThrow('failure')
    const a = await store.read('user:1:r0', load)
    const b = await store.read('user:1:r1', load)
    const c = await store.read('user:2:r0', load)
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
    expect(load).toHaveBeenCalledTimes(4)
    store.clear()
    expect((await store.read('user:1:r0', load)).id).not.toBe(a.id)
  })
})
