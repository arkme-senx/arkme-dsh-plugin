import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArkmePresentationMaintenance } from '../src/client/presentation-maintenance-runtime.js'

afterEach(() => { vi.useRealTimers() })

describe('Arkme presentation maintenance runtime', () => {
  it('runs directory and avatar maintenance independently and stops both lifecycles', async () => {
    vi.useFakeTimers()
    const refreshDirectory = vi.fn().mockRejectedValue(new Error('directory offline'))
    const revalidateAvatars = vi.fn(async () => undefined)
    const maintenance = createArkmePresentationMaintenance({
      refreshDirectory,
      revalidateAvatars,
      intervalMillis: 100,
      jitterMillis: () => 0,
    })

    const stop = maintenance.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(refreshDirectory).toHaveBeenCalledOnce()
    expect(revalidateAvatars).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(100)
    expect(refreshDirectory).toHaveBeenCalledTimes(2)
    expect(revalidateAvatars).toHaveBeenCalledTimes(2)

    stop()
    await vi.advanceTimersByTimeAsync(500)
    expect(refreshDirectory).toHaveBeenCalledTimes(2)
    expect(revalidateAvatars).toHaveBeenCalledTimes(2)
  })
})
