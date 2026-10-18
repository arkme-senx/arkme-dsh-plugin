import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { ChatService } from '../../src/services/chat-service.js'
import { ArkmeService } from '../../src/arkme-service.js'
import { ArkmePluginError } from '../../src/services/service.js'
import { quoteSourceContent, type ArkmeMessageQuote } from '../../src/message-quote.js'
const source = { textContent: '请检查通知', title: '', textFormat: 'plain' as const }
const quote: ArkmeMessageQuote = { version: 1, projection: 'arkme-text-v1', sourceDigest: createHash('sha256').update(quoteSourceContent(source)).digest('hex'), start: 1, end: 5, text: '检查通知', prefix: '请', suffix: '' }
function fixture(response: unknown = { quote_reply: { protocol_version: 1, enabled: true, projection: 'arkme-text-v1', max_quote_length: 2000 } }) {
  const post = vi.fn(async () => response)
  const service = Object.create(ChatService.prototype) as ChatService
  Object.assign(service, { runtime: { requireSession: vi.fn(async () => ({ userId: 42 })), authenticatedChatPost: post },
    source: { openSourceRef: vi.fn(async () => ({ kind: 'private_chat', ownerRef: 'chat1' })) },
    openMessageActionRef: vi.fn(async () => source) })
  return { service, post }
}
describe('quote reply owner contract', () => {
  it('validates a signed source snapshot and the declared capability', async () => {
    const { service, post } = fixture()
    await expect(service.validateQuoteReply('source', 'action', quote)).resolves.toEqual(quote)
    expect(post).toHaveBeenCalledWith('/api/v1/chats/extensions/capabilities', { chat_session_uid: 'chat1' }, { userId: 42 }, undefined)
  })
  it.each([undefined, { quote_reply: { enabled: true } }, { quote_reply: { protocol_version: 2, enabled: true } }])('does not guess support from a partial response', async value => {
    const { service, post } = fixture(); post.mockResolvedValue(value)
    await expect(service.validateQuoteReply('source', 'action', quote)).rejects.toMatchObject({ code: 'message-quote-unavailable' })
  })
  it.each([404, 405, 501])('treats an explicit unsupported status %s as unavailable', async code => {
    const { service, post } = fixture(); post.mockRejectedValue(new ArkmePluginError('http', 'unsupported', false, code))
    await expect(service.sourceMessageExtensionCapabilities('source')).resolves.toMatchObject({ supported: false })
  })
  it.each([401, 403, 500])('preserves network/auth errors %s instead of silently downgrading', async code => {
    const { service, post } = fixture(); post.mockRejectedValue(new ArkmePluginError('http', 'failed', true, code))
    await expect(service.sourceMessageExtensionCapabilities('source')).rejects.toMatchObject({ httpStatus: code })
  })
  it('rejects tampered and stale quotations', async () => {
    const { service } = fixture()
    await expect(service.validateQuoteReply('source', 'action', { ...quote, text: '别的内容' })).rejects.toMatchObject({ code: 'message-quote-source-changed' })
    await expect(service.validateQuoteReply('source', 'action', { ...quote, sourceDigest: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'message-quote-source-changed' })
  })
  it('blocks before uploading any attachments when support is unavailable', async () => {
    const uploadRefs = vi.fn()
    const owner = { config: {}, chat: { validateQuoteReply: vi.fn(async () => { throw new ArkmePluginError('message-quote-unavailable', '未接通', false) }) }, filesOwner: () => ({ uploadRefs }) }
    await expect(ArkmeService.prototype.extendSourceMessage.call(owner as never, 'source', 'action', '回复', 'record', ['file'], { quote })).rejects.toMatchObject({ code: 'message-quote-unavailable' })
    expect(uploadRefs).not.toHaveBeenCalled()
  })
  it('projects inaccessible and malformed snapshots without exposing the quoted text', () => {
    const { service } = fixture()
    const project = (service as unknown as { timelineExtensionProjection(v: unknown, userId: number, profiles: Map<string, unknown>): unknown }).timelineExtensionProjection.bind(service)
    const base = { extension_edge: { parent_record_uid: 'parent', parent_record_owner_user_id: 11, quote_reply: quote, quote_reply_state: 'unavailable' } }
    expect(project(base, 42, new Map())).toMatchObject({ extensionParent: { quoteState: 'unavailable', textContent: '' } })
    expect(JSON.stringify(project(base, 42, new Map()))).not.toContain('检查通知')
  })
  it.each([true, false])('requires the create receipt to confirm the exact quote (echo=%s)', async echo => {
    const { service, post } = fixture()
    const recordUid = '11111111-1111-4111-8111-111111111111'
    const relationUid = '22222222-2222-4222-8222-222222222222'
    Object.assign(service, {
      runtime: { config: { maxTextLength: 10000 }, requireSession: async () => ({ userId: 42 }), authenticatedChatPost: post },
      openMessageActionRef: async () => ({ ...source, recordUid: 'original', recordOwnerUserId: 11, chatSessionUid: 'chat1', relationUid: 'original-relation', sourceSequence: 7 }),
      profile: { refreshProfile: async () => ({ profile: { nickname: '我', displayName: '我', avatarRef: '' } }) },
      realtime: { scheduleChatSessionProjection: vi.fn() }, hydrateUploadedExtension: async (item: unknown) => item,
    })
    post.mockImplementation(async (...args: unknown[]) => args[0] === '/api/v1/chats/extensions/capabilities'
      ? { quote_reply: { protocol_version: 1, enabled: true, projection: 'arkme-text-v1', max_quote_length: 2000 } }
      : { child_record_uid: recordUid, seq: 8, ...(echo ? { quote_reply: quote } : {}) })
    const send = service.extendSourceMessage('source', 'action', '回复正文', recordUid, [], { quote, relationUid })
    if (echo) await expect(send).resolves.toMatchObject({ recordUid, localState: 'synced' })
    else await expect(send).rejects.toMatchObject({ code: 'message-quote-receipt-missing', retryable: true })
    expect(post).toHaveBeenCalledWith('/api/v1/chats/extensions/children/create', expect.objectContaining({
      child_record_uid: recordUid, child_rel_uid: relationUid, quote_reply: quote,
      quote_reply_source: { relation_uid: 'original-relation', sequence: 7 },
    }), { userId: 42 }, undefined)
  })
})
it.each(['send_to_self','default_category','topic'])('checks personal capabilities for %s rather than chat capabilities', async kind => {
  const {service,post}=fixture()
  Object.assign(service,{runtime:{requireSession:async()=>({userId:42}),authenticatedPost:post},source:{openSourceRef:async()=>({kind,ownerRef:'topic-id'})}})
  await expect(service.validateQuoteReply('src','ref',quote)).resolves.toEqual(quote)
  expect(post).toHaveBeenCalledWith('/api/v1/records/extensions/capabilities',kind==='topic'?{topic_uid:'topic-id'}:{},{userId:42},undefined)
})
it('passes the self quote to personal creation without changing the existing extension relation', async () => {
  const {service,post}=fixture(); const create=vi.fn(async()=>({recordUid:'11111111-1111-4111-8111-111111111111',status:1}))
  Object.assign(service,{runtime:{config:{maxTextLength:10000},requireSession:async()=>({userId:42}),authenticatedPost:post},source:{openSourceRef:async()=>({kind:'send_to_self'}),invalidateSourceListCache:vi.fn()},
    openMessageActionRef:async()=>({...source,recordUid:'parent',recordOwnerUserId:42}),record:{createExtensionForConversation:create},profile:{refreshProfile:async()=>({profile:{nickname:'我',displayName:'我',avatarRef:''}})},realtime:{emitChatClientEvent:vi.fn(),nextChatClientRevision:()=>1},hydrateUploadedExtension:async(item:unknown)=>item})
  await service.extendSourceMessage('src','ref','正文','11111111-1111-4111-8111-111111111111',[],{quote})
  expect(create).toHaveBeenCalledWith('parent','11111111-1111-4111-8111-111111111111','正文',[],undefined,quote)
})
it.each([true,false])('requires a personal record create quote receipt (echo=%s)',async echo=>{
  const {RecordService}=await import('../../src/services/record-service.js')
  const service=Object.create(RecordService.prototype) as InstanceType<typeof RecordService>
  const recordUid='11111111-1111-4111-8111-111111111111'
  const create=vi.fn(async()=>({record_uid:recordUid,parent_record_uid:'parent',edge_uid:'edge',status:1,...(echo?{quote_reply:quote}:{})}))
  Object.assign(service,{runtime:{config:{maxTextLength:10000},requireSession:async()=>({userId:42})},createPersonalRecord:create,syncCreatedRecordTags:vi.fn()})
  const writing=service.createExtensionForConversation('parent',recordUid,'正文',[],undefined,quote)
  if(echo)await expect(writing).resolves.toMatchObject({recordUid,localState:'synced'})
  else await expect(writing).rejects.toMatchObject({code:'message-quote-receipt-missing'})
  expect(create).toHaveBeenCalledWith('/api/v1/records/extensions/create',expect.objectContaining({quote_reply:quote,parent_record_uid:'parent'}),{userId:42})
})
it('hides inaccessible personal quote snapshots even when an old parent preview is present',async()=>{
  const {RecordService}=await import('../../src/services/record-service.js')
  const service=Object.create(RecordService.prototype) as InstanceType<typeof RecordService>
  const project=(service as unknown as {recordExtensionProjection(v:unknown,userId:number):unknown}).recordExtensionProjection.bind(service)
  Object.assign(service,{media:{richContentBlocks:vi.fn(()=>[{secret:true}])}})
  const value=project({parent_record_uid:'parent',extension_edge:{quote_reply:quote,quote_reply_state:'unavailable'},extension_parent_preview:{record:{record_uid:'parent',text_content:'不应显示的旧内容'}}},42)
  expect(value).toMatchObject({extensionParent:{quoteState:'unavailable',textContent:'',contentBlocks:[]}})
  expect(JSON.stringify(value)).not.toContain('检查通知');expect(JSON.stringify(value)).not.toContain('旧内容')
})
