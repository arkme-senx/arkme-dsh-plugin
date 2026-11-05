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
  invalidate() { this.timeline = []; this.contexts.clear(); this.signature = ''; this.emit() }
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
    const value = replies.size || context?.context.extensionCount ? { count: Math.max(replies.size, context?.context.extensionCount ?? 0), replies: [...replies.values()] } : empty
    this.cache.set(key, value); return value
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
