import { afterEach, expect, it, vi } from 'vitest'
import { cachedWorldImageDataUrl, invalidateWorldImages, loadWorldImageDataUrl, subscribeWorldImageInvalidation } from '../src/client/world-image-cache.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
const image = { mediaType: 'image/png' as const, bytes: 1, dataBase64: 'AA==' }
afterEach(() => arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }))
it('drops downloaded World bytes and rejects in-flight bytes when the account changes', async () => {
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7 })
  await loadWorldImageDataUrl('loaded', async () => image)
  let resolve!: (value: typeof image) => void
  const pending = loadWorldImageDataUrl('pending', () => new Promise(done => { resolve = done }))
  const rejected = expect(pending).rejects.toThrow('授权已变化')
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 8 })
  resolve(image); await rejected
  expect(cachedWorldImageDataUrl('loaded')).toBeUndefined()
  expect(cachedWorldImageDataUrl('pending')).toBeUndefined()
  const read = vi.fn(async () => image)
  await loadWorldImageDataUrl('loaded', read)
  expect(read).toHaveBeenCalledOnce()
})
it('invalidates only a withdrawn publication and prevents its late read from restoring the cache', async () => {
  await loadWorldImageDataUrl('other', async () => image)
  let resolve!: (value: typeof image) => void
  const pending = loadWorldImageDataUrl('withdrawn', () => new Promise(done => { resolve = done }))
  const rejected = expect(pending).rejects.toThrow('授权已变化')
  invalidateWorldImages(['withdrawn']); resolve(image); await rejected
  expect(cachedWorldImageDataUrl('withdrawn')).toBeUndefined()
  expect(cachedWorldImageDataUrl('other')).toBe('data:image/png;base64,AA==')
})

it('notifies every mounted view on withdrawal and account changes even after cache eviction', async () => {
  const first = vi.fn(), second = vi.fn(), unrelated = vi.fn()
  const stop1 = subscribeWorldImageInvalidation('shared', first)
  const stop2 = subscribeWorldImageInvalidation('shared', second)
  const stopOther = subscribeWorldImageInvalidation('other-view', unrelated)
  invalidateWorldImages(['shared'])
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce(); expect(unrelated).not.toHaveBeenCalled()
  stop1()
  arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:99})
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledTimes(2); expect(unrelated).toHaveBeenCalledOnce()
  stop2(); stopOther()
})
