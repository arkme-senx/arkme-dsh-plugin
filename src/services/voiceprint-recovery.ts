import { ArkmePluginError } from './service.js'

/** Poll only the owner's durable enrollment state. Other write failures are never replayed. */
export async function waitForVoiceprintRecovery<T>(
  generate: () => Promise<T>,
  assertActive: () => Promise<void>,
  signal?: AbortSignal,
): Promise<T> {
  const deadline = Date.now() + 60_000
  while (true) {
    signal?.throwIfAborted()
    await assertActive()
    // Timers may resume late after the host has been suspended; do not start a new request past the polling window.
    if (Date.now() >= deadline) {
      throw new ArkmePluginError('world-voiceprint-preparing', '声音仍在准备中，请稍后再试', true, 503)
    }
    try {
      const result = await generate()
      await assertActive()
      signal?.throwIfAborted()
      return result
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || error.code !== 'arkme-code-1106') throw error
      if (Date.now() + 3_000 >= deadline) {
        throw new ArkmePluginError('world-voiceprint-preparing', '声音仍在准备中，请稍后再试', true, 503)
      }
      await new Promise<void>((resolve, reject) => {
        const aborted = () => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', aborted)
          reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', aborted)
          resolve()
        }, 3_000)
        if (signal?.aborted === true) aborted()
        else signal?.addEventListener('abort', aborted, { once: true })
      })
    }
  }
}
