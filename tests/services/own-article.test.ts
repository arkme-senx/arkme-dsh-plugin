import { expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatService } from '../../src/services/chat-service.js'
import { ArkmeStateStore } from '../../src/state-store.js'
import { dispatchArkmeHostOperation } from '../../src/host-api.js'

function fixture() {
  const runtime = { config: { maxTextLength: 20000 }, requireSession: vi.fn(async () => ({ userId: 42 })),
    stateStore: { uniqueCode: async () => 'signing-key' }, authenticatedChatPost: vi.fn(async () => ({ record_uid: 'forwarded', seq: 10, status: 1 })) }
  const source = { selfTarget: vi.fn(async () => ({ sourceRef: 'self' })), openSourceRef: vi.fn(async (ref: string) => ({ userId: 42, kind: ref === 'self' ? 'send_to_self' : 'group_chat', ownerRef: ref === 'self' ? '42' : 'group' })) }
  const detail = { sourceRef: 'self', itemUid: 'mine', title: '我的文章', textContent: '完整正文'.repeat(500), textFormat: 'markdown' as const, sendAtMillis: 123, updateAtMillis: 123, recordDurationMillis: 0, editDurationMillis: 0, thinkingDurationMillis: 0, version: 1, editable: true,
    contentBlocks: [{ kind: 'image', fileAssetUid: 'image-1', mediaRef: 'asset-ref' }] }
  const record = { longArticleDetail: vi.fn(async () => detail) }
  const realtime = { scheduleChatSessionProjection: vi.fn() }
  const chat = new ChatService(runtime as never, source as never, {} as never, {} as never, record as never, {} as never, {} as never, {} as never, realtime as never)
  return { runtime, record, chat, detail }
}
it('resolves full owned content and forwards using the existing source record contract with stable retry identity', async () => {
  const { chat, runtime, detail } = fixture()
  const selected = await chat.ownLongArticle('mine', 42)
  expect(selected.detail).toEqual(detail)
  expect(selected.messageActionRef).toMatch(/^arkme-message-action-v1\./)
  for (let attempt = 0; attempt < 2; attempt++) await chat.forwardSourceMessages(selected.detail.sourceRef, [selected.messageActionRef], { targetSourceRef: 'target', expectedUserId: 42, sendAtMillis: 456 })
  const body = runtime.authenticatedChatPost.mock.calls[0]![1]
  expect(body).toMatchObject({ chat_session_uid: 'group', source_record_uids: ['mine'], source_items: [{ source_type: 'record', record_uid: 'mine' }], send_at: 456 })
  expect(runtime.authenticatedChatPost.mock.calls[1]![1]).toEqual(body)
})
it('rejects another creator or a switched account and performs no sends', async () => {
  const { chat, runtime, record, detail } = fixture()
  await expect(chat.ownLongArticle('mine', 43)).rejects.toMatchObject({ code: 'file-account-changed' })
  expect(record.longArticleDetail).not.toHaveBeenCalled()
  record.longArticleDetail.mockResolvedValue({ ...detail, editable: false })
  await expect(chat.ownLongArticle('not-mine', 42)).rejects.toMatchObject({ code: 'long-article-not-owned' })
  record.longArticleDetail.mockResolvedValue(detail)
  runtime.requireSession.mockResolvedValueOnce({ userId: 42 }).mockResolvedValueOnce({ userId: 43 })
  await expect(chat.ownLongArticle('mine', 42)).rejects.toMatchObject({ code: 'file-account-changed' })
  expect(runtime.authenticatedChatPost).not.toHaveBeenCalled()
})
it('rejects wrong-account forward and invalid retry timestamps before side effects', async () => {
  const { chat, runtime } = fixture()
  await expect(chat.forwardSourceMessages('self', [], { expectedUserId: 43 })).rejects.toMatchObject({ code: 'file-account-changed' })
  await expect(chat.forwardSourceMessages('self', [], { sendAtMillis: -1 })).rejects.toMatchObject({ code: 'message-actions-time-invalid' })
  expect(runtime.authenticatedChatPost).not.toHaveBeenCalled()
})
it('host operations pass ownership, stable time and conditional cleanup constraints', async () => {
  const service = { ownLongArticle: vi.fn(), forwardSourceMessages: vi.fn(), removeLongArticleDraft: vi.fn() }
  await dispatchArkmeHostOperation(service as never, 'source.long-article.own', { itemUid: 'mine', expectedUserId: 42 })
  expect(service.ownLongArticle).toHaveBeenCalledWith('mine', 42, undefined)
  await dispatchArkmeHostOperation(service as never, 'source.forward-messages', { sourceRef: 'self', actionRefs: ['signed'], targetSourceRef: 'chat', expectedUserId: 42, sendAtMillis: 123 })
  expect(service.forwardSourceMessages).toHaveBeenCalledWith('self', ['signed'], { targetSourceRef: 'chat', expectedUserId: 42, sendAtMillis: 123 })
  await dispatchArkmeHostOperation(service as never, 'source.long-article.draft.delete', { sourceRef: 'chat', expectedRecordUid: 'sent-id' })
  expect(service.removeLongArticleDraft).toHaveBeenCalledWith('chat', undefined, 'sent-id')
})
it('cleanup of a sent draft atomically preserves a newer draft', async () => {
  const store = new ArkmeStateStore(await mkdtemp(join(tmpdir(), 'arkme-article-cas-')))
  await store.putLongArticleDraft(42, { sourceRef: 'chat', recordUid: 'newer', title: '后来输入的长文', textContent: '仍未发送', durationMillis: 0, updatedAtMillis: 1 })
  await store.removeLongArticleDraft(42, 'chat', undefined, 'sent-id')
  expect((await store.getLongArticleDraft(42, 'chat'))?.recordUid).toBe('newer')
  await store.removeLongArticleDraft(42, 'chat', undefined, 'newer')
  expect(await store.getLongArticleDraft(42, 'chat')).toBeUndefined()
})
