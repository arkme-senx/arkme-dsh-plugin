import {expect,it} from 'vitest'
import {MediaService} from '../src/services/media-service.js'
import {ChatService} from '../src/services/chat-service.js'
import {SourceService} from '../src/services/source-service.js'
import {ServiceRuntime,type ArkmeServiceConfig,type StateStore} from '../src/services/service.js'

it('reads only public extensions in a delegated group and binds pagination to the exact audience',async()=>{
 const session={userId:42,accessToken:'fake',refreshToken:'refresh'},wire:{path:string;frame:string|null}[]=[]
 let more=true
 const runtime=new ServiceRuntime({environment:'test',chatBaseUrl:'https://chat.example',requestTimeoutMs:1000} as ArkmeServiceConfig,{read:async()=>session,write:async()=>{},delete:async()=>{}},{uniqueCode:async()=> 'extension-test-key'} as StateStore,(async(input,init)=>{
  const path=new URL(String(input)).pathname;wire.push({path,frame:new Headers(init?.headers).get('X-Chat-Access-Ref')})
  if(path!=='/api/v1/chats/extensions/tree/page')throw new Error(`private lane must not be called: ${path}`)
  return new Response(JSON.stringify({code:200,data:{private_thought_reply_protocol:1,total:0,children:[],has_more:more,...(more?{next_after_cursor:{created_at:10,child_record_owner_user_id:77,child_record_uid:'next'}}:{})}}))
 }) as typeof fetch)
 const sources=new SourceService(runtime,{} as never,{} as never)
 const media=new MediaService(runtime,{} as never,{} as never,{} as never)
 const chat=new ChatService(runtime,sources,{} as never,media as never,{} as never,{} as never,{} as never,{timelineAiPolish:()=>undefined} as never,{} as never)
 const frame={accessRef:'team-A',teamId:'42',membershipKind:'member' as const,membershipRevision:4,groupMembershipUid:'admission-A',groupMembershipRevision:1,visibleFromSeq:7}
 const refA=await sources.sealSourceRef(42,'group_chat','group','客户群',{groupDelegation:frame})
 const refB=await sources.sealSourceRef(42,'group_chat','group','客户群',{groupDelegation:{...frame,accessRef:'team-B',groupMembershipUid:'admission-B'}})
 const action=async(ref:string)=>{
  const source=await sources.openSourceRef(ref,42)
  const [item]=await chat.projectChatTimelineItems([{relation:{rel_uid:'rel',record_uid:'record',sender_user_id:77,seq:7},record:{status:1,payload:{record_uid:'record',owner_user_id:77,version:3,text_content:'公开消息'}}}],source,session,undefined,{basicPresentation:true})
  return item!.messageActionRef!
 }
 try {
  const a=await action(refA),b=await action(refB)
  const page=await chat.sourceMessageExtensionContext(refA,a,{paginated:true})
  expect(page.nextCursor).toBeTruthy();expect(page.extensions).toEqual([])
  expect(wire).toEqual([{path:'/api/v1/chats/extensions/tree/page',frame:'team-A'}])
  await expect(chat.sourceMessageExtensionContext(refB,b,{paginated:true,pageCursor:page.nextCursor!})).rejects.toMatchObject({code:'extension-cursor-invalid'})
  expect(wire).toHaveLength(1)
  more=false
  const next=await chat.sourceMessageExtensionContext(refA,a,{paginated:true,pageCursor:page.nextCursor!})
  expect(next.nextCursor).toBeUndefined();expect(next.extensionCount).toBe(0)
  expect(wire).toEqual([{path:'/api/v1/chats/extensions/tree/page',frame:'team-A'},{path:'/api/v1/chats/extensions/tree/page',frame:'team-A'}])
 }finally{runtime.dispose()}
})
