import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserAvatarPersistentCache } from '../src/client/avatar-persistent-cache.js'

const rows = new Map<string, Response>()
const keyOf = (key: Request | string) => typeof key === 'string' ? key : key.url
const cache = {
  match: vi.fn(async (key: Request | string) => rows.get(keyOf(key))?.clone()),
  put: vi.fn(async (key: Request | string, value: Response) => { rows.set(keyOf(key), value.clone()) }),
  delete: vi.fn(async (key: Request | string) => rows.delete(keyOf(key))),
  keys: vi.fn(async () => [...rows.keys()].map(key => new Request(key))),
}
const ref = 'file_asset://cached-avatar-1'
const payload = { mediaType: 'image/png', dataBase64: 'aW1hZ2U=' }
beforeEach(() => {
  rows.clear(); vi.clearAllMocks()
  vi.stubGlobal('location', { origin: 'http://localhost:43210' })
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) })
})
afterEach(() => vi.unstubAllGlobals())

describe('browser immutable avatar cache', () => {
  it('survives new instances and isolates environments and accounts', async () => {
    await new BrowserAvatarPersistentCache().write('prod:4', ref, payload)
    const fresh = new BrowserAvatarPersistentCache()
    await expect(fresh.read('prod:4', ref)).resolves.toEqual(payload)
    await expect(fresh.read('test:4', ref)).resolves.toBeUndefined()
    await expect(fresh.read('prod:5', ref)).resolves.toBeUndefined()
  })
  it('does not persist mutable profile refs or an anonymous scope', async () => {
    const store = new BrowserAvatarPersistentCache()
    await store.write('prod:4', 'arkme-profile-image-v1.mutable', payload)
    await store.write('', ref, payload)
    expect(cache.put).not.toHaveBeenCalled()
  })
  it('evicts old entries at the count and byte limits', async () => {
    const store = new BrowserAvatarPersistentCache()
    for (let i = 0; i < 65; i++) await store.write('prod:4', `file_asset://avatar-${String(i).padStart(8,'0')}`, payload)
    expect(rows.size).toBe(64)
    await expect(store.read('prod:4', 'file_asset://avatar-00000000')).resolves.toBeUndefined()
    const keys = [...rows.keys()]
    // Stored byte lengths exercise eviction without allocating large test images.
    for (const key of keys) rows.set(key, new Response(JSON.stringify(payload), { headers: { 'Content-Length': String(2 * 1024 * 1024) } }))
    await store.write('prod:4', ref, payload)
    expect(rows.size).toBe(32)
    await expect(store.read('prod:4', ref)).resolves.toEqual(payload)
  })
  it('recovers from malformed entries, denied storage and a rejected write', async () => {
    const store = new BrowserAvatarPersistentCache()
    await store.write('prod:4', ref, payload)
    rows.set([...rows.keys()][0]!, new Response('{invalid json'))
    await expect(store.read('prod:4', ref)).resolves.toBeUndefined()
    expect(rows.size).toBe(0)
    cache.put.mockRejectedValueOnce(new Error('quota exceeded'))
    await expect(store.write('prod:4', ref, payload)).resolves.toBeUndefined()
    await store.write('prod:4', ref, payload)
    await expect(store.read('prod:4', ref)).resolves.toEqual(payload)
    vi.stubGlobal('caches', { open: vi.fn().mockRejectedValue(new Error('storage denied')) })
    await expect(store.read('prod:4', ref)).resolves.toBeUndefined()
  })
  it('accepts a real-sized base64 image without recursive regexp overflow', async () => {
    const large = { mediaType: 'image/jpeg', dataBase64: Buffer.alloc(759713, 1).toString('base64') }
    const store = new BrowserAvatarPersistentCache()
    await store.write('prod:4', ref, large)
    await expect(store.read('prod:4', ref)).resolves.toEqual(large)
  })
})
