import { expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { ChatService } from '../../src/services/chat-service.js'
import { quoteSourceContent } from '../../src/message-quote.js'
import { ArkmePluginError } from '../../src/services/service.js'
const source = {title:'',textContent:'重点',textFormat:'plain' as const,recordUid:'record',recordOwnerUserId:7,relationUid:'relation',sourceSequence:8}
const anchor = {version:1 as const,projection:'arkme-text-v1' as const,sourceDigest:createHash('sha256').update(quoteSourceContent(source)).digest('hex'),start:0,end:2,text:'重点',prefix:'',suffix:''}
const snapshot = {complete:true,accessible:true,revision:1,annotations:[{annotation_uid:'a',actor_user_id:42,actor_name:'你',anchor,state:'available'}]}
function fixture(kind='group_chat') {
  const post=vi.fn(async(path:string)=>path.endsWith('capabilities')?{underline:{enabled:true,protocol_version:1,projection:'arkme-text-v1',max_length:2000}}:{...snapshot,operation_uid:'op',accepted:true,accepted_revision:1,annotation_uid:'a'})
  const service=Object.create(ChatService.prototype) as ChatService
  Object.assign(service,{runtime:{requireSession:async()=>({userId:42}),authenticatedPost:post,authenticatedChatPost:post},source:{openSourceRef:async()=>({kind,ownerRef:'chat'})},openMessageActionRef:vi.fn(async()=>source)})
  return {service,post}
}
it.each(['group_chat','private_chat','send_to_self','default_category','topic'])('routes signed %s underline writes and verifies receipt',async(kind)=>{
  const {service,post}=fixture(kind)
  await expect(service.changeSourceUnderline('src','signed',{kind:'add',operationId:'op',anchor})).resolves.toMatchObject({items:[{mine:true}]})
  expect(post).toHaveBeenLastCalledWith('/api/v1/records/annotations/create',expect.objectContaining({record_uid:'record',record_owner_user_id:7,operation_uid:'op',anchor}),{userId:42},undefined)
  if(kind.includes('chat'))expect(post.mock.calls.at(-1)?.[1]).toMatchObject({chat_session_uid:'chat',relation_uid:'relation',sequence:8})
})
it('does not claim success for a missing or changed receipt',async()=>{
  const {service,post}=fixture();post.mockImplementation(async path=>path.endsWith('capabilities')?{underline:{enabled:true,protocol_version:1,projection:'arkme-text-v1',max_length:2000}}:{...snapshot,operation_uid:'wrong'} as never)
  await expect(service.changeSourceUnderline('src','signed',{kind:'add',operationId:'op',anchor})).rejects.toMatchObject({code:'underline-receipt-missing'})
})
it('rejects a spoofed selection before writing',async()=>{
  const {service,post}=fixture()
  await expect(service.changeSourceUnderline('src','signed',{kind:'add',operationId:'op',anchor:{...anchor,sourceDigest:'b'.repeat(64)}})).rejects.toMatchObject({code:'underline-source-changed'})
  expect(post.mock.calls.every(call=>call[0].endsWith('capabilities'))).toBe(true)
})
it('refuses to invent support after authentication errors or unsupported status',async()=>{
  const {service,post}=fixture();post.mockRejectedValueOnce(new ArkmePluginError('auth','no',false,401))
  await expect(service.sourceUnderlineCapabilities('src')).rejects.toMatchObject({httpStatus:401})
  post.mockRejectedValueOnce(new ArkmePluginError('unsupported','no',false,404))
  await expect(service.sourceUnderlineCapabilities('src')).resolves.toMatchObject({supported:false})
})
it('verifies complete batch results and strips inaccessible text',async()=>{
  const {service,post}=fixture();post.mockResolvedValueOnce({items:[{...snapshot,target_index:0,accessible:false}]} as never)
  await expect(service.sourceUnderlines('src',['ref'])).resolves.toEqual([{actionRef:'ref',snapshot:{revision:1,accessible:false,items:[]}}])
  post.mockResolvedValueOnce({items:[{...snapshot,target_index:1}]} as never)
  await expect(service.sourceUnderlines('src',['ref'])).rejects.toMatchObject({code:'underline-response-invalid'})
})

function localFixture(kind = 'group_chat') {
  const { service, post } = fixture(kind)
  const store = { read: vi.fn(() => ({ revision: 0, accessible: true, items: [] })), change: vi.fn(() => ({ revision: 1, accessible: true, items: [] })) }
  const runtime = (service as any).runtime
  runtime.stateStore = { messageMarks: store }; runtime.config = { environment: 'prod' }
  return { service, post, store, runtime }
}
it.each(['group_chat','private_chat','send_to_self','default_category','topic'])('stores %s locally without calling any cloud annotation endpoint', async kind => {
  const { service, post, store } = localFixture(kind)
  expect(await service.sourceLocalMarkCapabilities('src')).toEqual({ supported: true, maxLength: 2000, storage: 'local' })
  await service.changeSourceLocalMark('src', 'signed', { kind: 'add', operationId: 'op', anchor })
  await service.sourceLocalMarks('src', ['signed'])
  const chat = kind.includes('chat')
  expect(store.change).toHaveBeenCalledWith(JSON.stringify(['prod',42,chat?'chat':'self',chat?'chat':'']), JSON.stringify([7,'record',chat?'relation':'',chat?8:'']),42,anchor.sourceDigest,{ kind:'add',operationId:'op',anchor })
  expect(post).not.toHaveBeenCalled()
})
it('rejects local anchor tampering and changed accounts before persistence', async () => {
  const { service, store, runtime } = localFixture()
  await expect(service.changeSourceLocalMark('src','signed',{kind:'add',operationId:'op',anchor:{...anchor,text:'伪造'}})).rejects.toMatchObject({code:'local-mark-source-changed'})
  runtime.requireSession = vi.fn().mockResolvedValueOnce({userId:42}).mockResolvedValueOnce({userId:43})
  await expect(service.changeSourceLocalMark('src','signed',{kind:'add',operationId:'op',anchor})).rejects.toMatchObject({code:'local-mark-account-changed'})
  expect(store.change).not.toHaveBeenCalled()
})
it('reports unavailable storage and never falls back to cloud writes', async () => {
  const { service, runtime, post } = localFixture(); runtime.stateStore = {}
  await expect(service.sourceLocalMarkCapabilities('src')).rejects.toMatchObject({code:'local-mark-storage-unavailable'})
  expect(post).not.toHaveBeenCalled()
})

it('accepts the original receipt after the mark was later cancelled without resurrecting it', async () => {
  const {service,post}=fixture();post.mockImplementation(async path=>path.endsWith('capabilities')?{underline:{enabled:true,protocol_version:1,projection:'arkme-text-v1',max_length:2000}}:{...snapshot,revision:2,annotations:[],operation_uid:'op',accepted:true,accepted_revision:1,annotation_uid:'original'} as never)
  await expect(service.changeSourceUnderline('src','signed',{kind:'add',operationId:'op',anchor})).resolves.toMatchObject({revision:2,items:[]})
})
it('preserves an accepted receipt while stripping inaccessible current text', async () => {
  const {service,post}=fixture();post.mockImplementation(async path=>path.endsWith('capabilities')?{underline:{enabled:true,protocol_version:1,projection:'arkme-text-v1',max_length:2000}}:{...snapshot,accessible:false,revision:0,operation_uid:'op',accepted:true,accepted_revision:1,annotation_uid:'original'} as never)
  await expect(service.changeSourceUnderline('src','signed',{kind:'add',operationId:'op',anchor})).resolves.toMatchObject({accessible:false,items:[]})
})
