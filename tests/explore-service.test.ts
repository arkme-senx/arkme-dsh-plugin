import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExploreService } from '../src/services/explore-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { ExploreModule } from '../src/explore-contract.js'
import { profileProgress } from '../src/services/explore-projection.js'

const disposers:Array<()=>void>=[]
afterEach(()=>disposers.splice(0).forEach(fn=>fn()))
function fixture(){
  let user=11,epochCallback=()=>{}
  const writes:Array<{path:string;body:Record<string,unknown>}>=[],calls:Array<{path:string;body:Record<string,unknown>}>=[]
  const state={analysisEnabled:true,capabilityFailure:false,version:'v1',factValue:'喜欢散步',factDeleted:false,failWrite:false,available:true,progress:'paused',afterRead:()=>{},entities:Array.from({length:65},(_,i)=>({entity_id:`private-person-${i}`,name:`人物 ${i}`,linked_user_id:i===0?27:0,type:i<60?1:2,mention_count:2,last_mention_at:1000,ai_summary:'有依据的摘要'}))}
  const fact=()=>({fact_key:'private-fact',predicate_label:'偏好',value:state.factValue,state:'active',support_count:1,evidence:[{record_uid:'private-record',event_at:1000,speaker_role:'self'}]})
  const home=()=>({activated:true,state:'processing',snapshot:{snapshot_id:state.version,sections:[{section_id:'identity',title:'我是谁',total_count:state.factDeleted?0:1}]},processing:{phase:state.progress,rebuild_run_id:'private-run',can_resume:state.progress==='paused',can_pause:state.progress==='running',planning_complete:true,processed_units:5,total_units:10},sources:[{source:'personal_record',display_name:'个人记录',enabled:true},{source:'native_chat',display_name:'聊天',enabled:false},{source:'wechat_import',display_name:'微信导入',enabled:true}]})
  const anniversary=()=>({id:'private-anniversary',title:'生日',status:'pending',calendar_type:'solar',date_label:'10月28日',why:'明确提到日期',evidences:[{message_id:'private-message',content:'10月28日',source_type:6,owner_ref:{provider:'audio',container_id:'private-audio'},is_anchor:true}]})
  const send=async(path:string,body:Record<string,unknown>={})=>{
    calls.push({path,body});state.afterRead()
    if(path.endsWith('/capabilities/query')) {
      if(state.capabilityFailure)throw new Error('设置暂不可用')
      return ['personal_profile','goal_insight'].map(key=>({key,title:key,enabled:state.analysisEnabled,version:1,enabled_at:1}))
    }
    if(path.includes('/override')||path.endsWith('/follow')||path.endsWith('/delete')||path.endsWith('/activate')||path.endsWith('/resume')||path.endsWith('/pause')||path.endsWith('/set')||path.endsWith('/reclassify')){
      if(state.failWrite)throw new Error('服务暂不可用')
      writes.push({path,body})
      if(path.endsWith('/override')){if(body.action==='delete')state.factDeleted=true;else state.factValue=String(body.value)}
      return {}
    }
    if(path.endsWith('/experience/home'))return home()
    if(path.endsWith('/section/get'))return {snapshot_id:state.version,items:state.factDeleted?[]:[fact()],has_more:false}
    if(path.startsWith('/api/v1/relation/list'))return {entities:state.entities,private_chats:[]}
    if(path.endsWith('/detail-full'))return state.entities.find(x=>x.entity_id===body.entity_id)!
    if(path.endsWith('/entity/records/list'))return {records:[{record_uid:'private-record',content:'来源文字',created_at:1000,sender_is_self:true}],has_more:false,total:1}
    if(path.endsWith('/event/stream'))return {items:[{event_record_id:'private-event-record',event_id:'study',event_name:'学习',summary:'学习了新内容',occurred_at:1000}],total:1,user_progress:{active:false,can_trigger:true}}
    if(path.endsWith('/event/plaza'))return {all:[{event_id:'study',event_name:'学习'},{event_id:'exercise',event_name:'运动'}]}
    if(path.endsWith('/event/detail'))return {event_id:'study',event_name:'学习',records:[{event_record_id:'private-event-record',source_record_uid:'private-record',summary:'事件整理',occurred_at:1000,fields:{reflection:'新的思考'}}]}
    if(path.endsWith('/goal/list'))return {snapshot:{result_version:state.version},items:[{goal_id:'private-goal',title:'学习吉他',latest_update_summary:'每天练习'}],total:1,has_more:false}
    if(path.endsWith('/goal/detail'))return {snapshot:{result_version:state.version},item:{goal_id:'private-goal',title:'学习吉他',records:[{record_uid:'private-record',text:'每天练习'}]}}
    if(path.endsWith('/anniversary/home'))return {result_version:state.version,saved_anniversaries:[],pending_ai_discoveries:[anniversary()],material_coverage:{audio_unavailable_count:2}}
    if(path.endsWith('/evidence/open'))return {available:state.available,owner_ref:{provider:'audio',container_id:'private-audio',transcript_source:'doubao'}}
    if(path.endsWith('/section-summary'))return {sections:[]}
    if(path.endsWith('/model/list')||path.endsWith('/event-model/list'))return {effective_route_key:'private-model-a',items:[{route_key:'private-model-a',display_name:'模型 A'},{route_key:'private-model-b',display_name:'模型 B'}]}
    if(path.endsWith('/records/detail'))return {record_core:{record_uid:'private-record',status:1,content_access_state:1,origin_kind:1}}
    return {}
  }
  const runtime={config:{environment:'prod'},stateStore:{uniqueCode:async()=>'explore-test-seed'},requireSession:async()=>({userId:user,accessToken:'test',refreshToken:'test'}),subscribeAccountScope:(fn:()=>void)=>{epochCallback=fn;return()=>{}},authenticatedMemoryCorePost:send,authenticatedRelationGet:send,authenticatedRelationPost:send,authenticatedDataPost:send,authenticatedIntelligentPost:send,authenticatedPost:send} as unknown as ServiceRuntime
  const recording={exploreRecordingEvidence:vi.fn(async()=>({kind:'recording' as const,dateStamp:1000,focusItemId:'row',items:[]}))}
  const records={personalRecordDetail:vi.fn(async()=>({itemUid:'private-record',textContent:'当前原文'}))}
  const sources={privateRemarksByUserIds:vi.fn(async()=>new Map([[27,'同事备注']])),searchTargetSource:vi.fn()}
  const privacy={lockedRecordUids:vi.fn(async()=>new Set<string>())}
  const service=new ExploreService(runtime,recording,records as never,sources,privacy)
  disposers.push(()=>service.dispose())
  return {service,state,writes,calls,recording,records,privacy,switchAccount:()=>{user=22;epochCallback()}}
}
describe('Explore domain migration',()=>{
  it.each<ExploreModule>(['profile','relations','events','goals','anniversaries'])('loads actual-shaped %s contracts and opens its detail without leaking owner refs',async module=>{
    const f=fixture(),page=await f.service.page({module})
    expect(page.items.length).toBeGreaterThan(0)
    expect(JSON.stringify(page)).not.toMatch(/private-person|private-fact|private-goal|private-run|private-anniversary|private-record/)
    const detail=await f.service.detail(page.items[0]!.ref)
    expect(detail.item.title).toBeTruthy();expect(detail.evidence).toHaveLength(1)
    expect(detail.evidence[0]?.ref).toBeTruthy()
    expect(f.writes).toHaveLength(0)
  })
  it('paginates the legacy full relation response before rendering and uses remarks',async()=>{
    const f=fixture(),a=await f.service.page({module:'relations',filter:'1'})
    expect(a.total).toBe(60);expect(a.items).toHaveLength(50);expect(a.items[0]?.title).toBe('人物 0');expect(a.items[0]?.linkedContactName).toBe('同事备注')
    const b=await f.service.page({module:'relations',filter:'1',cursor:a.nextCursor!})
    expect(b.items).toHaveLength(10);expect(b.nextCursor).toBeUndefined()
    expect(new Set([...a.items,...b.items].map(x=>x.key)).size).toBe(60)
    await expect(f.service.page({module:'relations',filter:'2',cursor:a.nextCursor!})).rejects.toThrow()
  })
  it('rejects a changed relation snapshot between pages instead of mixing counts',async()=>{
    const f=fixture(),a=await f.service.page({module:'relations'})
    f.state.entities.unshift({...f.state.entities[0]!,entity_id:'private-new-person'})
    await expect(f.service.page({module:'relations',cursor:a.nextCursor!})).rejects.toThrow()
  })
  it('searches the linked contact remark without replacing an entity identity',async()=>{
    const f=fixture(),page=await f.service.page({module:'relations',query:'同事备注'})
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({title:'人物 0',linkedContactName:'同事备注'})
  })
  it('reclassifies using the owner catalog, including categories without loaded occurrences',async()=>{
    const f=fixture(),page=await f.service.page({module:'events'}),detail=await f.service.detail(page.items[0]!.ref)
    expect(detail.reclassifyTargets?.map(x=>x.label)).toEqual(['运动'])
    await f.service.mutate({ref:page.items[0]!.ref,action:'reclassify',targetRef:detail.reclassifyTargets![0]!.ref})
    expect(f.writes.at(-1)?.body).toEqual({event_record_id:'private-event-record',source_event_id:'study',target_event_id:'exercise'})
    await expect(f.service.mutate({ref:page.items[0]!.ref,action:'reclassify',targetRef:page.items[0]!.ref})).rejects.toThrow()
  })
  it('keeps paused processing distinct from active processing',()=>{
    expect(profileProgress({processing:{phase:'paused',processed_units:5,total_units:10,planning_complete:true}})).toMatchObject({active:false,label:'整理已暂停',completed:5,total:10})
  })
  it('saves a profile correction and rereads it after reopening the page',async()=>{
    const f=fixture(),a=await f.service.page({module:'profile'}),ref=a.items[0]!.ref
    await f.service.mutate({ref,action:'correct',value:'喜欢骑行'})
    const b=await f.service.page({module:'profile'})
    expect((await f.service.detail(b.items[0]!.ref)).item.summary).toBe('喜欢骑行')
    expect(f.writes[0]).toMatchObject({body:{fact_key:'private-fact',action:'correct',value:'喜欢骑行'}})
  })
  it('does not turn a failed write into a saved or removed result',async()=>{
    const f=fixture(),a=await f.service.page({module:'profile'});f.state.failWrite=true
    await expect(f.service.mutate({ref:a.items[0]!.ref,action:'delete'})).rejects.toThrow('服务暂不可用')
    expect((await f.service.page({module:'profile'})).items).toHaveLength(1)
  })
  it('rejects stale profile snapshots before writing a correction',async()=>{
    const f=fixture(),a=await f.service.page({module:'profile'});f.state.version='v2'
    await expect(f.service.mutate({ref:a.items[0]!.ref,action:'correct',value:'修改'})).rejects.toThrow()
    expect(f.writes).toHaveLength(0)
  })
  it('rejects cross-account and tampered references',async()=>{
    const f=fixture(),a=await f.service.page({module:'goals'}),ref=a.items[0]!.ref
    await expect(f.service.detail(ref+'x')).rejects.toThrow()
    f.switchAccount();await expect(f.service.detail(ref)).rejects.toThrow()
    await expect(f.service.mutate({ref,action:'delete'})).rejects.toThrow()
  })
  it('drops a result when the account changes during its owner read',async()=>{
    const f=fixture();f.state.afterRead=()=>{f.state.afterRead=()=>{};f.switchAccount()}
    await expect(f.service.page({module:'goals'})).rejects.toThrow()
  })
  it('uses the anniversary evidence owner before opening the exact ASR source',async()=>{
    const f=fixture(),a=await f.service.page({module:'anniversaries'}),d=await f.service.detail(a.items[0]!.ref)
    expect(await f.service.source(d.evidence[0]!.ref!)).toMatchObject({kind:'recording'})
    expect(f.recording.exploreRecordingEvidence).toHaveBeenCalledWith(expect.objectContaining({transcript_source:'doubao'}),'10月28日',undefined)
    f.state.available=false
    await expect(f.service.source(d.evidence[0]!.ref!)).rejects.toThrow()
    expect(f.recording.exploreRecordingEvidence).toHaveBeenCalledTimes(1)
  })
  it('checks current source privacy and never uses an inferred timestamp fallback',async()=>{
    const f=fixture(),a=await f.service.page({module:'goals'}),d=await f.service.detail(a.items[0]!.ref)
    f.privacy.lockedRecordUids.mockResolvedValue(new Set(['private-record']))
    await expect(f.service.source(d.evidence[0]!.ref!)).rejects.toThrow()
    expect(f.records.personalRecordDetail).not.toHaveBeenCalled()
  })
  it('validates calendar dates before any anniversary confirmation write',async()=>{
    const f=fixture(),a=await f.service.page({module:'anniversaries'}),ref=a.items[0]!.ref
    await expect(f.service.mutate({ref,action:'confirm',title:'生日',calendarType:'solar',year:2026,month:2,day:30})).rejects.toThrow()
    expect(f.writes).toHaveLength(0)
    await f.service.mutate({ref,action:'confirm',title:'生日',calendarType:'lunar',year:0,month:6,day:15,leapMonth:true})
    expect(f.writes[0]).toMatchObject({body:{candidate_id:'private-anniversary',calendar_type:'lunar',is_lunar_leap_month:true}})
  })
  it('keeps fixed-model settings limited to supported profile sources',async()=>{
    const f=fixture(),a=await f.service.settings('profile')
    expect(a.models).toEqual([])
    expect(a.sources.map(x=>x.key)).toEqual(['personal_record','native_chat'])
    expect(f.calls.some(x=>x.path.includes('/model/'))).toBe(false)
    const eventModels=await f.service.settings('events')
    await expect(f.service.saveSettings({ref:a.ref,modelRef:eventModels.models[0]!.ref})).rejects.toThrow()
    await expect(f.service.saveSettings({ref:a.ref,sources:['wechat_import']})).rejects.toThrow()
    await expect(f.service.saveSettings({ref:a.ref,sources:['unknown']})).rejects.toThrow()
    await f.service.saveSettings({ref:a.ref,sources:['personal_record','native_chat']})
    expect(f.writes.at(-1)?.body).toEqual({sources:['personal_record','native_chat']})
  })
})

describe('Explore automatic AI authorization',()=>{
  it.each(['profile','goals'] as const)('keeps saved %s readable while disabled or settings are unavailable',async module=>{
    const f=fixture();f.state.analysisEnabled=false
    const page=await f.service.page({module})
    expect(page.items).toHaveLength(1);expect(page.analysisEnabled).toBe(false)
    expect(page.actions.some(x=>['activate','resume','refresh'].includes(x.id))).toBe(false)
    expect(page.progress).toBeUndefined();expect(f.writes).toHaveLength(0)
    f.state.capabilityFailure=true
    const unavailable=await f.service.page({module})
    expect(unavailable.items).toHaveLength(1);expect(unavailable.analysisEnabled).toBeNull()
    await expect(f.service.mutate({ref:page.contextRef,action:'refresh'})).rejects.toThrow('设置暂不可用')
    expect(f.writes).toHaveLength(0)
  })
  it.each(['activate','refresh','resume'] as const)('rechecks permission before %s and never changes consent',async action=>{
    const f=fixture(),page=await f.service.page({module:'profile'})
    f.state.analysisEnabled=false
    await expect(f.service.mutate({ref:page.contextRef,action})).rejects.toThrow('自动使用额度')
    expect(f.writes).toHaveLength(0)
    expect(f.calls.some(x=>x.path.endsWith('/capabilities/update'))).toBe(false)
  })
  it('resumes the existing run after authorization, while pause remains available after closing',async()=>{
    const f=fixture(),page=await f.service.page({module:'profile'})
    await f.service.mutate({ref:page.contextRef,action:'resume'})
    expect(f.writes).toEqual([{path:'/api/v1/personal-profile/v3/experience/rebuild/resume',body:{run_id:'private-run'}}])
    f.state.analysisEnabled=false;f.state.progress='running'
    await f.service.mutate({ref:page.contextRef,action:'pause'})
    expect(f.writes.at(-1)?.path).toMatch(/rebuild\/pause$/)
  })
  it('does not create a rebuild from source settings while disabled',async()=>{
    const f=fixture(),settings=await f.service.settings('profile');f.state.analysisEnabled=false
    await expect(f.service.saveSettings({ref:settings.ref,sources:['native_chat']})).rejects.toThrow('自动使用额度')
    expect(f.writes).toHaveLength(0)
  })
})
