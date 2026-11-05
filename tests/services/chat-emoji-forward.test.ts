import { describe, expect, it, vi } from 'vitest'
import { ChatService } from '../../src/services/chat-service.js'

describe('Record forwarding emoji boundaries', () => {
  it.each([{ template_kind: 1, display_kind: 1 }, { templateKind: 8, displayKind: 0 }])('preserves forwarded article classification from %o', async kind => {
    const media = { recordContentPayload: (raw: unknown) => raw, forwardContentBlocks: () => [] }
    const chat = new ChatService({} as never, {} as never, {} as never, media as never, {} as never,
      {} as never, {} as never, {} as never, {} as never)
    const result = await chat.chatForwardRecordsPreview({ render_kind: 'forward_records', items: [{
      owner_name: '作者', title: '标题', text: '正文', ...kind,
    }] }, 42, 1)
    expect(result?.items[0]).toMatchObject({ title: '标题', textContent: '正文',
      templateKind: 'template_kind' in kind ? 1 : 8, displayKind: 'display_kind' in kind ? 1 : 0 })
  })

  it('keeps bounded UI snapshots unchanged and forwards selectors rather than truncated emoji previews', async () => {
    const token = '[jm_emoji:heart_eyes]'
    const textContent = '文'.repeat(495) + token + '文'.repeat(500 - token.length) + '[im_emoji:thumb_up]'
    const title = '题'.repeat(495) + token
    const item = { itemUid: 'record-emoji', senderName: '我', isMe: true, sendAtMillis: 1, status: 1, title, textContent }
    const authenticatedPost = vi.fn(async () => ({accepted:true, record_uid:'forward-emoji',status:1}))
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
    const record = { createPersonalRecord: runtime.authenticatedPost, list: vi.fn(async () => ({ items: [item], hasMore: false })), recordTimelineItem: (value: unknown) => value }
    const chat = new ChatService(runtime as never, source as never, {} as never, {} as never, record as never,
      {} as never, {} as never, {} as never, { invalidateRecordProjection: vi.fn() } as never)
    const page = await chat.readSource('default')
    await chat.forwardSourceMessages('default', [page.items[0]!.messageActionRef!], { recordUid: 'forward-emoji' })
    expect(authenticatedPost).toHaveBeenCalledWith('/api/v1/records/source-forward/create',expect.objectContaining({sources:[{record_uid:'record-emoji',record_owner_user_id:42}]}),expect.objectContaining({userId:42}),undefined)
    expect(authenticatedPost.mock.calls[0]?.[1]).not.toHaveProperty('content_payload')
    expect(page.items[0]?.textContent).toBe(textContent)
    expect(item).toMatchObject({ title, textContent })
  })
})
