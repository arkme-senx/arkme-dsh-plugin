import { expect, it, vi } from 'vitest'
import { ChatService } from '../../src/services/chat-service.js'

it('resolves signed source actions to authoritative selectors and keeps Team references separate from chat refs', async () => {
  const item = { itemUid: 'original', senderName: 'me', isMe: true, sendAtMillis: 1, status: 1, title: '', textContent: 'preview is not a command body' }
  const runtime = { config: { maxTextLength: 20000 }, requireSession: vi.fn(async () => ({ userId: 42 })), stateStore: { uniqueCode: vi.fn(async () => 'isolated-source-team-key') } }
  const source = { openSourceRef: vi.fn(async () => ({ kind: 'default_category', ownerRef: 'default', userId: 42 })), sourceItem: vi.fn(async () => ({ sourceRef: 'source-ref', kind: 'default_category' })) }
  const record = { list: vi.fn(async () => ({ items: [item], hasMore: false })), recordTimelineItem: (value: unknown) => value }
  const forward = vi.fn(async () => ({ sourceRef: 'team-ref', itemUid: 'accepted', status: 1, localState: 'synced' as const }))
  const chat = new ChatService(runtime as never, source as never, {} as never, {} as never, record as never,
    {} as never, {} as never, {} as never, {} as never, undefined, undefined, undefined, undefined, forward)
  const page = await chat.readSource('source-ref')
  const refs = [page.items[0]!.messageActionRef!]
  const options = { targetConversationRef: 'team-ref', expectedUserId: 42, recordUid: '11111111-1111-4111-8111-111111111111', sendAtMillis: 1700000000000 }
  await chat.forwardSourceMessages('source-ref', refs, options)
  expect(forward).toHaveBeenCalledWith({ targetConversationRef: 'team-ref', expectedUserId: 42, requestId: options.recordUid, sendAtMillis: options.sendAtMillis,
    sources: [{ record_uid: 'original', record_owner_user_id: 42 }] }, undefined)
  expect(source.openSourceRef).not.toHaveBeenCalledWith('team-ref', expect.anything())
  await expect(chat.forwardSourceMessages('source-ref', ['forged-action'], options)).rejects.toBeTruthy()
  await expect(chat.forwardSourceMessages('source-ref', refs, { ...options, targetSourceRef: 'chat-ref' })).rejects.toMatchObject({ code: 'message-actions-target-invalid' })
  await expect(chat.forwardSourceMessages('source-ref', refs, { ...options, expectedUserId: 99 })).rejects.toMatchObject({ code: 'file-account-changed' })
  expect(forward).toHaveBeenCalledOnce()
})
