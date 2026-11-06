import {useEffect,useRef,useState,type CSSProperties} from 'react'
import type {ArkmeSourceItem} from '../types.js'
import type {TeamGroupParticipant,TeamGroupApproval,TeamGroupPage,TeamGroupCommandAction,TeamGroupCommandResult} from '../team-group-contract.js'
import {callArkme} from './api.js'
import {ArkmeTeamAvatar} from './ArkmeTeamAvatar.js'
import {ArkmeDshRowActionsMenu} from './ArkmeDshMenu.js'
import {ArkmeConfirmDialog} from './ArkmeConfirmDialog.js'
import {TeamPublicCardDialog} from './TeamPublicCardDialog.js'
import {retainTeamGroupCommand} from './team-group-command-attempt.js'
import {invalidateTeamWorkspace} from './team-messaging-events.js'
import {arkmeInterwovenInvalidation} from './chat-directory-store.js'
import {arkmeTheme} from './arkme-theme.js'
import {tr} from './locale.js'

type TeamStyles=Record<string,CSSProperties>
type Target={key:string;teamRef:string;name:string;revision:number;admissionRef?:string;action:TeamGroupCommandAction}
export function GroupTeamsSection({accountKey,source,teams,canManage,leaveAvailable,ready,refresh,styles}:{accountKey:string;source:ArkmeSourceItem;teams:TeamGroupParticipant[];canManage:boolean;leaveAvailable:boolean;ready:boolean;refresh():void;styles:TeamStyles}) {
 const [menu,setMenu]=useState(''),[publicTeam,setPublicTeam]=useState<TeamGroupParticipant>(),[target,setTarget]=useState<Target>(),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [approvals,setApprovals]=useState<TeamGroupApproval[]>([]),[approvalError,setApprovalError]=useState(''),[approvalLoading,setApprovalLoading]=useState(false),[attempt,retry]=useState(0)
 const lifecycle=useRef<AbortController>()
 useEffect(()=>{
  const current=new AbortController();lifecycle.current=current
  setMenu('');setPublicTeam(undefined);setTarget(undefined);setError('');setBusy(false)
  return()=>current.abort()
 },[accountKey,source.sourceKey])
 useEffect(()=>{
  setApprovals([]);setApprovalError('')
  if(!ready||!canManage)return
  const controller=new AbortController();setApprovalLoading(true)
  void(async()=>{
   const rows:TeamGroupApproval[]=[],seen=new Set<string>();let cursor:string|undefined
   do {
    const page=await callArkme<TeamGroupPage<TeamGroupApproval>>('team.app.group.approvals',{expectedAccountKey:accountKey,sourceRef:source.sourceRef,...(cursor?{cursor}:{})},controller.signal)
    if(!Array.isArray(page.items)||page.hasMore&&(!page.nextCursor||seen.has(page.nextCursor)))throw new Error('审批列表分页未前进')
    rows.push(...page.items);cursor=page.hasMore?page.nextCursor:undefined;if(cursor)seen.add(cursor)
   }while(cursor)
   if(!controller.signal.aborted)setApprovals(rows)
  })().catch(e=>{if(!controller.signal.aborted)setApprovalError(e instanceof Error?e.message:tr('审批列表加载失败'))}).finally(()=>{if(!controller.signal.aborted)setApprovalLoading(false)})
  return()=>controller.abort()
 },[accountKey,source.sourceKey,source.sourceRef,ready,canManage,attempt])
 const choose=(value:Target)=>{setMenu('');setError('');setTarget(value)}
 const execute=async()=>{
  if(!target||busy||!lifecycle.current)return
  const signal=lifecycle.current.signal;setBusy(true);setError('')
  try {
   const retained=retainTeamGroupCommand(localStorage,accountKey,source.sourceKey??source.sourceRef,target.key,{action:target.action,sourceRef:source.sourceRef,teamRef:target.teamRef,expectedRevision:target.revision,...(target.admissionRef?{admissionRef:target.admissionRef}:{})})
   const recovered=retained.recovered?await callArkme<TeamGroupCommandResult>('team.app.group.status',{requestUid:retained.command.requestUid,expectedAccountKey:accountKey},signal):undefined
   const result=recovered&&recovered.state!=='not_found'?recovered:await callArkme<TeamGroupCommandResult>('team.app.group.command',{...retained.command,expectedAccountKey:accountKey},signal)
   signal.throwIfAborted()
   const expected={leave:'left',remove:'removed',approve:'joined',reject:'rejected'}[target.action as Exclude<TeamGroupCommandAction,'join'>]
   if(result.state!==expected)throw new Error(tr('操作结果尚未确认，请使用原操作重试'))
   localStorage.removeItem(retained.key)
   setTarget(undefined);arkmeInterwovenInvalidation.invalidate(source.sourceKey??source.sourceRef);refresh();retry(n=>n+1);invalidateTeamWorkspace(accountKey,source.canonicalChatSourceKey)
  } catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:tr('操作失败，请重试'))}
  finally{if(!signal.aborted)setBusy(false)}
 }
 const label=target?.action==='leave'?tr('退出群聊'):target?.action==='remove'?tr('移出群聊'):target?.action==='approve'?tr('同意入群'):tr('拒绝入群')
 return <>
  {teams.map(team=><div key={team.key} style={{display:'flex',alignItems:'center'}}>
   <button type="button" data-arkme-feedback="neutral" data-arkme-group-team-row style={{...styles.memberRow,flex:1,minWidth:0}} onClick={()=>setPublicTeam(team)}>
    <ArkmeTeamAvatar name={team.name} size={32}/><span style={styles.memberMain}><span style={styles.memberNameLine}><span style={styles.memberName}>{team.name}</span><span style={styles.badge}>{tr('团队')}</span></span><span style={{display:'block',minHeight:16,fontSize:12,lineHeight:'16px',color:arkmeTheme.secondary}}>@{team.jotmoId}</span></span>
   </button>
   {(canManage||leaveAvailable&&team.canLeave)&&<ArkmeDshRowActionsMenu open={menu===team.key} label={tr('{v0}的团队操作',{v0:team.name})} onToggle={()=>setMenu(menu===team.key?'':team.key)} onClose={()=>setMenu('')}
    items={[...(leaveAvailable&&team.canLeave?[{id:'leave',label:tr('团队退出群聊')}]:[]),...(canManage?[{id:'remove',label:tr('将团队移出群聊')}]:[])]}
    onSelect={action=>choose({...team,action:action as 'leave'|'remove'})}/>}
  </div>)}
  {ready&&!leaveAvailable&&<button type="button" style={styles.restrictionRetry} onClick={refresh}>{tr('团队操作资格暂时无法确认，点击重试')}</button>}
  {ready&&canManage&&<div aria-label={tr('团队入群审批')}>
   {approvalLoading&&<div style={styles.loading}>{tr('正在读取团队申请…')}</div>}
   {approvalError&&<button type="button" role="alert" style={styles.restrictionRetry} onClick={()=>retry(n=>n+1)}>{approvalError}{tr('，点击重试')}</button>}
   {approvals.map(approval=><div key={approval.key} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',fontSize:13}}><span style={{flex:1,minWidth:0}}>{approval.name}{tr('申请入群')}</span>
    <button type="button" onClick={()=>choose({...approval,action:'approve'})}>{tr('同意')}</button><button type="button" onClick={()=>choose({...approval,action:'reject'})}>{tr('拒绝')}</button>
   </div>)}
  </div>}
  {publicTeam&&<TeamPublicCardDialog accountKey={accountKey} jotmoId={publicTeam.jotmoId} teamRef={publicTeam.teamRef} onClose={()=>setPublicTeam(undefined)}/>}
  {target&&<ArkmeConfirmDialog titleId="arkme-team-group-command" title={tr('{v0}？',{v0:label})} description={target.action==='leave'||target.action==='remove'?tr('「{v0}」的同事将无法继续通过该团队查看或回复本群消息。',{v0:target.name}):tr('处理「{v0}」的入群申请。',{v0:target.name})} error={error} busy={busy} confirmLabel={label} busyLabel={tr('正在处理…')} onClose={()=>{if(!busy)setTarget(undefined)}} onConfirm={()=>{void execute()}}/>}
 </>
}
