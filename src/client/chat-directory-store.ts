import type { ArkmeSourceItem } from '../types.js'

export interface ArkmeChatDirectorySnapshot {
  revision: number
  sources: ArkmeSourceItem[]
}

export class ArkmeChatDirectoryStore {
  private snapshot: ArkmeChatDirectorySnapshot = { revision: 0, sources: [] }
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): ArkmeChatDirectorySnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  publish(sources: ArkmeSourceItem[]): void {
    this.snapshot = { revision: this.snapshot.revision + 1, sources: [...sources] }
    for (const listener of this.listeners) listener()
  }

  upsert(source: ArkmeSourceItem): void {
    this.upsertMany([source])
  }

  upsertMany(updates: ArkmeSourceItem[]): void {
    let sources = [...this.snapshot.sources]
    for (const source of updates) {
      const existingIndex = sources.findIndex(item => item.sourceRef === source.sourceRef)
      const existing = existingIndex < 0 ? undefined : sources[existingIndex]
      const normalized = existing === undefined
        ? source
        : { ...source, activeAtMillis: Math.max(existing.activeAtMillis, source.activeAtMillis) }
      if (existing !== undefined && normalized.activeAtMillis <= existing.activeAtMillis) {
        sources[existingIndex] = normalized
        continue
      }
      sources = sources.filter(item => item.sourceRef !== source.sourceRef)
      const insertionIndex = sources.findIndex(item => item.activeAtMillis < normalized.activeAtMillis)
      sources.splice(insertionIndex < 0 ? sources.length : insertionIndex, 0, normalized)
    }
    this.publish(sources)
  }

  unreadCount(sourceRef: string): number {
    return this.snapshot.sources.find(item => item.sourceRef === sourceRef)?.unreadCount ?? 0
  }

  updateUnread(sourceRef: string, unreadCount: number): void {
    const index = this.snapshot.sources.findIndex(item => item.sourceRef === sourceRef)
    if (index < 0) return
    const sources = [...this.snapshot.sources]
    sources[index] = { ...sources[index]!, unreadCount: Math.max(0, Math.trunc(unreadCount)) }
    this.publish(sources)
  }

  clear(): void {
    if (this.snapshot.sources.length === 0) return
    this.publish([])
  }
}

export const arkmeChatDirectory = new ArkmeChatDirectoryStore()

export interface ArkmeChatTimelineDeltaSnapshot {
  revision: number
  itemsBySourceRef: Record<string, import('../types.js').ArkmeTimelineItem[]>
}

export class ArkmeChatTimelineDeltaStore {
  private snapshot: ArkmeChatTimelineDeltaSnapshot = { revision: 0, itemsBySourceRef: {} }
  private readonly listeners = new Set<() => void>()
  readonly getSnapshot = (): ArkmeChatTimelineDeltaSnapshot => this.snapshot
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  publish(updates: Array<{ sourceRef: string; items: import('../types.js').ArkmeTimelineItem[] }>): void {
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      itemsBySourceRef: Object.fromEntries(updates.map(update => [update.sourceRef, [...update.items]])),
    }
    for (const listener of this.listeners) listener()
  }
}

export const arkmeChatTimelineDelta = new ArkmeChatTimelineDeltaStore()
