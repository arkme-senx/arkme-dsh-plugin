import { describe, expect, it, vi } from 'vitest'
import { TeamAppService } from '../src/services/team-app-service.js'
import { ServiceRuntime } from '../src/services/service.js'
import type { TeamConversation, TeamMessage } from '../src/team-app-contract.js'
import type { TeamHistoryResponse } from '../src/team-history-contract.js'

function fixture(side:'team'|'external'='team'){
  let actor=11,handler:(path:string,body:any)=>unknown|Promise<unknown>=()=>({state:'ready',has_more:false,messages:[]})
  const calls:any[]=[]
  const runtime=new ServiceRuntime({environment:'test',teamBaseUrl:'https://team.test',routePath:'/arkme',requestTimeoutMs:2000} as never,{} as never,{uniqueCode:async()=> 'machine-secret'} as never,async(input,init)=>{
    const body=JSON.parse(String(init?.body)),path=new URL(String(input)).pathname;calls.push({path,body})
    const data=path.endsWith('/conversations/open')?{}:path.endsWith('/conversations/list')?{items:[{conversation_uid:'convo',side,team_id:17,external_user_id:12,last_seq:2,channel:{team_id:17,name:'Team',jotmo_id:'team',public_ref:'p',enabled:true,revision:1}}],has_more:false}:await handler(path,body)
    return new Response(JSON.stringify({code:200,data}),{headers:{'content-type':'application/json'}})
  })
  vi.spyOn(runtime,'requireSession').mockImplementation(async()=>({userId:actor,accessToken:'access',refreshToken:`r${actor}`}))
  vi.spyOn(runtime,'accountScopedSession').mockImplementation(async()=>({userId:actor,accessToken:'access',refreshToken:`r${actor}`}))
  const service=new TeamAppService(runtime,{} as never)
  return {service,calls,handle(fn:typeof handler){handler=fn},change(){actor=22},async conversation(){return ((await service.execute('team.app.conversations',{side})) as {items:TeamConversation[]}).items[0]!}}
}
const raw={message_uid:'m1',seq:2,revision:1,version:9,side:'team',actor_user_id:11,created_at:1000,sender:{nickname:'甲'},own:true,text:'bounded excerpt',title:'title',media:[{name:'voice.m4a',kind:'audio'}]}
it('uses server filtering, opaque identities and excerpt-only message capabilities',async()=>{
  const f=fixture(),c=await f.conversation();f.handle(()=>({state:'ready',messages:[raw],through_seq:2,head_seq:3,indexing:true,has_more:true,cursor:'signed'}))
  const page=await f.service.execute('team.app.history',{conversationRef:c.ref,action:'query',options:{keyword:'中文',sender:'self',fromAt:10,untilAt:99}}) as TeamHistoryResponse
  expect(f.calls.at(-1)).toMatchObject({path:'/api/v1/team/conversations/history/query',body:{conversation_uid:'convo',side:'team',keyword:'中文',sender_user_id:11,from_at:10,until_at:99}})
  expect(page.messages[0]).toMatchObject({historyPreview:true,canEdit:false,canDelete:false,media:[],historyMedia:[{name:'voice.m4a',kind:'audio'}],content:{text_content:'bounded excerpt',content_payload:{text_format:'plain'}}})
  expect(page.messages[0]!.localMarkRef).toBeUndefined()
  expect(JSON.stringify(page)).not.toContain('actor_user_id');expect(JSON.stringify(page)).not.toContain('conversation_uid');expect(page.messages[0]!.sender.personRef).toBeTruthy()
  expect(page).toMatchObject({hasMore:true,cursor:'signed',throughSeq:2,headSeq:3,indexing:true})
})
it('binds result and word-source references to viewer, conversation and exact result',async()=>{
  const f=fixture(),c=await f.conversation();f.handle((_path,body)=>body.request_id?{state:'ready',result_id:body.request_id}:{state:'ready',result_id:'one',items:[{word:'中文',count:4,message_count:2,source_ref:'signed-word'}],has_more:true,cursor:'next'})
  const first=await f.service.execute('team.app.history',{conversationRef:c.ref,action:'analysis/create',options:{requestId:'one',analysisKind:'words'}}) as TeamHistoryResponse
  const words=await f.service.execute('team.app.history',{conversationRef:c.ref,action:'analysis/words',options:{resultRef:first.resultRef}}) as TeamHistoryResponse
  expect(words.words[0]).toMatchObject({word:'中文',count:4,messageCount:2});expect(words.words[0]!.sourceRef).not.toBe('signed-word');expect(words.hasMore).toBe(true)
  f.handle((_p,b)=>{expect(b).toMatchObject({result_id:'one',source_ref:'signed-word'});return {state:'ready',has_more:false,result_id:'one',messages:[raw]}})
  await f.service.execute('team.app.history',{conversationRef:c.ref,action:'analysis/sources',options:{resultRef:first.resultRef,sourceRef:words.words[0]!.sourceRef}})
  f.handle(()=>({state:'ready',result_id:'two'}));const other=await f.service.execute('team.app.history',{conversationRef:c.ref,action:'analysis/create',options:{requestId:'two',analysisKind:'words'}}) as TeamHistoryResponse
  const before=f.calls.length
  await expect(f.service.execute('team.app.history',{conversationRef:c.ref,action:'analysis/sources',options:{resultRef:other.resultRef,sourceRef:words.words[0]!.sourceRef}})).rejects.toThrow()
  expect(f.calls.length).toBe(before)
  f.change();await expect(f.service.execute('team.app.history',{conversationRef:c.ref,action:'analysis/state',options:{resultRef:first.resultRef}})).rejects.toThrow()
})
it('discards an account-changed response after IO and fails closed on malformed aggregates',async()=>{
 const f=fixture(),c=await f.conversation();f.handle(()=>{f.change();return {state:'ready',messages:[raw]}})
 await expect(f.service.execute('team.app.history',{conversationRef:c.ref,action:'query'})).rejects.toThrow('账号已变化')
 const g=fixture(),d=await g.conversation();g.handle(()=>({state:'ready',result_id:'bad',activity:{hourly:[],weekly:[]}}))
 await expect(g.service.execute('team.app.history',{conversationRef:d.ref,action:'analysis/result',options:{}})).rejects.toThrow('响应不完整')
})
it('exposes only a same-origin export descriptor and bounded authenticated chunks',async()=>{
 const f=fixture('external'),c=await f.conversation(),hash='a'.repeat(64)
 f.handle(()=>({state:'ready',result_id:'export',bytes:3,sha256:hash}));const ready=await f.service.execute('team.app.history',{conversationRef:c.ref,action:'exports/link',options:{}}) as TeamHistoryResponse
 expect(ready.downloadUrl).toMatch(/^\/arkme\/team\/history\/export\?ref=/);expect(ready.downloadUrl).not.toContain('export?ref=export')
 f.handle(()=>({state:'ready',chunk_base64:'YWJj',chunk_sha256:hash,sha256:hash,bytes:3,offset:3,complete:true}))
 expect(await f.service.execute('team.app.history.chunk',{resultRef:ready.resultRef})).toMatchObject({chunkBase64:'YWJj',bytes:3,offset:3,complete:true})
})
