import { useEffect, useRef, useState } from 'react'
import type { TeamGovernanceIntent, TeamGovernanceResult } from '../../../team-app-contract.js'
import { callArkme } from '../../api.js'
import { teamText as tr } from '../../team-messaging-i18n.js'
import { TeamFeatureDialog } from './TeamFeatureDialog.js'

export function TeamGovernanceDialog({accountKey,teamName,intent,onClose,onComplete}:{accountKey:string;teamName:string;intent:TeamGovernanceIntent;onClose:()=>void;onComplete:(result:TeamGovernanceResult)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const lifetime=useRef<AbortController>()
 useEffect(()=>{const controller=new AbortController();lifetime.current=controller;return()=>controller.abort()},[])
 const title=intent.kind==='role'?(intent.role==='admin'?'设置团队管理员':'取消团队管理员'):intent.kind==='transfer'?'转让团队':'解散团队'
 const description=intent.kind==='role'?tr('{v0}将成为{v1}，内部群角色同步更新。',{v0:intent.name,v1:tr(intent.role==='admin'?'团队管理员':'普通成员')}):intent.kind==='transfer'?tr('团队转让给{v0}，你将成为普通成员，内部群群主同步转移。',{v0:intent.name}):tr('团队解散后，内部群归档且不可访问。此操作无法撤销。')
 const submit=async()=>{
  const signal=lifetime.current?.signal
  if(busy||signal?.aborted)return
  setBusy(true);setError('')
  try{
   const result=await callArkme<TeamGovernanceResult>(`team.app.governance.${intent.kind}`,{expectedAccountKey:accountKey,teamRef:intent.teamRef,expectedMembershipRevision:intent.revision,...(intent.kind==='dissolve'?{}:{userRef:intent.userRef}),...(intent.kind==='role'?{role:intent.role}:{})},signal)
   if(!signal?.aborted)onComplete(result)
  }catch(error){if(!signal?.aborted)setError(error instanceof Error?error.message:tr('结果暂未确认，请刷新团队信息'))}
  finally{if(!signal?.aborted)setBusy(false)}
 }
 return <TeamFeatureDialog title={tr(title)} teamName={teamName} onClose={onClose} busy={busy}
   footer={<button type="button" className="arkme-contact-remark-confirm" disabled={busy} onClick={()=>{void submit()}}>{busy?tr('正在处理…'):tr('确认')}</button>}>
   <p>{description}</p>{error&&<p role="alert">{error}</p>}
 </TeamFeatureDialog>
}
