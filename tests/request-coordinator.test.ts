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
  it('accounts an already admitted transport to its original lane when a foreground reader joins', async () => {
    const coordinator = new ArkmeRequestCoordinator()
    const gate = deferred<number>()
    const operation = vi.fn(() => gate.promise)
    const read = { scope: 'user:1', service: 'auth' as const, key: 'profiles', operation }
    const background = coordinator.run({ ...read, lane: 'background-read' })
    const foreground = coordinator.run({ ...read, lane: 'interactive-read' })
    try {
      await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce())
      expect(coordinator.snapshotStats()['background-read:auth']?.started).toBe(1)
      expect(coordinator.snapshotStats()['interactive-read:auth']?.started ?? 0).toBe(0)
    } finally { gate.resolve(7); await Promise.all([background, foreground]); coordinator.dispose() }
  })

  it('retains foreground priority until the last foreground subscriber leaves', async () => {
    vi.useFakeTimers()
    const coordinator = new ArkmeRequestCoordinator({ laneLimits: {
      'background-read': { maxConcurrent: 1 }, 'interactive-read': { maxConcurrent: 1 },
    } })
    const bgGate = deferred<void>(), fgGate = deferred<void>()
    const bgBlocker = coordinator.run({ scope: 'user:1', lane: 'background-read', service: 'audio', operation: () => bgGate.promise })
    const fgBlocker = coordinator.run({ scope: 'user:1', lane: 'interactive-read', service: 'audio', operation: () => fgGate.promise })
    const operation = vi.fn(async () => 7)
    const read = { scope: 'user:1', service: 'auth' as const, key: 'profiles', cancelWhenUnobserved: true, operation }
    const background = coordinator.run({ ...read, lane: 'background-read' })
    const controller = new AbortController()
    const first = coordinator.run({ ...read, lane: 'interactive-read', signal: controller.signal })
    const second = coordinator.run({ ...read, lane: 'interactive-read' })
    const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    try {
      controller.abort(); await cancelled
      fgGate.resolve(); await fgBlocker
      await expect(Promise.all([second, background])).resolves.toEqual([7, 7])
      expect(operation).toHaveBeenCalledOnce()
    } finally {
      bgGate.resolve(); fgGate.resolve(); coordinator.dispose()
      await Promise.allSettled([bgBlocker, fgBlocker, first, second, background])
    }
  })

  it.each([false, true])('uses the remaining subscribers priority for recovery without resetting its deadline (cancel=%s)', async cancelForeground => {
    vi.useFakeTimers()
    const coordinator = new ArkmeRequestCoordinator({ laneLimits: { 'background-read': { maxConcurrent: 1 } } })
    const failure = new Error('temporary'), timeout = new Error('deadline')
    const firstAttempt = deferred<number>(), busy = deferred<void>()
    const operation = vi.fn().mockImplementationOnce(() => firstAttempt.promise).mockResolvedValue(7)
    const read = { scope: 'user:1', service: 'auth' as const, key: 'profiles', cancelWhenUnobserved: true, operation,
      recovery: { maxAttempts: 2, deadlineMs: 100, delay: (error: unknown) => error === failure ? 20 : undefined,
        exhausted: (error: unknown) => error as Error, timeout: () => timeout } }
    const background = coordinator.run({ ...read, lane: 'background-read' })
    const backgroundCheck = cancelForeground ? expect(background).rejects.toBe(failure) : expect(background).resolves.toBe(7)
    await vi.advanceTimersByTimeAsync(10)
    const blocker = coordinator.run({ scope: 'user:1', lane: 'background-read', service: 'audio', operation: () => busy.promise })
    const controller = new AbortController()
    const foreground = coordinator.run({ ...read, lane: 'interactive-read', signal: controller.signal })
    const foregroundCheck = cancelForeground ? expect(foreground).rejects.toMatchObject({ name: 'AbortError' }) : expect(foreground).resolves.toBe(7)
    try {
      if (cancelForeground) controller.abort()
      firstAttempt.reject(failure)
      await vi.advanceTimersByTimeAsync(21)
      expect(operation).toHaveBeenCalledTimes(cancelForeground ? 1 : 2)
      // The first attempt retains its original background slot until release.
      // Its retry can pass the background blocker only with a live foreground subscriber.
      await vi.advanceTimersByTimeAsync(70)
      await Promise.all([backgroundCheck, foregroundCheck])
    } finally {
      busy.resolve(); coordinator.dispose()
      await Promise.allSettled([background, foreground, blocker])
    }
  })

  it('returns a queued shared read to the background budget when its foreground subscriber cancels', async () => {
    vi.useFakeTimers()
    const coordinator = new ArkmeRequestCoordinator({ laneLimits: {
      'background-read': { maxConcurrent: 1 }, 'interactive-read': { maxConcurrent: 1 },
    } })
    const bgGate = deferred<void>(), fgGate = deferred<void>()
    const bgBlocker = coordinator.run({ scope: 'user:1', lane: 'background-read', service: 'audio', operation: () => bgGate.promise })
    const fgBlocker = coordinator.run({ scope: 'user:1', lane: 'interactive-read', service: 'audio', operation: () => fgGate.promise })
    const operation = vi.fn(async () => 7)
    const read = { scope: 'user:1', service: 'auth' as const, key: 'profiles', cancelWhenUnobserved: true, operation }
    const background = coordinator.run({ ...read, lane: 'background-read' })
    const controller = new AbortController()
    const foreground = coordinator.run({ ...read, lane: 'interactive-read', signal: controller.signal })
    const cancelled = expect(foreground).rejects.toMatchObject({ name: 'AbortError' })
    try {
      controller.abort(); await cancelled
      fgGate.resolve(); await fgBlocker
      await vi.advanceTimersByTimeAsync(10)
      expect(operation).not.toHaveBeenCalled()
      bgGate.resolve(); await bgBlocker
      await expect(background).resolves.toBe(7)
      expect(operation).toHaveBeenCalledOnce()
    } finally {
      bgGate.resolve(); fgGate.resolve(); coordinator.dispose()
      await Promise.allSettled([bgBlocker, fgBlocker, background, foreground])
    }
  })

  it('promotes a queued shared background read when a foreground consumer joins, without duplicating it', async () => {
    const coordinator = new ArkmeRequestCoordinator({ laneLimits: { 'background-read': { maxConcurrent: 1 } } })
    const busy = deferred<void>(), result = deferred<number>()
    const blocker = coordinator.run({ scope: 'user:1', lane: 'background-read', service: 'audio', operation: () => busy.promise })
    const operation = vi.fn(() => result.promise)
    const backgroundController = new AbortController()
    const read = { scope: 'user:1', service: 'auth' as const, key: 'profiles', route: 'profiles', cancelWhenUnobserved: true, operation }
    const background = coordinator.run({ ...read, lane: 'background-read', signal: backgroundController.signal })
    const cancelled = expect(background).rejects.toMatchObject({ name: 'AbortError' })
    const foreground = coordinator.run({ ...read, lane: 'interactive-read' })
    try {
      await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce())
      backgroundController.abort()
      await cancelled
      result.resolve(7)
      await expect(foreground).resolves.toBe(7)
      expect(operation).toHaveBeenCalledOnce()
    } finally {
      backgroundController.abort(); result.resolve(7); busy.resolve()
      await Promise.allSettled([background, foreground, blocker]); coordinator.dispose()
    }
  })

  it('keeps route admission and account isolation when promoting a shared read', async () => {
    vi.useFakeTimers()
    const coordinator = new ArkmeRequestCoordinator({ laneLimits: { 'background-read': { maxConcurrent: 1 } } })
    const busy = deferred<void>()
    const blocker = coordinator.run({ scope: 'user:1', lane: 'background-read', service: 'auth', route: 'profiles', operation: () => busy.promise })
    const operation = vi.fn(async () => 7)
    const read = { scope: 'user:1', service: 'auth' as const, key: 'profiles', route: 'profiles', operation }
    const background = coordinator.run({ ...read, lane: 'background-read' })
    const foreground = coordinator.run({ ...read, lane: 'interactive-read' })
    try {
      await vi.advanceTimersByTimeAsync(250)
      expect(operation).not.toHaveBeenCalled()
      await expect(coordinator.run({ ...read, scope: 'user:2', lane: 'interactive-read', operation: async () => 8 })).resolves.toBe(8)
      const checks = [expect(background).rejects.toBeInstanceOf(ArkmeStaleRequestError), expect(foreground).rejects.toBeInstanceOf(ArkmeStaleRequestError)]
      coordinator.invalidateScope('user:1')
      await Promise.all(checks)
      expect(operation).not.toHaveBeenCalled()
    } finally {
      busy.resolve(); await Promise.allSettled([blocker, background, foreground]); coordinator.dispose()
    }
  })

  it.each([false, true])('applies the final failure cooldown only when route-scoped (%s)', async coolsRoute => {
    vi.useFakeTimers()
    const coordinator = new ArkmeRequestCoordinator()
    const busy = new Error('busy')
    const shared = { scope: 'user:1', lane: 'interactive-read' as const, service: 'chat' as const, route: 'list' }
    await expect(coordinator.run({ ...shared, key: 'first', operation: async () => { throw busy }, recovery: {
      maxAttempts: 1, deadlineMs: 5000, delay: () => 1000, coolsRoute: () => coolsRoute,
      exhausted: () => busy, timeout: () => new Error('deadline'),
    } })).rejects.toBe(busy)
    const next = vi.fn(async () => 'next')
    const pending = coordinator.run({ ...shared, key: 'next', operation: next })
    await expect(coordinator.run({ ...shared, route: 'unread', key: 'other', operation: async () => 'other' })).resolves.toBe('other')
    await vi.advanceTimersByTimeAsync(250)
    expect(next).toHaveBeenCalledTimes(coolsRoute ? 0 : 1)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toBe('next')
    coordinator.dispose()
  })

  it('serializes different parameters on one account route while another route and writes keep moving', async () => {
    vi.useFakeTimers()
    const coordinator = new ArkmeRequestCoordinator()
    const gate = deferred<string>()
    const shared = { scope: 'user:1', lane: 'interactive-read' as const, service: 'chat' as const, route: 'list' }
    const first = coordinator.run({ ...shared, key: 'one', operation: () => gate.promise })
    const next = vi.fn(async () => 'two')
    const second = coordinator.run({ ...shared, key: 'two', operation: next })
    await vi.advanceTimersByTimeAsync(300)
    expect(next).not.toHaveBeenCalled()
    await expect(coordinator.run({ ...shared, route: 'unread', key: 'unread', operation: async () => 'unread' })).resolves.toBe('unread')
    await expect(coordinator.run({ scope: 'user:1', lane: 'write', service: 'chat', operation: async () => 'written' })).resolves.toBe('written')
    gate.resolve('one')
    await vi.advanceTimersByTimeAsync(1)
    await expect(Promise.all([first, second])).resolves.toEqual(['one', 'two'])
    coordinator.dispose()
  })

  it('aborts a registered shared transport only after all subscribers cancel', async () => {
    const coordinator = new ArkmeRequestCoordinator()
    let transport!: AbortSignal
    const request = { scope: 'user:1', lane: 'interactive-read' as const, service: 'chat' as const, key: 'list', route: 'list', cancelWhenUnobserved: true,
      operation: async (signal: AbortSignal) => {
        transport = signal
        return await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      } }
    const a = new AbortController(), b = new AbortController()
    const first = coordinator.run({ ...request, signal: a.signal })
    const second = coordinator.run({ ...request, signal: b.signal })
    const checks = [expect(first).rejects.toMatchObject({ name: 'AbortError' }), expect(second).rejects.toMatchObject({ name: 'AbortError' })]
    await vi.waitFor(() => expect(transport).toBeDefined())
    a.abort(); await checks[0]
    expect(transport.aborted).toBe(false)
    b.abort(); await checks[1]
    expect(transport.aborted).toBe(true)
    coordinator.dispose()
  })
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


it('reports bounded admission reasons and cancellation without exposing request keys', async () => {
  vi.useFakeTimers()
  const coordinator = new ArkmeRequestCoordinator({
    laneLimits: { 'interactive-read': { maxConcurrent: 1, burst: 1, ratePerSecond: 1 } },
    defaultServiceLimit: { maxConcurrent: 1, burst: 1, ratePerSecond: 1 },
  })
  const gate = deferred<string>(), onQueue = vi.fn()
  const request = { scope: 'secret-account', lane: 'interactive-read' as const, service: 'record' as const }
  const first = coordinator.run({ ...request, operation: () => gate.promise })
  const queued = coordinator.run({ ...request, onQueue, operation: async () => 'next' })
  const controller = new AbortController(), cancelledLog = vi.fn()
  const cancelled = coordinator.run({ ...request, signal: controller.signal, onQueue: cancelledLog, operation: async () => 'never' })
  const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort(); await rejected
  expect(cancelledLog.mock.calls.at(-1)).toEqual(['cancel', expect.objectContaining({ blockedBy: expect.stringContaining('service-concurrency') })])
  gate.resolve('first'); await first
  await vi.advanceTimersByTimeAsync(1000); await queued
  expect(onQueue.mock.calls.map(([event]) => event)).toEqual(['enter', 'start'])
  expect(onQueue.mock.calls[1]?.[1]).toMatchObject({ queueWaitMs: 1000, blockedBy: 'lane-concurrency,lane-rate,service-concurrency,service-rate' })
  expect(JSON.stringify(onQueue.mock.calls)).not.toContain('secret-account')
  coordinator.dispose()
})


it('bounds the aggregate queue across services and frees cancelled admission without starting it', async () => {
  const coordinator = new ArkmeRequestCoordinator({ maxConcurrent: 1, maxQueued: 1 })
  const held = deferred<string>()
  const base = { scope: 'u', lane: 'interactive-read' as const, service: 'chat' as const }
  const first = coordinator.run({ ...base, operation: () => held.promise })
  const controller = new AbortController(), queuedOperation = vi.fn(async () => 'queued')
  const queued = coordinator.run({ ...base, service: 'auth', signal: controller.signal, operation: queuedOperation })
  const cancelled = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
  try {
    await expect(coordinator.run({ ...base, service: 'team', operation: async () => 'overflow' })).rejects.toMatchObject({ name: 'ArkmeRequestQueueOverflowError' })
    controller.abort(); await cancelled
    const next = coordinator.run({ ...base, service: 'record', operation: async () => 'admitted' })
    held.resolve('first')
    await expect(next).resolves.toBe('admitted')
    expect(queuedOperation).not.toHaveBeenCalled()
  } finally { held.resolve('first'); await first; coordinator.dispose() }
})
