import { describe, expect, it, vi } from 'vitest'
import { LocationSearchCache } from '../src/client/location-search-cache.js'
import { worldLocationViewport } from '../src/location-search.js'
const query = { mode: 'viewport' as const, ...worldLocationViewport }
describe('short-lived location search cache', () => {
  it('coalesces reads and retains the old snapshot while stale content refreshes', async () => {
    let now = 1000, finish!: (value: unknown) => void
    const read = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const cache = new LocationSearchCache(read, () => now); cache.activate('one')
    const first = cache.load('one', query), second = cache.load('one', query)
    expect(first).toBe(second)
    await Promise.resolve(); finish({ markers: ['first'] }); await first
    await cache.load('one', query)
    expect(read).toHaveBeenCalledTimes(1)
    now += 61_000
    const refresh = cache.load('one', query)
    expect(cache.peek('one', query)).toEqual({ markers: ['first'] })
    await Promise.resolve(); finish({ markers: ['updated'] }); await refresh
    expect(cache.peek('one', query)).toEqual({ markers: ['updated'] })
    now += 301_000
    expect(cache.peek('one', query)).toBeUndefined()
  })
  it('rejects responses from the previous account and clears data when switching back', async () => {
    let finish!: (value: unknown) => void
    const cache = new LocationSearchCache(() => new Promise(resolve => { finish = resolve }))
    cache.activate('one')
    const pending = cache.load('one', query); await Promise.resolve()
    cache.activate('two'); finish({ markers: ['private'] })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cache.peek('two', query)).toBeUndefined()
    cache.activate('one'); expect(cache.peek('one', query)).toBeUndefined()
  })
  it('invalidates pending reads and discards selected records on privacy changes', async () => {
    const cache = new LocationSearchCache(async () => ({ markers: [] }))
    cache.activate('one'); await cache.load('one', query)
    cache.saveNavigation('one', { viewport: worldLocationViewport, sources: ['quick_note'], scrollTop: 90,
      page: { key: 'selected', data: { items: [], hasMore: false, nextOffset: 0, truncated: false } } })
    cache.invalidate(false)
    expect(cache.peek('one', query)).toEqual({ markers: [] })
    cache.invalidate(true)
    expect(cache.peek('one', query)).toBeUndefined()
    expect(cache.getNavigation('one')).toMatchObject({ page: undefined, scrollTop: 0 })
  })
  it('cancels superseded map queries without cancelling a shared identical query', async () => {
    const requests: { signal: AbortSignal; finish: (value: unknown) => void }[] = []
    const cache = new LocationSearchCache((_query, signal) => new Promise(finish => requests.push({ signal, finish })))
    cache.activate('one')
    const old = cache.load('one', query); await Promise.resolve()
    const next = cache.load('one', { ...query, zoom: 12 }); await Promise.resolve()
    expect(requests[0]!.signal.aborted).toBe(true)
    expect(requests[1]!.signal.aborted).toBe(false)
    expect(cache.load('one', { ...query, zoom: 12 })).toBe(next)
    requests[0]!.finish({ markers: ['old'] }); await expect(old).rejects.toMatchObject({ name: 'AbortError' })
    requests[1]!.finish({ markers: ['new'] }); await next
  })
})
