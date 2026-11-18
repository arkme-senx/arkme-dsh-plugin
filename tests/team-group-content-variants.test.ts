import {expect,it,vi} from 'vitest'
import {ChatService} from '../src/services/chat-service.js'
import {SourceService} from '../src/services/source-service.js'
import {MediaService} from '../src/services/media-service.js'
import {ServiceRuntime,type ArkmeServiceConfig,type StateStore} from '../src/services/service.js'
import {dispatchArkmeHostOperation} from '../src/host-api.js'
import {createArkmeSdk} from '../src/sdk/index.js'

it('keeps nested frozen attachments and shared-recording detail in the selected receiving source',async()=>{
 const session={userId:42,accessToken:'fake',refreshToken:'refresh'};let revoked=false
 const requests:unknown[]=[]
 const recording={render_kind:'shared_recording_memory',source_digest:'digest',title:'共享录音',summary:'摘要',transcript:'共享原文',display_at:1782300000000}
 const runtime=new ServiceRuntime({environment:'test',chatBaseUrl:'https://chat.example',requestTimeoutMs:1000} as ArkmeServiceConfig,{read:async()=>session,write:async()=>{},delete:async()=>{}},{uniqueCode:async()=> 'variants-key'} as StateStore,(async(input,init)=>{
  expect(new URL(String(input)).pathname).toBe('/api/v1/chats/records/detail')
  expect(new Headers(init?.headers).get('X-Chat-Access-Ref')).toBe('receiving-frame')
  requests.push(JSON.parse(String(init?.body)))
  return revoked?new Response('{}',{status:403}):new Response(JSON.stringify({code:200,data:{item:{content_payload:recording}}}))
 }) as typeof fetch)
 const sources=new SourceService(runtime,{} as never,{} as never),media=new MediaService(runtime,{} as never,{} as never,{} as never)
 const chat=new ChatService(runtime,sources,{} as never,media,{} as never,{} as never,{} as never,{timelineAiPolish:()=>undefined} as never,{} as never)
 const frame={accessRef:'receiving-frame',teamId:'42',membershipKind:'member' as const,membershipRevision:4,groupMembershipUid:'admission',groupMembershipRevision:1,visibleFromSeq:7}
 const sourceRef=await sources.sealSourceRef(42,'group_chat','group','客户群',{groupDelegation:frame}),source=await sources.openSourceRef(sourceRef,42)
 const raw=(uid:string,payload:unknown)=>({relation:{chat_session_uid:'group',rel_uid:`rel-${uid}`,record_uid:uid,record_owner_user_id:77,sender_user_id:77,seq:7},record:{status:1,payload:{record_uid:uid,owner_user_id:77,version:3,content_payload:payload}}})
 try {
  const [shared,forward]=await chat.projectChatTimelineItems([raw('recording',recording),raw('forward',{forward_records:{render_kind:'forward_records',items:[{forward_records:{render_kind:'forward_records',items:[{owner_id:88,record_uid:'original-deleted',files:[{type:4,name:'说明.pdf',source_attachment_ref:'nested-receiving-proof',download_url:'https://must-not-use.test/original'}]}]}}]}})],source,session,undefined,{basicPresentation:true})
  const ref=shared?.sharedRecording?.detailRef;expect(ref).toBeTruthy()
  await expect(chat.sharedRecordingDetail(ref!)).rejects.toMatchObject({code:'message-source-required'})
  const other=await sources.sealSourceRef(42,'group_chat','group','客户群',{groupDelegation:{...frame,teamId:'43'}})
  await expect(chat.sharedRecordingDetail(ref!,{sourceRef:other})).rejects.toMatchObject({code:'message-source-mismatch'})
  expect(requests).toEqual([])
  const sdk=createArkmeSdk({fetchImpl:async(_input,init)=>{const req=JSON.parse(String(init?.body));const value=await dispatchArkmeHostOperation({sharedRecordingDetail:chat.sharedRecordingDetail.bind(chat)} as never,req.operation,req.params);return new Response(JSON.stringify({ok:true,value}))}})
  await expect(sdk.sharedRecordingDetail(ref!,{sourceRef})).resolves.toMatchObject({transcript:'共享原文'})
  expect(requests).toEqual([{chat_session_uid:'group',record_uid:'recording',record_owner_user_id:77,rel_uid:'rel-recording',seq:7}])
  const block=forward?.forwardRecords?.items[0]?.forwardRecords?.items[0]?.contentBlocks?.[0];expect(block?.mediaRef).toBeTruthy()
  const stream=vi.spyOn(runtime,'authenticatedRecordSourceStream').mockResolvedValue(new Response('pdf'))
  await media.fetchMedia(block!.mediaRef)
  expect(stream).toHaveBeenCalledWith(expect.objectContaining({access_ref:'receiving-frame',chat_session_uid:'group',relation_uid:'rel-forward',record_uid:'forward',record_owner_user_id:77,version:3,attachment:'nested-receiving-proof'}),expect.anything())
  expect(JSON.stringify(forward)).not.toContain('must-not-use')
  revoked=true;await expect(chat.sharedRecordingDetail(ref!,{sourceRef})).rejects.toThrow()
 }finally{runtime.dispose()}
})
