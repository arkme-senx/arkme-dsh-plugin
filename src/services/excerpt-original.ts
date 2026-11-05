import { readExcerptSource, type RecordExcerptOriginal, type RecordExcerptSource } from '../record-excerpt.js'
import { ArkmePluginError, objectValue as obj, stringValue as str, type ServiceRuntime } from './service.js'

export interface ExcerptOriginalReaders {
  personal(uid:string,signal:AbortSignal):Promise<{textContent:string;title:string;sendAtMillis:number}>
  agent(session:number,message:number,user:number,signal:AbortSignal):Promise<{text:string;createdAtMillis:number}>
  recording(uid:string,segment:string,signal:AbortSignal):Promise<RecordExcerptOriginal>
  call(uid:string,segment:string,signal:AbortSignal):Promise<RecordExcerptOriginal>
}
const unavailable=()=>new ArkmePluginError('excerpt-source-unavailable','原文已失效或当前无权查看；个人摘录仍保留',false,404)

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
          return {title:item.title||'原快记',text:item.textContent,at:item.sendAtMillis}
        }
        const data=await runtime.authenticatedChatPost('/api/v1/chats/records/detail',{chat_session_uid:s.chat_session_uid,record_uid:s.record_uid,record_owner_user_id:s.owner_user_id,rel_uid:s.relation_uid},session,scoped,{bypassCache:true,cacheMs:0,lane:'interactive-read'})
        const item=obj(obj(data).item),relation=obj(item.relation),record=obj(item.record),core=obj(record.payload)
        if(str(relation.rel_uid)!==s.relation_uid||str(core.record_uid)!==s.record_uid||Number(core.owner_user_id)!==s.owner_user_id||Number(record.status??core.status)!==1||Number(core.content_access_state??record.content_access_state??1)!==1)throw unavailable()
        return {title:str(core.title)||'原消息',text:str(core.text_content),at:Number(relation.attach_at)||0}
      }
      case 'codex_event':{
        const data=obj(await runtime.authenticatedTeamPost('/api/v1/team-codex/events/detail',{source_id:s.source_id,task_id:s.task_id,event_id:s.event_id},session,scoped,true))
        if(typeof data.text!=='string')throw unavailable()
        return {title:'Codex 原文',text:data.text,at:Number(data.at)||0}
      }
      case 'team_message':{
        const data=obj(await runtime.authenticatedTeamPost('/api/v1/team/conversations/timeline/locate',{conversation_uid:s.team_conversation_uid,message_uid:s.team_message_uid,side:s.side??'team',limit:1},session,scoped,true))
        const row=(Array.isArray(data.messages)?data.messages:[]).map(obj).find(item=>item.message_uid===s.team_message_uid),content=obj(row?.content)
        if(!row||row.state!=='published'||content.status!=='available')throw unavailable()
        return {title:str(content.title)||'团队原消息',text:str(content.text_content),at:Number(row.created_at)||0}
      }
      case 'agent_message':return {title:'Arko 原文',...await readers.agent(s.agent_session_id,s.agent_message_id,session.userId,scoped).then(item=>({text:item.text,at:item.createdAtMillis}))}
      case 'recording_segment':return readers.recording(s.recording_uid,s.segment_uid,scoped)
      case 'call_segment':return readers.call(s.call_uid,s.segment_uid,scoped)
      case 'dsh_message':{
        if(!s.role)throw unavailable()
        const data=obj(await runtime.authenticatedDshRemotePost('/api/v1/dsh-remote/messages/selection-context',{targets:[{runtime_ref:s.runtime_ref,session_ref:s.session_ref,event_seq:s.event_seq,role:s.role}]},session,scoped))
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
