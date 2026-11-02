import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { MessageQuoteThreadStore, quoteThreadKey } from '../src/client/message-quote-threads.js'
import { quoteSourceContent, quoteContext } from '../src/message-quote.js'
import type { ArkmeTimelineItem, ArkmeMessageCopyLinkExtensionItem } from '../src/types.js'
const root: ArkmeTimelineItem = { itemUid: 'original', recordOwnerUserId: 7, sequence: 11, senderName: '原作者', title: '', textContent: '可以。可以。', textFormat: 'plain', status: 1, isMe: false, sendAtMillis: 1 }
const quote = { version: 1 as const, projection: 'arkme-text-v1' as const, sourceDigest: createHash('sha256').update(quoteSourceContent(root)).digest('hex'), start: 3, end: 5, text: '可以', ...quoteContext(root.textContent, 3, 5) }
const reply: ArkmeTimelineItem = { ...root, itemUid: 'reply', recordOwnerUserId: 42, sequence: 12, textContent: '回复正文', extensionParent: {
  itemUid: root.itemUid, recordOwnerUserId: root.recordOwnerUserId, sequence: root.sequence, senderName: root.senderName, title: '', textContent: root.textContent, quote, quoteState: 'available',
} }
const comment = { recordUid: 'reply', parentRecordUid: root.itemUid, recordOwnerUserId: 42, sequence: 12 } as ArkmeMessageCopyLinkExtensionItem
describe('verified quote thread projection', () => {
  it('connects a selected range back to the exact original occurrence', () => {
    const store = new MessageQuoteThreadStore(true); store.ingest([root, reply])
    expect(store.thread(root)).toMatchObject({ count: 1, replies: [{ parent: { quote: { start: 3, end: 5 } } }] })
    expect(store.thread({ ...root, sequence: 33 }).count).toBe(0)
    expect(store.thread({ ...root, recordOwnerUserId: 8 }).count).toBe(0)
    expect(store.thread({ ...root, sequence: undefined }).count).toBe(0)
  })
  it('reuses a verified timeline quote when an exact comment projection omitted its anchor', () => {
    const store = new MessageQuoteThreadStore(true); store.ingest([root, reply])
    expect(store.commentParent(root, comment)?.quote).toEqual(quote)
    expect(store.commentParent(root, { ...comment, quoteState: 'unavailable' })).toMatchObject({ quoteState: 'unavailable', textContent: '' })
    expect(store.commentParent(root, { ...comment, recordOwnerUserId: 99 })).toBeUndefined()
  })
  it('deduplicates the same edge across timeline and detail and retains authoritative total count', () => {
    const store = new MessageQuoteThreadStore(true); store.ingest([root, reply])
    store.acceptContext(root, { parentRecordUid: root.itemUid, extensionCount: 3, extensions: [{ ...comment, quote, quoteState: 'available' }] })
    expect(store.thread(root).count).toBe(3)
    expect(store.thread(root).replies).toHaveLength(1)
  })
  it('does not infer a missing chat occurrence identity or guess between duplicate sends', () => {
    const store = new MessageQuoteThreadStore(true)
    store.ingest([reply, { ...reply, sequence: 44 }])
    expect(store.commentParent(root, { ...comment, sequence: undefined })).toBeUndefined()
    store.ingest([{ ...reply, extensionParent: { ...reply.extensionParent!, sequence: undefined } }])
    expect(store.thread(root).count).toBe(0)
  })
  it('supports owned personal records and clears all quotes on invalidation', () => {
    const store = new MessageQuoteThreadStore(false)
    const personal = { ...root, recordOwnerUserId: undefined, sequence: undefined }
    store.ingest([{ ...reply, extensionParent: { ...reply.extensionParent!, recordOwnerUserId: undefined, sequence: undefined } }])
    expect(store.thread(personal).count).toBe(1)
    store.ingest([reply])
    expect(store.thread(personal).count).toBe(1)
    expect(store.thread({ ...personal, recordOwnerUserId: 99 }).count).toBe(0)
    store.requestComments(personal); expect(store.request?.key).toBe(quoteThreadKey(personal))
    store.invalidate(); expect(store.thread(personal).count).toBe(0)
  })
  it('retains edited quotation text but never revives unavailable snapshots', () => {
    const store = new MessageQuoteThreadStore(true)
    store.ingest([{ ...reply, extensionParent: { ...reply.extensionParent!, quoteState: 'edited' } }])
    expect(store.thread(root).replies[0]?.parent.quoteState).toBe('edited')
    store.ingest([{ ...reply, extensionParent: { ...reply.extensionParent!, quoteState: 'unavailable' } }])
    expect(store.thread(root).count).toBe(0)
  })
})
