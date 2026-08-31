import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeRequestCoordinator, ArkmeStaleRequestError } from '../src/request-coordinator.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

afterEach(() => { vi.useRealTimers() })

describe('ArkmeRequestCoordinator', () => {
  it('joins concurrent reads with the same semantic key', async () => {
    const coordinator = new ArkmeRequestCoordinator()
    const result = deferred<number>()
    const operation = vi.fn(async () => await result.promise)
    const request = {
      scope: 'user:1', lane: 'interactive-read' as const, service: 'chat' as const,
      key: 'timeline:session-1:first', operation,
    }

    const first = coordinator.run(request)
    const second = coordinator.run(request)
    await vi.waitFor(() => { expect(operation).toHaveBeenCalledOnce() })
    result.resolve(7)

    await expect(Promise.all([first, second])).resolves.toEqual([7, 7])
    expect(coordinator.snapshotStats()['interactive-read:chat']).toMatchObject({ started: 1, joined: 1 })
  })

  it('reuses only successful TTL values and honors an explicit bypass', async () => {
    let now = 1_000
    const coordinator = new ArkmeRequestCoordinator({ now: () => now })
    const operation = vi.fn(async () => ({ revision: operation.mock.calls.length }))
    const request = {
      scope: 'user:1', lane: 'interactive-read' as const, service: 'auth' as const,
      key: 'profile:self', cacheMs: 1_000, operation,
      clone: (value: { revision: number }) => ({ ...value }),
    }

    await expect(coordinator.run(request)).resolves.toEqual({ revision: 1 })
    await expect(coordinator.run(request)).resolves.toEqual({ revision: 1 })
    expect(operation).toHaveBeenCalledOnce()
    await expect(coordinator.run({ ...request, bypassCache: true })).resolves.toEqual({ revision: 2 })
    now += 1_001
    await expect(coordinator.run(request)).resolves.toEqual({ revision: 3 })
  })

  it('suppresses repeated failures during a cooldown without caching them as success', async () => {
    let now = 1_000
    const coordinator = new ArkmeRequestCoordinator({ now: () => now, random: () => 0.5 })
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce('ok')
    const request = {
      scope: 'user:1', lane: 'background-read' as const, service: 'chat' as const,
      key: 'projection:session-1', failureCooldownMs: 2_000, operation,
    }

    await expect(coordinator.run(request)).rejects.toThrow('busy')
    await expect(coordinator.run(request)).rejects.toThrow('busy')
    expect(operation).toHaveBeenCalledOnce()
    now += 2_001
    await expect(coordinator.run(request)).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('invalidates stale account work without allowing an old completion to clear new work', async () => {
    const coordinator = new ArkmeRequestCoordinator()
    const oldResult = deferred<string>()
    const newResult = deferred<string>()
    const operation = vi.fn()
      .mockImplementationOnce(async () => await oldResult.promise)
      .mockImplementationOnce(async () => await newResult.promise)
    const request = {
      scope: 'user:1', lane: 'interactive-read' as const, service: 'chat' as const,
      key: 'session:one', operation,
    }

    const oldRequest = coordinator.run(request)
    await vi.waitFor(() => { expect(operation).toHaveBeenCalledOnce() })
    coordinator.invalidateScope('user:1')
    const currentRequest = coordinator.run(request)
    await vi.waitFor(() => { expect(operation).toHaveBeenCalledTimes(2) })
    oldResult.resolve('stale')
    newResult.resolve('current')

    await expect(oldRequest).rejects.toBeInstanceOf(ArkmeStaleRequestError)
    await expect(currentRequest).resolves.toBe('current')
  })

  it('starts fresh keyed work after invalidation without cancelling or caching the detached result', async () => {
    const coordinator = new ArkmeRequestCoordinator()
    const oldResult = deferred<string>()
    const currentResult = deferred<string>()
    const signals: AbortSignal[] = []
    const operation = vi.fn()
      .mockImplementationOnce(async (signal: AbortSignal) => {
        signals.push(signal)
        return await oldResult.promise
      })
      .mockImplementationOnce(async (signal: AbortSignal) => {
        signals.push(signal)
        return await currentResult.promise
      })
    const request = {
      scope: 'user:1', lane: 'interactive-read' as const, service: 'chat' as const,
      key: 'calendar:month:2026-08', cacheMs: 30_000, operation,
    }

    const oldRequest = coordinator.run(request)
    const oldJoiner = coordinator.run(request)
    await vi.waitFor(() => { expect(operation).toHaveBeenCalledOnce() })

    coordinator.invalidateKey('user:1', 'calendar:')
    expect(signals[0]?.aborted).toBe(false)
    const currentRequest = coordinator.run(request)
    await vi.waitFor(() => { expect(operation).toHaveBeenCalledTimes(2) })

    oldResult.resolve('detached')
    await expect(Promise.all([oldRequest, oldJoiner])).resolves.toEqual(['detached', 'detached'])

    const currentJoiner = coordinator.run(request)
    expect(coordinator.snapshotStats()['interactive-read:chat']).toMatchObject({
      started: 2,
      joined: 2,
      cacheHits: 0,
    })

    currentResult.resolve('current')
    await expect(Promise.all([currentRequest, currentJoiner])).resolves.toEqual(['current', 'current'])
    await expect(coordinator.run(request)).resolves.toBe('current')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('does not restore a failure cooldown from invalidated keyed work', async () => {
    const coordinator = new ArkmeRequestCoordinator({ random: () => 0.5 })
    const oldResult = deferred<string>()
    const currentResult = deferred<string>()
    const operation = vi.fn()
      .mockImplementationOnce(async () => await oldResult.promise)
      .mockImplementationOnce(async () => await currentResult.promise)
    const request = {
      scope: 'user:1', lane: 'interactive-read' as const, service: 'chat' as const,
      key: 'calendar:date:2026-08-31', failureCooldownMs: 30_000, operation,
    }

    const oldRequest = coordinator.run(request)
    await vi.waitFor(() => { expect(operation).toHaveBeenCalledOnce() })
    coordinator.invalidateKey('user:1', 'calendar:')
    const currentRequest = coordinator.run(request)
    await vi.waitFor(() => { expect(operation).toHaveBeenCalledTimes(2) })

    oldResult.reject(new Error('detached failure'))
    await expect(oldRequest).rejects.toThrow('detached failure')
    const currentJoiner = coordinator.run(request)
    expect(coordinator.snapshotStats()['interactive-read:chat']).toMatchObject({
      started: 2,
      joined: 1,
      cooldownSkips: 0,
    })

    currentResult.resolve('current')
    await expect(Promise.all([currentRequest, currentJoiner])).resolves.toEqual(['current', 'current'])
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('also fences unkeyed mutations when their account generation changes', async () => {
    const coordinator = new ArkmeRequestCoordinator()
    const result = deferred<string>()
    const request = coordinator.run({
      scope: 'user:1', lane: 'write', service: 'chat',
      operation: async () => await result.promise,
    })
    await vi.waitFor(() => {
      expect(coordinator.snapshotStats()['write:chat']?.started).toBe(1)
    })

    coordinator.invalidateScope('user:1')
    result.resolve('stale write')

    await expect(request).rejects.toBeInstanceOf(ArkmeStaleRequestError)
  })

  it('rate-limits real starts while leaving unkeyed writes independent', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const coordinator = new ArkmeRequestCoordinator({
      laneLimits: { write: { maxConcurrent: 10, ratePerSecond: 2, burst: 2 } },
      defaultServiceLimit: { maxConcurrent: 20, ratePerSecond: 100, burst: 100 },
    })
    const started: number[] = []
    const requests = Array.from({ length: 5 }, () => coordinator.run({
      scope: 'user:1', lane: 'write' as const, service: 'chat' as const,
      operation: async () => { started.push(Date.now()); return started.length },
    }))

    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual([0, 0])
    await vi.advanceTimersByTimeAsync(499)
    expect(started).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(started).toEqual([0, 0, 500])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(started).toEqual([0, 0, 500, 1000, 1500])
    await expect(Promise.all(requests)).resolves.toHaveLength(5)
  })

  it('applies a server-requested cooldown to every request for that service', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const coordinator = new ArkmeRequestCoordinator({
      laneLimits: { 'interactive-read': { maxConcurrent: 10, ratePerSecond: 100, burst: 100 } },
      defaultServiceLimit: { maxConcurrent: 10, ratePerSecond: 100, burst: 100 },
    })
    const started: number[] = []
    const throttled = coordinator.run({
      scope: 'user:1', lane: 'interactive-read', service: 'chat',
      serviceCooldownMs: () => 1_000,
      operation: async () => { started.push(Date.now()); throw new Error('429') },
    }).catch(error => error as Error)
    await vi.advanceTimersByTimeAsync(0)
    await expect(throttled).resolves.toMatchObject({ message: '429' })

    const next = coordinator.run({
      scope: 'user:1', lane: 'interactive-read', service: 'chat',
      operation: async () => { started.push(Date.now()); return 'ok' },
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(started).toEqual([0])
    await vi.advanceTimersByTimeAsync(1)
    await expect(next).resolves.toBe('ok')
    expect(started).toEqual([0, 1000])
  })

  it('rejects excess queued work instead of accumulating an unbounded delay storm', async () => {
    const coordinator = new ArkmeRequestCoordinator({
      laneLimits: { 'background-read': { maxConcurrent: 1, ratePerSecond: 100, burst: 100, maxQueued: 1 } },
      defaultServiceLimit: { maxConcurrent: 10, ratePerSecond: 100, burst: 100, maxQueued: 10 },
    })
    const firstResult = deferred<number>()
    const first = coordinator.run({
      scope: 'user:1', lane: 'background-read', service: 'chat',
      operation: async () => await firstResult.promise,
    })
    await vi.waitFor(() => {
      expect(coordinator.snapshotStats()['background-read:chat']?.started).toBe(1)
    })
    const second = coordinator.run({
      scope: 'user:1', lane: 'background-read', service: 'chat', operation: async () => 2,
    })
    await expect(coordinator.run({
      scope: 'user:1', lane: 'background-read', service: 'chat', operation: async () => 3,
    })).rejects.toMatchObject({ name: 'ArkmeRequestQueueOverflowError' })

    firstResult.resolve(1)
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2])
    expect(coordinator.snapshotStats()['background-read:chat']?.queueRejected).toBe(1)
  })
})
