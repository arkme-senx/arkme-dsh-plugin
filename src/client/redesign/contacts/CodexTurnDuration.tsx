import { useEffect, useRef, useState } from 'react'
import type { TeamCodexTask, TeamCodexTurnTiming } from '../../../team-codex-contract.js'
import { codexTurnTiming } from '../../../team-codex-timing.js'
import { arkmeTheme } from '../../arkme-theme.js'
import { tr } from '../../locale.js'
import { CodexTaskStateDot } from './CodexTaskStateDot.js'
import { codexTaskStatus } from './codex-task-status.js'

export function codexDurationText(milliseconds: number): string {
  const total=Math.floor(Math.max(0,milliseconds)/1000),seconds=total%60,minutes=Math.floor(total/60)%60,hours=Math.floor(total/3600)
  return hours ? tr('{hours}小时 {minutes}分钟 {seconds}秒',{hours,minutes,seconds})
    : minutes ? tr('{minutes}分钟 {seconds}秒',{minutes,seconds}) : tr('{seconds}秒',{seconds})
}

/** A small isolated clock: ticking never rerenders the conversation or adjusts its scroll. */
export function CodexTurnDuration({ timing: value, task }: {timing:TeamCodexTurnTiming;task:TeamCodexTask}) {
  const [tick,setNow]=useState(Date.now)
  // Evidence may arrive between one-second ticks; compare against the current
  // render time so a fresh heartbeat is not briefly mistaken for a future one.
  const now=Math.max(tick,Date.now())
  const last=useRef({start:value.startedAt,elapsed:0})
  const timing=codexTurnTiming(value)
  useEffect(()=>{
    if(timing?.state!=='working') return
    setNow(Date.now())
    const timer=setInterval(()=>setNow(Date.now()),1000)
    return ()=>clearInterval(timer)
  },[timing?.state,timing?.startedAt])
  if(!timing) return null
  const running=timing.state==='working' && (timing.live??codexTaskStatus(task,now)==='running')
    && now>=timing.observedAt && now-timing.observedAt<30_000
  if(last.current.start!==timing.startedAt) last.current={start:timing.startedAt,elapsed:0}
  const elapsed=timing.durationMs??Math.max(last.current.elapsed,0,(running?now:timing.observedAt)-timing.startedAt)
  last.current.elapsed=elapsed
  const label=timing.state==='finished' ? tr('用时 {time}',{time:codexDurationText(elapsed)})
    : timing.state==='interrupted' ? tr('已中断 · 用时 {time}',{time:codexDurationText(elapsed)})
      : tr('已处理 {time}',{time:codexDurationText(elapsed)})
  return <div className="arkme-codex-turn-duration" style={{display:'flex',alignItems:'center',gap:7,color:arkmeTheme.secondary,
    fontSize:12,fontVariantNumeric:'tabular-nums',minHeight:20,margin:'10px 0 12px'}}>
    <CodexTaskStateDot status={timing.state==='working'?(running?'running':'unknown'):timing.state}/>
    <span>{label}{timing.state==='working'&&!running?tr(' · 等待同步'):''}</span>
  </div>
}
