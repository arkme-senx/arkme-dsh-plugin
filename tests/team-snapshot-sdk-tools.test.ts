import { expect,it,vi } from 'vitest'
import { ArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { teamMessageTools } from '../src/tools/business/conversation/team-messages.js'

it('routes typed SDK snapshot, freeze and exact edit operations through the Host owner',async()=>{
 const snapshot={schemaVersion:1,recorded:true,version:2,snapshotVersion:1,detail:{itemUid:'opaque',textContent:'',backgroundSound:'unknown',durationState:'complete'}}
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamMessageSnapshot:1}}),teamSnapshotCapabilities:vi.fn(async()=>({schemaVersion:1})),freezeTeamMetadata:vi.fn(async()=>({metadataRef:'cipher'})),readTeamMessageSnapshot:vi.fn(async()=>snapshot),editTeamMessage:vi.fn(async()=>({version:2})),readTeamEditReceipt:vi.fn(async()=>({revisionUid:'stable',accepted:true,acceptedVersion:2}))}
 const fetchImpl=vi.fn(async(_path:unknown,init?:RequestInit)=>{const {operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params,init?.signal??undefined)}))}) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl}),metadata={send_at:1000,capture_context:{schema_version:1 as const,captured_at:1000,device_state:'unavailable' as const,location_state:'not_recorded' as const}}
 expect(await sdk.freezeTeamMetadata('conversation','stable',metadata)).toEqual({metadataRef:'cipher'})
 expect(await sdk.readTeamMessageSnapshot('conversation','message')).toEqual(snapshot)
 const command={conversationRef:'conversation',messageRef:'message',version:1,revisionUid:'stable',content:{template_kind:1,text_content:'edited'}}
 await sdk.editTeamMessage(command);await sdk.readTeamEditReceipt('conversation','message','stable')
 expect(service.freezeTeamMetadata).toHaveBeenCalledWith('conversation','stable',metadata,undefined)
 expect(service.editTeamMessage).toHaveBeenCalledWith(command,undefined)
})
it('redacts device and precise position from the model Tool result',async()=>{
 const read=vi.fn(async()=>({schemaVersion:1,recorded:true,version:1,snapshotVersion:1,detail:{itemUid:'opaque',textContent:'',backgroundSound:'unknown',startAtMillis:1000,captureContext:{clientName:'private-device'},locationCapture:{latitude:30,longitude:120}}}))
 const tool=teamMessageTools.find(m=>m.meta.toolName==='arkme_team_messages')!.create({readTeamMessageSnapshot:read} as never)
 const result=await tool.execute({snapshot:true,conversation_ref:'conversation',message_ref:'message'} as never,{signal:new AbortController().signal,callId:'call'} as never)
 expect(read).toHaveBeenCalledWith('conversation','message',expect.any(AbortSignal))
 expect(result).toContain('startAtMillis');expect(result).not.toMatch(/private-device|latitude|longitude|captureContext/)
})
it('exact edit Tool reconciles before writing and preserves attachment payload',async()=>{
 const payload={payload_kind:2,schema_version:1,media_refs:[{file_asset_uid:'asset'}]}
 const receipt=vi.fn(async()=>({accepted:false})),edit=vi.fn(async()=>({version:2})),preflight=vi.fn(async()=>[{own:true,canEdit:true,version:1,content:{text_content:'old',template_kind:2,content_payload:payload}}])
 const tool=teamMessageTools.find(m=>m.meta.toolName==='arkme_team_message_edit')!.create({readTeamEditReceipt:receipt,editTeamMessage:edit,preflightTeamMessages:preflight} as never)
 await tool.execute({conversation_ref:'conversation',message_ref:'message',version:1,revision_uid:'11111111-1111-4111-8111-111111111111',text:'new'} as never,{signal:new AbortController().signal,callId:'stable-call'} as never)
 const command=edit.mock.calls[0]![0] as unknown as Record<string,unknown>
 expect(command.content).toMatchObject({text_content:'new',content_payload:payload})
 expect(command).not.toHaveProperty('metadataRef')
 receipt.mockResolvedValue({accepted:true} as never)
 await tool.execute({conversation_ref:'conversation',message_ref:'message',version:1,revision_uid:'11111111-1111-4111-8111-111111111111',text:'new'} as never,{signal:new AbortController().signal,callId:'stable-call'} as never)
 expect(edit).toHaveBeenCalledOnce();expect(preflight).toHaveBeenCalledOnce()
})
