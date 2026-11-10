import {useEffect, useRef, useState, type CSSProperties} from 'react'
import type {ArkmeSourceItem, ArkmeTeam} from '../types.js'
import type {TeamInternalGroupPreview, TeamInternalGroupResult} from '../team-internal-group-contract.js'
import {callArkme} from './api.js'
import {arkmeTheme} from './arkme-theme.js'
import {tr, useArkmeLocale} from './locale.js'
import {TeamFeatureDialog} from './redesign/contacts/TeamFeatureDialog.js'

type Target = {mode:'create';teamJotmoId:string}|{mode:'link';source:ArkmeSourceItem}
type Props = {accountKey:string;target:Target;onClose():void;onReady?():void}
const errorText = (e:unknown) => e instanceof Error ? e.message : tr('加载失败，请重试')
const roleName = {owner:'群主',admin:'管理员',member:'成员'} as const
export function TeamInternalGroupDialog(p:Props) {
  return <ScopedDialog key={JSON.stringify([p.accountKey,p.target.mode,p.target.mode==='create'?p.target.teamJotmoId:p.target.source.sourceRef])} {...p}/>
}
function ScopedDialog({accountKey,target,onClose,onReady}:Props) {
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
      if(value.state==='ready')onReady?.()
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
  const label=busy?'处理中…':action==='ack'?'完成':action==='recover'?(result?.state==='activating'?'查询进度':'查询原请求'):action==='prepare-original'?'重新检查':action==='confirm'?(preview?.mode==='create'?'确认创建':'确认关联'):'下一步'
  const showForm=!result
  const showRules=showForm||!!preview
  const reset=()=>{requestUid.current='';setResult(undefined);setError('')}
  return <TeamFeatureDialog title={tr((preview?.mode??target.mode)==='create'?'创建团队内部群':'关联团队内部群')}
    className="arkme-internal-group-dialog"
    teamName={!result&&target.mode==='link'?target.source.displayName:team?.name??tr('团队')} onClose={onClose}
    footer={<button className="arkme-contact-remark-confirm" type="button" disabled={busy||!team||(action==='prepare'&&!canPrepare)} onClick={()=>void invoke(action)}>{tr(label)}</button>}>
    <div ref={bodyRef} tabIndex={-1} style={styles.body}>
      {showForm&&<p style={styles.copy}>{tr('成员随团队自动同步。')}</p>}
      {!teams&&!loadError&&<p role="status">{tr('正在加载我的团队…')}</p>}
      {loadError&&<p role="alert">{loadError} <button type="button" onClick={()=>setRevision(r=>r+1)}>{tr('重试')}</button></p>}
      {teams&&showForm&&target.mode==='link'&&<label style={styles.label}>{tr('关联团队')}<select style={styles.input} value={teamId} disabled={busy} onChange={e=>{setTeamId(e.target.value);reset()}}>
        <option value="">{tr('请选择团队')}</option>{teams.map(t=><option key={t.jotmoId} value={t.jotmoId}>{t.name}</option>)}
      </select></label>}
      {teams?.length===0&&<p>{tr('你尚未加入团队')}</p>}
      {team&&showForm&&target.mode==='create'&&<label style={styles.label}>{tr('群名称')}<input style={styles.input} maxLength={120} disabled={locked} value={name} onChange={e=>{setName(e.target.value);reset()}}/></label>}
      {team&&!canManage&&<p role="status">{tr('仅团队所有者或管理员可创建或关联内部群。')}</p>}
      {preview&&<Preview value={preview}/>}
      {result?.state==='unresolved'&&<Status title={tr('正在核对原请求')} detail={tr('“{v0}”尚未确认，重新检查会继续原请求，不会重复建群。',{v0:result.label??''})}/>}
      {result?.state==='activating'&&<Status title={tr('正在同步成员')} detail={tr('可关闭窗口，稍后打开查看进度。')}/>}
      {result?.state==='ready'&&<Status title={tr('内部群已就绪')} detail={tr('成员已同步，可在群聊列表中打开。')}/>}
      {result?.state==='rejected'&&<Status title={tr('关联未生效')} detail={tr('原群成员已变化，请完成后重新关联。')}/>}
      {result?.state==='archived'&&<Status title={tr('内部群已归档')} detail={tr('团队已解散。')}/>}
      {showRules&&<details style={styles.details}>
        <summary style={styles.summary}>{tr('了解同步规则')}</summary>
        <div style={styles.rules}>
          <p>{tr('加入团队自动入群，离开团队立即失去群访问权限。')}</p>
          <p>{tr('群内以本人身份发言，机器人和历史消息作者保持不变。')}</p>
          <p>{tr('免打扰和首页显示可单独设置；团队解散后内部群归档。')}</p>
        </div>
      </details>}
      {error&&<p role="alert" style={{margin:0,color:arkmeTheme.danger}}>{error}</p>}
    </div>
  </TeamFeatureDialog>
}
function Status({title,detail}:{title:string;detail:string}) {
  return <div role="status" style={styles.status}><h3 style={styles.heading}>{title}</h3><p style={styles.copy}>{detail}</p></div>
}
function Preview({value:v}:{value:TeamInternalGroupPreview}) {
  const row=(label:string,value:string,danger=false)=><div style={styles.row} key={label+value}><dt style={{color:danger?arkmeTheme.danger:arkmeTheme.secondary}}>{label}</dt><dd style={{margin:0}}>{value}</dd></div>
  return <>
    <div style={styles.target}><span style={{color:arkmeTheme.secondary}}>{tr(v.mode==='create'?'群名称':'关联群')}</span><strong>{v.label}</strong></div>
    <section aria-label={tr('成员变更')} style={styles.preview}>
      <h3 style={styles.heading}>{tr('成员变更')}</h3>
      <div style={styles.counts}>
        {v.add.length>0&&<span style={styles.count}>{tr('新增 {v0} 人',{v0:v.add.length})}</span>}
        {v.remove.length>0&&<span style={styles.count}>{tr('移出 {v0} 人',{v0:v.remove.length})}</span>}
        {v.retainCount>0&&<span style={styles.count}>{tr('保留 {v0} 人',{v0:v.retainCount})}</span>}
      </div>
      <dl style={{margin:0}}>
        {v.add.length>0&&row(tr('新增成员'),v.add.map(p=>p.name).join('、'))}
        {v.remove.length>0&&row(tr('移出成员'),v.remove.map(p=>p.name).join('、'),true)}
        {row(tr('群主'),tr('{v0}（团队所有者）',{v0:v.owner.name}))}
        {v.roleChanges.map(p=>row(tr('角色调整'),`${p.name}：${tr(roleName[p.before])} → ${tr(roleName[p.after])}`))}
        {v.botCount>0&&row(tr('机器人'),tr('保留 {v0} 个',{v0:v.botCount}))}
      </dl>
      {(v.retain.length > 0 || v.bots.length > 0) && <details style={styles.details}>
        <summary>{tr('查看保留名单')}</summary>
        <dl style={{margin:0}}>
          {v.retain.length > 0 && row(tr('保留成员'), v.retain.map(person => person.name).join('、'))}
          {v.bots.length > 0 && row(tr('机器人'), v.bots.map(bot => bot.name).join('、'))}
        </dl>
      </details>}
    </section>
    <section aria-label={tr('确认前请留意')} style={styles.rules}>
      <h3 style={styles.heading}>{tr('确认前请留意')}</h3>
      <p>{tr('新增或重新入群的成员，只能查看本次入群后的消息。')}{v.mode==='link'&&tr('保留成员的合法历史权限不变。')}</p>
      <p>{tr('成员与角色随团队同步，不能单独退群或解除关联。')}</p>
      {v.closePublicAccess&&<p>{tr('将关闭公开发现和公开入群。')}</p>}
    </section>
  </>
}
const styles:Record<string,CSSProperties>={
  body:{display:'grid',gap:16,padding:20,fontSize:13,lineHeight:1.5,outline:'none',overflowWrap:'anywhere'},
  copy:{margin:0,color:arkmeTheme.secondary,lineHeight:1.5},
  preview:{display:'grid',gap:10,padding:14,border:`1px solid ${arkmeTheme.border}`,borderRadius:10},
  heading:{fontSize:14,fontWeight:600,margin:0,color:arkmeTheme.text},
  counts:{display:'flex',flexWrap:'wrap',gap:8},
  count:{padding:'4px 8px',borderRadius:6,background:arkmeTheme.layer2},
  row:{display:'grid',gridTemplateColumns:'72px minmax(0,1fr)',gap:8,padding:'5px 0'},
  rules:{display:'grid',gap:6,color:arkmeTheme.secondary},
  details:{borderTop:`1px solid ${arkmeTheme.borderSoft}`,paddingTop:4},
  summary:{cursor:'pointer',padding:'10px 0',color:arkmeTheme.secondary},
  status:{display:'grid',gap:8,textAlign:'center',padding:'28px 12px'},
  target:{display:'grid',gridTemplateColumns:'72px minmax(0,1fr)',gap:8,padding:'10px 12px',background:arkmeTheme.layer1,borderRadius:8},
  label:{display:'grid',gap:8},
  input:{width:'100%',minWidth:0,boxSizing:'border-box',padding:'9px 12px',border:`1px solid ${arkmeTheme.borderSoft}`,borderRadius:8,background:arkmeTheme.layer1,color:arkmeTheme.text,font:'inherit'},
}
