import { afterEach, expect, it, vi } from 'vitest'
import { withArkmeReadDeadline } from '../src/client/read-deadline.js'

afterEach(() => { vi.useRealTimers() })

it('bounds a stalled read, cancels its transport, and cleans up its timer', async () => {
  vi.useFakeTimers()
  let signal!: AbortSignal
  const pending = withArkmeReadDeadline(current => {
    signal = current
    return new Promise(() => undefined)
  })
  const rejected = expect(pending).rejects.toThrow('读取超时')
  await vi.advanceTimersByTimeAsync(30_000)
  await rejected
  expect(signal.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('preserves caller cancellation and never starts an already cancelled read', async () => {
  const controller = new AbortController()
  const read = vi.fn().mockResolvedValue(1)
  controller.abort()
  await expect(withArkmeReadDeadline(read, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(read).not.toHaveBeenCalled()
})

it('returns successful reads unchanged and releases the deadline', async () => {
  vi.useFakeTimers()
  expect(await withArkmeReadDeadline(async () => 7)).toBe(7)
  expect(vi.getTimerCount()).toBe(0)
})

it('settles a non-cooperative read when its owning page exits', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const pending = withArkmeReadDeadline(() => new Promise(() => undefined), controller.signal)
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await rejected
  expect(vi.getTimerCount()).toBe(0)
})
