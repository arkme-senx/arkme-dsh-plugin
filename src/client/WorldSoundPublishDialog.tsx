import {ArkmeCloseButton} from './ArkmeCloseButton.js'
import {useEffect,useRef,useState,useSyncExternalStore,type CSSProperties} from 'react'
import {createPortal} from 'react-dom'
import type {WorldSoundPrepared,WorldSoundReceipt,WorldSoundSelection} from '../world-sound-contract.js'
import {callArkme} from './api.js'
import {arkmeAuthStore} from './auth-store.js'
import {arkmeTheme as c} from './arkme-theme.js'
import {TeamWorldPublisherPicker,useTeamWorldPublisher} from './TeamWorldPublisher.js'
import {tr} from './locale.js'
const button:CSSProperties={font:'inherit',fontSize:13,padding:'8px 14px',border:`1px solid ${c.border}`,borderRadius:8,background:c.base,color:c.text,cursor:'pointer'}
export function WorldSoundPublishDialog({selection,playing=false,onPreview,onClose}:{selection:WorldSoundSelection;playing?:boolean;onPreview():void;onClose():void}){
  const auth=useSyncExternalStore(arkmeAuthStore.subscribe,arkmeAuthStore.getSnapshot,arkmeAuthStore.getSnapshot).auth
  const account=auth?.status==='authenticated'?`${auth.environment}:${auth.userId}`:''
  const owner=useRef(account),panel=useRef<HTMLElement>(null),initial=useRef(selection)
  const publisher=useTeamWorldPublisher(account)
  const [prepared,setPrepared]=useState<WorldSoundPrepared>(),[receipt,setReceipt]=useState<WorldSoundReceipt>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0)
  const attempt=useRef<{requestUid:string;draftRef:string;teamRef?:string}>(),active=useRef<AbortController>()
  useEffect(()=>{
    if(account!==owner.current)return
    const controller=new AbortController();setLoading(true);setError('')
    void callArkme<WorldSoundPrepared>('world.sound-excerpts',{accountKey:account,action:'prepare',selection:initial.current},controller.signal).then(value=>{if(!controller.signal.aborted)setPrepared(value)}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:tr('暂时无法读取声音选段'))}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[account,retry])
  useEffect(()=>{const previous=document.activeElement instanceof HTMLElement?document.activeElement:undefined;panel.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>{active.current?.abort();previous?.focus()}},[])
  useEffect(()=>()=>active.current?.abort(),[account])
  if(!account||owner.current!==account)return null
  const submit=async()=>{
    if(!prepared||busy||receipt)return
    if(publisher.selected&&!publisher.team){setError(tr('所选团队身份暂不可用，请重新核验'));return}
    attempt.current??={requestUid:crypto.randomUUID(),draftRef:prepared.draftRef,...(publisher.selected?{teamRef:publisher.team!.teamRef}:{})}
    const request=new AbortController();active.current=request;setBusy(true);setError('')
    try{const value=await callArkme<WorldSoundReceipt>('world.sound-excerpts',{accountKey:account,action:'publish',...attempt.current,confirmed:true},request.signal);if(!request.signal.aborted)setReceipt(value)}catch(e){if(!request.signal.aborted)setError(e instanceof Error?e.message:tr('暂未确认提交结果，请重试原请求'))}finally{if(!request.signal.aborted)setBusy(false)}
  }
  const source=tr(selection.kind==='call'?'通话摘录':'录音摘录')
  const checkReceipt=async(withdraw=false)=>{
    if(!receipt||busy)return
    const request=new AbortController();active.current=request;setBusy(true);setError('')
    try{const value=await callArkme<WorldSoundReceipt>('world.sound-excerpts',{accountKey:account,action:'management',recordRef:receipt.recordRef,withdraw},request.signal);if(!request.signal.aborted)setReceipt(value)}catch(e){if(!request.signal.aborted)setError(e instanceof Error?e.message:tr('暂时无法读取审核结果'))}finally{if(!request.signal.aborted)setBusy(false)}
  }
  return createPortal(<div style={{position:'fixed',inset:0,zIndex:10300,background:'rgba(0,0,0,.3)',display:'grid',placeItems:'center',padding:20}} onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}>
    <section ref={panel} role="dialog" aria-modal="true" aria-label={tr('发布声音摘录')} style={{background:c.menu,color:c.text,borderRadius:16,padding:24,width:'min(520px,100%)',maxHeight:'85vh',overflowY:'auto',boxShadow:c.shadow}} onKeyDown={event=>{
      if(event.key==='Escape'&&!busy){event.stopPropagation();onClose()}
      if(event.key==='Tab'){const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')],first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    }}>
      <header style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h2 style={{margin:0,fontSize:17,fontWeight:500}}>{tr('发到世界')}</h2><ArkmeCloseButton aria-label={tr('关闭声音发布窗口')} disabled={busy} onClick={onClose}/></header>
      <p style={{color:c.secondary,fontSize:12,margin:'10px 0 16px'}}>{source}{prepared?` · ${prepared.excerpt.segments.length} ${tr('段')} · ${Math.ceil(prepared.excerpt.durationMillis/1000)} ${tr('秒')}`:''}</p>
      {loading&&<p role="status">{tr('正在核对所选声音与原文…')}</p>}
      {prepared&&<><div style={{background:c.subtle,borderRadius:10,padding:16}}><div style={{fontSize:11,color:c.secondary}}>{tr('卡片引语 · 所选原文')}</div><p style={{fontSize:19,lineHeight:1.8,margin:'8px 0 12px'}}>“{prepared.excerpt.segments[0]!.text}”</p><button type="button" style={button} disabled={busy||!!receipt} onClick={onPreview}>{tr(playing?'停止试听':'试听全部选段')}</button><p style={{fontSize:12,color:c.secondary,lineHeight:1.8,margin:'12px 0 0'}}>{tr('只公开选中的声音和原文，按原始顺序连续播放。')}</p></div>
        <details style={{margin:'12px 0',fontSize:12,color:c.secondary}}><summary style={{cursor:'pointer'}}>{tr('查看全部所选原文')}</summary>{prepared.excerpt.segments.map((s,i)=><p key={i} style={{whiteSpace:'pre-wrap',lineHeight:1.8}}>{s.omittedBefore?`${tr('中间有省略')} · `:''}{s.speaker}：{s.text}</p>)}</details>
        <TeamWorldPublisherPicker state={publisher} actorName={tr('我')} disabled={busy||!!attempt.current||!!receipt} onSelect={publisher.select}/>
        <p style={{fontSize:12,lineHeight:1.8,color:c.secondary,margin:'16px 0'}}>{tr('确认这些声音可公开分享。提交后先审核，通过后才会出现在世界。')}</p>
      </>}
      {error&&<div role="alert" style={{fontSize:12,color:c.danger,lineHeight:1.8,margin:'12px 0'}}>{error}{!prepared&&<button type="button" style={button} onClick={()=>setRetry(v=>v+1)}>{tr('重试')}</button>}</div>}
      {receipt&&<div style={{padding:14,borderRadius:9,background:c.accentSoft,fontSize:13,lineHeight:1.8}}><div role="status">{tr(!receipt.publicRequested?'已取消公开发布':receipt.checkStatus===4?'审核未通过，未公开':[2,3].includes(receipt.checkStatus)?'审核通过，已发布到世界':'审核中，目前仅自己可见')}</div><p style={{margin:'5px 0 0',fontSize:12,color:c.secondary}}>{tr(receipt.publicRequested&&[2,3].includes(receipt.checkStatus)?'世界中的用户可以连续收听这份声音摘录。':'其他人无法查看或播放。')}</p><div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:12}}><button type="button" style={button} disabled={busy} onClick={()=>{void checkReceipt()}}>{tr('检查审核状态')}</button>{receipt.publicRequested&&receipt.canManage&&<button type="button" style={button} disabled={busy} onClick={()=>{void checkReceipt(true)}}>{tr('取消公开发布')}</button>}</div></div>}
      <footer style={{display:'flex',justifyContent:'flex-end',gap:10,marginTop:20}}><button type="button" style={button} disabled={busy} onClick={onClose}>{tr(receipt?'完成':'取消')}</button>{!receipt&&<button type="button" style={{...button,background:c.primaryAction,color:c.onPrimaryAction}} disabled={loading||!prepared||busy||!!publisher.selected&&(!publisher.team||publisher.loading)} onClick={()=>{void submit()}}>{tr(busy?'正在提交…':attempt.current?'重试确认提交结果':'提交审核')}</button>}</footer>
    </section>
  </div>,document.body)
}
