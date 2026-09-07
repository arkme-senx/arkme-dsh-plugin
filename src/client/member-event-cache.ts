import type { ArkmeMemberEventPage, ArkmeMemberEventQuery } from '../types.js'
import { subscribeAllMemberEventHints } from './member-event-hints.js'
import { MemberEventTimeline } from './member-event-timeline.js'

type Read = (query: ArkmeMemberEventQuery, signal: AbortSignal) => Promise<ArkmeMemberEventPage>
interface CacheEntry {
  timeline: MemberEventTimeline
  read: Read
  listeners: Map<() => void, boolean>
}

/** Memory only, scoped to the authenticated environment/account and opaque group key. */
class MemberEventCache {
  private account: string | undefined
  private entries = new Map<string, CacheEntry>()

  activateAccount(account: string | undefined): void {
    if (this.account === account) return
    this.account = account
    for (const entry of this.entries.values()) entry.timeline.dispose()
    this.entries.clear()
  }

  peek(account: string | undefined, sourceKey: string, mode: 'latest' | 'around', window?: { from: number; to?: number }) {
    if (account === undefined || account !== this.account) return undefined
    return this.entries.get(sourceKey)?.timeline.cachedSnapshot(mode, window)
  }

  attach(account: string, sourceKey: string, read: Read, changed: () => void) {
    this.activateAccount(account)
    let entry = this.entries.get(sourceKey)
    if (entry === undefined) {
      const listeners = new Map<() => void, boolean>()
      const created: CacheEntry = {
        read, listeners,
        timeline: new MemberEventTimeline((query, signal) => created.read(query, signal), () => {
          for (const listener of listeners.keys()) listener()
          if (listeners.size === 0) created.timeline.trim()
          if (created.timeline.snapshot().unavailable && this.entries.get(sourceKey) === created) this.entries.delete(sourceKey)
        }),
      }
      entry = created
      entry.timeline.setForeground(false)
    }
    entry.read = read
    this.entries.delete(sourceKey)
    this.entries.set(sourceKey, entry)
    entry.listeners.set(changed, false)
    this.evict()
    const current = entry
    const foreground = () => current.timeline.setForeground([...current.listeners.values()].some(Boolean))
    return {
      timeline: current.timeline,
      setForeground: (visible: boolean) => { current.listeners.set(changed, visible); foreground() },
      release: () => {
        current.listeners.delete(changed)
        foreground()
        if (current.listeners.size === 0) current.timeline.trim()
        this.evict()
      },
    }
  }

  invalidate(account: string, sourceKey: string, eventId: string, occurredAt: number): void {
    if (this.account === account) this.entries.get(sourceKey)?.timeline.invalidate(eventId, occurredAt)
  }

  revoke(account: string | undefined, sourceKey: string): void {
    if (account !== this.account) return
    this.entries.get(sourceKey)?.timeline.revoke()
    this.entries.delete(sourceKey)
  }

  private evict(): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= 20) break
      if (entry.listeners.size > 0) continue
      entry.timeline.dispose()
      this.entries.delete(key)
    }
  }
}

export const arkmeMemberEvents = new MemberEventCache()
subscribeAllMemberEventHints(hint => {
  arkmeMemberEvents.invalidate(hint.account, hint.sourceKey, hint.eventId, hint.occurredAtMillis)
})
