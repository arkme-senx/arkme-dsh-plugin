import { describe, expect, it, vi } from 'vitest'
import { ConversationArrangementService } from '../src/services/conversation-arrangement-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { ArkmeConversationArrangementPage, ArkmeConversationArrangement } from '../src/types.js'

function fixture() {
  const session = { userId: 12, refreshToken: 'viewer-session' }
  const item = { id: 'shared-a', uid: 'private-arrangement-id', owner_user_id: 11, can_manage: false,
    title: '周五15:00到研发会议室和李工确认样机', description: '带测试结果', status: 2, due_at: 1793948400000,
    sources: [{ record_uid: 'record-a', record_owner_user_id: 11, sender: '李工', sent_at: 1000, text: '周五下午三点确认样机' }] }
  const page = { items: [item], has_more: false, next_cursor: '' }
  const runtime = { config: { environment: 'production' }, requireSession: vi.fn(async () => session),
    authenticatedIntelligentPost: vi.fn(async (path: string): Promise<unknown> => path.endsWith('detail') ? item : page) }
  const source = { openSourceRef: vi.fn(async () => ({ kind: 'group_chat', ownerRef: 'chat-a' })) }
  const arrangement = { ownedArrangementReference: vi.fn(async () => 'owned-ref') }
  const service = new ConversationArrangementService(runtime as unknown as ServiceRuntime, source as never, arrangement)
  return { service, runtime, source, arrangement, item, page }
}
describe('conversation arrangements provider boundary', () => {
  it('keeps shared references opaque and separate from personal mutations', async () => {
    const { service, runtime, arrangement } = fixture()
    const page = await service.read('source', '') as ArkmeConversationArrangementPage
    expect(JSON.stringify(page)).not.toContain('private-arrangement-id')
    expect(page.items[0]?.arrangementRef).toBeUndefined()
    expect(arrangement.ownedArrangementReference).not.toHaveBeenCalled()
    const item = await service.read('source', '', page.items[0]!.relatedRef) as ArkmeConversationArrangement
    expect(item.relatedRef).toBe(page.items[0]!.relatedRef)
    expect(runtime.authenticatedIntelligentPost).toHaveBeenLastCalledWith('/api/v1/arrangements/conversation/detail',
      { chat_session_uid: 'chat-a', uid: 'private-arrangement-id', owner_user_id: 11 }, expect.objectContaining({ userId: 12 }), undefined, { lane: 'interactive-read', bypassCache: true })
  })
  it('only gives an existing management reference to the actual signed-in owner', async () => {
    const { service, item, arrangement } = fixture()
    item.can_manage = true
    expect((await service.read('source', '') as ArkmeConversationArrangementPage).items[0]?.arrangementRef).toBeUndefined()
    item.owner_user_id = 12
    expect((await service.read('source', '') as ArkmeConversationArrangementPage).items[0]?.arrangementRef).toBe('owned-ref')
    expect(arrangement.ownedArrangementReference).toHaveBeenCalledWith('private-arrangement-id', 12)
  })
  it.each(['default_category', 'topic'])('rejects non-conversation source %s', async kind => {
    const { service, source, runtime } = fixture(); source.openSourceRef.mockResolvedValue({ kind, ownerRef: 'chat-a' })
    await expect(service.read('source', '')).rejects.toMatchObject({ code: 'conversation-arrangement-scope' })
    expect(runtime.authenticatedIntelligentPost).not.toHaveBeenCalled()
  })
  it('rejects detail replay into another conversation or account', async () => {
    const { service, source, runtime } = fixture()
    const page = await service.read('source', '') as ArkmeConversationArrangementPage
    const ref = page.items[0]!.relatedRef
    source.openSourceRef.mockResolvedValue({ kind: 'group_chat', ownerRef: 'chat-b' })
    await expect(service.read('source', '', ref)).rejects.toMatchObject({ code: 'conversation-arrangement-expired' })
    source.openSourceRef.mockResolvedValue({ kind: 'group_chat', ownerRef: 'chat-a' })
    runtime.requireSession.mockResolvedValue({ userId: 13, refreshToken: 'other' })
    await expect(service.read('source', '', ref)).rejects.toMatchObject({ code: 'conversation-arrangement-expired' })
  })
  it('discards completion after cancellation or account switch', async () => {
    const { service, runtime } = fixture(); const controller = new AbortController(); controller.abort()
    await expect(service.read('source', '', undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    runtime.requireSession.mockResolvedValueOnce({ userId: 12, refreshToken: 'viewer-session' }).mockResolvedValueOnce({ userId: 13, refreshToken: 'other' })
    await expect(service.read('source', '')).rejects.toMatchObject({ code: 'conversation-arrangement-account-changed' })
  })
  it('keeps authority errors visible and rejects malformed source contracts', async () => {
    const { service, runtime, item } = fixture()
    runtime.authenticatedIntelligentPost.mockRejectedValueOnce(new Error('authority unavailable'))
    await expect(service.read('source', '')).rejects.toThrow('authority unavailable')
    item.sources[0]!.record_owner_user_id = -1
    await expect(service.read('source', '')).rejects.toMatchObject({ code: 'conversation-arrangement-invalid' })
  })
  it('rejects a non-advancing cursor and substituted detail identity', async () => {
    const { service, page, item } = fixture(); page.has_more = true; page.next_cursor = 'same'
    await expect(service.read('source', 'same')).rejects.toMatchObject({ code: 'conversation-arrangement-invalid' })
    page.has_more = false; page.next_cursor = ''
    const result = await service.read('source', '') as ArkmeConversationArrangementPage
    item.uid = 'substituted'
    await expect(service.read('source', '', result.items[0]!.relatedRef)).rejects.toMatchObject({ code: 'conversation-arrangement-invalid' })
  })
})
