import {createHash} from 'node:crypto'
import {quoteCanonicalText,quoteSourceContent,normalizeQuoteText} from '../message-quote.js'
import type {SelectedTextNoteQuote} from '../selected-text-note.js'
import { readExcerptSource, type RecordExcerptOriginal, type RecordExcerptSource } from '../record-excerpt.js'
import { ArkmePluginError, objectValue as obj, stringValue as str, type ServiceRuntime } from './service.js'

export interface ExcerptOriginalReaders {
  personal(uid:string,signal:AbortSignal):Promise<{textContent:string;title:string;sendAtMillis:number;recordVersion?:number;textFormat?:'plain'|'markdown'}>
  agent(session:number,message:number,user:number,signal:AbortSignal):Promise<{text:string;createdAtMillis:number;textFormat:'plain'|'markdown'}>
  recording(uid:string,segment:string,signal:AbortSignal):Promise<RecordExcerptOriginal>
  call(uid:string,segment:string,signal:AbortSignal):Promise<RecordExcerptOriginal>
}
const unavailable=()=>new ArkmePluginError('excerpt-source-unavailable','原文已失效或当前无权查看；已发送摘录仍保留',false,404)

/** Read on demand, under the real owner's current ACL. No cached permission or media grant. */
export async function readExcerptOriginal(runtime:ServiceRuntime,raw:unknown,readers:ExcerptOriginalReaders,signal?:AbortSignal,expectedAccount?:{userId:number;refreshToken:string}):Promise<RecordExcerptOriginal> {
  const source=readExcerptSource(raw)
  if(!source)throw unavailable()
  const session=await runtime.requireSession(),scoped=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)
  if(expectedAccount&&(expectedAccount.userId!==session.userId||expectedAccount.refreshToken!==session.refreshToken))throw new ArkmePluginError('excerpt-account-changed','账号已变化，请重新打开原文',false,409)
  const read=async(s:RecordExcerptSource):Promise<RecordExcerptOriginal>=>{
    switch(s.kind){
      case 'record':{
        if(!s.chat_session_uid&&!s.relation_uid){
          if(s.owner_user_id!==session.userId)throw unavailable()
          const item=await readers.personal(s.record_uid,scoped)
          return {title:item.title||'原快记',text:item.textContent,at:item.sendAtMillis,textFormat:item.textFormat??'plain',...(item.recordVersion===undefined?{}:{recordVersion:item.recordVersion})}
        }
        const data=await runtime.authenticatedChatPost('/api/v1/chats/records/detail',{chat_session_uid:s.chat_session_uid,record_uid:s.record_uid,record_owner_user_id:s.owner_user_id,rel_uid:s.relation_uid},session,scoped,{bypassCache:true,cacheMs:0,lane:'interactive-read'})
        const item=obj(obj(data).item),relation=obj(item.relation),record=obj(item.record),core=obj(record.payload)
        if(str(relation.rel_uid)!==s.relation_uid||str(core.record_uid)!==s.record_uid||Number(core.owner_user_id)!==s.owner_user_id||Number(record.status??core.status)!==1||Number(core.content_access_state??record.content_access_state??1)!==1)throw unavailable()
        return {title:str(core.title)||'原消息',text:str(core.text_content),textFormat:obj(core.content_payload).text_format==='markdown'?'markdown':'plain',recordVersion:Number(core.version),at:Number(relation.attach_at)||0}
      }
      case 'codex_event':{
        const data=obj(await runtime.authenticatedTeamPost('/api/v1/team-codex/events/detail',{source_id:s.source_id,task_id:s.task_id,event_id:s.event_id},session,scoped,true))
        if(typeof data.text!=='string'||data.text_format!=='plain'&&data.text_format!=='markdown')throw unavailable()
        return {title:'Codex 原文',text:data.text,textFormat:data.text_format,at:Number(data.at)||0}
      }
      case 'team_message':{
        const data=obj(await runtime.authenticatedTeamPost('/api/v1/team/conversations/timeline/locate',{conversation_uid:s.team_conversation_uid,message_uid:s.team_message_uid,side:s.side??'team',limit:1},session,scoped,true))
        const row=(Array.isArray(data.messages)?data.messages:[]).map(obj).find(item=>item.message_uid===s.team_message_uid),content=obj(row?.record)
        if(!row||row.state!=='published'||content.status!=='available')throw unavailable()
        return {title:str(content.title)||'团队原消息',text:str(content.text_content),textFormat:obj(content.content_payload).text_format==='markdown'?'markdown':'plain',...(Number.isSafeInteger(content.version)?{recordVersion:Number(content.version)}:{}),at:Number(row.created_at)||0}
      }
      case 'agent_message':return {title:'Arko 原文',...await readers.agent(s.agent_session_id,s.agent_message_id,session.userId,scoped).then(item=>({text:item.text,at:item.createdAtMillis,textFormat:item.textFormat}))}
      case 'recording_segment':return readers.recording(s.recording_uid,s.segment_uid,scoped)
      case 'call_segment':return readers.call(s.call_uid,s.segment_uid,scoped)
      case 'dsh_message':{
        if(!s.role)throw unavailable()
        const data=obj(await runtime.authenticatedDshRemotePost('/api/v1/dsh-remote/messages/selection-context',{prefer_format_version:4,targets:[{runtime_ref:s.runtime_ref,session_ref:s.session_ref,event_seq:s.event_seq,role:s.role}]},session,scoped))
        const row=Array.isArray(data.items)&&data.items.length===1?obj(data.items[0]):{}
        if(row.runtime_ref!==s.runtime_ref||row.session_ref!==s.session_ref||row.event_seq!==s.event_seq||row.role!==s.role||typeof row.canonical_text!=='string')throw unavailable()
        return {title:'DeepSeek Harness 原文',text:row.canonical_text}
      }
    }
  }
  const result=await read(source)
  scoped.throwIfAborted()
  const current=await runtime.accountScopedSession()
  if(!current||current.userId!==session.userId||current.refreshToken!==session.refreshToken)throw new ArkmePluginError('excerpt-account-changed','账号已变化，请重新打开原文',false,409)
  if(Buffer.byteLength(result.text,'utf8')>512*1024)throw new ArkmePluginError('excerpt-source-too-large','原文过长，请在来源会话查看',false,413)
  return result
}

/** A digest and exact range suffice; never persist or disclose unselected context. */
export function matchExcerptOriginal(original:RecordExcerptOriginal,quote:SelectedTextNoteQuote):RecordExcerptOriginal {
 const a=quote.sourceSelection
 if(!a)return original
 const item={textContent:original.text,textFormat:original.textFormat??'plain'}
 const canonical=quoteCanonicalText(item)
 // Codex captures offsets and digest from its visible prose, including for Markdown.
 const digestSource=quote.source?.kind==='codex_event'?{textContent:canonical,textFormat:'plain' as const}:item
 const digest=createHash('sha256').update(quoteSourceContent(digestSource)).digest('hex')
 const boundary=(n:number)=>n>=0&&n<=canonical.length&&!(n>0&&n<canonical.length&&/[\uDC00-\uDFFF]/.test(canonical[n]!))
 if(digest!==a.source_digest||a.record_version!==undefined&&a.record_version!==original.recordVersion||!boundary(a.start)||!boundary(a.end)||canonical.slice(a.start,a.end)!==normalizeQuoteText(quote.text))throw new ArkmePluginError('excerpt-source-changed','原文版本或选区已变化；已发送摘录仍保留',false,409)
 return {...original,selection:{start:a.start,end:a.end}}
}

/** Rebase a paged plain-text view using owner offsets, never by searching equal prose. */
export function rebaseExcerptSelection(fullText:string,scalarStart:number,scalarEnd:number,quote:SelectedTextNoteQuote):NonNullable<SelectedTextNoteQuote['sourceSelection']> {
 const a=quote.sourceSelection,points=Array.from(fullText)
 if(!a||!Number.isSafeInteger(scalarStart)||!Number.isSafeInteger(scalarEnd)||scalarStart<0||scalarEnd<=scalarStart||scalarEnd>points.length)throw unavailable()
 const fragment=points.slice(scalarStart,scalarEnd).join('')
 matchExcerptOriginal({title:'',text:fragment,...(a.record_version===undefined?{}:{recordVersion:a.record_version})},quote)
 const leading=fragment.match(/^\s*/u)?.[0]??''
 const prefix=points.slice(0,scalarStart).join('')+leading
 const base=prefix.trimStart().replace(/\s+/gu,' ').length
 const rebased={...a,source_digest:createHash('sha256').update(quoteSourceContent({textContent:fullText,textFormat:'plain'})).digest('hex'),start:base+a.start,end:base+a.end}
 matchExcerptOriginal({title:'',text:fullText,...(a.record_version===undefined?{}:{recordVersion:a.record_version})},{...quote,sourceSelection:rebased})
 return rebased
}
