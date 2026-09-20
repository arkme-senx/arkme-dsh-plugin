import { describe, expect, it, vi } from 'vitest'
import { SharedReadGroup } from '../src/shared-read-group.js'

function gate<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

describe('composite shared reads', () => {
  it('shares work but cancels only the departing reader', async () => {
    const group = new SharedReadGroup<number>()
    const pending = gate<number>()
    let transport!: AbortSignal
    const load = vi.fn(async (signal: AbortSignal) => { transport = signal; return await pending.promise })
    const first = new AbortController()
    const second = new AbortController()
    const a = group.run('a', load, first.signal)
    const b = group.run('a', load, second.signal)
    const results = Promise.allSettled([a, b])
    await Promise.resolve()
    first.abort()
    await expect(a).rejects.toMatchObject({ name: 'AbortError' })
    expect(transport.aborted).toBe(false)
    pending.resolve(7)
    expect((await results)[1]).toEqual({ status: 'fulfilled', value: 7 })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('aborts only when the last reader leaves and starts fresh on reopening', async () => {
    const group = new SharedReadGroup<number>()
    const pending = gate<number>()
    let transport!: AbortSignal
    const first = new AbortController()
    const second = new AbortController()
    const load = vi.fn(async (signal: AbortSignal) => { transport = signal; return await pending.promise })
    const a = group.run('a', load, first.signal)
    const b = group.run('a', load, second.signal)
    const results = Promise.allSettled([a, b])
    await Promise.resolve()
    first.abort(); second.abort()
    await results
    expect(transport.aborted).toBe(true)
    const fresh = vi.fn(async () => 9)
    await expect(group.run('a', fresh)).resolves.toBe(9)
    pending.resolve(7)
    expect(fresh).toHaveBeenCalledTimes(1)
  })

  it('detaches invalidated work without letting it become current again', async () => {
    const group = new SharedReadGroup<number>()
    const pending = gate<number>()
    let oldIsCurrent!: () => boolean
    const old = group.run('a', async (_signal, isCurrent) => { oldIsCurrent = isCurrent; return await pending.promise })
    await Promise.resolve()
    group.invalidate(key => key === 'a')
    expect(oldIsCurrent()).toBe(false)
    const next = gate<number>()
    let nextIsCurrent!: () => boolean
    const fresh = group.run('a', async (_signal, isCurrent) => { nextIsCurrent = isCurrent; return await next.promise })
    await Promise.resolve()
    pending.resolve(1)
    await old
    expect(nextIsCurrent()).toBe(true)
    next.resolve(2)
    await expect(fresh).resolves.toBe(2)
  })

  it('does not start a pre-cancelled read or poison the next attempt after failure', async () => {
    const group = new SharedReadGroup<number>()
    const controller = new AbortController()
    controller.abort()
    const load = vi.fn(async () => 3)
    await expect(group.run('a', load, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(load).not.toHaveBeenCalled()
    await expect(group.run('a', async () => { throw new Error('offline') })).rejects.toThrow('offline')
    await expect(group.run('a', load)).resolves.toBe(3)
  })

  it('keeps different read keys independent', async () => {
    const group = new SharedReadGroup<number>()
    const first = gate<number>()
    const a = group.run('a', async () => first.promise)
    await expect(group.run('b', async () => 2)).resolves.toBe(2)
    first.resolve(1)
    await expect(a).resolves.toBe(1)
  })

  it('aborts active transports when the owner is disposed', async () => {
    const group = new SharedReadGroup<number>()
    const read = group.run('a', signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })))
    await Promise.resolve()
    group.clear()
    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('disposes invalidated transports as well as reusable flights', async () => {
    const group = new SharedReadGroup<number>()
    const pending = gate<number>()
    let transport!: AbortSignal
    const read = group.run('a', async signal => { transport = signal; return await pending.promise })
    await Promise.resolve()
    group.invalidate(key => key === 'a')
    group.clear()
    try { expect(transport.aborted).toBe(true) }
    finally { pending.resolve(1); await read }
  })

})
