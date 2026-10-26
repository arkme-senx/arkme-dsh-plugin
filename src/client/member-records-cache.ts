import type { ArkmeTimelineItem } from '../types.js'
import type { memberRecordsViewport } from './member-records-viewport.js'
export interface MemberRecordsSnapshot {
  items: ArkmeTimelineItem[]; cursor?: number; hasMore: boolean
  viewport?: ReturnType<typeof memberRecordsViewport>
}
/** Small, memory-only window cache. No background timers or account sharing. */
export class MemberRecordsCache {
  private account = ''
  private entries = new Map<string, MemberRecordsSnapshot & { at: number }>()
  activate(account: string) { if (this.account !== account) { this.entries.clear(); this.account = account } }
  get(account: string, key: string, now = Date.now()): MemberRecordsSnapshot | undefined {
    this.activate(account)
    const value = this.entries.get(key)
    if (!value || now - value.at > 60_000 || now < value.at) { this.entries.delete(key); return undefined }
    this.entries.delete(key); this.entries.set(key,value)
    return { ...value, items: value.items.slice() }
  }
  put(account: string, key: string, value: MemberRecordsSnapshot, now = Date.now()) {
    this.activate(account)
    if (value.items.length > 500) { this.entries.delete(key); return }
    this.entries.delete(key); this.entries.set(key,{...value,items:value.items.slice(),at:now})
    while (this.entries.size > 8) this.entries.delete(this.entries.keys().next().value!)
  }
  remove(account: string, key: string) { this.activate(account); this.entries.delete(key) }
}
export const memberRecordsCache = new MemberRecordsCache()
