import {expect,it,vi} from 'vitest'
import {SourceService,type ArkmeSourceRefPayload,type GroupDelegation} from '../src/services/source-service.js'
import {ServiceRuntime,type ArkmeServiceConfig,type StateStore} from '../src/services/service.js'

const actor={userId:90,accessToken:'fake-token',refreshToken:'fake-refresh'}
function fixture(environment='test') {
  const requests:Headers[]=[]
  const fetchImpl=vi.fn(async(_url,init)=>{
    const headers=new Headers(init?.headers);requests.push(headers)
    await new Promise(resolve=>setTimeout(resolve,5))
    return new Response(JSON.stringify({code:200,data:{frame:headers.get('X-Chat-Access-Ref')??'personal'}}))
  }) as typeof fetch
  const config={environment,chatBaseUrl:'https://chat.example',requestTimeoutMs:1000} as ArkmeServiceConfig
  const runtime=new ServiceRuntime(config,{} as never,{uniqueCode:async()=> 'fake-local-key'} as StateStore,fetchImpl)
  const sources=new SourceService(runtime,{} as never,{} as never)
  return {runtime,sources,requests}
}
const delegation:GroupDelegation={accessRef:'host-only-signed-ref',teamId:'42',membershipKind:'member',membershipRevision:7,groupMembershipUid:'group-epoch',groupMembershipRevision:1,visibleFromSeq:10}

it('encrypts the selected source frame and fences actor/environment without changing canonical message identity',async()=>{
  const {sources}=fixture()
  const plain=await sources.sealSourceRef(90,'group_chat','group','客户群')
  const delegated=await sources.sealSourceRef(90,'group_chat','group','客户群',{groupDelegation:delegation})
  const raw=Buffer.from(delegated.split('.')[1]!,'base64url').toString()
  expect(raw).not.toContain(delegation.accessRef);expect(raw).not.toContain(delegation.groupMembershipUid)
  const p=await sources.openSourceRef(plain,90),d=await sources.openSourceRef(delegated,90)
  expect(d.groupDelegation).toEqual(delegation)
  expect(await sources.sourceScopeKey(d)).not.toBe(await sources.sourceScopeKey(p))
  const reentered={...d,groupDelegation:{...delegation,groupMembershipUid:'new-epoch',groupMembershipRevision:3}}
  expect(await sources.sourceScopeKey(reentered)).not.toBe(await sources.sourceScopeKey(d))
  expect(await sources.chatTimelineItemKey(90,p.ownerRef,'relation')).toBe(await sources.chatTimelineItemKey(90,d.ownerRef,'relation'))
  const projected=await sources.sourceItem(d)
  expect(projected.sourceKey).toBe(await sources.sourceScopeKey(d))
  expect(JSON.stringify(projected)).not.toContain(delegation.accessRef)
  expect((await sources.openSourceRef(projected.sourceRef,90)).groupDelegation).toEqual(delegation)
  await expect(sources.openSourceRef(delegated,91)).rejects.toThrow('账号')
  await expect(fixture('production').sources.openSourceRef(delegated,90)).rejects.toThrow('团队群来源')
})

it('does not coalesce personal and two explicit team reads of the same canonical group',async()=>{
  const {runtime,requests}=fixture()
  const read=(ref?:string)=>runtime.authenticatedChatPost<{frame:string}>('/api/v1/chat/timeline/page',{chat_session_uid:'group',limit:30},actor,undefined,ref?{chatAccessRef:ref}:{})
  const results=await Promise.all([read(),read('team-A-epoch-1'),read('team-B-epoch-4')])
  expect(results.map(r=>r.frame)).toEqual(['personal','team-A-epoch-1','team-B-epoch-4'])
  expect(requests).toHaveLength(3)
  await expect(read('')).resolves.toEqual({frame:'personal'})
  await expect(runtime.authenticatedChatPost('/api/v1/chat/timeline/page',{},actor,undefined,{chatAccessRef:''})).rejects.toThrow('无效')
})

it('rejects a non-group delegated source before issuing an opaque reference',async()=>{
  const {sources}=fixture()
  await expect(sources.sealSourceRef(90,'private_chat','private','私信',{groupDelegation:delegation})).rejects.toThrow('群聊')
})

it('sends real decimal-string Team protocols without changing the existing numeric owner wire contract',async()=>{
 const encoded:string[]=[]
 const runtime=new ServiceRuntime({environment:'test',chatBaseUrl:'https://chat.example',teamBaseUrl:'https://team.example',requestTimeoutMs:1000} as ArkmeServiceConfig,{} as never,{} as StateStore,(async(_url,init)=>{
  encoded.push(String(init?.body));return new Response(JSON.stringify({code:200,data:{}}))
 }) as typeof fetch)
 const id='9223372036854775806'
 await runtime.authenticatedChatPost('/api/v1/chats/team-group/command',{action:'join',team_id:id},actor,undefined,{stringIdFields:['team_id']})
 await runtime.authenticatedTeamPost('/api/v1/team/workspace/page',{team_id:id},actor,undefined,true,{stringIdFields:['team_id']})
 await runtime.authenticatedTeamPost('/api/v1/team/profile/get',{team_id:id},actor,undefined,true)
 expect(JSON.parse(encoded[0]!).team_id).toBe(id)
 expect(JSON.parse(encoded[1]!).team_id).toBe(id)
 expect(encoded[2]).toBe('{"team_id":9223372036854775806}')
})

it('revalidates the exact frozen delegation through current metadata without upgrading a rejoined employee',async()=>{
 let actor=90,revision=7
 const requests:{body:Record<string,unknown>;header:string|null}[]=[]
 const runtime=new ServiceRuntime({environment:'test',chatBaseUrl:'https://chat.example',requestTimeoutMs:1000} as ArkmeServiceConfig,{} as never,{uniqueCode:async()=> 'test-key'} as StateStore,(async(_url,init)=>{
  requests.push({body:JSON.parse(String(init?.body)),header:new Headers(init?.headers).get('X-Chat-Access-Ref')})
  return new Response(JSON.stringify({code:200,data:{items:[{chat_session_uid:'group',access_kind:'team_delegation',membership:{active:true,membership_uid:'group-epoch',revision:1,visible_from_seq:10},representation:{team_id:'42',membership_kind:'member',membership_revision:revision}}]}}))
 }) as typeof fetch)
 vi.spyOn(runtime,'requireSession').mockImplementation(async()=>({userId:actor,accessToken:'fake',refreshToken:'same-refresh'}))
 const sources=new SourceService(runtime,{} as never,{} as never)
 const frame={version:1 as const,userId:90,kind:'group_chat' as const,ownerRef:'group',displayName:'客户群',groupDelegation:delegation}
 const session={userId:90,accessToken:'fake',refreshToken:'same-refresh'}
 await sources.authorizeGroupDelegation(frame,session)
 expect(requests[0]).toEqual({body:{team_id:'42',items:[{chat_session_uid:'group',membership_uid:'group-epoch',revision:1}]},header:delegation.accessRef})
 revision=8
 await expect(sources.authorizeGroupDelegation(frame,session)).rejects.toThrow('资格已变化')
 revision=7;actor=91
 await expect(sources.authorizeGroupDelegation(frame,session)).rejects.toThrow('账号已变化')
})

it('never coalesces Record or Intelligent reads across two explicit group audiences',async()=>{
 const requests:{path:string;frame:string|null}[]=[]
 const runtime=new ServiceRuntime({environment:'test',recordBaseUrl:'https://record.example',intelligentBaseUrl:'https://intelligent.example',requestTimeoutMs:1000} as ArkmeServiceConfig,{read:async()=>actor,write:async()=>{},delete:async()=>{}},{} as StateStore,(async(input,init)=>{
  const path=new URL(String(input)).pathname,frame=new Headers(init?.headers).get('X-Chat-Access-Ref');requests.push({path,frame})
  await new Promise(resolve=>setTimeout(resolve,10))
  return new Response(JSON.stringify({code:path.includes('chat-thought')?200:0,data:{frame}}))
 }) as typeof fetch)
 try {
  const read=(frame:string)=>runtime.authenticatedPost('/api/v1/search/records/query',{query:'same'},actor,undefined,{chatAccessRef:frame,lane:'interactive-read',cacheMs:0,bypassCache:true})
  const thought=(frame:string)=>runtime.authenticatedIntelligentPost('/api/v1/chat-thought/list',{chat_session_uid:'same',rel_uids:['same']},actor,undefined,{chatAccessRef:frame,lane:'background-read',cacheMs:0,bypassCache:true})
  const results=await Promise.all([read('frame-A'),read('frame-B'),thought('frame-A'),thought('frame-B')])
  expect(results).toEqual([{frame:'frame-A'},{frame:'frame-B'},{frame:'frame-A'},{frame:'frame-B'}]);expect(requests).toHaveLength(4)
 }finally{runtime.dispose()}
})
