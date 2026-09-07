import { describe, expect, it, vi } from 'vitest'
import { ChatService } from '../../src/services/chat-service.js'

describe('Record forwarding emoji boundaries', () => {
  it('bounds signed snapshots and stored previews without splitting tokens or rewriting the source', async () => {
    const token = '[jm_emoji:heart_eyes]'
    const textContent = '文'.repeat(495) + token + '文'.repeat(500 - token.length) + '[im_emoji:thumb_up]'
    const title = '题'.repeat(495) + token
    const item = { itemUid: 'record-emoji', senderName: '我', isMe: true, sendAtMillis: 1, status: 1, title, textContent }
    const authenticatedPost = vi.fn(async () => ({ record_uid: 'forward-emoji', status: 1 }))
    const runtime = {
      config: { maxTextLength: 1000 },
      requireSession: vi.fn(async () => ({ userId: 42 })),
      stateStore: { uniqueCode: vi.fn(async () => 'emoji-test-signing-key') },
      authenticatedPost,
    }
    const source = {
      openSourceRef: vi.fn(async () => ({ kind: 'default_category', ownerRef: 'default', userId: 42 })),
      sourceItem: vi.fn(async () => ({ sourceRef: 'default', kind: 'default_category' })),
    }
    const record = { list: vi.fn(async () => ({ items: [item], hasMore: false })), recordTimelineItem: (value: unknown) => value }
    const chat = new ChatService(runtime as never, source as never, {} as never, {} as never, record as never,
      {} as never, {} as never, {} as never, { invalidateRecordProjection: vi.fn() } as never)
    const page = await chat.readSource('default')
    await chat.forwardSourceMessages('default', [page.items[0]!.messageActionRef!], { recordUid: 'forward-emoji' })
    expect(authenticatedPost).toHaveBeenCalledWith('/api/v1/records/create', expect.objectContaining({
      content_payload: expect.objectContaining({ forward_records: expect.objectContaining({ items: [expect.objectContaining({
        title: '题'.repeat(495), text: textContent.slice(0, 995), text_preview: '文'.repeat(495),
      })] }) }),
    }), expect.objectContaining({ userId: 42 }), undefined)
    expect(page.items[0]?.textContent).toBe(textContent)
    expect(item).toMatchObject({ title, textContent })
  })
})
