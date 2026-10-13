import { describe, expect, it, vi } from 'vitest'
import { DayLocationCache } from '../src/client/day-location-cache.js'
const date = { bucketDate: '2026-10-13', timezone: 'Asia/Shanghai' }
const snapshot = { points: [], scanned: 1, failed: 0, complete: true }
describe('daily location snapshots', () => {
  it('reuses in-flight and complete reads while keeping date and timezone isolated', async () => {
    let finish!: (value: typeof snapshot) => void
    const read = vi.fn(() => new Promise<typeof snapshot>(resolve => { finish = resolve }))
    const cache = new DayLocationCache(read); cache.activate('one')
    const first = cache.load('one', date)
    expect(cache.load('one', date)).toBe(first)
    await Promise.resolve(); finish(snapshot); await first
    await cache.load('one', date)
    expect(read).toHaveBeenCalledTimes(1)
    expect(cache.get('one', date).data).toBe(snapshot)
    expect(cache.get('one', { ...date, bucketDate: '2026-10-12' }).data.complete).toBe(false)
    expect(cache.get('one', { ...date, timezone: 'UTC' }).data.complete).toBe(false)
  })
  it('publishes partial progress, retains it after failure, and retries', async () => {
    const read = vi.fn().mockImplementationOnce(async (_date, _signal, progress) => { progress({ ...snapshot, complete: false }); throw new Error('offline') }).mockResolvedValue(snapshot)
    const cache = new DayLocationCache(read); cache.activate('one')
    await cache.load('one', date)
    expect(cache.get('one', date)).toMatchObject({ data: { scanned: 1, complete: false }, loading: false, error: 'offline' })
    await cache.load('one', date)
    expect(cache.get('one', date)).toMatchObject({ data: { complete: true }, error: '' })
  })
  it('clears data and rejects late progress after privacy invalidation or an account switch', async () => {
    let publish!: (value: typeof snapshot) => void, finish!: (value: typeof snapshot) => void, signal!: AbortSignal
    const cache = new DayLocationCache((_date, s, progress) => { signal = s; publish = progress; return new Promise(resolve => { finish = resolve }) })
    cache.activate('one'); const pending = cache.load('one', date); await Promise.resolve()
    publish(snapshot); expect(cache.get('one', date).data.complete).toBe(true)
    cache.invalidate(true); expect(signal.aborted).toBe(true)
    publish(snapshot); finish(snapshot); await pending
    expect(cache.get('one', date).data.complete).toBe(false)
    const second = cache.load('one', date); await Promise.resolve(); cache.activate('two'); publish(snapshot); finish(snapshot); await second
    expect(signal.aborted).toBe(true); expect(cache.get('two', date).data.complete).toBe(false)
  })
  it('refreshes stale entries without blanking the last snapshot and bounds retained days', async () => {
    let now = 1000
    const read = vi.fn(async () => snapshot)
    const cache = new DayLocationCache(read, () => now); cache.activate('one')
    await cache.load('one', date); now += 61_000
    const refresh = cache.load('one', date)
    expect(cache.get('one', date)).toMatchObject({ data: snapshot, loading: true }); await refresh
    for (let day = 1; day <= 6; day++) await cache.load('one', { ...date, bucketDate: `2026-10-0${day}` })
    expect(cache.get('one', date).data.complete).toBe(false)
  })
  it('cancels an older date scan when selecting a new date', async () => {
    const requests: { signal: AbortSignal; finish: (value: typeof snapshot) => void }[] = []
    const cache = new DayLocationCache((_date, signal) => new Promise(finish => requests.push({ signal, finish })))
    cache.activate('one'); const first = cache.load('one', date); await Promise.resolve()
    const next = cache.load('one', { ...date, bucketDate: '2026-10-12' }); await Promise.resolve()
    expect(requests[0]!.signal.aborted).toBe(true); expect(requests[1]!.signal.aborted).toBe(false)
    requests[0]!.finish(snapshot); requests[1]!.finish(snapshot); await Promise.all([first, next])
    expect(cache.get('one', date).data.complete).toBe(false)
  })
})
