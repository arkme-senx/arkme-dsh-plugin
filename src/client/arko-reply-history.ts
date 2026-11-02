import type { ArkmeRecordThought, ArkmeRecordThoughts } from '../record-thought-contract.js'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { arkoReplyScene, type ArkoReplyScene } from '../arko-reply-management.js'
import { callArkme } from './api.js'
import { subscribeThoughtInvalidation } from './thought-invalidations.js'
export type ArkoReplyHistoryItem = Pick<ArkmeTimelineItem, 'itemUid' | 'sendAtMillis' | 'isMe' | 'recordVersion' | 'version' | 'messageActionRef' | 'timelineItemKey' | 'recordOwnerUserId'> & { textContent?: string | undefined }
export interface ArkoReplyHistoryEntry { key: string; scene: ArkoReplyScene; source: ArkmeSourceItem; item: ArkoReplyHistoryItem; thought: ArkmeRecordThought }
const selfSource = (source: ArkmeSourceItem) => ['send_to_self', 'default_category', 'topic'].includes(source.kind)
const baseKey = (source: ArkmeSourceItem, uid: string) => JSON.stringify([selfSource(source) ? 'self' : source.sourceKey || source.sourceRef, uid])
/** A bounded index of already-read results; opening it revalidates each result against its owner. */
export class ArkoReplyHistoryRegistry {
  private scope: string | undefined
  private entries = new Map<string, ArkoReplyHistoryEntry>()
  private versions = new Map<string, number>()
  activate(scope: string | undefined): void { if (scope !== this.scope) { this.scope = scope; this.entries.clear(); this.versions.clear() } }
  observeItem(scope: string, source: ArkmeSourceItem, item: ArkoReplyHistoryItem): void {
    this.activate(scope)
    const base = baseKey(source, item.itemUid), version = item.recordVersion ?? item.version ?? 0, previous = this.versions.get(base)
    if (previous !== undefined && version !== previous) for (const [key, entry] of this.entries) if (baseKey(entry.source, entry.item.itemUid) === base) this.entries.delete(key)
    this.versions.set(base, version)
    if (this.versions.size > 1000) this.versions.delete(this.versions.keys().next().value!)
  }
  observe(scope: string, source: ArkmeSourceItem, item: ArkoReplyHistoryItem, thoughts: readonly ArkmeRecordThought[]): void {
    this.observeItem(scope, source, item)
    const base = baseKey(source, item.itemUid)
    for (const [key, entry] of this.entries) if (baseKey(entry.source, entry.item.itemUid) === base) this.entries.delete(key)
    for (const thought of thoughts) {
      if (thought.recordUid !== item.itemUid || thought.status && thought.status !== 'ready' || !thought.content.trim() && !thought.display?.suggestions.length) continue
      const key = `${base}:${thought.scene ?? thought.biz}`
      const snapshot = { ...item, ...(item.textContent ? { textContent: item.textContent.slice(0, 180) } : {}) }
      this.entries.set(key, { key, scene: arkoReplyScene(thought, source.kind === 'group_chat', item.isMe), source, item: snapshot, thought })
    }
    while (this.entries.size > 500) this.entries.delete(this.entries.keys().next().value!)
  }
  list(scope: string): ArkoReplyHistoryEntry[] { return this.scope === scope ? [...this.entries.values()].sort((a, b) => b.item.sendAtMillis - a.item.sendAtMillis) : [] }
  forget(scope: string, sourceKey?: string, timelineItemKey?: string): void {
    if (scope !== this.scope) return
    for (const [key, entry] of this.entries) if ((!sourceKey || entry.source.sourceKey === sourceKey || entry.source.sourceRef === sourceKey)
      && (!timelineItemKey || entry.item.timelineItemKey === timelineItemKey)) this.entries.delete(key)
  }
  remove(scope: string, key: string): void { if (scope === this.scope) this.entries.delete(key) }
}
export const arkoReplyHistory = new ArkoReplyHistoryRegistry()
subscribeThoughtInvalidation(change => { if (change.clear) arkoReplyHistory.forget(change.accountScope, change.sourceKey, change.timelineItemKey) })

export async function readArkoReplyHistory(scope: string, scene: ArkoReplyScene | 'all', offset: number, signal: AbortSignal, snapshot?: readonly ArkoReplyHistoryEntry[]) {
  const candidates = (snapshot ?? arkoReplyHistory.list(scope)).filter(item => scene === 'all' || item.scene === scene)
  const page = candidates.slice(offset, offset + 50), groups = new Map<string, ArkoReplyHistoryEntry[]>()
  for (const entry of page) {
    const key = selfSource(entry.source) ? 'self' : entry.source.sourceRef
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  const items: ArkoReplyHistoryEntry[] = []
  let failedSources = 0
  // At most one optional owner read at a time. This work never runs on composer input.
  for (const [key, entries] of groups) {
    signal.throwIfAborted()
    try {
      const result = await callArkme<ArkmeRecordThoughts>(key === 'self' ? 'record.thoughts.query' : 'chat.thoughts.query',
        key === 'self' ? { expectedAccountScope: scope, recordUids: [...new Set(entries.map(entry => entry.item.itemUid))] }
          : { expectedAccountScope: scope, sourceRef: key, messageActionRefs: [...new Set(entries.map(entry => entry.item.messageActionRef).filter(Boolean))] }, signal, { priority: 'background' })
      signal.throwIfAborted()
      if (result.accountScope !== scope) throw new Error('账号已切换')
      for (const entry of entries) {
        const thought = result.items.find(thought => thought.recordUid === entry.item.itemUid && (!thought.status || thought.status === 'ready')
          && arkoReplyScene(thought, entry.source.kind === 'group_chat', entry.item.isMe) === entry.scene)
        if (thought && (thought.content.trim() || thought.display?.suggestions.length)) items.push({ ...entry, thought })
        else arkoReplyHistory.remove(scope, entry.key)
      }
    } catch (error) { signal.throwIfAborted(); failedSources++ }
  }
  return { items, failedSources, hasMore: offset + page.length < candidates.length, nextOffset: offset + page.length }
}
