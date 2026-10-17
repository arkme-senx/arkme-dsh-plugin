import { CapabilityService } from './capability-service.js'
import { mergeExploreEvidence } from '../explore-evidence.js'
import type { ExploreDetailPart, ExploreEnrichment } from '../explore-contract.js'
import { createHmac } from 'node:crypto'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import { EXPLORE_MODULES, type ExploreModule, type ExploreItem, type ExplorePage, type ExploreDetail, type ExploreEvidence, type ExploreQuery, type ExploreMutation, type ExploreSource, type ExploreAction, type ExploreSettings } from '../explore-contract.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { RecordService } from './record-service.js'
import type { RecordingService } from './recording-service.js'
import type { SourceService } from './source-service.js'
import type { ArkmePrivacyVisibilityService } from './privacy-visibility.js'
import { ArkmePluginError, ServiceRuntime } from './service.js'
import { doc, text, number, list, strings, first, bounded, profileProgress, insightProgress, ENTITY_TYPES, type Doc } from './explore-projection.js'

const PREFIX = 'arkme-explore-v1'
const missing = () => new ArkmePluginError('explore-unavailable', '内容已更新或不可访问，请重新打开', true, 409)
const PAGE = 50
const action = (id: ExploreAction['id'], label: string, destructive = false): ExploreAction => ({id,label,...(destructive ? {destructive:true} : {})})

/** Desktop adapter only. Domain services own recognition, canonical identities and saved corrections. */
export class ExploreService {
  private readonly codec: EncryptedReferenceCodec
  private epoch = 0
  private readonly unsubscribe: () => void
  private relationCache: { scope: string; until: number; value: Doc } | undefined
  private remarksCache = new Map<number, { until: number; value: string }>()
  constructor(private readonly runtime: ServiceRuntime,
    private readonly recording: Pick<RecordingService,'exploreRecordingEvidence'>,
    private readonly records: Pick<RecordService,'personalRecordDetail'>,
    private readonly sources: Pick<SourceService,'searchTargetSource'|'privateRemarksByUserIds'>,
    private readonly privacy: Pick<ArkmePrivacyVisibilityService,'lockedRecordUids'>) {
    this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), missing)
    this.unsubscribe = runtime.subscribeAccountScope(() => { this.epoch++; this.relationCache = undefined; this.remarksCache.clear() })
  }
  dispose(): void { this.epoch++; this.relationCache = undefined; this.remarksCache.clear(); this.unsubscribe() }
  private async guard(session: ArkmeSessionCredentials, epoch: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (epoch !== this.epoch || (await this.runtime.requireSession()).userId !== session.userId) throw missing()
  }
  private async seal(session: ArkmeSessionCredentials, value: Doc): Promise<string> {
    return this.codec.seal(PREFIX,{...value, viewer:session.userId, environment:this.runtime.config.environment, expires:Date.now()+86400_000})
  }
  private async open(value: unknown, session: ArkmeSessionCredentials, kind: string): Promise<Doc> {
    const ref = await this.codec.open(PREFIX,bounded(value,16384,true))
    if (ref.kind !== kind || ref.viewer !== session.userId || ref.environment !== this.runtime.config.environment || number(ref.expires) < Date.now()) throw missing()
    return ref
  }
  private module(value: unknown): ExploreModule {
    if (!EXPLORE_MODULES.includes(value as ExploreModule)) throw missing()
    return value as ExploreModule
  }
  private async key(session: ArkmeSessionCredentials, ...values: unknown[]): Promise<string> {
    return createHmac('sha256',await this.runtime.stateStore.uniqueCode()).update(JSON.stringify([session.userId,...values])).digest('hex')
  }
  private async request(module: ExploreModule, path: string, body: Doc, session: ArkmeSessionCredentials, signal?: AbortSignal, write = false): Promise<Doc> {
    if (module === 'profile') return this.runtime.authenticatedMemoryCorePost<Doc>(path,body,session,signal,write)
    const options = {lane:write ? 'write' as const : 'interactive-read' as const,bypassCache:true,cacheMs:0}
    if (module === 'relations') return this.runtime.authenticatedRelationPost<Doc>(path,body,session,signal,options)
    if (module === 'events') return this.runtime.authenticatedDataPost<Doc>(path,body,session,signal,options)
    return this.runtime.authenticatedIntelligentPost<Doc>(path,body,session,signal,options)
  }
  private home(module: ExploreModule, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<Doc> {
    if (module === 'profile') return this.request(module,'/api/v1/personal-profile/v3/experience/home',{},session,signal)
    return this.request(module,'/api/v1/insight/anniversary/home',{source_type:0},session,signal)
  }
  private async analysisEnabled(module: ExploreModule, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<boolean> {
    const result = await new CapabilityService(this.runtime).query(`${this.runtime.config.environment}:${session.userId}`, signal)
    const setting = result.settings.find(x => x.key === (module === 'profile' ? 'personal_profile' : 'goal_insight'))
    if (!setting) throw new ArkmePluginError('capability-contract-invalid', '暂时无法确认额度设置，请重试', true, 502)
    return setting.enabled
  }
  private async requireAnalysis(module: ExploreModule, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<void> {
    if (!await this.analysisEnabled(module, session, signal)) throw new ArkmePluginError('capability-disabled', '请先在「自动使用额度」中开启此功能', false, 409)
  }
  private async relationHome(session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<Doc> {
    const scope = `${this.runtime.config.environment}:${session.userId}`, epoch = this.epoch
    if (this.relationCache?.scope === scope && this.relationCache.until > Date.now()) return this.relationCache.value
    const value = await this.runtime.authenticatedRelationGet<Doc>('/api/v1/relation/list?limit=10000&offset=0',session,signal)
    await this.guard(session,epoch,signal)
    this.relationCache = {scope,until:Date.now()+30_000,value}; return value
  }
  private cachedRelation(session: ArkmeSessionCredentials, id: unknown): Doc {
    if (this.relationCache?.scope !== `${this.runtime.config.environment}:${session.userId}`) return {}
    return list(this.relationCache.value.entities).find(x => x.entity_id === id) ?? {}
  }
  async personEntries(signal?: AbortSignal) {
    const session = await this.runtime.requireSession(), epoch = this.epoch
    const rows = list((await this.relationHome(session, signal)).entities).filter(row => number(row.type) === 1)
    const result = await Promise.all(rows.map(async row => ({ entityId: text(row.entity_id), linkedUserId: number(row.linked_user_id), aliases: strings(row.aliases),
      item: await this.item('relations', row, session, { linkedUserId: number(row.linked_user_id) }) })))
    await this.guard(session, epoch, signal)
    return result
  }
  private async relationRemarks(ids: number[], session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<Map<number,string>> {
    const epoch=this.epoch
    const missingIds=[...new Set(ids)].filter(id=>id>0&&id!==session.userId&&(this.remarksCache.get(id)?.until??0)<Date.now())
    if(missingIds.length) {
      const remarks=await this.sources.privateRemarksByUserIds(missingIds,{...(signal?{signal}:{})})
      await this.guard(session,epoch,signal)
      for(const id of missingIds)this.remarksCache.set(id,{until:Date.now()+120_000,value:remarks.get(id)??''})
    }
    return new Map(ids.map(id=>[id,this.remarksCache.get(id)?.value??'']))
  }
  async enrich(refs: unknown, signal?: AbortSignal): Promise<ExploreEnrichment> {
    if(!Array.isArray(refs)||refs.length>50)throw missing()
    const session=await this.runtime.requireSession(),epoch=this.epoch
    const items=await Promise.all(refs.map(async value=>{
      const ref=await this.open(value,session,'item');if(ref.module!=='relations')throw missing()
      return {id:ref.id,linked:number(ref.linkedUserId)}
    }))
    const remarks=await this.relationRemarks(items.map(x=>x.linked),session,signal)
    const result={items:await Promise.all(items.map(async x=>({key:await this.key(session,'relations',x.id),linkedContactName:remarks.get(x.linked)??''})))}
    await this.guard(session,epoch,signal);return result
  }
  private async item(module: ExploreModule, raw: Doc, session: ArkmeSessionCredentials, extra: Doc = {}): Promise<ExploreItem> {
    const id = first(raw.fact_key,raw.entity_id,raw.event_record_id,raw.goal_id,raw.id)
    if (!id) throw missing()
    const title = first(raw.predicate_label,raw.name,raw.title,doc(raw.summary_fields).title,doc(raw.fields).title,raw.event_name,'未命名')
    const summary = first(raw.value,raw.ai_summary,raw.latest_update_summary,raw.summary,raw.why)
    return {key:await this.key(session,module,id),ref:await this.seal(session,{kind:'item',module,id,...extra}),title,summary,
      category: module === 'relations' ? ENTITY_TYPES[number(raw.type)] ?? '其他' : first(raw.event_name,raw.type_label,raw.predicate_label),
      status: first(raw.status_label,module === 'anniversaries' ? raw.status === 'pending' ? '待确认' : '已确认' : undefined,raw.state === 'pending_confirm' ? '待确认' : undefined),
      date:number(raw.last_mention_at || raw.occurred_at || raw.latest_activity_at),
      ...(module === 'anniversaries' && raw.date_label ? {dateLabel:text(raw.date_label)} : {}),
      ...(module === 'relations' ? {count:number(raw.mention_count)} : {}),
      ...(module === 'relations' && raw.linked_contact_name ? {linkedContactName:text(raw.linked_contact_name)} : {}),
    }
  }
  async page(input: ExploreQuery, signal?: AbortSignal): Promise<ExplorePage> {
    const module = this.module(input.module), session = await this.runtime.requireSession(), epoch = this.epoch
    const filter = bounded(input.filter ?? '',100), query = bounded(input.query ?? '',200)
    const cursor = input.cursor ? await this.open(input.cursor,session,'cursor') : {}
    if (input.cursor && (cursor.module !== module || cursor.filter !== filter || cursor.query !== query)) throw missing()
    const offset = number(cursor.offset)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw missing()
    const page: ExplorePage = {module,items:[],filters:[],total:0,contextRef:'',actions:[]}
    let next: Doc | undefined, context: Doc = {}
    if (module === 'profile') {
      const home = await this.home(module,session,signal), snapshot = doc(home.snapshot), version = text(snapshot.snapshot_id)
      const sections = list(snapshot.sections).length ? list(snapshot.sections) : list(home.section_catalog)
      const section = sections.find(s => s.section_id === filter) ?? sections[0]
      page.filters = sections.map(s => ({key:text(s.section_id),label:text(s.title),count:number(s.total_count)}))
      const progress = profileProgress(home); if (progress) page.progress = progress
      const processing = doc(home.processing)
      page.actions = home.activated !== true ? [action('activate','开始整理')] : processing.can_resume === true ? [action('resume','继续整理')] : processing.can_pause === true ? [action('pause','暂停整理')] : processing.phase ? [] : [action('refresh','重新整理')]
      context = {version}
      page.emptyMessage = processing.phase === 'paused' ? '这一分类还没有整理结果。可在右上角继续已暂停的整理。' : '这一分类暂时没有内容。'
      if (version && section && number(section.total_count) > 0) {
        if (cursor.version && cursor.version !== version) throw missing()
        const raw = await this.request(module,'/api/v1/personal-profile/v3/section/get',{snapshot_id:version,section_id:section.section_id,page:Math.floor(offset/PAGE)+1,page_size:PAGE},session,signal)
        if (raw.snapshot_id !== version) throw missing()
        page.items = await Promise.all(list(raw.items).map(x => this.item(module,x,session,{version,section:section.section_id,page:Math.floor(offset/PAGE)+1})))
        page.total = number(section.total_count)
        if (raw.has_more === true) next={offset:offset+PAGE,version}
      }
      page.notice = '当前分析范围：'+list(home.sources).filter(x=>x.enabled===true).map(x=>text(x.display_name)).join('、')
    } else if (module === 'relations') {
      const raw = await this.relationHome(session,signal)
      const all = list(raw.entities), counts = new Map<number,number>()
      all.forEach(x => counts.set(number(x.type),(counts.get(number(x.type)) ?? 0)+1))
      page.filters = [{key:'',label:'全部',count:all.length},...Object.entries(ENTITY_TYPES).filter(([k]) => counts.has(Number(k))).map(([k,label])=>({key:k,label,count:counts.get(Number(k))!}))]
      // Preserve global remark search, but never block the ordinary list on optional contact reads.
      const remarks = query ? await this.relationRemarks(all.map(x=>number(x.linked_user_id)),session,signal)
        : new Map(all.map(x=>{const id=number(x.linked_user_id);return [id,this.remarksCache.get(id)?.value??''] as const}))
      const rows = all.filter(x => (!filter || number(x.type) === Number(filter)) && (!query || [text(x.name),remarks.get(number(x.linked_user_id))??'',...strings(x.aliases)].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())))
      const version = await this.key(session,rows.map(x=>[x.entity_id,x.last_mention_at,x.mention_count,x.name]))
      if (cursor.version && cursor.version !== version) throw missing()
      const selected = rows.slice(offset,offset+PAGE)
      page.items = await Promise.all(selected.map(x => this.item(module,{...x,linked_contact_name:remarks.get(number(x.linked_user_id))},session,{linkedUserId:number(x.linked_user_id)})))
      page.needsEnrichment=selected.some(x=>number(x.linked_user_id)>0&&(this.remarksCache.get(number(x.linked_user_id))?.until??0)<Date.now())
      page.total = rows.length
      if (offset+PAGE < rows.length) next={offset:offset+PAGE,version}
    } else if (module === 'events') {
      const raw = await this.request(module,'/api/v1/event/stream',{filter:'all',scope:'all',limit:PAGE,offset},session,signal)
      page.items = await Promise.all(list(raw.items).map(x=>this.item(module,x,session,{eventId:text(x.event_id)})))
      page.total = number(raw.total)
      if (raw.has_more === true && number(raw.next_offset)>offset) next={offset:number(raw.next_offset)}
      const progress = doc(raw.user_progress)
      if (progress.active === true) page.progress={label:'正在整理事件',active:true,updatedAt:0,completed:number(progress.processed_count),total:number(progress.total_count)}
      page.actions=[action('create','创建事件'),...(progress.can_trigger === true ? [action('refresh','整理事件')] : [])]
    } else if (module === 'goals') {
      const raw = await this.request(module,'/api/v1/insight/goal/list',{view:'full',limit:PAGE,offset,...(cursor.version ? {result_version:cursor.version} : {})},session,signal)
      const version=text(doc(raw.snapshot).result_version)
      if (cursor.version && cursor.version !== version) throw missing()
      page.items=await Promise.all(list(raw.items).map(x=>this.item(module,x,session,{version})))
      page.total=number(raw.total); context={version}
      if(raw.has_more===true && number(raw.next_offset)>offset) next={offset:number(raw.next_offset),version}
      page.actions=[action('refresh','重新分析')]
      page.notice='根据已有记录整理的目标与进展。'
    } else {
      const raw=await this.home(module,session,signal),version=first(raw.result_version,doc(raw.snapshot).result_version)
      const saved=list(raw.saved_anniversaries),pending=list(raw.pending_ai_discoveries)
      page.filters=[{key:'',label:'全部',count:saved.length+pending.length},{key:'saved',label:'已确认',count:saved.length},{key:'pending',label:'待确认',count:pending.length}]
      const rows=filter==='saved' ? saved : filter==='pending' ? pending : [...saved,...pending]
      page.items=await Promise.all(rows.map(x=>this.item(module,{...x,status:pending.includes(x)?'pending':'saved'},session,{version})))
      page.total=rows.length; context={version};page.actions=[action('refresh','重新分析')]
      const unavailable=number(doc(raw.material_coverage).audio_unavailable_count)
      if(unavailable) page.notice=`有 ${unavailable} 份录音尚未具备可分析内容，当前结果保留。`
    }
    if(module==='goals'||module==='anniversaries') {
      try {
        const raw=await this.request(module,'/api/v1/insight/section-summary',{section_types:[module==='goals'?3:4]},session,signal)
        const progress=insightProgress(list(raw.sections)[0]??{})
        if(progress){page.progress=progress;if(progress.active)page.actions=[action('stop','停止本次分析')]}
      } catch(error) { signal?.throwIfAborted(); page.notice=[page.notice,'分析进度暂不可用，已有结果仍可查看。'].filter(Boolean).join(' ');page.actions=[] }
    }
    if (module === 'profile' || module === 'goals') {
      try { page.analysisEnabled = await this.analysisEnabled(module, session, signal) }
      catch { signal?.throwIfAborted(); page.analysisEnabled = null }
      if (page.analysisEnabled !== true) {
        // Reading saved results must not depend on optional billing settings.
        page.actions = page.actions.filter(x => x.id === 'pause' || x.id === 'stop')
        delete page.progress
        page.emptyMessage = '还没有相关内容'
      }
    }
    page.contextRef=await this.seal(session,{kind:'context',module,...context})
    if(next)page.nextCursor=await this.seal(session,{kind:'cursor',module,filter,query,...next})
    await this.guard(session,epoch,signal);return page
  }
  private async evidence(module: ExploreModule, rows: Doc[], session: ArkmeSessionCredentials, parent: Doc): Promise<ExploreEvidence[]> {
    const result = await Promise.all(rows.map(async (row,index)=>{
      const owner=doc(row.owner_ref),fields=doc(row.fields)
      const uid=first(row.record_uid,row.source_record_uid,owner.record_uid,strings(fields.record_uids)[0])
      const content=first(row.content,row.text,row.summary,row.value)
      const date=number(row.event_at||row.send_at||row.created_at||row.occurred_at||owner.start_at)
      const canOpen=!!uid || module==='anniversaries' && !!row.message_id
      const identity=module==='relations'&&uid ? [uid,text(row.subject_uid),text(owner.provider)] : [first(row.event_record_id,row.message_id,uid)||`${date}:${number(parent.offset)+index}`]
      const start=number(row.start_position),end=number(row.end_position)
      return {key:await this.key(session,module,parent.id,...identity),label:first(row.source_label,owner.container_title,row.time_label,owner.provider==='audio'?'录音':'来源记录'),
        speaker:first(row.sender_label,row.speaker_name,row.sender_is_self===true||row.speaker_role==='self'?'你':''),text:content,date,anchor:row.is_anchor===true||row.is_primary_anchor===true,
        ...(module==='relations'&&end>start&&start>=0?{mentions:[{start,end,text:text(row.mention_text)}]}:{}),
        ...(canOpen ? {ref:await this.seal(session,{kind:'evidence',module,parentId:parent.id,version:parent.version,uid,messageId:row.message_id,quote:content.slice(0,2000)})} : {unavailableReason:'这条结果尚未提供可定位的原文'})}
    }))
    return module==='relations'?mergeExploreEvidence(result):result
  }
  async detail(itemRef: string, cursorValue?: string, signal?: AbortSignal, part?: ExploreDetailPart): Promise<ExploreDetail> {
    const session=await this.runtime.requireSession(),epoch=this.epoch,ref=await this.open(itemRef,session,'item'),module=this.module(ref.module)
    const cursor=cursorValue?await this.open(cursorValue,session,'detail-cursor'):{}
    if(cursorValue && (cursor.module!==module || cursor.id!==ref.id))throw missing()
    if(part&&module!=='relations')throw missing()
    if(!Number.isSafeInteger(number(cursor.offset))||number(cursor.offset)<0||number(cursor.offset)>100000)throw missing()
    let raw:Doc={},evidence:Doc[]=[],next:Doc|undefined,fields:ExploreDetail['fields']=[],actions:ExploreAction[]=[],notice:string|undefined
    let reclassifyTargets:ExploreDetail['reclassifyTargets']
    if(module==='profile') {
      const page=await this.request(module,'/api/v1/personal-profile/v3/section/get',{snapshot_id:ref.version,section_id:ref.section,page:ref.page,page_size:PAGE},session,signal)
      if(page.snapshot_id!==ref.version)throw missing()
      raw=list(page.items).find(x=>x.fact_key===ref.id)??{};evidence=list(raw.evidence)
      fields=[{label:'整理内容',value:text(raw.value)},{label:'相关人物',value:text(raw.subject_display_name)},{label:'支持依据',value:`${number(raw.support_count)} 条`}]
      actions=[action('correct','纠正内容'),action('delete','删除这条档案',true)]
    } else if(module==='relations') {
      const [entity,records]=await Promise.all([
        part==='records'?Promise.resolve({entity_id:ref.id} as Doc):this.request(module,'/api/v1/entity/detail',{entity_id:ref.id},session,signal),
        part==='overview'?Promise.resolve({} as Doc):this.request(module,'/api/v1/entity/records/list',{entity_id:ref.id,limit:30,offset:number(cursor.offset)},session,signal),
      ])
      raw=Object.keys(doc(entity.entity)).length?doc(entity.entity):entity
      if(raw.entity_id!==ref.id)throw missing()
      const cached=this.cachedRelation(session,ref.id)
      raw={...cached,...raw,linked_contact_name:this.remarksCache.get(number(ref.linkedUserId??cached.linked_user_id))?.value??''}
      evidence=list(records.records);fields=[{label:'关联联系人',value:text(raw.linked_contact_name)},{label:'内容概述',value:text(raw.ai_summary)},{label:'别名',value:strings(raw.aliases).join('、')}]
      if(records.has_more===true && number(records.next_offset)>number(cursor.offset))next={offset:number(records.next_offset)}
      actions=[action('delete','删除识别实体',true)]
      notice='同一实体的来源在这里汇总。涉及的人物身份以已确认的信息为准。'
    } else if(module==='events') {
      const data=await this.request(module,'/api/v1/event/detail',{event_id:ref.eventId,anchor_event_record_id:ref.id,range_key:'all',limit:30,include_aggregate:!cursorValue,...(cursor.cursor?{cursor:cursor.cursor}:{})},session,signal)
      if(data.event_id!==ref.eventId)throw missing()
      const rows=list(data.records),anchor=rows.find(x=>x.event_record_id===ref.id)??rows[0]??{}
      raw={...anchor,event_record_id:ref.id,event_name:data.event_name,is_subscribed:data.is_subscribed}
      fields=Object.entries(doc(anchor.fields)).filter(([key,value])=>typeof value==='string' && !['session_key','occurred_at','source_record_uid','title'].includes(key)).map(([label,value])=>({label:({emotion:'情绪',reflection:'思考',summary:'总结'} as Record<string,string>)[label]??label,value:text(value)}))
      evidence=rows.map(x=>({...x,is_anchor:x.event_record_id===ref.id}))
      if(data.has_more===true&&text(data.next_cursor))next={cursor:data.next_cursor}
      actions=[data.is_subscribed===true?action('unsubscribe','取消关注'):action('subscribe','关注事件'),action('supplement','补充内容'),action('reclassify','调整分类')]
      if(!cursorValue) {
        try {
          const catalog=await this.request(module,'/api/v1/event/plaza',{limit:200,offset:0},session,signal)
          reclassifyTargets=await Promise.all(list(catalog.all).filter(x=>text(x.event_id)&&x.event_id!==ref.eventId).map(async x=>({label:text(x.event_name),ref:await this.seal(session,{kind:'category',module,eventId:x.event_id})})))
        }catch(error){signal?.throwIfAborted();actions=actions.filter(x=>x.id!=='reclassify');notice='分类列表暂不可用，可刷新后再调整分类。'}
      }
    } else if(module==='goals') {
      const data=await this.request(module,'/api/v1/insight/goal/detail',{goal_id:ref.id,result_version:ref.version},session,signal)
      if(ref.version && doc(data.snapshot).result_version!==ref.version)throw missing()
      raw=doc(data.item);if(raw.goal_id!==ref.id)throw missing()
      fields=[...strings(raw.analysis_bullets).map(value=>({label:'目标分析',value})),...list(raw.timeline).map(x=>({label:[text(x.occurred_date),text(x.stage_label),text(x.title)].filter(Boolean).join(' · '),value:text(x.summary)}))]
      evidence=list(raw.records)
      notice='目标内容来自分析结果，可通过来源记录核对。'
    } else {
      const data=await this.request(module,'/api/v1/insight/anniversary/home',{source_type:0,result_version:ref.version},session,signal)
      if(ref.version&&first(data.result_version,doc(data.snapshot).result_version)!==ref.version)throw missing()
      const pending=list(data.pending_ai_discoveries),saved=list(data.saved_anniversaries)
      const found=[...saved,...pending].find(x=>x.id===ref.id);if(!found)throw missing()
      raw={...found,status:pending.includes(found)?'pending':'saved'};evidence=list(raw.evidences)
      fields=[{label:'日期',value:first(raw.date_label,raw.next_occurrence_label)},{label:'距离下一次',value:text(raw.countdown_label)},{label:'识别依据',value:text(raw.why)}]
      actions=[action('confirm',raw.status==='pending'?'确认纪念日':'修改纪念日'),...(raw.status==='pending'?[action('dismiss','忽略这条识别')]:[])]
    }
    if(!Object.keys(raw).length)throw missing()
    const result:ExploreDetail={item:await this.item(module,raw,session,Object.fromEntries(Object.entries(ref).filter(([k])=>!['kind','id','module','viewer','environment','expires'].includes(k)))),fields:fields.filter(x=>x.value),evidence:await this.evidence(module,evidence,session,{...ref,offset:number(cursor.offset)}),actions,...(notice?{notice}:{})}
    // Keep the originally selected identity even when a detail page contains a different chronological anchor.
    result.item.ref=itemRef
    if(reclassifyTargets)result.reclassifyTargets=reclassifyTargets
    if(next)result.nextCursor=await this.seal(session,{kind:'detail-cursor',module,id:ref.id,...next})
    if(module==='anniversaries')result.dateInput={calendarType:raw.calendar_type==='lunar'?'lunar':'solar',year:number(raw.origin_year),month:number(raw.origin_month),day:number(raw.origin_day),leapMonth:raw.is_lunar_leap_month===true}
    await this.guard(session,epoch,signal);return result
  }
  async mutate(input: ExploreMutation, signal?: AbortSignal): Promise<{saved:true}> {
    const session=await this.runtime.requireSession(),epoch=this.epoch
    const raw=await this.codec.open(PREFIX,bounded(input.ref,16384,true)),kind=raw.kind==='context'?'context':'item'
    const ref=await this.open(input.ref,session,kind),module=this.module(ref.module)
    const request=async(path:string,body:Doc)=>{await this.guard(session,epoch,signal);return this.request(module,path,body,session,signal,true)}
    const value=()=>bounded(input.value,10000,true)
    if(module==='profile') {
      if(kind==='item'&&['correct','delete'].includes(input.action)) {
        await this.detail(input.ref,undefined,signal)
        await request('/api/v1/personal-profile/v3/fact/override',{fact_key:ref.id,action:input.action,...(input.action==='correct'?{value:value()}:{})})
      } else if(kind==='context'&&['activate','refresh','pause','resume'].includes(input.action)) {
        if (input.action !== 'pause') await this.requireAnalysis(module,session,signal)
        const current=await this.home(module,session,signal),p=doc(current.processing)
        if(input.action==='pause'||input.action==='resume') {
          if(p[input.action==='pause'?'can_pause':'can_resume']!==true||!p.rebuild_run_id)throw missing()
          await request(`/api/v1/personal-profile/v3/experience/rebuild/${input.action}`,{run_id:p.rebuild_run_id})
        }else await request(`/api/v1/personal-profile/v3/experience/${input.action}`,{})
      }else throw missing()
    } else if(module==='relations'&&kind==='item'&&input.action==='delete') {
      await request('/api/v1/entity/delete',{entity_id:ref.id});this.relationCache=undefined
    } else if(module==='events') {
      if(kind==='item'&&['subscribe','unsubscribe'].includes(input.action))await request(`/api/v1/event/${input.action}`,{event_id:ref.eventId})
      else if(kind==='item'&&input.action==='supplement')await request('/api/v1/event/detail/supplement',{event_id:ref.eventId,content:value(),text:value(),supplement:value()})
      else if(kind==='item'&&input.action==='reclassify') {
        const target=await this.open(input.targetRef,session,'category');if(target.module!=='events'||!target.eventId)throw missing()
        await request('/api/v1/event/record/reclassify',{event_record_id:ref.id,source_event_id:ref.eventId,target_event_id:target.eventId})
      } else if(kind==='context'&&input.action==='create')await request('/api/v1/event/create',{event_name:value(),name:value(),is_subscribed:true,subscribed:true})
      else if(kind==='context'&&input.action==='refresh')await request('/api/v1/event/process/trigger',{force:false})
      else throw missing()
    } else if(kind==='context'&&(module==='goals'||module==='anniversaries')&&['refresh','stop'].includes(input.action)) {
      if (module === 'goals' && input.action === 'refresh') await this.requireAnalysis(module,session,signal)
      await request(input.action==='stop'?'/api/v1/insight/terminate':`/api/v1/insight/${module==='goals'?'goal':'anniversary'}/refresh`,input.action==='stop'?{section_type:module==='goals'?3:4}:{source_type:0})
    } else if(module==='anniversaries'&&kind==='item'&&['confirm','dismiss'].includes(input.action)) {
      await this.detail(input.ref,undefined,signal)
      const body:Doc={candidate_id:ref.id}
      if(input.action==='confirm') {
        body.title=bounded(input.title,200,true)
        if(!['solar','lunar'].includes(String(input.calendarType))||!Number.isInteger(input.month)||!Number.isInteger(input.day)||!Number.isInteger(input.year??0)||number(input.month)<1||number(input.month)>12||number(input.day)<1||number(input.day)>(input.calendarType==='lunar'?30:31)||number(input.year)<0||number(input.year)>9999)throw new ArkmePluginError('explore-date-invalid','请填写有效日期',false,400)
        if(input.calendarType==='solar'&&new Date(number(input.year)||2000,number(input.month)-1,number(input.day)).getMonth()!==number(input.month)-1)throw new ArkmePluginError('explore-date-invalid','请填写有效日期',false,400)
        Object.assign(body,{calendar_type:input.calendarType,origin_year:input.year??0,origin_month:input.month,origin_day:input.day,is_lunar_leap_month:input.calendarType==='lunar'&&input.leapMonth===true})
      }
      await request(`/api/v1/insight/anniversary/${input.action==='confirm'?'follow':'dismiss'}`,body)
    }else throw missing()
    await this.guard(session,epoch,signal);return {saved:true}
  }
  async settings(moduleValue: unknown, signal?: AbortSignal): Promise<ExploreSettings> {
    const module=this.module(moduleValue),session=await this.runtime.requireSession(),epoch=this.epoch
    if(module==='relations'||module==='goals')throw missing()
    if(module==='profile') {
      const home=await this.home(module,session,signal)
      const result:ExploreSettings={ref:await this.seal(session,{kind:'settings',module}),models:[],sources:list(home.sources).filter(x=>x.source!=='wechat_import').map(x=>({key:text(x.source),label:text(x.display_name),description:text(x.description),enabled:x.enabled===true}))}
      await this.guard(session,epoch,signal);return result
    }
    const path=module==='events'?'/api/v1/event-model/list':'/api/v1/insight/model-panel/get'
    const raw=await this.runtime.authenticatedIntelligentPost<Doc>(path,module==='anniversaries'?{section_type:4,source_type:0,history_limit:20}:{},session,signal,{lane:'interactive-read',bypassCache:true,cacheMs:0})
    const config=module==='anniversaries'?doc(raw.config):raw,current=first(config.effective_route_key,config.current_route_key,config.active_route_key)
    const options=list(config.items??config.allowed_route_options)
    const result:ExploreSettings={ref:await this.seal(session,{kind:'settings',module}),
      models:await Promise.all(options.map(x=>this.seal(session,{kind:'model',module,route:text(x.route_key)}).then(ref=>({ref,label:first(x.display_name,x.model_key),selected:x.route_key===current})))),
      sources:[]}
    await this.guard(session,epoch,signal);return result
  }
  async saveSettings(input: Doc, signal?: AbortSignal): Promise<{saved:true}> {
    const session=await this.runtime.requireSession(),epoch=this.epoch,ref=await this.open(input.ref,session,'settings'),module=this.module(ref.module)
    if(input.modelRef && input.sources!==undefined)throw missing()
    if(input.modelRef) {
      if(module==='profile'||module==='goals')throw missing()
      const model=await this.open(input.modelRef,session,'model');if(model.module!==module)throw missing()
      const current=await this.settings(module,signal)
      const available=await Promise.all(current.models.map(x=>this.open(x.ref,session,'model')))
      if(!available.some(x=>x.route===model.route))throw missing()
      const path=module==='events'?'/api/v1/event-model/activate':'/api/v1/insight/anniversary/model/activate'
      await this.guard(session,epoch,signal)
      await this.runtime.authenticatedIntelligentPost(path,{route_key:model.route},session,signal,{lane:'write',bypassCache:true,cacheMs:0})
    } else if(module==='profile'&&Array.isArray(input.sources)) {
      await this.requireAnalysis(module,session,signal)
      const home=await this.home(module,session,signal),allowed=list(home.sources).filter(x=>x.source!=='wechat_import').map(x=>x.source)
      if(input.sources.some(x=>typeof x!=='string'||!allowed.includes(x))||new Set(input.sources).size!==input.sources.length)throw missing()
      await this.guard(session,epoch,signal)
      await this.request(module,'/api/v1/personal-profile/v3/experience/sources/set',{sources:input.sources},session,signal,true)
    }else throw missing()
    await this.guard(session,epoch,signal);return {saved:true}
  }
  async source(evidenceRef: string, signal?: AbortSignal): Promise<ExploreSource> {
    const session=await this.runtime.requireSession(),epoch=this.epoch,ref=await this.open(evidenceRef,session,'evidence'),module=this.module(ref.module)
    let uid=text(ref.uid),result:ExploreSource
    if(module==='anniversaries') {
      const raw=await this.request(module,'/api/v1/insight/anniversary/evidence/open',{candidate_id:ref.parentId,message_id:ref.messageId,source_type:0,result_version:ref.version},session,signal)
      if(raw.available!==true)throw new ArkmePluginError('explore-source-unavailable','原文已删除或当前不可访问',false,404)
      const owner=doc(raw.owner_ref)
      if(owner.provider==='audio') {
        result=await this.recording.exploreRecordingEvidence(owner,text(ref.quote),signal)
        await this.guard(session,epoch,signal);return result
      }
      uid=text(owner.record_uid)
    }
    if(!uid)throw new ArkmePluginError('explore-source-missing','这条结果缺少可定位的来源',false,404)
    const raw=await this.runtime.authenticatedPost<Doc>('/api/v1/records/detail',{record_uid:uid},session,signal,{lane:'interactive-read',bypassCache:true})
    const core=doc(raw.record_core)
    if(core.record_uid!==uid||number(core.content_access_state??raw.content_access_state)!==1||number(core.status)!==1||(await this.privacy.lockedRecordUids(session,signal)).has(uid))throw new ArkmePluginError('explore-source-restricted','原文已删除或当前无权查看',false,403)
    if([3,4].includes(number(core.origin_kind))) {
      const source=await this.sources.searchTargetSource(3,text(core.origin_container_ref),'',signal)
      if(!source)throw missing()
      result={kind:'conversation',source,itemUid:uid,sendAtMillis:number(core.send_at)}
    }else result={kind:'record',item:await this.records.personalRecordDetail(uid,signal)}
    await this.guard(session,epoch,signal);return result
  }
}
