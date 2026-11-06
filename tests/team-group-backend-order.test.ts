import {expect,it,vi} from 'vitest'
import {UnifiedChatTimelineService} from '../src/services/unified-chat-timeline-service.js'
import {CHAT_TIMELINE_SOURCES} from '../src/unified-chat-timeline.js'
import {TimelineTokenCodec} from '../src/services/timeline-token.js'
import {ArkmePluginError} from '../src/services/service.js'

const missing=()=>new ArkmePluginError('arkme-http-404','Not Found',false,502,{upstreamStatus:404})
const response=(version:2|3)=>({protocol_version:version,chat_session_uid:'group',timeline_items:[],sources:CHAT_TIMELINE_SOURCES.filter(s=>version===3||s!=='team_membership').map(source=>({source,status:'ready',item_count:0})),complete:true,window_token:`v${version}-window`,older_cursor:`v${version}-older`,has_more:false,older_has_more:false,newer_has_more:false})
function fixture(delegated=false){
 const post=vi.fn(async(path:string)=>{if(path.endsWith('/access'))return {state:'ready',access_kind:'team_delegation',representation:{group_membership_uid:'epoch',group_membership_revision:1}};if(path.endsWith('/v3'))throw missing();return response(2)})
 const session={userId:7,refreshToken:'fake'}
 const source={kind:'group_chat',ownerRef:'group',...(delegated?{groupDelegation:{accessRef:'frame',groupMembershipUid:'epoch',groupMembershipRevision:1}}:{})}
 const service=new UnifiedChatTimelineService({requireSession:async()=>session,config:{environment:'test'},stateStore:{uniqueCode:async()=> 'key'},authenticatedChatPost:post} as never,{openSourceRef:async()=>source,sourceItem:async()=>({kind:'group_chat',sourceKey:delegated?'team':'personal'}),chatDirectorySourceKey:async()=> 'canonical'} as never,{projectChatTimelineItems:async()=>[]} as never,{} as never)
 return {post,service}
}
it('reads an existing personal group on a v2-only backend and keeps its cursor and refresh on v2',async()=>{
 const f=fixture()
 try{
  const initial=await f.service.read('source')
  await f.service.read('source',{mode:'older',cursor:initial.unified!.olderCursor!})
  await f.service.read('source',{mode:'refresh',windowTokens:initial.unified!.windowTokens})
  expect(f.post.mock.calls.map(([path])=>path)).toEqual(['/api/v1/chat/timeline/unified/v3','/api/v1/chat/timeline/unified/v2','/api/v1/chat/timeline/unified/v2','/api/v1/chat/timeline/unified/v2'])
 }finally{f.service.dispose()}
})
it('never reads a delegated group through the personal v2 protocol when v3 is missing',async()=>{
 const f=fixture(true)
 try{await expect(f.service.read('source')).rejects.toThrow();expect(f.post.mock.calls.some(([path])=>path.endsWith('/v2'))).toBe(false)}finally{f.service.dispose()}
})
it.each([403,500,503])('does not reinterpret HTTP %s as an unsupported timeline protocol',async status=>{
 const f=fixture();f.post.mockImplementation(async()=>{throw new ArkmePluginError('upstream','failed',true,502,{upstreamStatus:status})})
 try{await expect(f.service.read('source')).rejects.toThrow();expect(f.post).toHaveBeenCalledTimes(1)}finally{f.service.dispose()}
})
it('keeps a confirmed v3 cursor on v3, rejecting its disappearance instead of widening its scope',async()=>{
 const f=fixture();f.post.mockResolvedValue(response(3))
 try{
  const page=await f.service.read('source');f.post.mockRejectedValue(missing())
  await expect(f.service.read('source',{mode:'older',cursor:page.unified!.olderCursor!})).rejects.toThrow()
  expect(f.post.mock.calls.every(([path])=>path.endsWith('/v3'))).toBe(true)
 }finally{f.service.dispose()}
})

it('continues a published personal v2 cursor without probing or reinterpreting it',async()=>{
 const f=fixture(),codec=new TimelineTokenCodec('key',JSON.stringify(['test',7,'group']))
 try{await f.service.read('source',{mode:'older',cursor:codec.seal('old-opaque-cursor','older')});expect(f.post.mock.calls.map(([path])=>path)).toEqual(['/api/v1/chat/timeline/unified/v2'])}finally{f.service.dispose()}
})
it('rejects mixed protocol windows before sending an upstream read',async()=>{
 const f=fixture(),codec=new TimelineTokenCodec('key',JSON.stringify(['test',7,'group']))
 try{await expect(f.service.read('source',{mode:'refresh',windowTokens:[codec.seal(JSON.stringify(['wire',2,'a']),'window'),codec.seal(JSON.stringify(['wire',3,'b']),'window')]})).rejects.toMatchObject({code:'chat-timeline-window-invalid'});expect(f.post).not.toHaveBeenCalled()}finally{f.service.dispose()}
})
it('does not negotiate away a malformed successful response',async()=>{
 const f=fixture();f.post.mockResolvedValue({...response(3),sources:[]})
 try{await expect(f.service.read('source')).rejects.toMatchObject({code:'chat-timeline-contract-invalid'});expect(f.post).toHaveBeenCalledTimes(1)}finally{f.service.dispose()}
})
