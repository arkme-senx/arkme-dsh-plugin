import type { ArkmeMessageExtensionSummary, ArkmeMessageExtensionSummaryItem } from '../message-extension-summary.js'
import type { ArkmeMessageCopyLinkExtensionItem, ArkmeSourceMessageExtensionContext, ArkmeTimelineExtensionParent, ArkmeTimelineItem } from '../types.js'
import { quoteSourceContent, readMessageQuote } from '../message-quote.js'

type Identity = Pick<ArkmeTimelineItem, 'itemUid' | 'recordOwnerUserId' | 'sequence'>
export const quoteThreadKey = (item: Identity) => JSON.stringify([item.itemUid, item.recordOwnerUserId ?? '', item.sequence ?? ''])
interface Reply { child: Identity; parent: ArkmeTimelineExtensionParent }
export interface MessageQuoteThread { count: number; replies: Reply[] }
const empty: MessageQuoteThread = { count: 0, replies: [] }

/** Frontend projection of verified edges already read for this account/conversation.
 * No text search, inferred offsets, writes, or per-message tree polling.
 */
export class MessageQuoteThreadStore {
  private summaries = new Map<string, { content: string; summary: ArkmeMessageExtensionSummary }>()
  private readEpoch = 0
  notice = ''
  private timeline: Reply[] = []
  private contexts = new Map<string, { item: ArkmeTimelineItem; context: ArkmeSourceMessageExtensionContext }>()
  private cache = new Map<string, MessageQuoteThread>()
  private listeners = new Set<() => void>()
  private revision = 0
  private signature = ''
  request: { key: string; revision: number } | undefined
  constructor(readonly chat: boolean) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.revision
  private emit() { this.cache.clear(); this.revision++; for (const listener of this.listeners) listener() }
  invalidate() { this.readEpoch++; this.summaries.clear(); this.notice = ''; this.timeline = []; this.contexts.clear(); this.signature = ''; this.emit() }
  ingest(items: readonly ArkmeTimelineItem[]) {
    const next = items.flatMap(item => item.status === 1 && item.extensionParent?.quoteState !== 'unavailable' && readMessageQuote(item.extensionParent?.quote)
      ? [{ child: { itemUid: item.itemUid, recordOwnerUserId: item.recordOwnerUserId, sequence: item.sequence } as Identity, parent: item.extensionParent! }] : [])
    const signature = JSON.stringify(next)
    if (signature === this.signature) return
    this.signature = signature; this.timeline = next; this.emit()
  }
  acceptContext(item: ArkmeTimelineItem, context: ArkmeSourceMessageExtensionContext) {
    if (context.parentRecordUid !== item.itemUid) return
    const key = quoteThreadKey(item), current = this.contexts.get(key)
    if (current && JSON.stringify(current.context) === JSON.stringify(context) && quoteSourceContent(current.item) === quoteSourceContent(item)) return
    this.contexts.set(key, { item, context }); this.emit()
  }
  private matches(parent: Identity, item: Identity) {
    if (parent.itemUid !== item.itemUid) return false
    if (!this.chat) return parent.recordOwnerUserId === undefined || item.recordOwnerUserId === undefined
      || String(parent.recordOwnerUserId) === String(item.recordOwnerUserId)
    return parent.recordOwnerUserId !== undefined && item.recordOwnerUserId !== undefined
      && String(parent.recordOwnerUserId) === String(item.recordOwnerUserId)
      && parent.sequence !== undefined && parent.sequence === item.sequence
  }
  thread(item: ArkmeTimelineItem): MessageQuoteThread {
    const key = `${quoteThreadKey(item)}:${quoteSourceContent(item)}`
    const cached = this.cache.get(key)
    if (cached) return cached
    const context = this.contexts.get(quoteThreadKey(item))
    const replies = new Map<string, Reply>()
    for (const reply of this.timeline) if (this.matches(reply.parent, item)) replies.set(quoteThreadKey(reply.child), reply)
    for (const child of context?.context.extensions ?? []) {
      if (child.parentRecordUid !== item.itemUid || !child.quote || child.quoteState === 'unavailable') continue
      const quote = readMessageQuote(child.quote)
      if (!quote) continue
      const identity: Identity = { itemUid: child.recordUid, ...(child.recordOwnerUserId !== undefined ? { recordOwnerUserId: child.recordOwnerUserId } : {}), ...(child.sequence !== undefined ? { sequence: child.sequence } : {}) }
      replies.set(quoteThreadKey(identity), { child: identity, parent: { itemUid: item.itemUid, senderName: item.senderName, title: '', textContent: '',
        ...(item.recordOwnerUserId !== undefined ? { recordOwnerUserId: item.recordOwnerUserId } : {}), ...(item.sequence !== undefined ? { sequence: item.sequence } : {}),
        quote, quoteState: child.quoteState ?? 'available' } })
    }
    const local = replies.size || context?.context.extensionCount ? { count: Math.max(replies.size, context?.context.extensionCount ?? 0), replies: [...replies.values()] } : empty
    const authority = this.summaries.get(quoteThreadKey(item))
    const value = this.chat ? { count: authority?.content === quoteSourceContent(item) && authority.summary.complete && authority.summary.accessible ? authority.summary.commentCount : 0, replies: local.replies } : local
    this.cache.set(key, value); return value
  }
  quotes(item: ArkmeTimelineItem) {
    if (!this.chat) return this.thread(item).replies.flatMap(reply => reply.parent.quoteState !== 'edited' && reply.parent.quoteState !== 'unavailable' && reply.parent.quote ? [reply.parent.quote] : [])
    const current = this.summaries.get(quoteThreadKey(item))
    if (!current || current.content !== quoteSourceContent(item) || !current.summary.accessible || !current.summary.complete
      || (item.recordVersion !== undefined && item.recordVersion !== current.summary.sourceRecordVersion)) return []
    return current.summary.anchors
  }
  async readSummaries(sourceRef: string, items: readonly ArkmeTimelineItem[], signal: AbortSignal,
    read: (sourceRef: string, refs: string[], signal: AbortSignal) => Promise<ArkmeMessageExtensionSummaryItem[]>) {
    if (!this.chat || signal.aborted) return
    const epoch = this.readEpoch
    const targets = new Map(items.filter(item => item.status === 1 && item.messageActionRef).map(item => [item.messageActionRef!, item]))
    const keep = new Set([...targets.values()].map(quoteThreadKey))
    let trimmed = false
    for (const key of this.summaries.keys()) if (!keep.has(key)) { this.summaries.delete(key); trimmed = true }
    if (trimmed) this.emit()
    try {
      const refs = [...targets.keys()]
      let incomplete = false
      for (let start = 0; start < refs.length; start += 40) {
        const batch = refs.slice(start, start + 40), rows = await read(sourceRef, batch, signal)
        if (signal.aborted || epoch !== this.readEpoch) return
        if (rows.length !== batch.length || new Set(rows.map(row => row.actionRef)).size !== batch.length || rows.some(row => !batch.includes(row.actionRef))) throw new Error('评论汇总不完整，请重试')
        for (const row of rows) {
          const item = targets.get(row.actionRef)!
          this.summaries.set(quoteThreadKey(item), { content: quoteSourceContent(item), summary: row.summary })
        }
        incomplete ||= rows.some(row => !row.summary.complete)
        this.notice = incomplete ? '评论汇总读取未完成，请重试' : ''
        this.emit()
      }
    } catch (error) {
      if (signal.aborted || epoch !== this.readEpoch) return
      this.readEpoch++; this.summaries.clear()
      this.notice = error instanceof Error ? error.message : '评论汇总读取失败，请重试'
      this.emit()
    }
  }
  commentParent(root: ArkmeTimelineItem, child: ArkmeMessageCopyLinkExtensionItem): ArkmeTimelineExtensionParent | undefined {
    const known = this.thread(root).replies.filter(reply => reply.child.itemUid === child.recordUid
      && (child.recordOwnerUserId === undefined || String(reply.child.recordOwnerUserId) === String(child.recordOwnerUserId))
      && (child.sequence === undefined || reply.child.sequence === child.sequence))
    if (child.quoteState === 'unavailable') return { itemUid: child.parentRecordUid ?? root.itemUid, senderName: '', title: '', textContent: '', quoteState: 'unavailable' }
    if (child.quote && readMessageQuote(child.quote)) return { itemUid: child.parentRecordUid ?? root.itemUid,
      senderName: child.parentRecordUid === root.itemUid ? root.senderName : '', title: '', textContent: '', quote: child.quote, quoteState: child.quoteState ?? 'available' }
    return child.quoteState === undefined && known.length === 1 ? known[0]!.parent : undefined
  }
  requestComments(item: ArkmeTimelineItem) { this.request = { key: quoteThreadKey(item), revision: (this.request?.revision ?? 0) + 1 }; this.emit() }
}
