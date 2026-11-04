import { describe, expect, it, vi } from 'vitest'
import { ConversationArrangementService } from '../src/services/conversation-arrangement-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { ArkmeConversationArrangementPage, ArkmeConversationArrangement } from '../src/types.js'

function fixture() {
  const session = { userId: 12, refreshToken: 'viewer-session' }
  const item = { uid: 'private-arrangement-id', user_id: 12,
    title: '周五15:00到研发会议室和李工确认样机', description: '带测试结果', status: 2, due_at: 1793948400000,
    sources: [{ record_uid: 'record-a', record_owner_user_id: 11, sender: '李工', sent_at: 1000, text: '周五下午三点确认样机' }] }
  const page = { list: [item], has_more: false, next_cursor: '', conversation_scope: { kind: 'personal', chat_session_uid: 'chat-a', user_id: 12 } }
  const runtime = { config: { environment: 'production' }, requireSession: vi.fn(async () => session),
    authenticatedIntelligentPost: vi.fn(async (): Promise<unknown> => page) }
  const source = { openSourceRef: vi.fn(async () => ({ kind: 'group_chat', ownerRef: 'chat-a' })) }
  const arrangement = { ownedArrangementReference: vi.fn(async () => 'owned-ref') }
  const team={resolveConversation:vi.fn(async()=>({conversation_uid:'team-a',side:'team' as 'team'|'external'}))}
  const service = new ConversationArrangementService(runtime as unknown as ServiceRuntime, source as never, arrangement,team)
  return { service, runtime, source, arrangement, item, page,team }
}
describe('conversation arrangements provider boundary', () => {
  it.each(['team','external'] as const)('binds the team %s side to an acknowledged personal owner scope',async side=>{
    const {service,runtime,source,team,item}=fixture();team.resolveConversation.mockResolvedValue({conversation_uid:'team-a',side})
    runtime.authenticatedIntelligentPost.mockResolvedValue({list:[item],has_more:false,next_cursor:'',conversation_scope:{kind:'personal_team',team_conversation_uid:'team-a',team_side:side,user_id:12}})
    const result=await service.read('','',undefined,undefined,'team-ref') as ArkmeConversationArrangementPage
    expect(result.items[0]?.arrangementRef).toBe('owned-ref');expect(source.openSourceRef).not.toHaveBeenCalled()
    expect(runtime.authenticatedIntelligentPost.mock.calls[0]?.[1]).toEqual({status:-1,limit:20,team_conversation_uid:'team-a',team_side:side,conversation_cursor:''})
    team.resolveConversation.mockResolvedValue({conversation_uid:'team-b',side})
    await expect(service.read('','',result.items[0]!.relatedRef,undefined,'other-team')).rejects.toMatchObject({code:'conversation-arrangement-expired'})
  })
  it('rejects ambiguous inputs and old servers that ignore a team filter',async()=>{
    const {service,arrangement}=fixture()
    await expect(service.read('chat','',undefined,undefined,'team')).rejects.toMatchObject({code:'conversation-arrangement-scope'})
    await expect(service.read('','',undefined,undefined,'team')).rejects.toMatchObject({code:'conversation-arrangement-unavailable'})
    expect(arrangement.ownedArrangementReference).not.toHaveBeenCalled()
  })
  it('uses the personal list API and returns only opaque management references', async () => {
    const { service, runtime, arrangement } = fixture()
    const page = await service.read('source', '') as ArkmeConversationArrangementPage
    expect(JSON.stringify(page)).not.toContain('private-arrangement-id')
    expect(page.items[0]?.arrangementRef).toBe('owned-ref')
    expect(arrangement.ownedArrangementReference).toHaveBeenCalledWith('private-arrangement-id', 12)
    expect(runtime.authenticatedIntelligentPost).toHaveBeenLastCalledWith('/api/v1/arrangements/list',
      { status: -1, limit: 20, chat_session_uid: 'chat-a', conversation_cursor: '' }, expect.objectContaining({ userId: 12 }), undefined, { lane: 'interactive-read', bypassCache: true })
    const item = await service.read('source', '', page.items[0]!.relatedRef) as ArkmeConversationArrangement
    expect(item.relatedRef).toBe(page.items[0]!.relatedRef)
    expect(runtime.authenticatedIntelligentPost).toHaveBeenLastCalledWith('/api/v1/arrangements/list',
      { status: -1, limit: 20, chat_session_uid: 'chat-a', uids: ['private-arrangement-id'] }, expect.objectContaining({ userId: 12 }), undefined, { lane: 'interactive-read', bypassCache: true })
  })
  it('fails closed when an old server ignores the conversation filter', async () => {
    const { service, runtime, arrangement, item } = fixture()
    runtime.authenticatedIntelligentPost.mockResolvedValue({ list: [item], total: 27329 })
    await expect(service.read('source', '')).rejects.toMatchObject({ code: 'conversation-arrangement-unavailable' })
    expect(arrangement.ownedArrangementReference).not.toHaveBeenCalled()
  })
  it.each(['kind', 'chat_session_uid', 'user_id'])('rejects a substituted scope %s', async key => {
    const { service, page } = fixture()
    Object.assign(page.conversation_scope, { [key]: 'wrong' })
    await expect(service.read('source', '')).rejects.toMatchObject({ code: 'conversation-arrangement-unavailable' })
  })
  it('rejects another account item even inside an acknowledged response', async () => {
    const { service, item } = fixture()
    item.user_id = 11
    await expect(service.read('source', '')).rejects.toMatchObject({ code: 'conversation-arrangement-invalid' })
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
  it('keeps authority errors visible and rejects malformed arrangement contracts', async () => {
    const { service, runtime, item } = fixture()
    runtime.authenticatedIntelligentPost.mockRejectedValueOnce(new Error('authority unavailable'))
    await expect(service.read('source', '')).rejects.toThrow('authority unavailable')
    item.uid = ''
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
