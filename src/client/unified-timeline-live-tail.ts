import type { ArkmeTimelineItem } from '../types.js'
import { compareUnifiedTimelineEvents, type ArkmeUnifiedTimelineWindow } from '../unified-chat-timeline.js'
import { MAX_ACTIVE_TIMELINE_EVENTS } from './unified-timeline-window.js'

/** Revocations apply to visible canonical rows as well as the uncommitted tail. */
export function removeUnifiedTimelineItems(window: ArkmeUnifiedTimelineWindow, keys: ReadonlySet<string>): ArkmeUnifiedTimelineWindow {
  if (!keys.size) return window
  const events = window.events.filter(event => event.kind !== 'message' || !keys.has(event.item.timelineItemKey ?? ''))
  return events.length === window.events.length ? window : { ...window, events }
}

/** Mounted-conversation overlay, never a durable window or a pagination owner. */
export class UnifiedTimelineLiveTail {
  private revision = 0
  private readonly pending = new Map<string, { revision: number; item: ArkmeTimelineItem }>()

  get readRevision(): number { return this.revision }
  get hasPending(): boolean { return this.pending.size > 0 }

  receive(window: ArkmeUnifiedTimelineWindow, items: readonly ArkmeTimelineItem[]): ArkmeUnifiedTimelineWindow {
    if (!window.complete || window.newerHasMore) return window
    const messages = window.events.flatMap(event => event.kind === 'message' ? [event.item] : [])
    let sequence = Math.max(0, ...messages.map(item => item.sequence ?? 0))
    // Without a confirmed frontier we cannot prove that a tail is gap-free.
    if (!sequence) return window
    const ids = new Set(window.events.map(event => event.eventId))
    let accepted = 0
    for (const item of [...items].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))) {
      if ((item.sequence ?? 0) <= sequence) continue
      if (item.sequence !== sequence + 1 || item.status !== 1 || !item.timelineEventId || !item.timelineOrderTie) break
      if (ids.size + accepted >= MAX_ACTIVE_TIMELINE_EVENTS || this.pending.size >= MAX_ACTIVE_TIMELINE_EVENTS) break
      sequence = item.sequence
      if (ids.has(item.timelineEventId)) continue
      this.pending.set(item.timelineEventId, { revision: ++this.revision, item })
      accepted++
    }
    return accepted ? this.project(window) : window
  }

  /** Request order is not coverage: a completed read may still lag a delivered body. */
  reconcile(window: ArkmeUnifiedTimelineWindow, readRevision: number): ArkmeUnifiedTimelineWindow {
    const ids = new Set(window.events.filter(event => event.windowToken !== undefined).map(event => event.eventId))
    const frontier = window.complete && !window.newerHasMore
      ? Math.max(0, ...window.events.flatMap(event => event.kind === 'message' ? [event.item.sequence ?? 0] : [])) : 0
    for (const [id, entry] of this.pending) {
      if (ids.has(id) || entry.revision <= readRevision && (entry.item.sequence ?? Infinity) <= frontier) this.pending.delete(id)
    }
    return this.project(window)
  }

  remove(keys: ReadonlySet<string>): void {
    for (const [id, entry] of this.pending) if (keys.has(entry.item.timelineItemKey ?? '')) this.pending.delete(id)
  }

  private project(window: ArkmeUnifiedTimelineWindow): ArkmeUnifiedTimelineWindow {
    if (!this.pending.size || window.newerHasMore) return window
    const events = new Map(window.events.map(event => [event.eventId, event]))
    for (const [id, { item }] of this.pending) {
      if (events.has(id) || events.size >= MAX_ACTIVE_TIMELINE_EVENTS) continue
      events.set(id, { kind: 'message', source: 'messages', eventId: id, occurredAtMillis: item.sendAtMillis,
        orderTie: item.timelineOrderTie!, contentStatus: 'available', item })
    }
    return events.size === window.events.length ? window : { ...window, events: [...events.values()].sort(compareUnifiedTimelineEvents) }
  }
}
