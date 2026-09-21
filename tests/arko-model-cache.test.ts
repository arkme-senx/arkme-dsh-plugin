import { describe, expect, it, vi } from 'vitest'
import { ArkoModelCache } from '../src/client/arko-model-cache.js'
import type { ArkmeArkoModelCatalog } from '../src/types.js'
const catalog = (key: string): ArkmeArkoModelCatalog => ({ defaultRouteKey: key, effectiveRouteKey: key, selectionSource: 'personal', options: [] })

describe('Arko model cache', () => {
  it('reuses fresh results and isolates environment and account', async () => {
    const cache = new ArkoModelCache()
    const load = vi.fn().mockResolvedValue(catalog('a'))
    await cache.load('test:1', load)
    await cache.load('test:1', load)
    expect(load).toHaveBeenCalledTimes(1)
    expect(cache.get('prod:1')).toBeUndefined()
    expect(cache.get('test:2')).toBeUndefined()
  })
  it('deduplicates requests and preserves stale data on refresh failure', async () => {
    let now = 0
    const cache = new ArkoModelCache(() => now)
    cache.set('test:1', catalog('a'))
    now = 300_001
    let reject!: (error: Error) => void
    const load = vi.fn(() => new Promise<ArkmeArkoModelCatalog>((_, fail) => { reject = fail }))
    const first = cache.load('test:1', load)
    const second = cache.load('test:1', load)
    expect(load).toHaveBeenCalledTimes(1)
    expect(cache.get('test:1')?.effectiveRouteKey).toBe('a')
    reject(new Error('offline'))
    await expect(first).rejects.toThrow('offline')
    await expect(second).rejects.toThrow('offline')
    expect(cache.get('test:1')?.effectiveRouteKey).toBe('a')
  })
  it('does not let an older fetch overwrite a successful model switch', async () => {
    const cache = new ArkoModelCache()
    let resolve!: (value: ArkmeArkoModelCatalog) => void
    const pending = cache.load('test:1', () => new Promise(done => { resolve = done }))
    cache.set('test:1', catalog('b'))
    resolve(catalog('a'))
    await pending
    expect(cache.get('test:1')?.effectiveRouteKey).toBe('b')
  })
})

it('shares activation state across remounts and prevents overlapping model switches', async () => {
  const cache = new ArkoModelCache()
  let resolve!: (value: ArkmeArkoModelCatalog) => void
  const first = cache.select('test:1', () => new Promise(done => { resolve = done }))
  expect(cache.isSelecting('test:1')).toBe(true)
  const secondLoader = vi.fn().mockResolvedValue(catalog('c'))
  const second = cache.select('test:1', secondLoader)
  await Promise.resolve()
  resolve(catalog('b'))
  await Promise.all([first, second])
  expect(secondLoader).not.toHaveBeenCalled()
  expect(cache.get('test:1')?.effectiveRouteKey).toBe('b')
  expect(cache.isSelecting('test:1')).toBe(false)
})
