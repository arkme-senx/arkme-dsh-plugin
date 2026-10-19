import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmePluginError } from '../../src/services/service.js'
import { waitForVoiceprintRecovery } from '../../src/services/voiceprint-recovery.js'

afterEach(() => { vi.useRealTimers() })

describe('world voiceprint enrollment recovery', () => {
  it('waits for the durable candidate and returns the ready chunk', async () => {
    vi.useFakeTimers()
    const generate = vi.fn().mockRejectedValueOnce(new ArkmePluginError('arkme-code-1106', '准备中', false))
      .mockRejectedValueOnce(new ArkmePluginError('arkme-code-1106', '准备中', false))
      .mockResolvedValue({ chunkIndex: 0 })
    const result = waitForVoiceprintRecovery(generate, async () => {})
    await vi.advanceTimersByTimeAsync(6_000)
    await expect(result).resolves.toEqual({ chunkIndex: 0 })
    expect(generate).toHaveBeenCalledTimes(3)
  })

  it('stops waiting immediately when playback is cancelled', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const generate = vi.fn().mockRejectedValue(new ArkmePluginError('arkme-code-1106', '准备中', false))
    const result = waitForVoiceprintRecovery(generate, async () => {}, controller.signal)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(60_000)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not replay an ordinary server or authorization failure', async () => {
    for (const code of ['arkme-code-1002', 'arkme-code-1003', 'arkme-timeout']) {
      const error = new ArkmePluginError(code, 'failure', true)
      const generate = vi.fn().mockRejectedValue(error)
      await expect(waitForVoiceprintRecovery(generate, async () => {})).rejects.toBe(error)
      expect(generate).toHaveBeenCalledTimes(1)
    }
  })

  it('checks account lifecycle again before retry and after success', async () => {
    vi.useFakeTimers()
    const generate = vi.fn().mockRejectedValue(new ArkmePluginError('arkme-code-1106', '准备中', false))
    const active = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('account changed'))
    const result = waitForVoiceprintRecovery(generate, active)
    const rejected = expect(result).rejects.toThrow('account changed')
    await vi.advanceTimersByTimeAsync(3_000)
    await rejected
    expect(generate).toHaveBeenCalledTimes(1)
    const afterSuccess = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('account changed'))
    const lateGenerate = vi.fn(async () => 'late chunk')
    await expect(waitForVoiceprintRecovery(lateGenerate, afterSuccess)).rejects.toThrow('account changed')
    expect(lateGenerate).toHaveBeenCalledTimes(1)
  })

  it('does not start a late retry when the host resumes after the polling window', async () => {
    vi.useFakeTimers()
    const generate = vi.fn().mockRejectedValue(new ArkmePluginError('arkme-code-1106', '准备中', false))
    const result = waitForVoiceprintRecovery(generate, async () => {})
    const rejected = expect(result).rejects.toMatchObject({ code: 'world-voiceprint-preparing' })
    await vi.advanceTimersByTimeAsync(0)
    vi.setSystemTime(Date.now() + 90_000)
    await vi.advanceTimersByTimeAsync(3_000)
    await rejected
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('bounds preparation polling to one minute', async () => {
    vi.useFakeTimers()
    const generate = vi.fn().mockRejectedValue(new ArkmePluginError('arkme-code-1106', '准备中', false))
    const result = waitForVoiceprintRecovery(generate, async () => {})
    const rejected = expect(result).rejects.toMatchObject({ code: 'world-voiceprint-preparing' })
    await vi.advanceTimersByTimeAsync(60_000)
    await rejected
    expect(generate).toHaveBeenCalledTimes(20)
  })
})
