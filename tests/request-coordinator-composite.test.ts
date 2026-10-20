import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeRequestCoordinator } from '../src/request-coordinator.js'

const composite = {
  scope: 'test:42', lane: 'interactive-read' as const, service: 'extension' as const,
  admission: 'route-only' as const, route: 'composite', cancelWhenUnobserved: true,
}
function gate() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}
afterEach(() => { vi.useRealTimers() })

it('keeps composite route concurrency and rate limits without reserving lane or service capacity', async () => {
  vi.useFakeTimers()
  const coordinator = new ArkmeRequestCoordinator({
    laneLimits: { 'interactive-read': { maxConcurrent: 1, burst: 1, ratePerSecond: 1 } },
    defaultServiceLimit: { maxConcurrent: 1, burst: 1, ratePerSecond: 1 },
  })
  const held = gate(), next = vi.fn(async () => 'next')
  const first = coordinator.run({ ...composite, key: 'one', operation: () => held.promise })
  const second = coordinator.run({ ...composite, key: 'two', operation: next })
  await vi.advanceTimersByTimeAsync(0)
  expect(next).not.toHaveBeenCalled()
  // Same lane and service can still admit one real transport while the owner route is occupied.
  await expect(coordinator.run({ scope: composite.scope, lane: composite.lane, service: composite.service,
    operation: async () => 'transport' })).resolves.toBe('transport')
  held.resolve(); await first
  await vi.advanceTimersByTimeAsync(199)
  expect(next).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  await expect(second).resolves.toBe('next')
  coordinator.dispose()
})

it('bounds a composite route queue and removes cancelled waiters without consuming transport queue capacity', async () => {
  vi.useFakeTimers()
  const coordinator = new ArkmeRequestCoordinator({ laneLimits: { 'interactive-read': { maxQueued: 1 } } })
  const held = gate(), controller = new AbortController(), operation = vi.fn(async () => undefined)
  const first = coordinator.run({ ...composite, key: 'active', operation: () => held.promise })
  const queued = Promise.allSettled(Array.from({ length: 128 }, (_, index) => coordinator.run({
    ...composite, key: `queued:${index}`, signal: controller.signal, operation,
  })))
  await expect(coordinator.run({ ...composite, key: 'overflow', operation })).rejects.toMatchObject({ name: 'ArkmeRequestQueueOverflowError' })
  await expect(coordinator.run({ scope: composite.scope, lane: composite.lane, service: composite.service,
    operation: async () => 'transport' })).resolves.toBe('transport')
  controller.abort()
  expect((await queued).every(result => result.status === 'rejected')).toBe(true)
  expect(operation).not.toHaveBeenCalled()
  const fresh = coordinator.run({ ...composite, key: 'fresh', operation })
  held.resolve(); await first
  await vi.advanceTimersByTimeAsync(200)
  await fresh
  expect(operation).toHaveBeenCalledOnce()
  coordinator.dispose()
})

it('includes route wait in the composite deadline and never starts an expired callback', async () => {
  vi.useFakeTimers()
  const coordinator = new ArkmeRequestCoordinator(), held = gate(), operation = vi.fn(async () => 'expired')
  const first = coordinator.run({ ...composite, key: 'first', operation: () => held.promise })
  const pending = coordinator.run({ ...composite, key: 'expired', operation, recovery: {
    maxAttempts: 1, deadlineMs: 100, delay: () => undefined,
    exhausted: error => error as Error, timeout: () => new Error('owner deadline'),
  } })
  const check = expect(pending).rejects.toThrow('owner deadline')
  await vi.advanceTimersByTimeAsync(100)
  await check
  held.resolve(); await first
  await vi.advanceTimersByTimeAsync(500)
  expect(operation).not.toHaveBeenCalled()
  coordinator.dispose()
})

it('requires a route instead of admitting an unbounded composite', async () => {
  const coordinator = new ArkmeRequestCoordinator()
  const { route: _route, ...request } = composite
  await expect(coordinator.run({ ...request, operation: async () => undefined })).rejects.toThrow('bounded route')
  coordinator.dispose()
})
