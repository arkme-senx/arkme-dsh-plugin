import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResourceStore } from '../src/client/resource-store.js'
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
afterEach(() => { vi.useRealTimers() })

describe('shared resource snapshots', () => {
  it('restores asynchronous local data before the network completes, then replaces it', async () => {
    const remote = deferred<number>()
    const store = new ResourceStore<number, string>({ loadCached: async () => 1, load: () => remote.promise })
    const pending = store.refresh('key', 'source')
    await vi.waitFor(() => expect(store.get('key').value).toBe(1))
    expect(store.get('key').refreshing).toBe(true)
    remote.resolve(2)
    await pending
    expect(store.get('key').value).toBe(2)
  })
  it('does not publish a late local restoration after reset', async () => {
    const local = deferred<number>()
    const load = vi.fn(async () => 2)
    const store = new ResourceStore<number, string>({ loadCached: () => local.promise, load })
    const pending = store.refresh('key', 'source').catch(error => error)
    await Promise.resolve()
    store.reset()
    local.resolve(1)
    await pending
    expect(store.get('key').value).toBeUndefined()
    expect(load).not.toHaveBeenCalled()
  })
  it('continues to the owner when optional local storage fails', async () => {
    const store = new ResourceStore<number, string>({ loadCached: async () => { throw new Error('disk') }, load: async () => 2 })
    await expect(store.refresh('key', 'source')).resolves.toBe(2)
  })

  it('can use a still-fresh fact without waiting for an unrelated background refresh', async () => {
    const pending = deferred<number>()
    const load = vi.fn().mockResolvedValueOnce(1).mockReturnValueOnce(pending.promise)
    const store = new ResourceStore<number, string>({ load })
    await store.refresh('key', 'source')
    const background = store.refresh('key', 'source')
    let immediate: number | undefined
    const current = store.refresh('key', 'source', false).then(value => { immediate = value })
    await Promise.resolve()
    const beforeRefreshCompletes = immediate
    pending.resolve(2); await Promise.all([background, current])
    expect(beforeRefreshCompletes).toBe(1)
  })
  it('invalidates each active entry once even though refresh updates LRU order', async () => {
    const load = vi.fn(async () => 1)
    const store = new ResourceStore<number, string>({ load })
    store.subscribe('a', 'source-a', vi.fn()); store.subscribe('b', 'source-b', vi.fn())
    store.invalidate()
    await vi.waitFor(() => { expect(store.get('a').refreshing).toBe(false); expect(store.get('b').refreshing).toBe(false) })
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('publishes the in-flight promise before notifying synchronous subscribers', async () => {
    const load = vi.fn(async () => 1)
    const store = new ResourceStore<number, string>({ load })
    let joined: Promise<number> | undefined
    store.subscribe('a', 'source', () => { if (store.get('a').refreshing) joined = store.refresh('a', 'source') })
    const read = store.refresh('a', 'source')
    expect(joined).toBe(read)
    await read; expect(load).toHaveBeenCalledOnce()
  })
  it('does not evict a new active query when existing entries are all subscribed', async () => {
    const store = new ResourceStore<number, string>({ load: async () => 2 }, Date.now, 1)
    store.subscribe('a', 'source-a', vi.fn())
    await expect(store.refresh('b', 'source-b')).resolves.toBe(2)
    const leave = store.subscribe('c', 'source-c', vi.fn())
    await expect(store.refresh('c', 'source-c')).resolves.toBe(2)
    expect(store.get('c').value).toBe(2)
    leave()
    expect(store.get('c').value).toBeUndefined()
  })
  it('joins reads while retaining the previous visible value on refresh and failure', async () => {
    const pending = deferred<number>()
    const load = vi.fn().mockResolvedValueOnce(1).mockReturnValueOnce(pending.promise)
    const store = new ResourceStore<number, string>({ load })
    await store.refresh('key', 'source')
    const a = store.refresh('key', 'source'); const b = store.refresh('key', 'source')
    expect(a).toBe(b)
    expect(store.get('key')).toMatchObject({ value: 1, refreshing: true, mutating: false })
    pending.reject(new Error('offline'))
    await expect(a).rejects.toThrow('offline')
    expect(store.get('key')).toMatchObject({ value: 1, refreshing: false, stale: true })
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('a read issued before a mutation cannot overwrite its acknowledgement', async () => {
    const pending = deferred<number>()
    const store = new ResourceStore<number, string>({ load: () => pending.promise })
    const oldRead = store.refresh('key', 'source').catch(error => error)
    await Promise.resolve()
    await store.mutate('key', 'source', async context => { context.commit(2) })
    pending.resolve(1); await oldRead
    expect(store.get('key')).toMatchObject({ value: 2, mutating: false, refreshing: false })
  })
  it('locks same-frame writes and leaves business failure recovery separate from query success', async () => {
    const pending = deferred<void>()
    const store = new ResourceStore<number, string>({ load: async () => 2 })
    const operation = vi.fn(async () => { await pending.promise; throw new Error('write unconfirmed') })
    const first = store.mutate('key', 'source', operation).catch(error => error)
    expect(await store.mutate('key', 'source', operation)).toBeUndefined()
    pending.resolve(); await first
    await store.refresh('key', 'source')
    expect(operation).toHaveBeenCalledOnce()
    expect(store.get('key').operationError).toMatchObject({ message: 'write unconfirmed' })
    expect(store.get('key').value).toBe(2)
  })
  it('reset isolates old completions while retaining mounted subscriptions', async () => {
    const pending = deferred<number>()
    const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(2)
    const store = new ResourceStore<number, string>({ load })
    const listener = vi.fn(); store.subscribe('key', 'source', listener)
    const old = store.refresh('key', 'source').catch(error => error)
    await Promise.resolve(); store.reset()
    await store.refresh('key', 'source'); const calls = listener.mock.calls.length
    pending.resolve(1); await old
    expect(store.get('key').value).toBe(2)
    expect(listener).toHaveBeenCalledTimes(calls)
  })
  it('keeps a shared request alive when only one consumer leaves', async () => {
    const pending = deferred<number>(); let signal!: AbortSignal
    const store = new ResourceStore<number, string>({ load: (_binding, input) => { signal = input; return pending.promise } })
    const leave = store.subscribe('key', 'source', vi.fn())
    const notify = vi.fn(); store.subscribe('key', 'source', notify)
    const query = store.refresh('key', 'source'); await Promise.resolve(); leave()
    expect(signal.aborted).toBe(false)
    pending.resolve(1); await query
    expect(store.get('key').value).toBe(1)
    expect(notify).toHaveBeenCalled()
  })
  it('coalesces invalidations received during a write into one later read', async () => {
    const load = vi.fn(async () => 3)
    const store = new ResourceStore<number, string>({ load })
    store.subscribe('key', 'source', vi.fn())
    await store.mutate('key', 'source', async context => {
      store.invalidate('key'); store.invalidate('key'); context.commit(2)
    })
    await vi.waitFor(() => expect(store.get('key').value).toBe(3))
    expect(load).toHaveBeenCalledOnce()
  })
  it('bounds older-value recovery to one additional query', async () => {
    const load = vi.fn(async () => 1)
    const store = new ResourceStore<number, string>({ load, accept: (old, next) => next >= old })
    store.subscribe('key', 'source', vi.fn())
    await store.mutate('key', 'source', async context => { context.commit(3) })
    await expect(store.refresh('key', 'source')).rejects.toThrow('较旧')
    await vi.waitFor(() => expect(store.get('key').refreshing).toBe(false))
    expect(store.get('key').value).toBe(3)
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('expires freshness without clearing the value and never lets storage errors fail a command', async () => {
    vi.useFakeTimers()
    const store = new ResourceStore<number, string>({ load: async () => 1, freshForMs: 60_000,
      persist: () => { throw new Error('quota') } })
    await store.refresh('key', 'source')
    expect(store.get('key').stale).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(store.get('key')).toMatchObject({ value: 1, stale: true })
    store.reset()
  })
})
