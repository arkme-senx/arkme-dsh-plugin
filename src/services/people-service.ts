import { SpeakerGroupService } from './speaker-group-service.js'
import type { ExploreEvidence, ExploreSource } from '../explore-contract.js'
import { PeopleIdentityService } from './people-identity-service.js'
import { createHmac, createHash } from 'node:crypto'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import { PEOPLE_SOURCES, type PeoplePage, type PeopleSource, type PersonFacet, type PeopleIdentityImpact } from '../people-contract.js'
import type { ExploreService } from './explore-service.js'
import type { RecordingService } from './recording-service.js'
import type { ContactDirectoryService } from './contact-directory-service.js'
import type { ChatService } from './chat-service.js'
import { ArkmePluginError, type ServiceRuntime, objectValue } from './service.js'

const unavailable = () => new ArkmePluginError('people-unavailable', '人物资料已变化，请刷新后重试', true, 409)
const id = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0

/** Projects verified owner facts; explicit identity commands remain in the Relation owner domain. */
export class PeopleService {
  private readonly identities: PeopleIdentityService
  private readonly codec: EncryptedReferenceCodec
  constructor(private readonly runtime: ServiceRuntime,
    private readonly explore: Pick<ExploreService, 'personDirectoryItem'> & Partial<Pick<ExploreService,'personEvidenceKey'>>,
    private readonly recording: Pick<RecordingService, 'directorySpeakerRef' | 'directoryUserSpeakerRef'> & Partial<Pick<RecordingService,'recordingGroupRows'>>,
    private readonly contacts: Pick<ContactDirectoryService, 'listRecordingSpeakerUsers' | 'enrichPeoplePage'>,
    private readonly chat: Pick<ChatService, 'openPrivateChatFromUser'> & Partial<Pick<ChatService,'personRecordsForIdentity'>>) {
    this.identities = new PeopleIdentityService(runtime, (id, owner) => recording.directorySpeakerRef(id, owner))
    this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), unavailable, 262144)
  }
  async list(sourceValue: unknown, signal?: AbortSignal, cursor?: unknown, queryValue?: unknown): Promise<PeoplePage> {
    if (!PEOPLE_SOURCES.includes(sourceValue as PeopleSource)) throw unavailable()
    const source = sourceValue as PeopleSource, session = await this.runtime.requireSession()
    if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || cursor.length > 16384)) throw unavailable()
    if (queryValue !== undefined && (typeof queryValue !== 'string' || [...queryValue].length > 200)) throw unavailable()
    const query = typeof queryValue === 'string' ? queryValue.trim() : ''
    const keySecret = await this.runtime.stateStore.uniqueCode()
    const key = (kind: string, value: string | number) => createHmac('sha256', keySecret).update(JSON.stringify([this.runtime.config.environment, session.userId, 'people-v1', kind, value])).digest('hex')
    let ownerCursor: string | undefined
    if (cursor) {
      const c = await this.codec.open('arkme-people-page-v1', cursor as string)
      if (c.viewer !== session.userId || c.environment !== this.runtime.config.environment || c.source !== source || c.query !== query || typeof c.cursor !== 'string') throw unavailable()
      ownerCursor = c.cursor
    }
    type Row = { chat_session_uid?: string; identity: { namespace: string; id: string }; link: { identity: { namespace: string; id: string }; state: string; person_id: string; person_revision?: number; excluded_person_ids?: string[] }; display_name: string; aliases?: string[]; ref_user_id?: number; remark?: string; relation?: Record<string, unknown> }
    const page = await this.runtime.authenticatedRelationPost<{ source: string; items: Row[]; next_cursor?: string; search_pending?: boolean }>('/api/v1/entity/identities/directory',
      { source, query, limit: 50, ...(ownerCursor ? { cursor: ownerCursor } : {}) }, session, signal, { bypassCache: true, cacheMs: 0 })
    if (page.source !== source || !Array.isArray(page.items) || page.items.length > 50) throw unavailable()
    const contactRows = source === 'contacts' ? await this.contacts.enrichPeoplePage(page.items.map(r => ({ userId: id(r.ref_user_id), label: r.display_name, ...(r.remark ? { remark: r.remark } : {}) })), session, signal) : []
    const items = await Promise.all(page.items.map(async (row, index): Promise<PersonFacet> => {
      const identity = row.identity, userId = id(row.ref_user_id), kind = source === 'relations' ? 'entity' : source === 'speakers' ? 'speaker' : 'contact'
      if (!identity?.id || identity.namespace !== ({ relations: 'relation_entity', speakers: 'audio_speaker', contacts: 'arkme_user' }[source]) || !row.link || row.link.identity?.id !== identity.id || row.link.identity.namespace !== identity.namespace) throw unavailable()
      const contact = contactRows[index]
      const facet: PersonFacet = { key: key(kind, source === 'contacts' ? userId : identity.id), personKey: key(userId ? 'user' : kind, userId || identity.id), source,
        name: contact?.label || row.remark || row.display_name || '未命名人物', aliases: [...new Set([...(contact?.aliases ?? []), ...(row.aliases ?? []), ...(row.remark && row.remark !== row.display_name ? [row.display_name] : [])])], accountLinked: userId > 0, isSelf: userId === session.userId,
        ...(row.remark ? { hasRemark: true } : {}), ...(contact?.avatarRef ? { avatarRef: contact.avatarRef } : {}) }
      if (source === 'relations') {
        if (!row.relation) throw unavailable()
        facet.relation = await this.explore.personDirectoryItem(row.relation)
      } else if (source === 'speakers') {
        facet.speakerRef = await this.recording.directorySpeakerRef(identity.id, session.userId); facet.assignmentRef = facet.speakerRef
      } else {
        if (!userId) throw unavailable()
        facet.assignmentRef = await this.recording.directoryUserSpeakerRef(userId, session.userId)
        if (userId !== session.userId) facet.chatRef = await this.codec.seal('arkme-person-chat-v1', { viewer: session.userId, environment: this.runtime.config.environment, userId, label: facet.name, expires: Date.now() + 30 * 60_000 })
      }
      if(source==='speakers'||source==='contacts'&&(row.chat_session_uid||userId===session.userId)) facet.recordsRef=await this.codec.seal('arkme-person-records-v1',{viewer:session.userId,environment:this.runtime.config.environment,identity,source,chat:row.chat_session_uid,userId,expires:Date.now()+30*60_000})
      return this.identities.decorate(facet, identity, value => key('person', value), signal, row.link)
    }))
    const nextCursor = page.next_cursor ? await this.codec.seal('arkme-people-page-v1', { viewer: session.userId, environment: this.runtime.config.environment, source, query, cursor: page.next_cursor }) : undefined
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw unavailable()
    return { source, items, ...(nextCursor ? { nextCursor } : {}), ...(page.search_pending ? { searchPending: true } : {}) }
  }
  async identityAction(action: unknown, params: Record<string, unknown>, signal?: AbortSignal) { if(action==='records')return this.records(params,signal);if(action==='records-source')return this.recordSource(params,signal);if(action==='impact')return this.impact(params,signal);return this.identities.execute(action, params, signal) }
  private async impact(params:Record<string,unknown>,signal?:AbortSignal):Promise<PeopleIdentityImpact> {
    const session=await this.runtime.requireSession(),prefix='arkme-person-impact-v1'
    if(typeof params.commandRef!=='string')throw unavailable()
    const commandHash=createHash('sha256').update(params.commandRef).digest('hex')
    type Progress={viewer:number;environment:string;commandHash:string;expires:number;index:number;sourceCursor?:string;recordingCount:number;chatCount:number;seen:string[];seenRecords:string[];relationCursor?:string;step?:number}
    let progress:Progress
    if(typeof params.cursor==='string'&&params.cursor.startsWith(prefix+'.')){
      progress=await this.codec.open(prefix,params.cursor) as unknown as Progress
      if(progress.viewer!==session.userId||progress.environment!==this.runtime.config.environment||progress.commandHash!==commandHash||progress.expires<Date.now())throw unavailable()
    }else progress={viewer:session.userId,environment:this.runtime.config.environment,commandHash,expires:Date.now()+5*60_000,index:0,recordingCount:0,chatCount:0,seen:[],seenRecords:[],...(typeof params.cursor==='string'?{relationCursor:params.cursor}:{})}
    // Recheck the signed preview and current source permissions for every continuation.
    const raw=await this.identities.execute('impact',{commandRef:params.commandRef,...(progress.relationCursor?{cursor:progress.relationCursor}:{})},signal) as PeopleIdentityImpact&{recordSources?:Array<{namespace:string;id:string}>}
    const {recordSources,...result}=raw
    if(!Array.isArray(recordSources)||recordSources.length>100)throw new ArkmePluginError('people-impact-upgrade','服务端尚未提供完整来源影响，请更新服务后重新预览',true,501)
    if(result.state==='pending')return result
    if(progress.index<recordSources.length){
      const identity=recordSources[progress.index]!
      const source=await this.runtime.authenticatedRelationPost<{identity:{namespace:string;id:string};chat_session_uid?:string;user_id?:number}>('/api/v1/entity/identities/record-source',{identity},session,signal,{bypassCache:true,cacheMs:0})
      if(source.identity?.namespace!==identity.namespace||source.identity.id!==identity.id)throw unavailable()
      const audio=identity.namespace==='audio_speaker',key=audio?'speaker:'+identity.id:'user:'+source.user_id
      if(!progress.sourceCursor&&progress.seen.includes(key))progress.index++
      else {
        const recordsRef=await this.codec.seal('arkme-person-records-v1',{viewer:session.userId,environment:this.runtime.config.environment,identity,source:audio?'speakers':'contacts',chat:source.chat_session_uid,userId:source.user_id,expires:progress.expires})
        const page=await this.records({recordsRef,...(progress.sourceCursor?{cursor:progress.sourceCursor}:{})},signal)
        const ledger=this.runtime.stateStore.personImpact
        if(ledger){
          if(progress.seenRecords.length)throw unavailable() // Old large cursors restart under the new bounded checkpoint protocol.
          const step=(progress.step??0)+1
          const keys=page.evidence.map(row=>createHash('sha256').update((audio?'audio:':'chat:')+row.key).digest('base64url'))
          const counts=ledger.append(`${this.runtime.config.environment}:${session.userId}`,commandHash,step,
            {recordingCount:progress.recordingCount,chatCount:progress.chatCount},keys,audio,progress.expires)
          Object.assign(progress,counts,{step})
        }else{
        const known=new Set(progress.seenRecords)
        for(const row of page.evidence){const recordKey=createHash('sha256').update((audio?'audio:':'chat:')+row.key).digest('base64url');if(known.has(recordKey))continue
          if(known.size>=3000)throw new ArkmePluginError('people-impact-budget','本次涉及超过 3000 条不同原文，影响核对尚未完成；请减少本次关联身份后重新预览。',false,422)
          known.add(recordKey);if(audio)progress.recordingCount++;else progress.chatCount++
        }
        progress.seenRecords=[...known]
        }
        if(page.nextCursor)progress.sourceCursor=page.nextCursor
        else{delete progress.sourceCursor;progress.seen.push(key);progress.index++}
      }
    }
    signal?.throwIfAborted();const current=await this.runtime.requireSession();if(current.userId!==session.userId||current.refreshToken!==session.refreshToken)throw unavailable()
    const more=progress.index<recordSources.length
    const {nextCursor:_,...base}=result
    return {...base,state:more?'pending':'complete',recordingCount:progress.recordingCount,chatCount:progress.chatCount,...(more?{nextCursor:await this.codec.seal(prefix,progress)}:{})}
  }
  private async recordSource(params:Record<string,unknown>,signal?:AbortSignal):Promise<ExploreSource> {
    const session=await this.runtime.requireSession()
    if(typeof params.ref!=='string')throw unavailable()
    const ref=await this.codec.open('arkme-person-source-v1',params.ref)
    if(ref.viewer!==session.userId||ref.environment!==this.runtime.config.environment||Number(ref.expires)<Date.now()||typeof ref.key!=='string')throw unavailable()
    const page=await this.records({recordsRef:ref.recordsRef,...(ref.cursor?{cursor:ref.cursor}:{})},signal,true)
    const item=page.evidence.find(e=>e.key===ref.key)
    if(!item?.directSource)throw unavailable()
    return item.directSource
  }
  private async records(params: Record<string,unknown>,signal?:AbortSignal,forSource=false):Promise<{evidence:Array<ExploreEvidence&{directSource?:ExploreSource}>;nextCursor?:string}> {
    const session=await this.runtime.requireSession()
    if(typeof params.recordsRef!=='string'||params.cursor!==undefined&&typeof params.cursor!=='string')throw unavailable()
    const ref=await this.codec.open('arkme-person-records-v1',params.recordsRef),identity=objectValue(ref.identity)
    if(ref.viewer!==session.userId||ref.environment!==this.runtime.config.environment||Number(ref.expires)<Date.now())throw unavailable()
    await this.runtime.authenticatedRelationPost('/api/v1/entity/identities/resolve',{identity},session,signal,{bypassCache:true,cacheMs:0})
    let evidence:Array<ExploreEvidence&{directSource?:ExploreSource}>,nextCursor:string|undefined
    if(ref.source==='speakers'&&identity.namespace==='audio_speaker'&&typeof identity.id==='string'&&this.recording.recordingGroupRows){
      const groups=new SpeakerGroupService(this.runtime,{recordingGroupRows:this.recording.recordingGroupRows.bind(this.recording)},async()=>({type:'speaker',id:identity.id}))
      const page=await groups.members({detailRef:params.recordsRef,...(params.cursor?{cursor:params.cursor}:{})},signal)
      nextCursor=page.nextCursor
      evidence=page.items.map(item=>{const day=new Date(item.startAtMillis);day.setHours(0,0,0,0);return {key:item.itemId,label:'录音',speaker:item.speakerLabel,text:item.text,date:item.startAtMillis,anchor:false,roles:['speaker'],directSource:{kind:'recording',dateStamp:day.getTime(),focusItemId:item.itemId,items:[item]}}})
    }else if(ref.source==='contacts'&&['arkme_user','contact'].includes(String(identity.namespace))&&(typeof ref.chat==='string'||id(ref.userId)===session.userId)&&id(ref.userId)&&this.chat.personRecordsForIdentity){
      const page=await this.chat.personRecordsForIdentity(typeof ref.chat==='string'?ref.chat:'',id(ref.userId),params.cursor as string|undefined,signal)
      if(!page.supported)throw new ArkmePluginError('person-records-unsupported','聊天来源暂不支持人物内容分页',false,501)
      nextCursor=page.nextCursor
      evidence=await Promise.all(page.items.map(async(item):Promise<ExploreEvidence&{directSource?:ExploreSource}>=>({key:this.explore.personEvidenceKey?await this.explore.personEvidenceKey('core_record',item.itemUid):item.eventRef,label:'聊天原文',speaker:item.senderName,text:item.textContent,date:item.sendAtMillis,anchor:false,roles:['author'],directSource:{kind:'conversation',source:item.personSource,itemUid:item.itemUid,sendAtMillis:item.sendAtMillis}})))
    }else throw unavailable()
    signal?.throwIfAborted();const current=await this.runtime.requireSession();if(current.userId!==session.userId||current.refreshToken!==session.refreshToken)throw unavailable()
    if(!forSource)evidence=await Promise.all(evidence.map(async row=>{const {directSource:_,...publicRow}=row;return {...publicRow,personSourceRef:await this.codec.seal('arkme-person-source-v1',{viewer:session.userId,environment:this.runtime.config.environment,expires:ref.expires,recordsRef:params.recordsRef,cursor:params.cursor,key:row.key})}}))
    return {evidence,...(nextCursor?{nextCursor}:{})}
  }
  async openChat(value: string, signal?: AbortSignal) {
    const session = await this.runtime.requireSession()
    const ref = await this.codec.open('arkme-person-chat-v1', value)
    if (ref.viewer !== session.userId || ref.environment !== this.runtime.config.environment || Number(ref.expires) < Date.now() || !id(ref.userId)) throw unavailable()
    await this.runtime.authenticatedRelationPost('/api/v1/entity/identities/resolve', { identity: { namespace: 'arkme_user', id: String(ref.userId) } }, session, signal, { bypassCache: true, cacheMs: 0 })
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (typeof ref.label !== 'string' || current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw unavailable()
    return this.chat.openPrivateChatFromUser(Number(ref.userId), { presentationDisplayName: ref.label as string, ...(signal ? { signal } : {}) })
  }
}
