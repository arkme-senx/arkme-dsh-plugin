import { ArkmeRequestCoordinator } from '../request-coordinator.js'

const key = Symbol.for('arkme.browser-loopback-admission.v1')
const criticalOperations = new Set(['files.send', 'files.send.tasks', 'source.send-text', 'source.send-rich', 'team.app.send', 'team.app.send.enqueue', 'team.app.send.retry-task', 'team.app.send.tasks'])
function limit(concurrency: number) {
  return { maxConcurrent: concurrency, maxQueued: 256, ratePerSecond: Number.MAX_SAFE_INTEGER, burst: Number.MAX_SAFE_INTEGER }
}
function pool() {
  return new ArkmeRequestCoordinator({ maxConcurrent: 5, maxQueued: 256,
    laneLimits: { write: limit(2), image: limit(4) }, defaultServiceLimit: limit(5) })
}

/** Keep four ordinary slots, reserve one for delivery, and leave one for Harness SSE. */
export async function runArkmeBrowserRequest<T>(operation: string, signal: AbortSignal | undefined, work: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  if (typeof window === 'undefined' || !['http:', 'https:'].includes(window.location?.protocol ?? '')) return await work(signal)
  let owner: Window = window
  try { while (owner.parent !== owner && owner.parent.location.origin === window.location.origin) owner = owner.parent }
  catch { /* Cross-origin embeds retain their own bounded budget. */ }
  // Same-origin Harness frames share transport slots, without retaining account data.
  const shared = owner as unknown as { [key: symbol]: ArkmeRequestCoordinator | undefined }
  const selected = shared[key] ??= pool()
  // Local priority lanes only: no request key, caching, replay or upstream pacing.
  const lane = criticalOperations.has(operation) || operation.startsWith('auth.') ? 'write' : 'image'
  return await selected.run({ scope: 'loopback', service: 'other', lane,
    ...(signal ? { signal } : {}), operation: async requestSignal => await work(requestSignal) })
}
