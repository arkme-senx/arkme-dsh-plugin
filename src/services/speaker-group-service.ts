import {parseGroupConsistency} from '../speaker-similarity-contract.js'
import {createHash} from 'node:crypto'
import {EncryptedReferenceCodec} from '../encrypted-reference.js'
import {ArkmePluginError,objectValue,type ServiceRuntime} from './service.js'
import type {RecordingService} from './recording-service.js'
import type {SpeakerGroupMembers,SpeakerGroupPreview,SpeakerGroupJob,SpeakerGroupJobs,SpeakerGroupConflictItem} from '../speaker-group-contract.js'
const bad=()=>new ArkmePluginError('speaker-group-invalid','分组或任务已变化，请重新读取',true,409)
const count=(v:unknown)=>{if(!Number.isSafeInteger(v)||Number(v)<0)throw bad();return Number(v)}
const text=(v:unknown)=>{if(typeof v!=='string'||!v||v.length>16384)throw bad();return v}
type Session = Awaited<ReturnType<ServiceRuntime['requireSession']>>
export class SpeakerGroupService {
 private codec:EncryptedReferenceCodec
 constructor(private runtime:ServiceRuntime,private recording:Pick<RecordingService,'recordingGroupRows'>,private detail:(ref:unknown,owner:number)=>Promise<Record<string,unknown>>){this.codec=new EncryptedReferenceCodec(()=>runtime.stateStore.uniqueCode(),bad)}
 private async assertSession(s:Session,signal?:AbortSignal){signal?.throwIfAborted();const current=await this.runtime.requireSession();if(current.userId!==s.userId||current.refreshToken!==s.refreshToken)throw bad()}
 private async scoped<T>(run:(s:Session)=>Promise<T>,signal?:AbortSignal){const s=await this.runtime.requireSession();const result=await run(s);await this.assertSession(s,signal);return result}
 private async seal(s:Session,value:Record<string,unknown>){await this.assertSession(s);const ref=await this.codec.seal('arkme-speaker-group-v1',{...value,owner:s.userId,environment:this.runtime.config.environment});await this.assertSession(s);return ref}
 private async open(s:Session,value:unknown){await this.assertSession(s);const r=await this.codec.open('arkme-speaker-group-v1',text(value));await this.assertSession(s);if(r.owner!==s.userId||r.environment!==this.runtime.config.environment)throw bad();return r}
 private async post(s:Session,path:string,body:Record<string,unknown>,signal?:AbortSignal){
  await this.assertSession(s,signal)
  let data:unknown
  try {data=await this.runtime.authenticatedAudioPost<Record<string,unknown>>(`/api/v1/audio/speaker/group/${path}`,body,s,signal,{bypassCache:true,cacheMs:0,lane:['apply','cancel','undo'].includes(path)?'write':'interactive-read'})}
  catch(error){if(error instanceof ArkmePluginError&&(error.upstreamStatus??error.httpStatus)===422)throw new ArkmePluginError('speaker-group-budget',path==='members'?'分组证据超过本次读取预算，请缩小审查范围后重试。':'完整分组最多原子保存 2000 段；本次未保存，请返回逐片段选择或减少分组。',false,422);throw error}
  await this.assertSession(s,signal);return objectValue(data)
 }
 async members(input:Record<string,unknown>,signal?:AbortSignal):Promise<SpeakerGroupMembers>{return this.scoped(s=>this.membersFor(s,input,signal),signal)}
 private async membersFor(s:Session,input:Record<string,unknown>,signal?:AbortSignal):Promise<SpeakerGroupMembers>{
  const sort=input.sort??'time';if(sort!=='time'&&sort!=='review')throw bad()
  const ref=await this.detail(input.detailRef,s.userId)
  const source={type:ref.type,id:ref.id,expected_version:ref.expectedVersion},sourceKey=createHash('sha256').update(JSON.stringify({source,sort})).digest('hex')
  const c=input.cursor?await this.open(s,input.cursor):undefined
  if(c&&c.sourceKey!==sourceKey)throw bad()
  const data=await this.post(s,'members',{detail_ref:source,sort,limit:20,...(c?{cursor:c.cursor,snapshot_version:c.snapshot}: {})},signal)
  if(!Array.isArray(data.items)||data.items.length>20||typeof data.has_more!=='boolean'||typeof data.requires_review!=='boolean')throw bad()
  const snapshot=text(data.snapshot_version),members=data.items.map(value=>{const r=objectValue(value),l=objectValue(r.locator);if(!['system','doubao'].includes(String(l.transcript_source)))throw bad();const start=count(l.start_at),end=count(l.end_at);if(end<=start)throw bad();return {locator:{session_id:text(l.session_id),child_id:text(l.child_id),item_index:count(l.item_index),transcript_source:String(l.transcript_source),start_at:start,end_at:end,revision:text(l.revision)},occurred_at:count(r.occurred_at)}})
  if(c&&snapshot!==c.snapshot||count(data.total_count)<members.length)throw bad()
  const items=await this.recording.recordingGroupRows(members,signal)
  const consistency=data.consistency===undefined?undefined:parseGroupConsistency(data.consistency)
  if(consistency&&consistency.totalCount!==count(data.total_count))throw bad()
  const evidence=data.items.map((value,i)=>{const r=objectValue(value),state=r.evidence_state??'insufficient',deviation=r.deviation??null
   if(!['ready','insufficient'].includes(String(state))||deviation!==null&&(typeof deviation!=='number'||!Number.isFinite(deviation)||deviation<0||deviation>2)||state==='ready'&&deviation===null)throw bad()
   if(!items[i])throw bad();return {itemRef:items[i]!.itemRef,state:state as 'ready'|'insufficient',deviation:deviation as number|null}})
  return {items,evidence,...(consistency?{consistency,scoreDefinition:text(data.score_definition)}:{}),snapshotRef:await this.seal(s,{snapshot,sourceKey}),totalCount:count(data.total_count),firstAt:count(data.first_at),lastAt:count(data.last_at),requiresReview:data.requires_review||consistency?.state!=='ready'||consistency.reviewCount!==0,
   ...(data.has_more?{nextCursor:await this.seal(s,{snapshot,sourceKey,cursor:text(data.next_cursor)})}:{})}
 }
 async action(action:unknown,input:Record<string,unknown>,signal?:AbortSignal):Promise<SpeakerGroupPreview|SpeakerGroupJob|SpeakerGroupJobs|SpeakerGroupConflictItem>{return this.scoped(s=>this.actionFor(s,action,input,signal),signal)}
 private async actionFor(s:Session,action:unknown,input:Record<string,unknown>,signal?:AbortSignal):Promise<SpeakerGroupPreview|SpeakerGroupJob|SpeakerGroupJobs|SpeakerGroupConflictItem>{
  if(action==='conflict'){
   const ref=await this.open(s,input.conflictRef),locator=objectValue(ref.locator)
   if(!ref.locator)throw bad()
   const items=await this.recording.recordingGroupRows([{locator:locator as Parameters<RecordingService['recordingGroupRows']>[0][number]['locator'],occurred_at:0}],signal,{allowChanged:true})
   if(items.length!==1)throw bad();return {item:items[0]!}
  }
  if(action==='jobs'){const c=input.cursor?await this.open(s,input.cursor):undefined;const p=await this.post(s,'jobs',{limit:20,...(c?{cursor:text(c.listCursor)}:{})},signal);if(!Array.isArray(p.items)||p.items.length>20||typeof p.has_more!=='boolean')throw bad();return {items:await Promise.all(p.items.map(v=>this.job(objectValue(v),s))),...(p.has_more?{nextCursor:await this.seal(s,{listCursor:text(p.next_cursor)})}:{})}}
  if(action==='preview'){
   if(!Array.isArray(input.snapshots)||!input.snapshots.length||input.snapshots.length>100)throw bad()
   const snapshots=await Promise.all(input.snapshots.map(async v=>text((await this.open(s,v)).snapshot)))
   let target:Record<string,unknown>|undefined,anchor:unknown
   if(input.excludedDetailRef){const ref=await this.detail(input.excludedDetailRef,s.userId),p=await this.post(s,'members',{detail_ref:{type:ref.type,id:ref.id,expected_version:ref.expectedVersion},limit:1},signal);if(!Array.isArray(p.items)||p.items.length!==1)throw bad();anchor=objectValue(p.items[0]).locator}
   else {const t=objectValue(input.target)
    if(t.kind==='directory'){const ref=await this.detail(t.detailRef,s.userId);if(ref.type!=='speaker')throw bad();target={kind:'existing',speaker_id:ref.id}}
    else if(t.kind==='new'&&typeof t.name==='string'&&t.name.trim()&&[...t.name.trim()].length<=80)target={kind:'new',name:t.name.trim()}
    else if(t.kind==='anonymous'||t.kind==='unknown')target={kind:t.kind};else throw bad()
   }
   if(typeof input.idempotencyKey!=='string'||input.idempotencyKey.length<16||input.idempotencyKey.length>80)throw bad()
   const p=await this.post(s,'preview',{scope:'whole_group',snapshots:[...new Set(snapshots)],idempotency_key:input.idempotencyKey,...(target?{target}:{exclude_anchor:anchor})},signal)
   return this.preview(p,'apply',s)
  }
  if(action==='apply'||action==='undo'){
   const ref=await this.open(s,input.commandRef);if(ref.action!==action)throw bad()
   return this.job(await this.post(s,String(action),{preview_token:text(ref.token)},signal),s)
  }
  const ref=await this.open(s,input.jobRef)
  if(action==='undo-preview')return this.preview(await this.post(s,'undo/preview',{job_id:text(ref.job)},signal),'undo',s)
  if(action!=='job'&&action!=='cancel')throw bad()
  return this.job(await this.post(s,String(action),{job_id:text(ref.job)},signal),s)
 }
 private async conflicts(values:unknown,s:Session){
  if(!Array.isArray(values)||values.length>2000)throw bad()
  return Promise.all(values.map(async value=>{const l=objectValue(value);if(!['system','doubao'].includes(String(l.transcript_source))||count(l.end_at)<=count(l.start_at))throw bad()
   const locator={session_id:text(l.session_id),child_id:text(l.child_id),item_index:count(l.item_index),transcript_source:String(l.transcript_source),start_at:count(l.start_at),end_at:count(l.end_at),revision:text(l.revision)}
   return {conflictRef:await this.seal(s,{locator})}
  }))
 }
 private async preview(p:Record<string,unknown>,action:string,s:Session):Promise<SpeakerGroupPreview>{
  if(!Array.isArray(p.conflicts)||!Array.isArray(p.sources))throw bad()
  if(count(p.affected_count)>2000)throw new ArkmePluginError('speaker-group-budget','完整分组最多原子保存 2000 段；本次未保存，请减少分组。',false,422)
  return {conflicts:await this.conflicts(p.conflicts,s),commandRef:p.conflicts.length?'':await this.seal(s,{action,token:text(p.preview_token)}),affectedCount:count(p.affected_count),firstAt:count(p.first_at),lastAt:count(p.last_at),conflictCount:p.conflicts.length,sourceCounts:p.sources.map(v=>count(objectValue(v).total_count)),expiresAt:count(p.expires_at)}
 }
 private async job(p:Record<string,unknown>,s:Session):Promise<SpeakerGroupJob>{
  if(!['preview','queued','preparing','publishing','complete','failed','conflict','cancelled'].includes(String(p.state))||p.conflicts!==null&&!Array.isArray(p.conflicts))throw bad()
  const prepared=count(p.prepared_count),total=count(p.total_count);if(prepared>total)throw bad()
  if(p.action!=='apply'&&p.action!=='undo')throw bad()
  return {conflicts:await this.conflicts(p.conflicts??[],s),jobRef:await this.seal(s,{job:text(p.job_id)}),action:p.action,state:p.state as SpeakerGroupJob['state'],preparedCount:prepared,totalCount:total,conflictCount:Array.isArray(p.conflicts)?p.conflicts.length:0,...(p.error?{error:'处理未完成，请重新读取任务；确认冲突后重新预览。'}:{})}
 }
}
