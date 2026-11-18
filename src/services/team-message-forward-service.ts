import {createHash} from 'node:crypto'
import type {TeamForwardInput} from '../team-message-contract.js'
import type {ArkmeSourceSendResult} from '../types.js'
import type {TeamAppService} from './team-app-service.js'
import type {SourceService,ArkmeSourceRefPayload} from './source-service.js'
import {postChatMessageCreation} from './direct-message-admission-service.js'
import {bindGroupSourceRepresentation} from './group-representation.js'
import {ArkmePluginError,objectValue,stringValue,type ServiceRuntime} from './service.js'

const invalid=()=>new ArkmePluginError('team-forward-invalid','转发请求无效，请重新选择',false,400)
const unknown=()=>new ArkmePluginError('team-forward-outcome-unknown','转发结果尚未确认，请使用原请求重试',false,409)
function clientUid(request:string):string {
 const bytes=createHash('sha256').update(`team-forward:${request}`).digest().subarray(0,16)
 bytes[6]=((bytes[6]??0)&15)|80;bytes[8]=((bytes[8]??0)&63)|128
 const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

export interface RecordTeamForwardInput {
 targetConversationRef:string;expectedUserId:number;requestId:string;sendAtMillis:number;commentText?:string
 sources:{record_uid:string;record_owner_user_id?:number;chat_session_uid?:string;relation_uid?:string;access_ref?:string}[]
}

/** Each destination keeps its native acceptance, identity and recovery owner.
 * This adapter resolves opaque selectors only; it never rebuilds source text. */
export class TeamMessageForwardService {
 constructor(private readonly runtime:ServiceRuntime,private readonly team:TeamAppService,private readonly sources:Pick<SourceService,'openSourceRef'|'invalidateSourceListCache'>,private readonly changed:(target:ArkmeSourceRefPayload,sequence?:number)=>void|Promise<void>){}
 async forwardRecords(input:RecordTeamForwardInput,signal?:AbortSignal):Promise<ArkmeSourceSendResult>{
  const comment=input.commentText?.trim()??''
  if(!input.targetConversationRef||!Number.isSafeInteger(input.expectedUserId)||input.expectedUserId<=0||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(input.requestId)||!Number.isSafeInteger(input.sendAtMillis)||input.sendAtMillis<=0||comment.length>20000||!input.sources.length||input.sources.length>100)throw invalid()
  const session=await this.runtime.requireSession()
  const guard=async()=>{
   signal?.throwIfAborted()
   const current=await this.runtime.accountScopedSession()
   if(session.userId!==input.expectedUserId||current?.userId!==session.userId||current.refreshToken!==session.refreshToken)throw new ArkmePluginError('team-account-changed','登录账号已变化，请重新打开转发',false,409)
   signal?.throwIfAborted()
  }
  await guard()
  const context=await this.team.resolveConversation(input.targetConversationRef,session.userId)
  await guard()
  const raw=objectValue(await this.runtime.authenticatedTeamPost('/api/v1/team/conversations/messages/forward',{
   ...context,client_message_uid:clientUid(input.requestId),expected_reply_seq:0,record_sources:input.sources,
  },session,signal))
  await guard()
  if(!stringValue(raw.message_uid)||!['published','recalled'].includes(String(raw.state))||raw.side!==context.side||!Number.isSafeInteger(raw.seq)||Number(raw.seq)<=0)throw unknown()
  const receipt=await this.team.messageReceipt(raw,session.userId,context)
  await guard()
  const result:ArkmeSourceSendResult={sourceRef:input.targetConversationRef,itemUid:receipt.key,status:1,sequence:receipt.seq,localState:'synced'}
  if(raw.state==='recalled')return {...result,warningText:'该消息已投递，随后被撤回'}
  if(comment)try{
   const response=objectValue(await this.runtime.authenticatedTeamPost('/api/v1/team/conversations/messages/send',{
    ...context,client_message_uid:clientUid(input.requestId+':comment'),expected_reply_seq:0,content:{text_content:comment,template_kind:1},
   },session,signal))
   await guard()
   if(!['published','recalled'].includes(String(response.state))||response.side!==context.side||!stringValue(response.message_uid)||!Number.isSafeInteger(response.seq)||Number(response.seq)<=0)throw unknown()
  }catch(error){await guard();return {...result,warningText:'消息已转发，附言尚未确认，请使用原请求重试'}}
  return result
 }
 async forward(input:TeamForwardInput,signal?:AbortSignal):Promise<ArkmeSourceSendResult>{
  if(!input||!input.requestId||!/^[A-Za-z0-9._:-]{1,128}$/u.test(input.requestId)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(input.recordUid)||!Number.isSafeInteger(input.sendAtMillis)||input.sendAtMillis<=0)throw invalid()
  const comment=input.commentText?.trim()??''
  if(comment.length>20000||comment&&(!input.commentRecordUid||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(input.commentRecordUid)||input.commentRecordUid===input.recordUid))throw invalid()
  const session=await this.runtime.requireSession()
  const selected=await this.team.resolveMessageSelection(input.conversationRef,input.selections,session.userId)
  const target=objectValue(input.target)
  let result:ArkmeSourceSendResult
  let nativeTarget:ArkmeSourceRefPayload|undefined
  let recalled=false
  if(target.kind==='team'){
   if(typeof target.conversationRef!=='string'||target.sourceRef!==undefined)throw invalid()
   const context=await this.team.resolveConversation(target.conversationRef,session.userId)
   const raw=objectValue(await this.runtime.authenticatedTeamPost('/api/v1/team/conversations/messages/forward',{...context,client_message_uid:clientUid(input.requestId),expected_reply_seq:0,sources:selected},session,signal))
   if(!stringValue(raw.message_uid)||!['published','recalled'].includes(String(raw.state))||raw.side!==context.side||typeof raw.seq!=='number'||!Number.isSafeInteger(raw.seq)||raw.seq<=0)throw unknown()
   recalled=raw.state==='recalled'
   const receipt=await this.team.messageReceipt(raw,session.userId,context)
   result={sourceRef:target.conversationRef,itemUid:receipt.key,status:1,sequence:receipt.seq,localState:'synced'}
  }else if(target.kind==='source'){
   if(typeof target.sourceRef!=='string'||target.conversationRef!==undefined)throw invalid()
   nativeTarget=await this.sources.openSourceRef(target.sourceRef,session.userId)
   if(nativeTarget.kind==='private_chat'||nativeTarget.kind==='group_chat'){
    const delegation=nativeTarget.groupDelegation
    const representation=bindGroupSourceRepresentation(nativeTarget,undefined)
    const raw=objectValue(await postChatMessageCreation(this.runtime,'/api/v1/chats/records/forward',{chat_session_uid:nativeTarget.ownerRef,client_request_id:input.requestId,source_items:selected.map(source=>({source_type:'team_message',team_source:source})),send_at:input.sendAtMillis,...(comment?{comment_text:comment}:{}),...(representation?{representation}:{})},session,signal,...(delegation?[{chatAccessRef:delegation.accessRef,trackWriteOutcome:true}]:[])))
    const itemUid=stringValue(raw.record_uid),sequence=typeof raw.seq==='number'&&Number.isSafeInteger(raw.seq)&&raw.seq>0?raw.seq:0
    if(!itemUid||!sequence)throw unknown()
    result={sourceRef:target.sourceRef,itemUid,status:1,sequence,localState:'synced'}
   }else if(['send_to_self','default_category','topic'].includes(nativeTarget.kind)){
    const topic=nativeTarget.kind==='topic'
    const raw=objectValue(await this.runtime.authenticatedPost(topic?'/api/v1/topics/records/team-message-forward/create':'/api/v1/records/team-message-forward/create',{record_uid:input.recordUid,...(topic?{topic_uid:nativeTarget.ownerRef}:{}),sources:selected,send_at:input.sendAtMillis},session,signal))
    const core=objectValue(raw.record_core)
    if(raw.accepted!==true||core.record_uid!==input.recordUid||core.owner_user_id!==session.userId)throw unknown()
    this.sources.invalidateSourceListCache(session.userId,'send_to_self')
    result={sourceRef:target.sourceRef,itemUid:input.recordUid,status:typeof core.status==='number'?core.status:1,localState:'synced'}
   }else throw invalid()
  }else throw invalid()
  if(recalled) result={...result,warningText:'该消息已投递，随后被撤回'}
  if(comment && !recalled && !(nativeTarget?.kind==='private_chat'||nativeTarget?.kind==='group_chat')) {
   try {
    if(target.kind==='team') {
     const context=await this.team.resolveConversation(String(target.conversationRef),session.userId)
     const receipt=objectValue(await this.runtime.authenticatedTeamPost('/api/v1/team/conversations/messages/send',{...context,client_message_uid:clientUid(input.requestId+':comment'),expected_reply_seq:0,content:{text_content:comment,template_kind:1}},session,signal))
     if(!['published','recalled'].includes(String(receipt.state))||!stringValue(receipt.message_uid))throw unknown()
    }else {
     const topic=nativeTarget?.kind==='topic'
     const receipt=objectValue(await this.runtime.authenticatedPost(topic?'/api/v1/topics/records/create':'/api/v1/records/create',{record_uid:input.commentRecordUid,...(topic?{topic_uid:nativeTarget!.ownerRef}:{}),template_kind:1,text_content:comment,send_at:input.sendAtMillis},session,signal))
     if(receipt.record_uid!==input.commentRecordUid||(topic?receipt.record_status!==1:receipt.status!==1))throw unknown()
    }
   }catch(error){signal?.throwIfAborted();result={...result,warningText:'消息已转发，附言尚未确认，请使用原请求重试'}}
  }
  signal?.throwIfAborted()
  const current=await this.runtime.accountScopedSession()
  if(current?.userId!==session.userId||current.refreshToken!==session.refreshToken)throw new ArkmePluginError('team-account-changed','登录账号已变化，请重新打开团队消息',false,409)
  if(nativeTarget)try{await this.changed(nativeTarget,result.sequence)}catch{/* acceptance is already confirmed */}
  return result
 }
}
