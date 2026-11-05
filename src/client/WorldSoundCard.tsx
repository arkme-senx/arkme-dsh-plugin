import {useEffect,useState,useSyncExternalStore,type CSSProperties} from 'react'
import {Play} from '@phosphor-icons/react/dist/icons/Play'
import {Pause} from '@phosphor-icons/react/dist/icons/Pause'
import {Microphone} from '@phosphor-icons/react/dist/icons/Microphone'
import {Phone} from '@phosphor-icons/react/dist/icons/Phone'
import {Waveform} from '@phosphor-icons/react/dist/icons/Waveform'
import type {WorldSoundExcerpt} from '../world-sound-contract.js'
import {worldSoundPlayback} from './world-sound-playback.js'
import {arkmeAuthStore} from './auth-store.js'
import {arkmeTheme as c} from './arkme-theme.js'
import {arkmeUi} from './ui-controller.js'
import {tr} from './locale.js'
const format=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`
const quiet:CSSProperties={padding:'5px 0',border:0,background:'transparent',color:c.secondary,cursor:'pointer',font:'inherit',fontSize:12}
export function WorldSoundCard({recordRef,excerpt,detail=false,status='published'}:{recordRef:string;excerpt:WorldSoundExcerpt;detail?:boolean;status?:'pending'|'published'|'rejected'|'withdrawn'}){
  const auth=useSyncExternalStore(arkmeAuthStore.subscribe,arkmeAuthStore.getSnapshot,arkmeAuthStore.getSnapshot).auth
  const account=auth?.status==='authenticated'?`${auth.environment}:${auth.userId}`:''
  const key=`${account}:${recordRef}:${excerpt.revision}`
  const state=useSyncExternalStore(listener=>worldSoundPlayback.subscribe(key,listener),()=>worldSoundPlayback.snapshot(key),()=>worldSoundPlayback.snapshot(key))
  const [expanded,setExpanded]=useState(detail),[guide,setGuide]=useState(false),[dragPosition,setDragPosition]=useState<number>()
  useEffect(()=>{if(!account)worldSoundPlayback.stop()},[account])
  useEffect(()=>{if(status!=='published'&&worldSoundPlayback.snapshot(key).key===key)worldSoundPlayback.stop()},[key,status])
  const quote=Array.from(excerpt.segments[0]!.text)
  const playing=state.status==='playing'||state.status==='loading',current=excerpt.segments[state.index]??excerpt.segments[0]!
  return <section data-world-sound-player={recordRef} aria-label={tr(excerpt.source==='call'?'通话摘录':'录音摘录')}>
    <div style={{display:'flex',alignItems:'center',gap:6,color:c.secondary,fontSize:12}}>{excerpt.source==='call'?<Phone size={14}/>:<Microphone size={14}/>}<span>{tr(excerpt.source==='call'?'通话摘录':'录音摘录')}</span><span>· {excerpt.segments.length} {tr('段')} · {format(excerpt.durationMillis)}</span></div>
    <blockquote style={{margin:'20px 0',fontSize:detail?23:20,lineHeight:1.8,fontWeight:500,overflowWrap:'anywhere'}}>“{quote.slice(0,100).join('')}{quote.length>100?'…':''}”</blockquote>
    {status!=='published'?<p role="status" style={{fontSize:13,color:c.secondary}}>{tr(status==='pending'?'审核中 · 仅自己可见':status==='rejected'?'审核未通过 · 未公开':'已取消公开发布')}</p>:<>
    <div style={{display:'flex',alignItems:'center',gap:14}}>
      <button type="button" aria-label={tr(playing?'暂停声音摘录':'播放全部声音片段')} aria-busy={state.status==='loading'||undefined} onClick={()=>worldSoundPlayback.toggle(key,excerpt)} style={{display:'grid',placeItems:'center',width:44,height:44,flexShrink:0,padding:0,border:0,borderRadius:'50%',background:c.primaryAction,color:c.onPrimaryAction,cursor:'pointer'}}>{playing?<Pause size={20} weight="fill"/>:<Play size={20} weight="fill"/>}</button>
      <div style={{flex:1,minWidth:0}}><div style={{display:'flex',alignItems:'center',gap:7,color:c.tertiary,fontSize:12}}><Waveform size={18}/><span>{tr(state.status==='loading'?'正在加载原声…':playing?'原声正在连续播放':'原声 · 一次听完全部选段')}</span></div>
        <input type="range" min={0} max={excerpt.durationMillis} value={dragPosition??state.position} aria-label={tr('声音摘录播放进度')} onChange={event=>setDragPosition(Number(event.target.value))} onPointerUp={event=>{worldSoundPlayback.seek(key,excerpt,Number(event.currentTarget.value));setDragPosition(undefined)}} onPointerCancel={()=>setDragPosition(undefined)} onKeyUp={event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)){worldSoundPlayback.seek(key,excerpt,Number(event.currentTarget.value));setDragPosition(undefined)}}} style={{width:'100%',accentColor:c.accent,margin:'8px 0 0',cursor:'pointer'}}/>
        <div style={{display:'flex',justifyContent:'space-between',fontVariantNumeric:'tabular-nums',fontSize:11,color:c.secondary}}><span>{format(state.position)}</span><span>{format(excerpt.durationMillis)}</span></div>
      </div>
    </div>
    {state.status==='failed'?<p role="alert" style={{fontSize:12,color:c.danger}}>{state.error}<button type="button" style={quiet} onClick={()=>worldSoundPlayback.toggle(key,excerpt)}>{tr('重试')}</button></p>:<p style={{fontSize:12,color:c.secondary,margin:'14px 0 10px',lineHeight:1.7}}>{playing?current.text:tr('点击播放，听见文字背后的语气。')}</p>}
    </>}
    <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}><button type="button" style={quiet} onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded}>{tr(expanded?'收起原文':'查看完整原文')}</button>{excerpt.segments.some(s=>s.omittedBefore)&&<span style={{fontSize:11,color:c.tertiary}}>{tr('含片段间省略')}</span>}</div>
    {expanded&&<ol style={{listStyle:'none',padding:0,margin:'10px 0 0',display:'grid',gap:9}}>{excerpt.segments.map((s,i)=><li key={i}><button type="button" disabled={status!=='published'} onClick={()=>worldSoundPlayback.seek(key,excerpt,s.offsetMillis)} aria-current={playing&&state.index===i?'true':undefined} style={{display:'block',textAlign:'left',font:'inherit',color:c.text,width:'100%',padding:'10px 12px',border:0,borderRadius:8,background:playing&&state.index===i?c.accentSoft:c.subtle,cursor:'pointer',lineHeight:1.8}}><span style={{display:'block',fontSize:11,color:c.secondary}}>{format(s.offsetMillis)} · {s.speaker}{s.omittedBefore?` · ${tr('中间有省略')}`:''}</span><span style={{fontSize:13}}>{s.text}</span></button></li>)}</ol>}
    <div style={{marginTop:14,paddingTop:10,borderTop:`1px solid ${c.borderSoft}`}}><button type="button" style={quiet} onClick={()=>setGuide(v=>!v)} aria-expanded={guide}>{tr('我也想这样分享')} ↗</button>
      {guide&&<div style={{fontSize:12,color:c.secondary,lineHeight:1.8,marginTop:8}}><p style={{margin:'0 0 8px'}}>{tr(excerpt.source==='call'?'打开通话详情，在转写中多选想分享的声音，再选择「发到世界」。':'打开录音详情，在转写中多选想分享的声音，再选择「发到世界」。')}</p><button type="button" style={quiet} onClick={()=>{worldSoundPlayback.stop();excerpt.source==='call'?arkmeUi.showCalls():arkmeUi.showRecordings()}}>{tr(excerpt.source==='call'?'去通话看看':'去录音看看')} ↗</button></div>}
    </div>
  </section>
}
