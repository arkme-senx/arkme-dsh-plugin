import { describe, it, expect, vi } from 'vitest'
import { registerImportManifest } from '../src/client/recordings/recording-import-registration.js'
describe('manifest registration recovery', () => {
  it('automatically continues after network recovery without another user click', async () => {
    vi.useFakeTimers()
    try {
      const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ registered:true })
      const waiting = vi.fn(), pending = registerImportManifest(request, new AbortController().signal, waiting)
      await vi.advanceTimersByTimeAsync(15000)
      expect(await pending).toEqual({registered:true}); expect(request).toHaveBeenCalledTimes(2); expect(waiting).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })
  it('releases retry timers when the account scope is disposed', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController(), request = vi.fn().mockRejectedValue(new Error('offline'))
      const pending = registerImportManifest(request, controller.signal, () => {})
      const rejected = expect(pending).rejects.toBeDefined()
      await vi.advanceTimersByTimeAsync(1); controller.abort(); await rejected
      expect(vi.getTimerCount()).toBe(0); expect(request).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })
})
