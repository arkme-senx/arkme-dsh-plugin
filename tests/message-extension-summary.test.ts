import { describe, it, expect, vi } from 'vitest'
import { readExtensionSummaryBatch } from '../src/message-extension-summary.js'
import { ChatService } from '../src/services/chat-service.js'
import { MessageQuoteThreadStore } from '../src/client/message-quote-threads.js'
import type { ArkmeTimelineItem } from '../src/types.js'
const anchor = { version: 1, projection: 'arkme-text-v1', sourceDigest: 'a'.repeat(64), start: 0, end: 2, text: '原文', prefix: '', suffix: '' }
const wire = (count = 125) => ({ version: 1, items: [{ target_index: 0, accessible: true, complete: true, comment_count: count, quote_count: count, source_record_version: 1, anchors: count ? [anchor] : [] }] })
const item: ArkmeTimelineItem = { itemUid: 'source', recordOwnerUserId: 8, sequence: 1, recordVersion: 1, messageActionRef: 'action', status: 1, senderName: '作者', textContent: '原文', title: '', isMe: false, sendAtMillis: 1 }
const result = (count = 125) => readExtensionSummaryBatch(wire(count), ['action'])
describe('complete reverse extension summary', () => {
  it('keeps quote counts separate from unique paint anchors and accepts authoritative decreases', async () => {
    const store = new MessageQuoteThreadStore(true), reader = vi.fn(async () => result())
    await store.readSummaries('source', [item], new AbortController().signal, reader)
    expect(store.thread(item).count).toBe(125); expect(store.quotes(item)).toHaveLength(1)
    reader.mockResolvedValue(result(0))
    await store.readSummaries('source', [item], new AbortController().signal, reader)
    expect(store.thread(item).count).toBe(0); expect(store.quotes(item)).toEqual([])
  })
  it('does not use loaded history as a complete fallback after a lookup fails', async () => {
    const store = new MessageQuoteThreadStore(true)
    await store.readSummaries('source', [item], new AbortController().signal, async () => result())
    store.acceptContext(item, { parentRecordUid: item.itemUid, extensionCount: 200, extensions: [] })
    await store.readSummaries('source', [item], new AbortController().signal, async () => { throw new Error('permission changed') })
    expect(store.thread(item).count).toBe(0); expect(store.quotes(item)).toEqual([]); expect(store.notice).toContain('permission')
  })
  it('rejects a late read after revocation or source switch and hides old-version anchors', async () => {
    const store = new MessageQuoteThreadStore(true)
    let finish!: (value: ReturnType<typeof result>) => void
    const work = store.readSummaries('source', [item], new AbortController().signal, () => new Promise(resolve => { finish = resolve }))
    store.invalidate(); finish(result()); await work
    expect(store.thread(item).count).toBe(0)
    await store.readSummaries('source', [item], new AbortController().signal, async () => result())
    expect(store.quotes({ ...item, recordVersion: 2 })).toEqual([])
  })
  it.each([
    { version: 2, items: [] }, { version: 1, items: [] },
    { version: 1, items: [{ ...wire().items[0], complete: false }] },
    { version: 1, items: [{ ...wire().items[0], target_index: 2 }] },
    { version: 1, items: [{ ...wire().items[0], quote_count: 126 }] },
    { version: 1, items: [{ ...wire().items[0], anchors: [{ ...anchor, start: -1 }] }] },
    { version: 1, items: [{ ...wire().items[0], anchors: [anchor, anchor] }] },
  ])('fails closed on incomplete or malformed response %j', data => {
    expect(() => readExtensionSummaryBatch(data, ['action'])).toThrow('评论汇总')
  })
  it('keeps an incomplete response distinct from successful zero', () => {
    const data = wire(0); data.items[0]!.complete = false
    expect(readExtensionSummaryBatch(data, ['action'])[0]?.summary).toMatchObject({ complete: false, commentCount: 0, anchors: [] })
  })
  it('uses signed exact occurrences and only the batch owner endpoint', async () => {
    const post = vi.fn(async () => wire()), service = Object.create(ChatService.prototype) as ChatService
    Object.assign(service, { runtime: { requireSession: async () => ({ userId: 7 }), authenticatedChatPost: post },
      source: { openSourceRef: async () => ({ kind: 'group_chat', ownerRef: 'chat' }) },
      openMessageActionRef: vi.fn(async () => ({ chatSessionUid: 'chat', recordOwnerUserId: 8, recordUid: 'source', relationUid: 'source-rel', sourceSequence: 1 })) })
    await expect(service.sourceMessageExtensionSummaries('signed-source', ['action'])).resolves.toMatchObject([{ actionRef: 'action', summary: { commentCount: 125 } }])
    expect(post).toHaveBeenCalledExactlyOnceWith('/api/v1/chats/extensions/summaries/batch', { chat_session_uid: 'chat', targets: [{ record_owner_user_id: 8, record_uid: 'source', relation_uid: 'source-rel', sequence: 1 }] }, { userId: 7 }, undefined)
    Object.assign(service, { openMessageActionRef: async () => ({ chatSessionUid: 'other-chat', relationUid: 'rel', sourceSequence: 1 }) })
    await expect(service.sourceMessageExtensionSummaries('source', ['action'])).rejects.toMatchObject({ code: 'extension-summary-occurrence-invalid' })
    expect(post).toHaveBeenCalledTimes(1)
  })
})
