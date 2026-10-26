import { callArkme } from './api.js'
import type { ArkmeArkoLifecycleSnapshot } from '../arko-lifecycle-contract.js'

// The existing foreground preview loop owns timing/cancellation. Consumers only
// subscribe to invalidation; no additional interval or persistent deletion cache.
let revision: number | undefined
let generation = 0
const listeners = new Set<() => void>()
export const arkoLifecycleSync = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  snapshot: () => generation,
  invalidate() { revision = undefined; generation++; for (const listener of listeners) listener() },
  async refresh(signal: AbortSignal) {
    const result = await callArkme<ArkmeArkoLifecycleSnapshot>('arko.lifecycle.query', { messageRefs: [] }, signal)
    if (signal.aborted || result.revision === revision) return
    revision = result.revision; generation++; for (const listener of listeners) listener()
  },
}
