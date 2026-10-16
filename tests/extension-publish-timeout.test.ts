import { expect, it, vi } from 'vitest'
import { ServiceRuntime } from '../src/services/service.js'

it('waits for publication receipts beyond the normal timeout while preserving cancellation and read limits', async () => {
  vi.useFakeTimers()
  const signals: AbortSignal[] = []
  const service = Object.assign(Object.create(ServiceRuntime.prototype) as ServiceRuntime, {
    config: { requestTimeoutMs: 30_000, extensionPublishBaseUrl: 'https://registry.test' },
    fetchImpl: async (_url: string, init: RequestInit) => await new Promise((_resolve, reject) => {
      const signal = init.signal!; signals.push(signal)
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }),
  })
  try {
    for (const action of ['complete', 'resume']) {
      const controller = new AbortController()
      const result = service.postDirect('https://registry.test', `/api/v1/extensions/publish-session/${action}`, {}, 'token', [0], controller.signal).catch(error => error)
      await vi.advanceTimersByTimeAsync(90_001)
      expect(signals.at(-1)?.aborted).toBe(false)
      if (action === 'complete') controller.abort()
      else await vi.advanceTimersByTimeAsync(10_000)
      expect(await result).toMatchObject(action === 'complete' ? { name: 'AbortError' } : { code: 'arkme-timeout' })
    }
    const read = service.postDirect('https://registry.test', '/api/v1/extensions/publish-session/status', {}, 'token', [0]).catch(error => error)
    await vi.advanceTimersByTimeAsync(30_001)
    expect(await read).toMatchObject({ code: 'arkme-timeout' })
  } finally { vi.useRealTimers() }
})
