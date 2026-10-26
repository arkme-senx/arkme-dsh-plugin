import {useEffect,useState} from 'react'
import type {TeamMessage} from '../team-app-contract.js'
import {createArkmeSdk} from '../sdk/index.js'
import {ArkmeDetailShell} from './ArkmeDetailShell.js'
import {ForwardRecordsDetail} from './ArkmeNoteDetails.js'
import {teamMessagePresentation,TeamMessageMediaScope} from './TeamMessageContent.js'
import {teamText as tr} from './team-messaging-i18n.js'

/** Reuses the established forward detail view. Full content is fetched only
 * for the clicked, currently authorized Team occurrence and exact version. */
export function TeamForwardDetail({message,conversationRef,onClose}:{message:TeamMessage;conversationRef:string;onClose():void}){
 const scope=JSON.stringify([conversationRef,message.ref,message.version])
 const [value,setValue]=useState<{scope:string;message:TeamMessage}>(),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 useEffect(()=>{
  const controller=new AbortController();setValue(undefined);setError('')
  void createArkmeSdk().preflightTeamMessages(conversationRef,[{messageRef:message.ref,version:message.version}],controller.signal).then(rows=>{
   if(!rows[0]?.forwardRecords)throw new Error(tr('内容当前不可用'))
   if(!controller.signal.aborted)setValue({scope,message:rows[0]})
  }).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:tr('加载失败'))})
  return()=>controller.abort()
 },[conversationRef,message.ref,message.version,retry])
 if(value?.scope===scope)return <TeamMessageMediaScope message={value.message}><ForwardRecordsDetail item={teamMessagePresentation(value.message)} onClose={onClose}/></TeamMessageMediaScope>
 return <ArkmeDetailShell title={tr('转发快记')} label={tr('转发快记')} onClose={onClose}><div role={error?'alert':'status'}>{error||tr('加载中...')}{error&&<button type="button" onClick={()=>setRetry(value=>value+1)}>{tr('重试')}</button>}</div></ArkmeDetailShell>
}
