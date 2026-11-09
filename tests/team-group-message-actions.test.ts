import {expect,it,vi} from 'vitest'
import {ChatService} from '../src/services/chat-service.js'
import {SourceService} from '../src/services/source-service.js'
import {MediaService} from '../src/services/media-service.js'
import {ServiceRuntime,type ArkmeServiceConfig,type StateStore} from '../src/services/service.js'
import {dispatchArkmeHostOperation} from '../src/host-api.js'
import {createArkmeSdk} from '../src/sdk/index.js'

it('rejects personal member read receipts for delegated sources before upstream I/O, including SDK dispatch',async()=>{
 const session={userId:42,accessToken:'fake',refreshToken:'refresh'}
 const fetchImpl=vi.fn(async()=>new Response('{}'))
 const runtime=new ServiceRuntime({environment:'test',chatBaseUrl:'https://chat.example',requestTimeoutMs:1000} as ArkmeServiceConfig,{read:async()=>session,write:async()=>{},delete:async()=>{}},{uniqueCode:async()=> 'receipt-scope-key'} as StateStore,fetchImpl)
 const sources=new SourceService(runtime,{} as never,{} as never)
 const chat=new ChatService(runtime,sources,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never)
 const sourceRef=await sources.sealSourceRef(42,'group_chat','group','客户群',{groupDelegation:{accessRef:'frame',teamId:'42',membershipKind:'member',membershipRevision:4,groupMembershipUid:'admission',groupMembershipRevision:1,visibleFromSeq:7}})
 const service={messageReadReceiptSummaries:chat.messageReadReceiptSummaries.bind(chat),messageReadReceiptDetail:chat.messageReadReceiptDetail.bind(chat)}
 const sdk=createArkmeSdk({fetchImpl:async(_input,init)=>{
  const request=JSON.parse(String(init?.body)),value=await dispatchArkmeHostOperation(service as never,request.operation,request.params)
  return new Response(JSON.stringify({ok:true,value}))
 }})
 try {
  await expect(chat.messageReadReceiptSummaries(sourceRef,[{itemUid:'own-record',sequence:7}])).rejects.toMatchObject({code:'message-read-receipt-unavailable'})
  await expect(chat.messageReadReceiptDetail(sourceRef,'own-record',7)).rejects.toMatchObject({code:'message-read-receipt-unavailable'})
  await expect(sdk.messageReadReceiptSummaries(sourceRef,[{itemUid:'own-record',sequence:7}])).rejects.toThrow('个人群成员')
  expect(fetchImpl).not.toHaveBeenCalled()
 } finally {runtime.dispose()}
})

it('keeps issued report and owner-withdrawal references in their exact source, including Host and public SDK adapters',async()=>{
 const session={userId:42,accessToken:'fake',refreshToken:'refresh'}
 const wire:{path:string;frame:string|null}[]=[];let revoked=false
 const runtime=new ServiceRuntime({environment:'test',chatBaseUrl:'https://chat.example',requestTimeoutMs:1000} as ArkmeServiceConfig,{read:async()=>session,write:async()=>{},delete:async()=>{}},{uniqueCode:async()=> 'actions-test-key'} as StateStore,(async(input,init)=>{
  const path=new URL(String(input)).pathname;wire.push({path,frame:new Headers(init?.headers).get('X-Chat-Access-Ref')})
  if(revoked)return new Response('{}',{status:403})
  const data=path.endsWith('/get-or-create')?{sid:'AbCdEf0123456789',url:'https://public.example/approved'}:path.endsWith('/report')?{report:{report_uid:'report',status:1}}:{chat_session_uid:'group',rel_uid:'rel',withdrawn_at:123,already_withdrawn:false}
  return new Response(JSON.stringify({code:200,data}))
 }) as typeof fetch)
 const sources=new SourceService(runtime,{} as never,{} as never),media=new MediaService(runtime,{} as never,{} as never,{} as never)
 const createPersonalRecord=vi.fn(async(_path,body)=>({accepted:true,record_uid:body.record_uid,status:1}))
 const forwardToTeam=vi.fn(async()=>({sourceRef:'team-contact',itemUid:'accepted-team-forward',status:1,localState:'synced' as const}))
 const chat=new ChatService(runtime,sources,{} as never,media,{createPersonalRecord} as never,{} as never,{} as never,{timelineAiPolish:()=>undefined} as never,{} as never,undefined,undefined,undefined,undefined,forwardToTeam)
 const frame={accessRef:'exact-team-frame',teamId:'42',membershipKind:'member' as const,membershipRevision:4,groupMembershipUid:'admission',groupMembershipRevision:1,visibleFromSeq:7}
 const sourceRef=await sources.sealSourceRef(42,'group_chat','group','客户群',{groupDelegation:frame})
 try {
  const source=await sources.openSourceRef(sourceRef,42)
  const [item]=await chat.projectChatTimelineItems([{relation:{rel_uid:'rel',record_uid:'record',sender_user_id:77,seq:7},record:{status:1,payload:{record_uid:'record',owner_user_id:77,version:3,text_content:'消息'}}}],source,session,undefined,{basicPresentation:true})
  expect(item?.messageRef).toBeTruthy();expect(item?.messageWithdrawalRef).toBeTruthy()
  const reportRef=item!.messageRef!,withdrawalRef=item!.messageWithdrawalRef!
  await expect(chat.reportMessage(reportRef,1)).rejects.toMatchObject({code:'message-source-required'})
  await expect(chat.withdrawGroupMessage(withdrawalRef)).rejects.toMatchObject({code:'message-source-required'})
  for(const changed of [{...frame,teamId:'43'},{...frame,groupMembershipUid:'rejoined'},{...frame,membershipRevision:5}]){
   const other=await sources.sealSourceRef(42,'group_chat','group','客户群',{groupDelegation:changed})
   await expect(chat.reportMessage(reportRef,1,{sourceRef:other})).rejects.toMatchObject({code:'message-source-mismatch'})
   await expect(chat.withdrawGroupMessage(withdrawalRef,{sourceRef:other})).rejects.toMatchObject({code:'message-source-mismatch'})
  }
  expect(wire).toEqual([])
  const service={reportMessage:chat.reportMessage.bind(chat),withdrawGroupMessage:chat.withdrawGroupMessage.bind(chat)}
  const sdk=createArkmeSdk({fetchImpl:async(_input,init)=>{
   const request=JSON.parse(String(init?.body))
   const data=await dispatchArkmeHostOperation(service as never,request.operation,request.params)
   return new Response(JSON.stringify({ok:true,value:data}))
  }})
  await expect(sdk.reportMessage(reportRef,1,{sourceRef})).resolves.toMatchObject({reportUid:'report'})
  await expect(sdk.withdrawGroupMessage(withdrawalRef,undefined,sourceRef)).resolves.toMatchObject({withdrawnAtMillis:123})
  expect(wire).toEqual([{path:'/api/v1/chats/report',frame:'exact-team-frame'},{path:'/api/v1/chats/messages/withdraw',frame:'exact-team-frame'}])
  await expect(chat.copySourceMessageLink(sourceRef,[item!.messageActionRef!])).resolves.toMatchObject({sid:'AbCdEf0123456789'})
  expect(wire.at(-1)).toEqual({path:'/api/v1/chats/messages/copy-link/get-or-create',frame:'exact-team-frame'})
  const personal=await sources.sealSourceRef(42,'send_to_self','self','自己')
  await expect(chat.forwardSourceMessages(sourceRef,[item!.messageActionRef!],{targetSourceRef:personal,recordUid:'019d8590-ebb4-7232-90f2-000000000001',sendAtMillis:123})).resolves.toMatchObject({localState:'synced'})
  expect(createPersonalRecord).toHaveBeenCalledWith('/api/v1/records/source-forward/create',expect.objectContaining({sources:[{record_uid:'record',chat_session_uid:'group',relation_uid:'rel',access_ref:'exact-team-frame'}]}),session,undefined)
  await chat.forwardSourceMessages(sourceRef,[item!.messageActionRef!],{targetConversationRef:'team-contact',recordUid:'019d8590-ebb4-7232-90f2-000000000002',sendAtMillis:123})
  expect(forwardToTeam).toHaveBeenCalledWith(expect.objectContaining({sources:[{record_uid:'record',chat_session_uid:'group',relation_uid:'rel',access_ref:'exact-team-frame'}]}),undefined)
  expect(await chat.reactionTarget(sourceRef,item!.messageActionRef!)).toEqual({chat_session_uid:'group',rel_uid:'rel',chatAccessRef:'exact-team-frame'})
  expect(await chat.recordEditHistoryTarget(sourceRef,item!.messageActionRef!)).toMatchObject({kind:'chat',chatAccessRef:'exact-team-frame'})
  revoked=true
  await expect(chat.reportMessage(reportRef,1,{sourceRef})).rejects.toThrow()
  await expect(chat.withdrawGroupMessage(withdrawalRef,{sourceRef})).rejects.toThrow()
  expect(wire.every(r=>r.frame==='exact-team-frame')).toBe(true)
 }finally{runtime.dispose()}
})
