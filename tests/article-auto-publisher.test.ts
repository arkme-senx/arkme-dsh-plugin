import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArticleAutoPublisher } from '../src/client/article-auto-publisher.js'
let dirty: boolean, ready: boolean, writer: ArticleAutoPublisher
const publish = vi.fn(), onError = vi.fn()
beforeEach(() => {
  vi.useFakeTimers(); dirty = ready = true
  publish.mockReset().mockImplementation(async () => { dirty = false }); onError.mockReset()
  writer = new ArticleAutoPublisher({ dirty: () => dirty, ready: () => ready, publish, onError })
})
afterEach(() => { writer.stop(); vi.useRealTimers() })
it('debounces to five idle seconds without periodic polling', async () => {
  writer.changed(); await vi.advanceTimersByTimeAsync(4_999); expect(publish).not.toHaveBeenCalled()
  writer.changed(); await vi.advanceTimersByTimeAsync(4_999); expect(publish).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1); expect(publish).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(60_000); expect(publish).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
})
it('bounds continuous typing to thirty seconds', async () => {
  writer.changed()
  for (let i = 0; i < 7; i++) { await vi.advanceTimersByTimeAsync(4_000); writer.changed() }
  await vi.advanceTimersByTimeAsync(2_000); expect(publish).toHaveBeenCalledOnce()
})
it('does not write during composition or incomplete image processing', async () => {
  ready = false; writer.changed(); await vi.advanceTimersByTimeAsync(30_000); expect(publish).not.toHaveBeenCalled()
  ready = true; writer.readyChanged(); await vi.advanceTimersByTimeAsync(5_000); expect(publish).toHaveBeenCalledOnce()
})
it('serializes concurrent close/share and drains changes made during an in-flight write', async () => {
  let complete!: () => void
  publish.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve }))
  const first = writer.flush(); await Promise.resolve()
  const second = writer.flush(); expect(first).toBe(second); expect(publish).toHaveBeenCalledOnce()
  writer.changed(); complete(); await first
  expect(publish).toHaveBeenCalledTimes(2); expect(dirty).toBe(false)
})
it('retains failed work without a retry loop and allows an explicit recovery trigger', async () => {
  publish.mockRejectedValueOnce(new Error('offline'))
  await expect(writer.flush()).rejects.toThrow('offline'); expect(onError).toHaveBeenCalledOnce()
  writer.readyChanged(); await vi.advanceTimersByTimeAsync(100_000); expect(publish).toHaveBeenCalledOnce()
  await writer.flush(); expect(publish).toHaveBeenCalledTimes(2)
})
it('flushes immediately on leave and never sends an unchanged article', async () => {
  writer.changed(); await writer.flush(); expect(publish).toHaveBeenCalledOnce()
  writer.changed(); await writer.flush(); await vi.advanceTimersByTimeAsync(30_000); expect(publish).toHaveBeenCalledOnce()
})
