import { describe, expect, it, vi } from 'vitest'
import { ReactionService } from '../src/services/reaction-service.js'
import { createArkmeSdk, ARKME_PROVIDER_CONTRACT_VERSION } from '../src/sdk/index.js'
import { createArkmeCoreToolDefinitions } from '../src/tools/index.js'
const target = { id: 'message', sourceRef: 'opaque-source', messageActionRef: 'opaque-message' }
const wire = { chat_session_uid: 'internal-chat', rel_uid: 'internal-message' }
const key = 'a'.repeat(64)
describe('reaction Host, SDK and Tool contracts', () => {
 it('hydrates only readable history in one batch and strips internal target and sender IDs', async () => {
  const row={event_uid:key,target:wire,expression:{text:'收到'},active:true,at:10,restricted:false,source_kind:'group_chat',sender_user_id:9,text:'[图片]'}
  const context=vi.fn(async()=>[{sourceName:'项目群',authorName:'张三'}])
  const service=new ReactionService({config:{environment:'test'},requireSession:async()=>({userId:7}),authenticatedPost:async()=>({items:[row,{...row,event_uid:'b'.repeat(64),restricted:true}],has_more:false})} as never,async()=>wire,undefined,undefined,context)
  const result=await service.request({action:'history',accountKey:'test:7',start_at:1,end_at:20,limit:100})
  expect(context).toHaveBeenCalledExactlyOnceWith([{sessionUID:'internal-chat',senderID:9,sourceKind:'group_chat'}],undefined)
  expect(result).toMatchObject({items:[{sourceName:'项目群',authorName:'张三',text:'[图片]'}, {restricted:true}]})
  const rows=(result as {items:object[]}).items
  expect(rows[1]).not.toHaveProperty('authorName')
  expect(rows[1]).not.toHaveProperty('text')
  expect(JSON.stringify(result)).not.toMatch(/sender_user_id|internal-chat|rel_uid/)
 })
 it('derives identity from the current session, resolves signed targets and strips internal fields', async () => {
  const post = vi.fn(async () => ({ items: [{ target: wire, mine: { actor_user_id: 7, revision: 0, selections: [] }, groups: [{key,expression:{text:'收到'},count:2}],has_more:false,actors_visible:false,private:false }] }))
  const resolve = vi.fn(async () => wire)
  const service = new ReactionService({config:{environment:'test'},requireSession:async()=>({userId:7}),authenticatedPost:post} as never,resolve)
  const result = await service.request({action:'query',accountKey:'test:7',targets:[target]})
  expect(post.mock.calls[0]?.[1]).toEqual({targets:[wire]})
  expect(result).toMatchObject({items:[{target_id:'message',actors_visible:false}]})
  expect(JSON.stringify(result)).not.toMatch(/internal-chat|actor_user_id|rel_uid/)
  await expect(service.request({action:'query',accountKey:'test:8',targets:[target]})).rejects.toThrow('账号')
  expect(resolve).toHaveBeenCalledTimes(1)
 })
 it('rejects mismatched receipts and an account switch while a request is in flight',async()=>{
  let actor=7
  const service=new ReactionService({config:{environment:'test'},requireSession:async()=>({userId:actor}),authenticatedPost:async()=>{actor=8;return{revision:0,items:[]}}} as never,async()=>wire)
  await expect(service.request({action:'library-query',accountKey:'test:7'})).rejects.toThrow('账号')
  const mismatch=new ReactionService({config:{environment:'test'},requireSession:async()=>({userId:7}),authenticatedPost:async()=>({items:[{target:{...wire,rel_uid:'other'}}]})} as never,async()=>wire)
  await expect(mismatch.request({action:'query',accountKey:'test:7',targets:[target]})).rejects.toThrow('数据不完整')
 })
 it('deduplicates one record rendered in both feed and received history while preserving both UI identities',async()=>{
  const post=vi.fn(async()=>({items:[{target:wire,mine:{revision:0,selections:[]},groups:[],has_more:false,actors_visible:true,private:false}]}))
  const service=new ReactionService({config:{environment:'test'},requireSession:async()=>({userId:7}),authenticatedPost:post} as never,async()=>wire)
  const result=await service.request({action:'query',accountKey:'test:7',targets:[target,{...target,id:'received'}]})
  expect(post.mock.calls[0]?.[1]).toEqual({targets:[wire]})
  expect(result).toMatchObject({items:[{target_id:'message'},{target_id:'received'}]})
 })
 it('uses provider feature discovery and rejects unsupported hosts',async()=>{
  let supported=true
  const calls: string[]=[]
  const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{const request=JSON.parse(String(init?.body));calls.push(request.operation);return new Response(JSON.stringify({ok:true,value:request.operation==='provider.capabilities'?{contractVersion:ARKME_PROVIDER_CONTRACT_VERSION,features:{reactionsV1:supported}}:{revision:0,items:[]}}),{headers:{'content-type':'application/json'}})}})
  await expect(sdk.reactions({action:'library-query',accountKey:'test:7'})).resolves.toEqual({revision:0,items:[]})
  expect(calls).toEqual(['provider.capabilities','reactions'])
  supported=false
  await expect(sdk.reactions({action:'library-query',accountKey:'test:7'})).rejects.toThrow()
 })
 it('registers separate read and explicit-write tools and prevents writes through the read adapter',async()=>{
  const reactions=vi.fn(async()=>({revision:0,items:[]}))
  const tools=createArkmeCoreToolDefinitions({reactions} as never)
  const read=tools.find(tool=>tool.name==='arkme_reactions_read')!
  const write=tools.find(tool=>tool.name==='arkme_reactions_write')!
  expect(read).toBeDefined();expect(write).toBeDefined()
  const exec={signal:new AbortController().signal} as never
  await expect(read.execute({request_json:JSON.stringify({action:'library-query',accountKey:'test:7'})},exec)).resolves.toContain('revision')
  await expect(read.execute({request_json:JSON.stringify({action:'history-policy-set',accountKey:'test:7',locked:false,expected_revision:0})},exec)).rejects.toThrow()
  expect(reactions).toHaveBeenCalledTimes(1)
  await write.execute({request_json:JSON.stringify({action:'history-policy-set',accountKey:'test:7',locked:true,expected_revision:0})},exec)
  expect(reactions).toHaveBeenLastCalledWith(expect.objectContaining({locked:true}),exec.signal)
 })
})

it('projects notification locators without exposing service identifiers', async () => {
 const post=vi.fn(async()=>({items:[{id:'a'.repeat(64),revision:2,actor_user_id:9,target:wire,record_uid:'old-record',record_owner_user_id:7,attach_at:123,text:'old',selections:[{key:'b'.repeat(64),expression:{text:'收到'},at:456}]}],after_id:'',has_more:false}))
 const service=new ReactionService({config:{environment:'test'},requireSession:async()=>({userId:7}),authenticatedPost:post} as never,async()=>wire,undefined,async()=> 'opaque-chat-key')
 const result=await service.request({action:'notifications',accountKey:'test:7',limit:50})
 expect(result).toMatchObject({items:[{sourceKey:'opaque-chat-key',itemUid:'old-record',recordOwnerUserId:7,revision:2}]})
 expect(JSON.stringify(result)).not.toMatch(/internal-chat|rel_uid/)
})
