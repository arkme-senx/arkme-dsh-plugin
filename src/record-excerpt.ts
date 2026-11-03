import type { SelectedTextNotePresentation } from './selected-text-note.js'

/** Navigation candidates only: every open must pass its real owner's current ACL. */
export type RecordExcerptSource =
  | { kind:'record'; record_uid:string; owner_user_id:number; chat_session_uid?:string; relation_uid?:string }
  | { kind:'team_message'; team_conversation_uid:string; team_message_uid:string; side?:'team'|'external' }
  | { kind:'agent_message'; agent_session_id:number; agent_message_id:number }
  | { kind:'codex_event'; source_id:string; task_id:string; event_id:string }
  | { kind:'dsh_message'; runtime_ref:string; session_ref:string; event_seq:number; role?:'user'|'assistant' }
  | { kind:'recording_segment'; recording_uid:string; segment_uid:string }
  | { kind:'call_segment'; call_uid:string; segment_uid:string }
export interface RecordExcerpt {
  schema_version:1; header_end:number; quote_start:number; quote_end:number; note_start:number; frozen_digest:string
  source?:RecordExcerptSource
}
const fields:Record<RecordExcerptSource['kind'], readonly string[]>={record:['record_uid','owner_user_id','chat_session_uid','relation_uid'],team_message:['team_conversation_uid','team_message_uid','side'],agent_message:['agent_session_id','agent_message_id'],codex_event:['source_id','task_id','event_id'],dsh_message:['runtime_ref','session_ref','event_seq','role'],recording_segment:['recording_uid','segment_uid'],call_segment:['call_uid','segment_uid']}
export function readExcerptSource(raw:unknown):RecordExcerptSource|undefined {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined
  const v=raw as Record<string,unknown>,kind=v.kind as RecordExcerptSource['kind'],allowed=fields[kind]
  if(!allowed||Object.keys(v).some(k=>k!=='kind'&&!allowed.includes(k)))return undefined
  for(const key of allowed){const value=v[key];if(key==='side'||key==='role'){if(value!==undefined&&!(key==='side'?['team','external']:['user','assistant']).includes(String(value)))return undefined;continue}if(kind==='record'&&['chat_session_uid','relation_uid'].includes(key)&&value===undefined)continue
    if(['owner_user_id','agent_session_id','agent_message_id','event_seq'].includes(key)){if(!Number.isSafeInteger(value)||Number(value)<(key==='event_seq'?0:1))return undefined}
    else if(typeof value!=='string'||!value||new TextEncoder().encode(value).length>1024||/[\x00\r\n]/.test(value))return undefined
  }
  if(kind==='record'&&!!v.chat_session_uid!==!!v.relation_uid)return undefined
  return Object.fromEntries([['kind',kind],...allowed.filter(key=>v[key]!==undefined).map(key=>[key,v[key]])]) as unknown as RecordExcerptSource
}
export function readRecordExcerpt(raw:unknown,text:string):RecordExcerpt|undefined {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined
  const p=raw as RecordExcerpt
  const offsets=[p.header_end,p.quote_start,p.quote_end,p.note_start]
  if(p.schema_version!==1||offsets.some(n=>!Number.isSafeInteger(n)||n<0||n>text.length||n>0&&n<text.length&&/[\uDC00-\uDFFF]/.test(text[n]!))||p.header_end<1||p.quote_start<p.header_end||p.quote_end<=p.quote_start||p.quote_end-p.quote_start>2000||p.note_start<p.quote_end||!/^[a-f0-9]{64}$/.test(p.frozen_digest))return undefined
  const source=readExcerptSource(p.source);if(p.source!==undefined&&!source)return undefined
  return {schema_version:1,header_end:p.header_end,quote_start:p.quote_start,quote_end:p.quote_end,note_start:p.note_start,frozen_digest:p.frozen_digest,...(source?{source}:{})}
}
export function recordExcerptPresentation(raw:unknown,text:string):SelectedTextNotePresentation|undefined {
  const p=readRecordExcerpt(raw,text);if(!p)return undefined
  const header=text.slice(0,p.header_end)
  // Display uses the frozen canonical header, never inferred identity or timestamps.
  return {quote:{version:1,sourceLabel:header.split('\n')[0]?.replace(/^引用 · /,'')||'摘录',senderName:'原作者',sourceAtMillis:0,text:text.slice(p.quote_start,p.quote_end),...(p.source?{source:p.source}:{})},header,noteText:text.slice(p.note_start),storage:'cloud'}
}

export interface RecordExcerptOriginal { title:string; text:string; at?:number }
