import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryArkmeAvatarImageStore } from '../src/client/avatar-image-store.js'

function imagePayload(value: string) {
  return {
    mediaType: 'image/png',
    dataBase64: Buffer.from(value).toString('base64'),
  }
}

function imageDataUrl(value: string): string {
  return `data:image/png;base64,${Buffer.from(value).toString('base64')}`
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function clientSourceFiles(directory: URL, prefix = ''): Array<{ name: string; source: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = `${prefix}${entry.name}`
    if (entry.isDirectory()) return clientSourceFiles(new URL(`${entry.name}/`, directory), `${name}/`)
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return []
    return [{ name, source: readFileSync(new URL(entry.name, directory), 'utf8') }]
  })
}

describe('InMemoryArkmeAvatarImageStore', () => {
  it('single-flights concurrent loads and caches the successful image', async () => {
    const pending = deferred<ReturnType<typeof imagePayload>>()
    const reader = vi.fn(async () => await pending.promise)
    const store = new InMemoryArkmeAvatarImageStore({ reader })

    const first = store.load('avatar-a')
    const concurrent = store.load('avatar-a')
    expect(reader).toHaveBeenCalledTimes(1)

    pending.resolve(imagePayload('first'))
    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      imageDataUrl('first'),
      imageDataUrl('first'),
    ])
    expect(store.current('avatar-a')).toBe(imageDataUrl('first'))
  })

  it('keeps the stale image visible while a changed active image is revalidated', async () => {
    let now = 1_000
    const pending = deferred<ReturnType<typeof imagePayload>>()
    const reader = vi.fn()
      .mockResolvedValueOnce(imagePayload('old'))
      .mockImplementationOnce(async () => await pending.promise)
    const store = new InMemoryArkmeAvatarImageStore({
      reader,
      now: () => now,
      ttlMillis: 100,
      jitterMillis: () => 0,
    })
    await store.load('avatar-a')
    const listener = vi.fn()
    store.subscribe('avatar-a', listener)
    listener.mockClear()
    now += 101

    const refresh = store.revalidateActive()
    expect(store.current('avatar-a')).toBe(imageDataUrl('old'))
    expect(listener).not.toHaveBeenCalled()

    pending.resolve(imagePayload('new'))
    await refresh
    expect(store.current('avatar-a')).toBe(imageDataUrl('new'))
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(imageDataUrl('new'))
  })

  it('does not notify subscribers when revalidation returns identical content', async () => {
    const reader = vi.fn(async () => imagePayload('same'))
    const store = new InMemoryArkmeAvatarImageStore({ reader })
    await store.load('avatar-a')
    const listener = vi.fn()
    store.subscribe('avatar-a', listener)

    await store.revalidateActive()

    expect(reader).toHaveBeenCalledTimes(2)
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps the last successful image when active revalidation fails', async () => {
    const reader = vi.fn()
      .mockResolvedValueOnce(imagePayload('old'))
      .mockRejectedValueOnce(new Error('offline'))
    const store = new InMemoryArkmeAvatarImageStore({ reader })
    await store.load('avatar-a')
    const listener = vi.fn()
    store.subscribe('avatar-a', listener)

    await store.revalidateActive()

    expect(store.current('avatar-a')).toBe(imageDataUrl('old'))
    expect(listener).not.toHaveBeenCalled()
  })

  it('revalidates subscribed references only and deduplicates shared references', async () => {
    const reader = vi.fn(async (imageRef: string) => imagePayload(imageRef))
    const store = new InMemoryArkmeAvatarImageStore({ reader })
    await Promise.all([
      store.load('avatar-active'),
      store.load('avatar-inactive'),
    ])
    const disposeFirst = store.subscribe('avatar-active', () => undefined)
    const disposeSecond = store.subscribe('avatar-active', () => undefined)
    reader.mockClear()

    await store.revalidateActive()

    expect(reader).toHaveBeenCalledOnce()
    expect(reader).toHaveBeenCalledWith('avatar-active')
    disposeFirst()
    disposeSecond()
  })

  it('clears account-scoped values and tells mounted subscribers to discard old images', async () => {
    const store = new InMemoryArkmeAvatarImageStore({
      reader: async () => imagePayload('old-account'),
    })
    store.activateScope('prod:1001')
    await store.load('avatar-a')
    const listener = vi.fn()
    store.subscribe('avatar-a', listener)

    store.activateScope('prod:2002')

    expect(store.current('avatar-a')).toBeUndefined()
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(undefined)
  })

  it('reloads mounted references after an authenticated scope change', async () => {
    let accountImage = 'first-account'
    const store = new InMemoryArkmeAvatarImageStore({ reader: async () => imagePayload(accountImage) })
    store.activateScope('prod:1001')
    await store.load('avatar-a')
    const listener = vi.fn()
    store.subscribe('avatar-a', listener)
    accountImage = 'second-account'

    store.activateScope('prod:2002')

    await vi.waitFor(() => { expect(store.current('avatar-a')).toBe(imageDataUrl('second-account')) })
    expect(listener.mock.calls).toEqual([[undefined], [imageDataUrl('second-account')]])
  })

  it('does not let an old-account in-flight read repopulate the cleared store', async () => {
    const pending = deferred<ReturnType<typeof imagePayload>>()
    const store = new InMemoryArkmeAvatarImageStore({
      reader: async () => await pending.promise,
    })
    store.activateScope('prod:1001')

    const staleLoad = store.load('avatar-a')
    store.activateScope('prod:2002')
    pending.resolve(imagePayload('old-account'))

    await expect(staleLoad).rejects.toThrow('Avatar image scope changed')
    expect(store.current('avatar-a')).toBeUndefined()
  })

  it('drops queued old-account reads so they cannot block the new account', async () => {
    const firstPending = deferred<ReturnType<typeof imagePayload>>()
    const reader = vi.fn(async (imageRef: string) => {
      if (imageRef === 'old-a') return await firstPending.promise
      return imagePayload(imageRef)
    })
    const store = new InMemoryArkmeAvatarImageStore({ reader, concurrency: 1 })
    store.activateScope('prod:1001')

    const firstOldLoad = store.load('old-a')
    const queuedOldLoad = store.load('old-b')
    store.activateScope('prod:2002')
    const newLoad = store.load('new-a')
    firstPending.resolve(imagePayload('old-a'))

    await expect(firstOldLoad).rejects.toThrow('Avatar image scope changed')
    await expect(queuedOldLoad).rejects.toThrow('Avatar image scope changed')
    await expect(newLoad).resolves.toBe(imageDataUrl('new-a'))
    expect(reader.mock.calls.map(([imageRef]) => imageRef)).toEqual(['old-a', 'new-a'])
  })

  it('does not invalidate values when the same account scope is activated again', async () => {
    const store = new InMemoryArkmeAvatarImageStore({ reader: async () => imagePayload('same-account') })
    store.activateScope('prod:1001')
    await store.load('avatar-a')
    const listener = vi.fn()
    store.subscribe('avatar-a', listener)

    store.activateScope('prod:1001')

    expect(store.current('avatar-a')).toBe(imageDataUrl('same-account'))
    expect(listener).not.toHaveBeenCalled()
  })

  it('bounds parallel Browser reads without serializing independent avatars', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<ReturnType<typeof imagePayload>>>>()
    let active = 0
    let peak = 0
    const reader = vi.fn(async (imageRef: string) => {
      active += 1
      peak = Math.max(peak, active)
      const operation = deferred<ReturnType<typeof imagePayload>>()
      pending.set(imageRef, operation)
      try { return await operation.promise }
      finally { active -= 1 }
    })
    const store = new InMemoryArkmeAvatarImageStore({ reader, concurrency: 2 })

    const loads = ['avatar-a', 'avatar-b', 'avatar-c', 'avatar-d'].map(async imageRef => await store.load(imageRef))
    expect(reader).toHaveBeenCalledTimes(2)
    expect(peak).toBe(2)

    pending.get('avatar-a')?.resolve(imagePayload('avatar-a'))
    pending.get('avatar-b')?.resolve(imagePayload('avatar-b'))
    await vi.waitFor(() => { expect(reader).toHaveBeenCalledTimes(4) })
    expect(peak).toBe(2)

    pending.get('avatar-c')?.resolve(imagePayload('avatar-c'))
    pending.get('avatar-d')?.resolve(imagePayload('avatar-d'))
    await expect(Promise.all(loads)).resolves.toEqual([
      imageDataUrl('avatar-a'), imageDataUrl('avatar-b'), imageDataUrl('avatar-c'), imageDataUrl('avatar-d'),
    ])
  })
})

describe('avatar image ownership boundary', () => {
  it('keeps image.read behind the shared avatar runtime', () => {
    const clientDirectory = new URL('../src/client/', import.meta.url)
    const directReaders = clientSourceFiles(clientDirectory)
      .filter(file => /['"]image\.read['"]/.test(file.source))
      .map(file => file.name)

    expect(directReaders).toEqual(['avatar-image-runtime.ts'])
  })
})
