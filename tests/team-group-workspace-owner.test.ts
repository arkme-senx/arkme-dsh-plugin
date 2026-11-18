import {expect,it,vi} from 'vitest'
import {TeamAppService} from '../src/services/team-app-service.js'
import {SourceService} from '../src/services/source-service.js'
import {ServiceRuntime,type ArkmeServiceConfig,type StateStore} from '../src/services/service.js'
import {EncryptedReferenceCodec} from '../src/encrypted-reference.js'
import {ArkmeService} from '../src/arkme-service.js'
import type {TeamWorkspacePage,TeamGroupPage,TeamGroupSourceCard} from '../src/team-group-contract.js'

const member={chat_session_uid:'group',team_id:'42',membership_uid:'admission',revision:1,active:true,visible_from_seq:10,team_name:'Support',team_jotmo_id:'support'}
const presentation={chat_session_uid:'group',membership_uid:'admission',revision:1,unread:{read_seq:9,session_last_seq:10,unread_count:2,has_unread_attention:true},latest:{relation:{chat_session_uid:'group',rel_uid:'relation',seq:10,display_name_snapshot:'小王',representation:{name:'Support',jotmo_id:'support'}},record:{status:1,payload:{text_content:'已批准预览'}}},avatar:{member_count:2,strategy:'owner_recent_speakers_v1',computed_at:200,member_ids:[90,91]}}
const group={chat_session_uid:'group',title:'客户群',access_kind:'team_delegation',membership_policy:'independent',access_ref:'private-signed-source',activity_at:200,activity_seq:10,membership:member,representation:{team_id:'42',membership_kind:'member',membership_revision:7,group_join_at:0,group_membership_uid:'admission',group_membership_revision:1,name:'Support',jotmo_id:'support'}}
const occurrence={source_uid:'source-occurrence',conversation_uid:'customer',group_uid:'group',relation_uid:'relation',membership_uid:'admission',sequence:10,occurred_at:200,record_version:3,active:true,record_ref:{owner_user_id:77,record_uid:'record'}}
const card={card_uid:'card',team_id:'42',conversation_uid:'customer',group_uid:'group',membership_uid:'admission',activity_at:200,latest:occurrence,group}
const customer={team_id:'42',conversation_uid:'customer',source_only:true,side:'team',last_seq:0,channel:{team_id:'42',name:'Support',jotmo_id:'support',enabled:false,revision:0,can_manage:false}}

it('wires canonical group keys through the actual public facade',async()=>{
 const session={userId:90,accessToken:'fixture',refreshToken:'fixture-refresh'}
 const service=new ArkmeService({environment:'test',chatBaseUrl:'https://chat.test',teamBaseUrl:'https://team.test',authBaseUrl:'https://auth.test',shareWebsite:'https://share.test',requestTimeoutMs:1000} as ArkmeServiceConfig,
  {read:async()=>session,write:async()=>{},delete:async()=>{}},{uniqueCode:async()=> 'public-facade-workspace'} as StateStore,
  async input=>new Response(JSON.stringify({code:200,data:String(input).endsWith('/workspace/folders/query')?{items:[{team_id:'42',group_count:1,activity_at:200,unread_count:2,latest_group:{...group,presentation},groups:[{chat_session_uid:'group',unread_count:2,last_seq:10,visible_from_seq:10}],channel:customer.channel}]}:{items:[],users:[]}}))
 )
 try {
  const folders=await service.teamWorkspace({operation:'folders'}) as import('../src/team-group-contract.js').TeamWorkspaceFolder[]
  expect(folders).toMatchObject([{groupCount:1,groups:[{sourceKey:expect.any(String)}]}])
  const fromHost=await service.executeTeamApp('team.app.workspace.request',{request:{operation:'folders'}}) as import('../src/team-group-contract.js').TeamWorkspaceFolder[]
  expect(fromHost).toMatchObject([{groupCount:1,channel:{jotmoId:'support'},groups:[{sourceKey:folders[0]!.groups[0]!.sourceKey}]}])
 }finally{service.dispose()}
})
function fixture() {
  let revoked=false,account=90
  const paths:string[]=[]
  const fetchImpl=vi.fn(async(input,init)=>{
    const path=new URL(String(input)).pathname;paths.push(path)
    let data:unknown={}
    if(path.endsWith('/workspace/page'))data={items:[{key:'customer',conversation_kind:'team_direct',activity_at:200,conversation:customer,source_card:card},{key:'group',conversation_kind:'team_group',activity_at:200,group:{...group,presentation}}],complete:true,unavailable_sources:[],has_more:false}
    if(path.endsWith('/workspace/folders/query'))data={items:[{team_id:'42',group_count:1,activity_at:200,unread_count:2,latest_group:{...group,presentation},groups:[{chat_session_uid:'group',unread_count:2,last_seq:10,visible_from_seq:10}],channel:customer.channel}]}
    if(path.endsWith('/group-sources/cards'))data={items:[card],has_more:false}
    if(path.endsWith('/group-sources/occurrences'))data={group,items:revoked?[]:[occurrence],has_more:false,before_seq:10}
    return new Response(JSON.stringify({code:200,data}))
  }) as typeof fetch
  const runtime=new ServiceRuntime({environment:'test',chatBaseUrl:'https://chat.example',teamBaseUrl:'https://team.example',authBaseUrl:'https://auth.example',shareWebsite:'https://share.example',requestTimeoutMs:1000} as ArkmeServiceConfig,{} as never,{uniqueCode:async()=> 'fake-workspace-key'} as StateStore,fetchImpl)
  const session=()=>({userId:account,accessToken:'fake',refreshToken:'fake-refresh'})
  vi.spyOn(runtime,'requireSession').mockImplementation(async()=>session());vi.spyOn(runtime,'accountScopedSession').mockImplementation(async()=>session())
  const sources=new SourceService(runtime,{} as never,{} as never)
  const privateChat={openPrivateChatFromUser:vi.fn(),readSourceAround:vi.fn(async(sourceRef:string)=>{
    const opened=await sources.openSourceRef(sourceRef,90)
    expect(opened.groupDelegation?.accessRef).toBe(group.access_ref)
    return {source:await sources.sourceItem(opened),items:[{itemUid:'record',sequence:10,recordVersion:3,messageActionRef:'opaque-action',textContent:'已授权原群正文'}]}
  })}
  const service=new TeamAppService(runtime,{publicAvatarPresentationsByArkmeIds:async()=>new Map()} as never,privateChat as never,sources)
  return {service,sources,privateChat,paths,revoke:()=>{revoked=true},changeAccount:()=>{account=91}}
}

it('projects mixed source-only contacts and groups without opening a private channel or exposing server capabilities',async()=>{
 const f=fixture(),teamRef=await f.service.worldTeamRef(42,90)
 const page=await f.service.execute('team.app.workspace',{teamRef}) as TeamWorkspacePage
 expect(page.items.map(row=>row.kind)).toEqual(['customer','group'])
 const row=page.items[0]!
 if(row.kind!=='customer')throw new Error('wrong customer')
 expect(row.conversation).toMatchObject({sourceOnly:true,lastSeq:0,unread:0,needsReply:false,hasGroupSources:true})
 expect(row.sourceCard!.source.accessKind).toBe('team_delegation')
 expect(JSON.stringify(page)).not.toContain(group.access_ref)
 expect(JSON.stringify(page)).not.toContain(occurrence.record_ref.record_uid)
 expect(f.paths).toEqual(['/api/v1/team/workspace/page'])
 expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled()
 const cards=await f.service.execute('team.app.sources.cards',{conversationRef:row.conversation.ref}) as TeamGroupPage<TeamGroupSourceCard>
 const located=await f.service.execute('team.app.sources.locate',{anchorRef:cards.items[0]!.latestRef}) as {source:{sourceRef:string};item:{textContent:string}}
 expect(located.item.textContent).toBe('已授权原群正文')
 expect((await f.sources.openSourceRef(located.source.sourceRef,90)).groupDelegation?.groupMembershipUid).toBe('admission')
 expect(f.paths.filter(path=>path.endsWith('/occurrences'))).toHaveLength(2)
})

it('rechecks the customer-source association after body hydration and rejects another customer before reading its source',async()=>{
 const f=fixture(),page=await f.service.execute('team.app.workspace',{teamRef:await f.service.worldTeamRef(42,90)}) as TeamWorkspacePage
 const customer=page.items[0]!
 if(customer.kind!=='customer')throw new Error('wrong customer')
 const cards=await f.service.execute('team.app.sources.cards',{conversationRef:customer.conversation.ref}) as TeamGroupPage<TeamGroupSourceCard>
 const other=await new EncryptedReferenceCodec(async()=> 'fake-workspace-key',()=>new Error('invalid')).seal('team-app-conversation',{viewer:90,environment:'test',side:'team',conversation_uid:'another-customer'})
 const before=f.paths.length
 await expect(f.service.execute('team.app.sources.occurrences',{conversationRef:other,cardRef:cards.items[0]!.ref})).rejects.toThrow('引用无效')
 expect(f.paths).toHaveLength(before)
 const original=f.privateChat.readSourceAround.getMockImplementation()!
 f.privateChat.readSourceAround.mockImplementation(async sourceRef=>{const body=await original(sourceRef);f.revoke();return body})
 await expect(f.service.execute('team.app.sources.locate',{anchorRef:cards.items[0]!.latestRef})).rejects.toThrow('引用无效')
 expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled()
 f.changeAccount()
 await expect(f.service.execute('team.app.sources.locate',{anchorRef:cards.items[0]!.latestRef})).rejects.toThrow()
})

it('returns approved selected-page previews and true group-only folders through the shared workspace owner',async()=>{
 const f=fixture(),teamRef=await f.service.worldTeamRef(42,90)
 const page=await f.service.execute('team.app.workspace',{teamRef}) as TeamWorkspacePage
 expect(page.items[1]).toMatchObject({kind:'group',source:{latestPreview:'小王 [Support]：已批准预览',unreadCount:2,hasUnreadMention:true}})
 // Customer association metadata never borrows a latest whole-group message.
 expect(page.items[0]!.kind==='customer'&&page.items[0].sourceCard!.source.latestPreview).toBeUndefined()
 const folders=await f.service.execute('team.app.workspace.request',{request:{operation:'folders'}}) as import('../src/team-group-contract.js').TeamWorkspaceFolder[]
 expect(folders).toHaveLength(1)
 expect(folders[0]).toMatchObject({groupCount:1,unread:2,hasPublished:true,preview:'小王 [Support]：已批准预览'})
 expect(JSON.stringify(folders)).not.toContain('private-signed-source')
 expect(JSON.stringify(folders)).not.toContain('chat_session_uid')
 expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled()
})


it('scopes folder discovery by the decoded team identity before projecting unrelated folders',async()=>{
 const f=fixture(),teamRef=await f.service.worldTeamRef(43,90)
 const folders=await f.service.execute('team.app.workspace.request',{request:{operation:'folders',teamRef}})
 expect(folders).toEqual([])
 expect(f.paths).toEqual(['/api/v1/team/workspace/folders/query'])
 const own=await f.service.execute('team.app.workspace.request',{request:{operation:'folders',teamRef:await f.service.worldTeamRef(42,90)}})
 expect(own).toMatchObject([{groupCount:1,channel:{jotmoId:'support'}}])
 expect(f.privateChat.openPrivateChatFromUser).not.toHaveBeenCalled()
})
it.each(['viewer','environment','malformed'] as const)('rejects %s folder scope before the owner read',async failure=>{
 const f=fixture()
 const teamRef=failure==='malformed'?'invalid':await new EncryptedReferenceCodec(async()=> 'fake-workspace-key',()=>new Error('invalid')).seal('team-app-team',{
  viewer:failure==='viewer'?91:90,environment:failure==='environment'?'prod':'test',team_id:'42',
 })
 await expect(f.service.execute('team.app.workspace.request',{request:{operation:'folders',teamRef}})).rejects.toThrow()
 expect(f.paths).toEqual([])
})
