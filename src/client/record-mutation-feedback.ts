import type { ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import type { ArkmeRecordDeletionResult } from '../record-deletion-contract.js'
import type { ArkmeRecordTopicAssignmentResult } from '../record-topic-assignment-contract.js'
import { arkmeTopicPathNames } from './source-tree.js'

type Phase = 'pending' | 'confirmed' | 'uncertain' | 'failed'
type Kind = 'delete' | 'topic'
interface Entry {
  operation: number; kind: Kind; phase: Phase; original: ArkmeTimelineItem
  source: ArkmeSourceItem; target?: ArkmeSourceItem; version?: number
}
export interface RecordMutationReceipt {
  id: number; kind: Kind; phase: Phase; count: number; label: string
  source: ArkmeSourceItem; target?: ArkmeSourceItem; message?: string
}
const sameSource = (a: ArkmeSourceItem, b: ArkmeSourceItem) => a.sourceKey && b.sourceKey
  ? a.sourceKey === b.sourceKey : a.sourceRef === b.sourceRef
const personal = (source: ArkmeSourceItem) => ['send_to_self', 'default_category', 'topic'].includes(source.kind)

/** Membership uses opaque topic identities, never a name or a fuzzy path match. */
export function topicMutationBelongs(source: ArkmeSourceItem, target: ArkmeSourceItem | undefined, directory: readonly ArkmeSourceItem[]) {
  if (source.kind === 'send_to_self') return true
  if (source.kind === 'default_category') return target === undefined
  const visited = new Set<string>()
  let current = target
  while (current && !visited.has(current.sourceRef)) {
    if (sameSource(source, current) || source.topicHierarchyKey && source.topicHierarchyKey === current.topicHierarchyKey) return true
    visited.add(current.sourceRef)
    current = directory.find(item => current!.parentTopicHierarchyKey
      ? item.topicHierarchyKey === current!.parentTopicHierarchyKey : item.sourceRef === current!.parentSourceRef)
  }
  return false
}

/** UI intent is separate from server facts. Survives picker unmount and navigation. */
export class RecordMutationFeedback {
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private sequence = 0
  private snapshot = { revision: 0, receipts: [] as RecordMutationReceipt[] }
  // A read begun before a mutation/receipt cannot reconcile the newer intent.
  readEpoch = 0
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.snapshot
  private publish() {
    this.snapshot = { ...this.snapshot, revision: this.snapshot.revision + 1 }
    this.listeners.forEach(listener => listener())
  }
  begin(kind: Kind, source: ArkmeSourceItem, items: readonly ArkmeTimelineItem[], target?: ArkmeSourceItem, directory: readonly ArkmeSourceItem[] = []) {
    if (!items.length || items.some(item => this.entries.has(item.itemUid))) throw new Error('这些内容正在同步，请稍后再操作')
    const id = ++this.sequence
    for (const original of items) this.entries.set(original.itemUid, { operation: id, kind, phase: 'pending', original, source, ...(target ? { target } : {}) })
    const label = target ? arkmeTopicPathNames(target, directory).join(' / ') || target.displayName : '未分类'
    this.snapshot = { ...this.snapshot, receipts: [...this.snapshot.receipts.filter(item => item.phase !== 'confirmed'),
      { id, kind, phase: 'pending' as const, count: items.length, label, source, ...(target ? { target } : {}) }] }
    this.readEpoch++; this.publish()
    return id
  }
  private finish(id: number, phase: Phase, message?: string) {
    this.snapshot = { ...this.snapshot, receipts: this.snapshot.receipts.map(receipt => receipt.id !== id ? receipt
      : { ...receipt, phase, ...(message ? { message } : {}) }) }
    this.readEpoch++; this.publish()
  }
  settleDeletion(id: number, result: ArkmeRecordDeletionResult) {
    let uncertain = 0, failed = 0, deleted = 0
    for (const [uid, entry] of this.entries) if (entry.operation === id) {
      const item = result.items.find(item => item.recordUid === uid)
      entry.phase = item?.result === 'deleted' ? 'confirmed' : item?.result === 'rejected' || item?.result === 'not_attempted' ? 'failed' : 'uncertain'
      if (entry.phase === 'confirmed') { entry.version = item!.version; deleted++ }
      else if (entry.phase === 'uncertain') uncertain++
      else failed++
    }
    this.finish(id, uncertain ? 'uncertain' : failed ? 'failed' : 'confirmed', uncertain
      ? `已确认删除 ${deleted} 条，${uncertain} 条结果待核对，其余内容已恢复`
      : failed ? `已删除 ${deleted} 条，${failed} 条未删除，已恢复原位置` : undefined)
  }
  settleTopic(id: number, result: ArkmeRecordTopicAssignmentResult) {
    const moved = new Set(result.movedRecordUids)
    for (const [uid, entry] of this.entries) if (entry.operation === id) {
      if (moved.has(uid)) entry.phase = 'confirmed'
      else this.entries.delete(uid)
    }
    this.finish(id, 'confirmed')
  }
  fail(id: number, error: unknown, definite = false) {
    for (const entry of this.entries.values()) if (entry.operation === id) entry.phase = definite ? 'failed' : 'uncertain'
    this.finish(id, definite ? 'failed' : 'uncertain', definite
      ? `操作未完成，已恢复原位置。${error instanceof Error ? error.message : ''}`
      : '网络响应未能确认，内容已恢复显示，结果待核对；请勿重复提交')
  }
  dismiss(id: number) { this.snapshot = { ...this.snapshot, receipts: this.snapshot.receipts.filter(receipt => receipt.id !== id) }; this.publish() }
  needsReconcile(source: ArkmeSourceItem) {
    return [...this.entries.values()].some(entry => entry.phase !== 'pending' && !(entry.kind === 'delete' && entry.phase === 'confirmed')
      && (sameSource(entry.source, source) || source.kind === 'send_to_self'))
  }
  project(item: ArkmeTimelineItem, source: ArkmeSourceItem, directory: readonly ArkmeSourceItem[]): ArkmeTimelineItem | undefined {
    const entry = this.entries.get(item.itemUid)
    // Topic membership belongs to personal views. A chat deletion still needs
    // its optimistic projection, but only in the conversation it came from.
    if (!entry || !personal(source) && (entry.kind !== 'delete' || !sameSource(source, entry.source))) return item
    if (entry.kind === 'delete' && entry.phase === 'confirmed' && (item.recordVersion ?? 0) > (entry.version ?? 0)) return item
    if (entry.phase === 'pending' || entry.phase === 'confirmed') {
      if (entry.kind === 'delete' || !topicMutationBelongs(source, entry.target, directory)) return undefined
      // A signed assignment reference binds the PREVIOUS topic. Never reuse it.
      const { selfTopic: _old, recordTopicAssignmentRef: _ref, recordTopicAssignmentTopicKey: _key, recordDeletionRef: _delete, ...rest } = item
      return { ...rest, ...(entry.target?.topicHierarchyKey ? { selfTopic: {
        topicHierarchyKey: entry.target.topicHierarchyKey, sourceRef: entry.target.sourceRef, title: entry.target.displayName,
      }, recordTopicAssignmentTopicKey: entry.target.topicHierarchyKey } : {}) }
    }
    // Unknown outcomes restore presentation but keep writes disabled until a fresh read.
    if (entry.phase === 'uncertain') {
      const { recordTopicAssignmentRef: _ref, recordDeletionRef: _delete, ...rest } = item
      return rest
    }
    return item
  }
  projectWindow(items: readonly ArkmeTimelineItem[], source: ArkmeSourceItem, directory: readonly ArkmeSourceItem[]) {
    const originals = [...items], ids = new Set(items.map(item => item.itemUid))
    for (const entry of this.entries.values()) {
      const restore = (entry.phase === 'failed' || entry.phase === 'uncertain') && sameSource(source, entry.source)
      const movedHere = entry.kind === 'topic' && (entry.phase === 'pending' || entry.phase === 'confirmed')
        && entry.target && sameSource(source, entry.target)
      if ((restore || movedHere) && !ids.has(entry.original.itemUid)) originals.push(entry.original)
    }
    return originals.flatMap(item => { const projected = this.project(item, source, directory); return projected ? [projected] : [] })
  }
  /** Only actual observations can reconcile. Absence from a page proves nothing. */
  observe(items: readonly ArkmeTimelineItem[], source: ArkmeSourceItem, epoch: number) {
    if (epoch !== this.readEpoch) return
    let changed = false
    for (const item of items) {
      const entry = this.entries.get(item.itemUid)
      if (!entry || entry.phase === 'pending') continue
      if (entry.kind === 'delete') {
        if (entry.phase === 'confirmed') {
          if ((item.recordVersion ?? 0) > (entry.version ?? 0)) { this.entries.delete(item.itemUid); changed = true }
        } else if (entry.phase === 'failed') { this.entries.delete(item.itemUid); changed = true }
        else if (item.status === 2 && (item.recordVersion ?? 0) > (entry.original.recordVersion ?? 0)) {
          entry.phase = 'confirmed'; entry.version = item.recordVersion!; changed = true
        }
      } else if (personal(source)) {
        const actual = item.selfTopic?.topicHierarchyKey ?? item.recordTopicAssignmentTopicKey
        const expected = entry.target?.topicHierarchyKey
        if (entry.phase === 'failed' || actual === expected && item.recordTopicAssignmentRef) {
          this.entries.delete(item.itemUid); changed = true
        }
      }
    }
    if (changed) {
      this.snapshot = { ...this.snapshot, receipts: this.snapshot.receipts.map(receipt => receipt.phase === 'uncertain'
        && ![...this.entries.values()].some(entry => entry.operation === receipt.id && entry.phase === 'uncertain')
        ? { ...receipt, phase: 'confirmed', message: '已核对操作结果' } : receipt) }
      this.readEpoch++; this.publish()
    }
  }
}

const owners = new Map<string, RecordMutationFeedback>()
export function recordMutationFeedback(accountKey: string) {
  let owner = owners.get(accountKey)
  if (!owner) { owner = new RecordMutationFeedback(); owners.set(accountKey, owner) }
  return owner
}
