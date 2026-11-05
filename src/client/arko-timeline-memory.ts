import { parseArkoTimelineCache } from '../arko-timeline-cache.js'
import type { ArkmeArkoTimelineCache } from '../arko-timeline-contract.js'
/** Synchronous ready projection. Disk and cloud reads never gate re-entry paint. */
export class ArkoTimelineMemory {
  private scope: string | undefined
  private value: ArkmeArkoTimelineCache | undefined
  get(scope: string | undefined) { return scope && scope === this.scope ? this.value : undefined }
  set(scope: string, value: ArkmeArkoTimelineCache) {
    const parsed = parseArkoTimelineCache(value)
    if (parsed && (scope !== this.scope || parsed.savedAtMillis >= (this.value?.savedAtMillis ?? 0))) { this.scope = scope; this.value = parsed }
  }
  clear() { this.scope = undefined; this.value = undefined }
}
export const arkoTimelineMemory = new ArkoTimelineMemory()
