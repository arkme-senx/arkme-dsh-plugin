import { ArkmePluginError, objectValue as obj, stringValue as str } from './service.js'
import { TEAM_HISTORY_ACTIONS, type TeamHistoryAction, type TeamHistoryOptions, type TeamHistoryResponse, type TeamHistoryExportChunk } from '../team-history-contract.js'
import type { TeamIdentity, TeamMessage } from '../team-app-contract.js'

type Context = { conversation_uid: string; side: 'team'|'external' }
export interface TeamHistoryAdapter {
  viewer: number; context: Context; routePath: string
  post(path: string, input: Record<string,unknown>, read: boolean): Promise<Record<string,unknown>>
  seal(kind: string, input: Record<string,unknown>): Promise<string>
  open(kind: string, ref: string): Promise<Record<string,unknown>>
  identity(raw: unknown, id?: unknown): Promise<TeamIdentity>
  preview(raw: Record<string,unknown>): Promise<TeamMessage>
}
const invalid = () => new ArkmePluginError('team-history-incomplete','团队历史响应不完整，请重试',true,502)
const num = (v: unknown) => typeof v==='number' && Number.isSafeInteger(v) && v>=0 ? v : undefined
const requiredNumber = (v: unknown) => { const n=num(v);if(n===undefined)throw invalid();return n }
const rows = (v: unknown) => { if(!Array.isArray(v))throw invalid();return v.map(obj) }
const states = new Set(['index_preparing','preparing','ready','failed','cancelled'])

function activity(raw: unknown, ref: string): import('../conversation-activity.js').ConversationActivityResult {
  if(raw===undefined || raw===null)throw invalid()
  const v=obj(raw),hourly=rows(v.hourly),weekly=rows(v.weekly)
  if(hourly.length!==24||weekly.length!==168)throw invalid()
  const bucket=(b:Record<string,unknown>)=>({hour:requiredNumber(b.hour),weekday:b.weekday===null?null:requiredNumber(b.weekday),messages:requiredNumber(b.messages),participants:requiredNumber(b.participants),systemMessages:0})
  const h=hourly.map(bucket),w=weekly.map(bucket),timed=requiredNumber(v.timed_messages)
  const total=requiredNumber(v.total_messages),unknown=requiredNumber(v.unknown_time),people=requiredNumber(v.participants),days=requiredNumber(v.active_days)
  if(timed+unknown!==total||people>total||days>timed||new Set(h.map(b=>b.hour)).size!==24||new Set(w.map(b=>`${b.weekday}:${b.hour}`)).size!==168||h.some(b=>b.weekday!==null)||w.some(b=>b.weekday===null||b.weekday<1||b.weekday>7)||[...h,...w].some(b=>b.hour>23||b.participants>b.messages||b.participants>people))throw invalid()
  for(const b of h)if(w.filter(day=>day.hour===b.hour).reduce((n,day)=>n+day.messages,0)!==b.messages)throw invalid()
  if(h.reduce((n,b)=>n+b.messages,0)!==timed || w.reduce((n,b)=>n+b.messages,0)!==timed)throw invalid()
  return {id:ref,updatedAt:Date.now(),totalMessages:requiredNumber(v.total_messages),activeDays:requiredNumber(v.active_days),participants:requiredNumber(v.participants),systemMessages:0,fromAt:null,toAt:null,hourly:h,weekly:w}
}

/** A single Host policy/codec owner serves UI, SDK and Tools. It does not cache
 * message bodies, infer identities, or fall back to scanning normal timelines. */
export async function teamHistoryOperation(adapter: TeamHistoryAdapter, action: TeamHistoryAction, options: TeamHistoryOptions): Promise<TeamHistoryResponse> {
  if(!(TEAM_HISTORY_ACTIONS as readonly string[]).includes(action))throw invalid()
  const context=adapter.context,body:Record<string,unknown>={...context}
  const fields={keyword:'keyword',fromAt:'from_at',untilAt:'until_at',timezone:'timezone',mediaKind:'media_kind',cursor:'cursor',limit:'limit',requestId:'request_id',analysisKind:'analysis_kind',hour:'hour',weekday:'weekday'} as const
  for(const [key,field] of Object.entries(fields)) { const value=options[key as keyof typeof fields];if(value!==undefined)body[field]=value }
  if(options.sender==='self'){if(options.personRef)throw invalid();body.sender_user_id=adapter.viewer}
  if(options.personRef){
    const person=await adapter.open('person',options.personRef)
    if(context.side!=='team'||person.side!=='team'||person.conversation_uid!==context.conversation_uid||!num(person.user_id))throw invalid()
    body[options.personMode==='mentioned'?'mentioned_user_id':'sender_user_id']=person.user_id
  }
  let resultRef=options.resultRef
  if(resultRef){const result=await adapter.open('history-result',resultRef);if(result.conversation_uid!==context.conversation_uid||result.side!==context.side||!str(result.result_uid))throw invalid();body.result_id=result.result_uid}
  if(options.sourceRef){const source=await adapter.open('history-source',options.sourceRef);if(source.conversation_uid!==context.conversation_uid||source.side!==context.side||source.result_uid!==body.result_id)throw invalid();body.source_ref=source.source_ref}
  const raw=await adapter.post(`conversations/history/${action==='exports/link'?'exports/state':action}`,body,true)
  if(!states.has(str(raw.state)))throw invalid()
  const state=raw.state as TeamHistoryResponse['state'],uid=str(raw.result_id)
  if(uid)resultRef=await adapter.seal('history-result',{...context,result_uid:uid})
  const result:TeamHistoryResponse={state,messages:[],words:[],days:[],participants:[],hasMore:raw.has_more===true,
    ...(resultRef?{resultRef}:{}),...(str(raw.cursor)?{cursor:str(raw.cursor)}:{}),...(str(raw.reason)?{reason:str(raw.reason)}:{}),...(str(raw.kind)?{kind:str(raw.kind)}:{})}
  const counts={through_seq:'throughSeq',head_seq:'headSeq',processed_through_seq:'processedThroughSeq',messages:'messageCount',total_in_snapshot:'totalInSnapshot',bytes:'bytes',expires_at:'expiresAt'} as const
  for(const [key,target] of Object.entries(counts)) { if(typeof raw[key]==='number')Object.assign(result,{[target]:requiredNumber(raw[key])}) }
  if(typeof raw.indexing==='boolean')result.indexing=raw.indexing
  if(str(raw.sha256)){if(!/^[a-f0-9]{64}$/u.test(str(raw.sha256)))throw invalid();result.sha256=str(raw.sha256)}
  if(state==='ready'&&['query','dates','participants','analysis/words','analysis/sources'].includes(action)&&(typeof raw.has_more!=='boolean'||raw.has_more&&!str(raw.cursor)))throw invalid()
  if(Array.isArray(raw.messages))result.messages=await Promise.all(rows(raw.messages).map(row=>adapter.preview(row)))
  if(raw.activity!==undefined&&raw.activity!==null){result.activity=activity(raw.activity,resultRef??'');result.unknownTime=requiredNumber(obj(raw.activity).unknown_time)}
  if(state==='ready'&&['query','analysis/sources'].includes(action)&&!Array.isArray(raw.messages))throw invalid()
  if(state==='ready'&&action==='analysis/result'&&!result.activity)throw invalid()
  if(state==='ready'&&action==='analysis/words'){
    if(!uid)throw invalid()
    result.words=await Promise.all(rows(raw.items).map(async row=>{
      const word=str(row.word),count=requiredNumber(row.count),messageCount=requiredNumber(row.message_count)
      if(!word||!str(row.source_ref)||count<messageCount||messageCount<1)throw invalid()
      return {word,count,messageCount,sourceRef:await adapter.seal('history-source',{...context,result_uid:uid,source_ref:row.source_ref})}
    }))
  }
  if(state==='ready'&&action==='dates')result.days=await Promise.all(rows(raw.items).map(async row=>({date:str(row.key),count:requiredNumber(row.count),message:await adapter.preview({message_uid:row.message_uid,seq:row.seq,revision:0,version:0,created_at:0,side:context.side,sender:{nickname:''},text:'',title:'',media:[],own:false})})))
  if(state==='ready'&&action==='participants')result.participants=await Promise.all(rows(raw.items).map(row=>adapter.identity({nickname:str(row.name)},row.user_id)))
  if(action==='exports/link'){
    if(state!=='ready'||!resultRef||!result.sha256||num(raw.bytes)===undefined)throw invalid()
    result.fileName='团队对话.md';result.downloadUrl=`${adapter.routePath}/team/history/export?ref=${encodeURIComponent(resultRef)}`
  }
  return result
}

export async function teamHistoryChunk(adapter: TeamHistoryAdapter, resultRef: string, cursor?: string): Promise<TeamHistoryExportChunk> {
  const result=await adapter.open('history-result',resultRef)
  if(result.conversation_uid!==adapter.context.conversation_uid||result.side!==adapter.context.side||!str(result.result_uid))throw invalid()
  const raw=await adapter.post('conversations/history/exports/download',{...adapter.context,result_id:result.result_uid,...(cursor?{cursor}:{})},true)
  if(raw.state!=='ready'||typeof raw.chunk_base64!=='string'||raw.chunk_base64.length>1500000||typeof raw.complete!=='boolean'||!/^[a-f0-9]{64}$/u.test(str(raw.sha256))||!/^[a-f0-9]{64}$/u.test(str(raw.chunk_sha256)))throw invalid()
  return {chunkBase64:raw.chunk_base64,chunkSha256:str(raw.chunk_sha256),sha256:str(raw.sha256),bytes:requiredNumber(raw.bytes),offset:requiredNumber(raw.offset),complete:raw.complete,fileName:'团队对话.md',...(str(raw.cursor)?{cursor:str(raw.cursor)}:{})}
}
