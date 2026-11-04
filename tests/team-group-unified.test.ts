import {expect,it,vi} from 'vitest'
import {SourceService,type GroupDelegation} from '../src/services/source-service.js'
import {UnifiedChatTimelineService} from '../src/services/unified-chat-timeline-service.js'
import {CHAT_TIMELINE_SOURCES} from '../src/unified-chat-timeline.js'
import {ArkmePluginError} from '../src/services/service.js'

it('isolates committed windows/cursors by team generation and checks current access before reading cached content',async()=>{
  let revoked=false,ticket=0
  const session={userId:90,accessToken:'fake',refreshToken:'fake-refresh'},store=new Map<string,unknown>(),commands:Record<string,unknown>[]=[]
  const delegation:GroupDelegation={accessRef:'team-A-ref',teamId:'42',membershipKind:'member',membershipRevision:7,groupMembershipUid:'epoch-A',groupMembershipRevision:1,visibleFromSeq:10}
  const post=vi.fn(async(path,body,_session,_signal,options)=>{
    expect(options.chatAccessRef).toBeDefined()
    if(path.endsWith('/team-group/access')) {
      if(revoked)throw new ArkmePluginError('team_group_forbidden','团队资格已撤销',false,403)
      const a=options.chatAccessRef==='team-A-ref'
      return {state:'ready',access_kind:'team_delegation',representation:{group_membership_uid:a?'epoch-A':'epoch-B',group_membership_revision:1}}
    }
    expect(path).toBe('/api/v1/chat/timeline/unified/v3')
    return {protocol_version:3,chat_session_uid:body.chat_session_uid,timeline_items:[{event_id:'team-group:notice',kind:'team_membership',source:'team_membership',occurred_at:100,order_tie:'team-group:notice',content_status:'available',payload:{chat_session_uid:'group',team_name:'接待',kind:'joined'}}],sources:CHAT_TIMELINE_SOURCES.map(source=>({source,status:source==='team_membership'?'ready':'not_applicable',item_count:source==='team_membership'?1:0})),complete:true,window_token:'window',older_cursor:'older',has_more:false,older_has_more:false,newer_has_more:false}
  })
  const runtime={requireSession:async()=>session,config:{environment:'test',fileStateDirectory:'virtual'},stateStore:{uniqueCode:async()=> 'fake-key'},authenticatedChatPost:post}
  const source=new SourceService(runtime as never,{} as never,{} as never)
  const a=await source.sealSourceRef(90,'group_chat','group','客户群',{groupDelegation:delegation})
  const b=await source.sealSourceRef(90,'group_chat','group','客户群',{groupDelegation:{...delegation,accessRef:'team-B-ref',teamId:'43',groupMembershipUid:'epoch-B'}})
  const cache={isClosed:false,close(){},async call(c:Record<string,unknown>){commands.push(c);const key=`${c.scope}:${c.request}`;if(c.kind==='reserve')return ++ticket;if(c.kind==='write'){store.set(key,c.page);return true}if(c.kind==='read')return store.get(key);return undefined}}
  const service=new UnifiedChatTimelineService(runtime as never,source,{projectChatTimelineItems:async()=>[]} as never,{} as never,()=>cache as never)
  try {
    const first=await service.read(a),second=await service.read(b)
    expect(first.unified!.events[0]).toMatchObject({kind:'notice',text:'接待团队加入了群聊'})
    expect(first.unified!.events[0]!.eventId).toBe(second.unified!.events[0]!.eventId)
    expect(first.source.sourceKey).not.toBe(second.source.sourceKey)
    expect(new Set(commands.filter(c=>c.kind==='write').map(c=>c.scope)).size).toBe(2)
    const canonical=await source.chatDirectorySourceKey(90,'group')
    expect(service.audienceAliases(canonical)).toEqual(expect.arrayContaining([first.source.sourceKey,second.source.sourceKey]))
    await expect(service.read(b,{mode:'older',cursor:first.unified!.olderCursor!})).rejects.toThrow()
    expect((await service.read(a,{cacheOnly:true})).unified!.events).toEqual(first.unified!.events)
    const reads=commands.filter(c=>c.kind==='read').length
    revoked=true
    await expect(service.read(a,{cacheOnly:true})).rejects.toThrow('资格已撤销')
    expect(commands.filter(c=>c.kind==='read')).toHaveLength(reads)
  } finally {service.dispose()}
})
