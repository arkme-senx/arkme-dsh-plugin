import {expect,it,vi} from 'vitest'
import {TeamMessageForwardService} from '../src/services/team-message-forward-service.js'
import type {TeamForwardInput} from '../src/team-message-contract.js'
const recordUid='11111111-1111-5111-8111-111111111111'
const input:TeamForwardInput={conversationRef:'source-team-ref',selections:[{messageRef:'message-ref',version:3}],target:{kind:'source',sourceRef:'target-ref'},requestId:'stable-request',recordUid,sendAtMillis:1700000000000}
function fixture(kind='private_chat'){
 const actor={userId:11,accessToken:'token',refreshToken:'session'},sources=[{conversation_uid:'source-conversation',message_uid:'source-message',side:'team',expected_record_version:3}]
 const runtime={requireSession:vi.fn(async()=>actor),accountScopedSession:vi.fn(async()=>actor),authenticatedTeamPost:vi.fn(async()=>({message_uid:'accepted',side:'team',state:'published',seq:7})),authenticatedChatPost:vi.fn(async()=>({record_uid:'chat-record',seq:8})),authenticatedPost:vi.fn(async()=>({accepted:true,record_core:{record_uid:recordUid,owner_user_id:11,status:1}}))}
 const team={resolveMessageSelection:vi.fn(async()=>sources),resolveConversation:vi.fn(async()=>({conversation_uid:'target-conversation',side:'team'})),messageReceipt:vi.fn(async()=>({key:'opaque-key',seq:7}))}
 const source={openSourceRef:vi.fn(async()=>({kind,ownerRef:'native-owner'})),invalidateSourceListCache:vi.fn()},changed=vi.fn(async()=>{})
 const service=new TeamMessageForwardService(runtime as never,team as never,source as never,changed)
 return {service,runtime,team,source,changed,sources}
}
it('forwards Team selectors through Chat acceptance without loading or rebuilding source bodies',async()=>{
 const f=fixture();const result=await f.service.forward(input)
 expect(result).toMatchObject({itemUid:'chat-record',sequence:8,localState:'synced'})
 expect(f.runtime.authenticatedChatPost.mock.calls[0]?.[0]).toBe('/api/v1/chats/records/forward')
 expect(f.runtime.authenticatedChatPost.mock.calls[0]?.[1]).toMatchObject({client_request_id:'stable-request',source_items:[{source_type:'team_message',team_source:f.sources[0]}]})
 expect(f.changed).toHaveBeenCalledOnce();expect(f.runtime.authenticatedTeamPost).not.toHaveBeenCalled();expect(f.runtime.authenticatedPost).not.toHaveBeenCalled()
})
it('uses native Record and owner topic target commands with stable record identity',async()=>{
 for(const kind of ['send_to_self','default_category','topic']){
  const f=fixture(kind);expect(await f.service.forward(input)).toMatchObject({itemUid:recordUid,localState:'synced'})
  expect(f.runtime.authenticatedPost.mock.calls[0]?.[0]).toBe(kind==='topic'?'/api/v1/topics/records/team-message-forward/create':'/api/v1/records/team-message-forward/create')
  expect(f.runtime.authenticatedPost.mock.calls[0]?.[1]).toMatchObject({record_uid:recordUid,sources:f.sources})
  expect(f.source.invalidateSourceListCache).toHaveBeenCalledWith(11,'send_to_self')
 }
})
it('uses the real target Team side, confirms only publication and reuses an unknown request identity',async()=>{
 const f=fixture(),command={...input,target:{kind:'team' as const,conversationRef:'target-team-ref'}}
 f.runtime.authenticatedTeamPost.mockResolvedValueOnce({message_uid:'accepted',side:'team',state:'preparing',seq:0})
 await expect(f.service.forward(command)).rejects.toMatchObject({code:'team-forward-outcome-unknown'})
 const receipt=await f.service.forward(command)
 expect(receipt).toMatchObject({itemUid:'opaque-key',localState:'synced'})
 const first=f.runtime.authenticatedTeamPost.mock.calls[0]?.[1] as Record<string,unknown>,second=f.runtime.authenticatedTeamPost.mock.calls[1]?.[1] as Record<string,unknown>
 expect(first.client_message_uid).toBe(second.client_message_uid);expect(first).toMatchObject({conversation_uid:'target-conversation',side:'team',sources:f.sources})
 expect(f.source.openSourceRef).not.toHaveBeenCalled();expect(f.runtime.authenticatedChatPost).not.toHaveBeenCalled()
})
it('rejects changed accounts, malformed targets and unconfirmed owner receipts',async()=>{
 const f=fixture('send_to_self');f.runtime.authenticatedPost.mockResolvedValueOnce({accepted:true,record_core:{record_uid:recordUid,owner_user_id:99,status:1}})
 await expect(f.service.forward(input)).rejects.toMatchObject({code:'team-forward-outcome-unknown'})
 f.runtime.accountScopedSession.mockResolvedValueOnce({userId:22,accessToken:'other',refreshToken:'other'})
 await expect(f.service.forward(input)).rejects.toMatchObject({code:'team-account-changed'})
 await expect(f.service.forward({...input,target:{kind:'invalid'} as never})).rejects.toMatchObject({code:'team-forward-invalid'})
 expect(f.changed).not.toHaveBeenCalled()
})
it('keeps the accepted card and stable comment identity when only the comment result is unknown',async()=>{
 const f=fixture('send_to_self'),commentUid='22222222-2222-5222-8222-222222222222'
 const command={...input,commentText:'附言',commentRecordUid:commentUid}
 f.runtime.authenticatedPost.mockImplementation(async(path:string)=>{
  if(path==='/api/v1/records/team-message-forward/create')return {accepted:true,record_core:{record_uid:recordUid,owner_user_id:11,status:1}}
  throw new Error('comment response lost')
 })
 const partial=await f.service.forward(command)
 expect(partial.localState).toBe('synced');expect(partial.warningText).toContain('附言尚未确认')
 f.runtime.authenticatedPost.mockImplementation(async(path:string)=>path==='/api/v1/records/team-message-forward/create'?{accepted:true,record_core:{record_uid:recordUid,owner_user_id:11,status:1}}:{record_uid:commentUid,status:1} as never)
 const complete=await f.service.forward(command)
 expect(complete.warningText).toBeUndefined()
 const comments=f.runtime.authenticatedPost.mock.calls.filter(call=>call[0]==='/api/v1/records/create')
 expect(comments.map(call=>(call[1] as Record<string,unknown>).record_uid)).toEqual([commentUid,commentUid])
 expect(comments.map(call=>(call[1] as Record<string,unknown>).send_at)).toEqual([input.sendAtMillis,input.sendAtMillis])
})

it('forwards Record and Chat selectors to the Team owner and keeps comment retry identity',async()=>{
 const f=fixture(),command={targetConversationRef:'team-target',expectedUserId:11,requestId:recordUid,sendAtMillis:input.sendAtMillis,commentText:'comment',sources:[{record_uid:'body',chat_session_uid:'chat',relation_uid:'relation'}]}
 f.runtime.authenticatedTeamPost.mockImplementation(async(path:string)=>path.endsWith('/messages/send')?{message_uid:'comment',side:'team',state:'preparing',seq:0}:{message_uid:'accepted',side:'team',state:'published',seq:7})
 const partial=await f.service.forwardRecords(command)
 expect(partial.warningText).toContain('附言尚未确认')
 expect(f.runtime.authenticatedTeamPost.mock.calls[0]?.[1]).toMatchObject({conversation_uid:'target-conversation',side:'team',record_sources:command.sources})
 expect(f.runtime.authenticatedTeamPost.mock.calls[0]?.[1]).not.toHaveProperty('content')
 f.runtime.authenticatedTeamPost.mockResolvedValue({message_uid:'accepted',side:'team',state:'published',seq:7})
 expect((await f.service.forwardRecords(command)).warningText).toBeUndefined()
 const requests=f.runtime.authenticatedTeamPost.mock.calls
 expect(requests[0]?.[1]).toEqual(requests[2]?.[1]);expect(requests[1]?.[1]).toEqual(requests[3]?.[1])
 expect(f.runtime.authenticatedChatPost).not.toHaveBeenCalled();expect(f.runtime.authenticatedPost).not.toHaveBeenCalled()
})
it('rejects account switches before publication, unconfirmed Team receipts and aborts before IO',async()=>{
 const f=fixture(),command={targetConversationRef:'team-target',expectedUserId:11,requestId:recordUid,sendAtMillis:input.sendAtMillis,sources:[{record_uid:'body',record_owner_user_id:11}]}
 f.runtime.accountScopedSession.mockResolvedValueOnce({userId:22,refreshToken:'other'} as never)
 await expect(f.service.forwardRecords(command)).rejects.toMatchObject({code:'team-account-changed'})
 expect(f.runtime.authenticatedTeamPost).not.toHaveBeenCalled()
 f.runtime.authenticatedTeamPost.mockResolvedValueOnce({message_uid:'pending',side:'team',state:'preparing',seq:0})
 await expect(f.service.forwardRecords(command)).rejects.toMatchObject({code:'team-forward-outcome-unknown'})
 const controller=new AbortController();controller.abort()
 await expect(f.service.forwardRecords(command,controller.signal)).rejects.toBeTruthy()
 expect(f.runtime.authenticatedTeamPost).toHaveBeenCalledOnce()
})

it('binds delegated Team forwarding to its sealed team identity and access reference on every retry',async()=>{
 const f=fixture('group_chat')
 const delegation={accessRef:'signed-current-access',teamId:'9007199254740993',membershipKind:'member',membershipRevision:7,groupMembershipUid:'group-admission',groupMembershipRevision:3,visibleFromSeq:10}
 f.source.openSourceRef.mockResolvedValue({kind:'group_chat',ownerRef:'native-owner',groupDelegation:delegation} as never)
 const command={...input,commentText:'附言',commentRecordUid:'22222222-2222-5222-8222-222222222222'}
 f.runtime.authenticatedChatPost.mockRejectedValueOnce(new Error('response lost'))
 await expect(f.service.forward(command)).rejects.toThrow('response lost')
 expect(await f.service.forward(command)).toMatchObject({localState:'synced'})
 const calls=f.runtime.authenticatedChatPost.mock.calls as unknown as unknown[][]
 for(const call of calls){
  expect(call[0]).toBe('/api/v1/chats/records/forward')
  expect(call[1]).toMatchObject({representation:{team_id:'9007199254740993',membership_kind:'member',membership_revision:7,group_join_at:0,group_membership_uid:'group-admission',group_membership_revision:3},comment_text:'附言',client_request_id:input.requestId})
  expect(call[4]).toEqual({chatAccessRef:'signed-current-access',trackWriteOutcome:true})
 }
 expect(calls[0]![1]).toEqual(calls[1]![1])
 expect(f.runtime.authenticatedPost).not.toHaveBeenCalled()
})
it('does not retry a revoked delegated target as a personal Chat member',async()=>{
 const f=fixture('group_chat')
 f.source.openSourceRef.mockResolvedValue({kind:'group_chat',ownerRef:'native-owner',groupDelegation:{accessRef:'revoked-access',teamId:'7',membershipKind:'member',membershipRevision:2,groupMembershipUid:'revoked-group',groupMembershipRevision:1,visibleFromSeq:1}} as never)
 f.runtime.authenticatedChatPost.mockRejectedValue(new Error('current group access denied'))
 await expect(f.service.forward(input)).rejects.toThrow('current group access denied')
 expect(f.runtime.authenticatedChatPost).toHaveBeenCalledOnce()
 expect((f.runtime.authenticatedChatPost.mock.calls as unknown as unknown[][])[0]![4]).toEqual({chatAccessRef:'revoked-access',trackWriteOutcome:true})
 expect(f.changed).not.toHaveBeenCalled()
})
