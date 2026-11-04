import {useEffect, useRef, useState, type CSSProperties} from 'react'
import type {ArkmeSourceItem, ArkmeTeam} from '../types.js'
import type {TeamInternalGroupPreview, TeamInternalGroupResult} from '../team-internal-group-contract.js'
import {callArkme} from './api.js'
import {arkmeTheme} from './arkme-theme.js'
import {tr, useArkmeLocale} from './locale.js'
import {TeamFeatureDialog} from './redesign/contacts/TeamFeatureDialog.js'

type Target = {mode:'create';teamJotmoId:string}|{mode:'link';source:ArkmeSourceItem}
type Props = {accountKey:string;target:Target;onClose():void}
const errorText = (e:unknown) => e instanceof Error ? e.message : tr('加载失败，请重试')
const roleName = {owner:'群主',admin:'管理员',member:'成员'} as const
export function TeamInternalGroupDialog(p:Props) {
  return <ScopedDialog key={JSON.stringify([p.accountKey,p.target.mode,p.target.mode==='create'?p.target.teamJotmoId:p.target.source.sourceRef])} {...p}/>
}
function ScopedDialog({accountKey,target,onClose}:Props) {
  useArkmeLocale()
  const [teams,setTeams]=useState<ArkmeTeam[]>(),[teamId,setTeamId]=useState(''),[name,setName]=useState('')
  const [loadError,setLoadError]=useState(''),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  const [busy,setBusy]=useState(false),[recovered,setRecovered]=useState(false),[result,setResult]=useState<TeamInternalGroupResult>()
  const bodyRef=useRef<HTMLDivElement>(null),inFlight=useRef<AbortController>(),requestUid=useRef('')
  const team=teams?.find(t=>t.jotmoId===teamId), canManage=team?.currentUserRole==='owner'||team?.currentUserRole==='admin'
  const requestedTeam=target.mode==='create'?target.teamJotmoId:undefined
  useEffect(()=>()=>inFlight.current?.abort(),[])
  useEffect(()=>{if(busy||result)bodyRef.current?.focus({preventScroll:true})},[busy,result])
  useEffect(()=>{
    const c=new AbortController();setLoadError('')
    void callArkme<ArkmeTeam[]>('team.app.teams',{expectedAccountKey:accountKey},c.signal).then(items=>{
      if(c.signal.aborted)return
      if(!Array.isArray(items))throw new Error(tr('团队状态返回异常，请重试'))
      const selected=requestedTeam?items.find(t=>t.jotmoId===requestedTeam):items.length===1?items[0]:undefined
      if(requestedTeam&&!selected)throw new Error(tr('当前团队已不可访问'))
      setTeams(items)
      if(selected){setTeamId(selected.jotmoId);if(requestedTeam)setName(n=>n||tr('{v0}内部群',{v0:selected.name}))}
    }).catch(e=>{if(!c.signal.aborted)setLoadError(errorText(e))})
    return()=>c.abort()
  },[accountKey,requestedTeam,revision])
  const invoke=async(action:'prepare'|'prepare-original'|'confirm'|'recover'|'ack')=>{
    if(!team||inFlight.current)return
    const c=new AbortController();inFlight.current=c;setBusy(true);setError('')
    try{
      requestUid.current ||= crypto.randomUUID()
      const value=await callArkme<TeamInternalGroupResult>(`team.app.internal-group.${action}`,{
        expectedAccountKey:accountKey,teamRef:team.teamRef,
        ...(action==='prepare'?{requestUid:requestUid.current,mode:target.mode,...(target.mode==='create'?{name:name.trim()}:{sourceRef:target.source.sourceRef})}:{}),
        ...(action==='confirm'&&result?.state==='preview'?{previewRef:result.previewRef}:{}),
        ...(action==='ack'&&result&&'requestUid'in result?{requestUid:result.requestUid}:{}),
      },c.signal)
      if(c.signal.aborted)return
      if(!value||!['preview','none','acknowledged','unresolved','activating','ready','archived','rejected'].includes(value.state))throw new Error(tr('内部群状态返回异常，请重试'))
      if(action==='ack'&&value.state==='acknowledged'){onClose();return}
      if('requestUid'in value)requestUid.current=value.requestUid
      setResult(value.state==='none'?undefined:value);setRecovered(true)
    }catch(e){if(!c.signal.aborted)setError(errorText(e))}
    finally{if(inFlight.current===c)inFlight.current=undefined;if(!c.signal.aborted)setBusy(false)}
  }
  useEffect(()=>{
    setRecovered(false);setResult(undefined);setError('')
    if(team)void invoke('recover')
    return()=>{inFlight.current?.abort();inFlight.current=undefined}
  },[team?.teamRef,revision])
  useEffect(()=>{
    if(result?.state!=='activating'||busy||error)return
    const timer=setTimeout(()=>void invoke('recover'),2000)
    return()=>clearTimeout(timer)
  },[result,busy,error])
  const preview=result?.state==='preview'?result:undefined
  const locked=busy||!!result
  const canPrepare=!!team&&canManage&&recovered&&!loadError&&(target.mode==='link'||!!name.trim())
  const action=result?.state==='ready'||result?.state==='archived'||result?.state==='rejected'?'ack':result?.state==='activating'?'recover':result?.state==='unresolved'||preview&&error?'prepare-original':preview?'confirm':!recovered?'recover':'prepare'
  const label=busy?'正在检查…':action==='ack'?'完成':action==='recover'?'查询原请求结果':action==='prepare-original'?'重新检查原请求':action==='confirm'?'确认以上变更':target.mode==='create'?'检查创建条件':'查看关联影响'
  const reset=()=>{requestUid.current='';setResult(undefined);setError('')}
  return <TeamFeatureDialog title={tr(target.mode==='create'?'创建团队内部群':'关联为团队内部群')}
    teamName={target.mode==='link'?target.source.displayName:team?.name??tr('团队')} onClose={onClose}
    footer={<button type="button" disabled={busy||!team||(action==='prepare'&&!canPrepare)} onClick={()=>void invoke(action)}>{tr(label)}</button>}>
    <div ref={bodyRef} tabIndex={-1} style={styles.body}>
      <p style={styles.copy}>{tr('成员随团队自动同步：加入团队后自动入群，离开团队后自动移出。')}</p>
      <p style={styles.copy}>{tr('群内按本人身份发言，不需要选择个人或团队身份。')}</p>
      {!teams&&!loadError&&<p role="status">{tr('正在加载我的团队…')}</p>}
      {loadError&&<p role="alert">{loadError} <button type="button" onClick={()=>setRevision(r=>r+1)}>{tr('重试')}</button></p>}
      {teams&&target.mode==='link'&&<label style={styles.label}>{tr('关联团队')}<select style={styles.input} value={teamId} disabled={busy} onChange={e=>{setTeamId(e.target.value);reset()}}>
        <option value="">{tr('请选择团队')}</option>{teams.map(t=><option key={t.jotmoId} value={t.jotmoId}>{t.name}</option>)}
      </select></label>}
      {teams?.length===0&&<p>{tr('你尚未加入团队')}</p>}
      {team&&target.mode==='create'&&<label style={styles.label}>{tr('群名称')}<input style={styles.input} maxLength={120} disabled={locked} value={name} onChange={e=>{setName(e.target.value);reset()}}/></label>}
      {team&&!canManage&&<p role="status">{tr('仅团队所有者或管理员可创建或关联内部群。')}</p>}
      {preview&&<Preview value={preview}/>}
      {result?.state==='unresolved'&&<p role="status">{tr('原请求“{v0}”的结果尚未确认。重新检查会继续核对原请求，不会另建群。',{v0:result.label??''})}</p>}
      {result?.state==='activating'&&<p role="status">{tr('请求已受理，正在同步成员并完成群访问交接。可关闭窗口，稍后查询原请求。')}</p>}
      {result?.state==='ready'&&<p role="status">{tr('内部群已就绪，成员已按团队同步。可在群聊列表中打开。')}</p>}
      {result?.state==='rejected'&&<p role="status">{tr('旧群成员已变化，本次关联未生效。完成后请重新检查关联影响。')}</p>}
      {result?.state==='archived'&&<p role="status">{tr('该请求已完成；团队已解散，内部群已归档。')}</p>}
      {!result&&<p style={styles.copy}>{tr('检查后会展示成员、角色、历史消息和客户端升级的影响；确认后才会生效。')}</p>}
      {error&&<p role="alert" style={{color:arkmeTheme.danger}}>{error}</p>}
    </div>
  </TeamFeatureDialog>
}
function Preview({value:v}:{value:TeamInternalGroupPreview}) {
  return <div style={styles.preview}>
    <p>{tr('将新增 {v0} 人，移出 {v1} 人，保留 {v2} 人；保留 {v3} 个机器人。',{v0:v.add.length,v1:v.remove.length,v2:v.retainCount,v3:v.botCount})}</p>
    {v.add.length>0&&<div>{tr('新增成员')}<ul>{v.add.map(p=><li key={p.key}>{p.name}</li>)}</ul></div>}
    {v.remove.length>0&&<div>{tr('移出成员')}<ul>{v.remove.map(p=><li key={p.key}>{p.name}</li>)}</ul></div>}
    <p>{tr('群主：{v0}（团队所有者）',{v0:v.owner.name})}</p>
    {v.roleChanges.length>0&&<ul>{v.roleChanges.map(p=><li key={p.key}>{p.name}：{tr(roleName[p.before])} → {tr(roleName[p.after])}</li>)}</ul>}
    <p>{tr('新增及重新加入的成员只可查看本次入群后的消息；原群保留成员已有的合法历史权限不变。')}</p>
    <p>{tr('不能单独退群或解除关联；免打扰和首页显示由你自行设置。机器人及历史消息的实际作者保持不变。')}</p>
    {v.closePublicAccess&&<p>{tr('确认后将关闭公开发现和公开入群。')}</p>}
    {v.requiresClientUpgrade&&<p>{tr('此群要求升级客户端后继续使用，其他群不受影响。')}</p>}
    <p style={styles.copy}>{tr('确认时会再次核对团队和群状态；预览变化后需要重新检查。')}</p>
  </div>
}
const styles:Record<string,CSSProperties>={
  body:{display:'grid',gap:14,padding:20,fontSize:13,outline:'none'},
  copy:{margin:0,color:arkmeTheme.secondary,lineHeight:1.7},
  preview:{display:'grid',gap:8,maxHeight:'45vh',overflowY:'auto',padding:12,border:`1px solid ${arkmeTheme.borderSoft}`,borderRadius:8},
  label:{display:'grid',gap:8},
  input:{width:'100%',minWidth:0,boxSizing:'border-box',padding:'9px 12px',border:`1px solid ${arkmeTheme.borderSoft}`,borderRadius:8,background:arkmeTheme.base,color:arkmeTheme.text,font:'inherit'},
}
