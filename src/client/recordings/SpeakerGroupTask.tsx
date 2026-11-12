import {useEffect,useRef,useState,type CSSProperties} from 'react'
import type {SpeakerGroupJob,SpeakerGroupJobs,SpeakerGroupPreview,SpeakerGroupConflict,SpeakerGroupConflictItem} from '../../speaker-group-contract.js'
import {useRecordingPlayback} from './useRecordingPlayback.js'
import {arkmeUi} from '../ui-controller.js'
import type {ArkmeRecordingWorkbenchItem} from '../../types.js'
import {callArkme} from '../api.js'
import {arkmeTheme as color} from '../arkme-theme.js'
import {tr} from '../locale.js'
const button:CSSProperties={padding:'6px 9px',border:`1px solid ${color.border}`,borderRadius:7,background:color.base,color:color.text,font:'inherit',cursor:'pointer'}
const labels:Record<SpeakerGroupJob['state'],string>={preview:'尚未保存',queued:'等待处理',preparing:'准备归属修改',publishing:'正在统一保存',complete:'已完成',failed:'处理失败，可恢复',conflict:'资料已变化，需要重新核对',cancelled:'已取消，原归属保留'}
export function SpeakerGroupTask({initialPreview,initialJob,targetLabel,onBack}:{initialPreview?:SpeakerGroupPreview;initialJob?:SpeakerGroupJob;targetLabel?:string;onBack():void}){
 const [preview,setPreview]=useState(initialPreview),[job,setJob]=useState(initialJob),[undo,setUndo]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const action=useRef(new AbortController());useEffect(()=>{const c=new AbortController();action.current=c;return()=>c.abort()},[])
 const run=async(kind:string)=>{setBusy(true);setError('');const signal=action.current.signal
  try{const result=await callArkme<SpeakerGroupJob|SpeakerGroupPreview>('speaker-directory.group-action',{action:kind,...(job?{jobRef:job.jobRef}:{}),...(preview?{commandRef:preview.commandRef}:{})},signal);if(signal.aborted)return
   if(kind==='undo-preview'){setPreview(result as SpeakerGroupPreview);setUndo(true)}else{setJob(result as SpeakerGroupJob);setPreview(undefined)}}
  catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:tr('任务请求失败，请重试同一操作'))}finally{if(!signal.aborted)setBusy(false)}}
 useEffect(()=>{if(!job||!['queued','preparing','publishing'].includes(job.state))return;const c=new AbortController()
  const timer=setTimeout(()=>{void callArkme<SpeakerGroupJob>('speaker-directory.group-action',{action:'job',jobRef:job.jobRef},c.signal).then(value=>{if(!c.signal.aborted)setJob(value)}).catch(e=>{if(!c.signal.aborted)setError(e instanceof Error?e.message:tr('任务状态读取失败'))})},1500)
  return()=>{clearTimeout(timer);c.abort()}
 },[job])
 return <section style={{marginTop:12,border:`1px solid ${color.border}`,borderRadius:9,padding:12}} aria-label={tr('完整分组任务')}>
  {preview&&<><strong>{tr(undo?'撤销整组修改预览':'完整分组影响预览')}</strong><p>{tr('目标')}：{undo?tr('恢复修改前的归属'):targetLabel??tr('所选归属')}</p><p>{tr('后台去重核对')}：{preview.affectedCount} {tr('段')}</p>{preview.firstAt>0&&<p>{new Date(preview.firstAt).toLocaleString()} — {new Date(preview.lastAt).toLocaleString()}</p>}{!!preview.sourceCounts.length&&<p>{tr('各来源分组')}：{preview.sourceCounts.join('、')} {tr('段')}</p>}
   <p>{tr(undo?'只恢复本次修改；后续人工修改冲突时不会覆盖。':'包含所选分组快照中的全部历史片段。准备完成前仍显示旧归属；不自动确认未来录音。')}</p>
   {!!preview.conflictCount&&<p role="alert" style={{color:color.danger}}>{tr('发现冲突片段')}：{preview.conflictCount} · {tr('请返回重新核对')}</p>}
   {!!preview.conflicts?.length&&<SpeakerGroupConflicts conflicts={preview.conflicts} total={preview.conflictCount}/>}
   <button style={button} disabled={busy||preview.conflictCount>0||!preview.commandRef} onClick={()=>void run(undo?'undo':'apply')}>{tr(busy?'正在提交…':undo?'确认撤销':'确认整组保存')}</button></>}
  {job&&!preview&&<><strong>{tr(job.action==='undo'?'撤销任务':'统一标记任务')} · {tr(labels[job.state])}</strong><p>{job.preparedCount} / {job.totalCount} {tr('段')}</p>{job.error&&<p style={{color:color.danger}}>{job.error}</p>}{job.conflictCount>0&&<p>{tr('冲突片段')}：{job.conflictCount}</p>}
   {!!job.conflicts?.length&&<SpeakerGroupConflicts conflicts={job.conflicts} total={job.conflictCount}/>}
   {job.state==='complete'&&job.action==='apply'&&<button style={button} disabled={busy} onClick={()=>void run('undo-preview')}>{tr('预览撤销')}</button>}
   {['queued','preparing','failed'].includes(job.state)&&<button style={button} disabled={busy} onClick={()=>void run('cancel')}>{tr('取消未完成任务')}</button>}
   {job.state!=='cancelled'&&job.state!=='complete'&&<button style={button} disabled={busy} onClick={()=>void run('job')}>{tr('重新读取任务')}</button>}
  </>}
  {error&&<p role="alert" style={{color:color.danger}}>{error}</p>}
  <p style={{color:color.secondary}}>{tr('已提交任务会保存在账号中，重启或换设备后可从最近任务继续查看。')}</p><button style={button} disabled={busy} onClick={onBack}>{tr('返回核对')}</button>
 </section>
}
export function RecentSpeakerGroupJobs(){
 const [page,setPage]=useState<SpeakerGroupJobs>(),[job,setJob]=useState<SpeakerGroupJob>(),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 const controller=useRef(new AbortController());useEffect(()=>{const c=new AbortController();controller.current=c;return()=>c.abort()},[])
 const load=async(more=false)=>{setLoading(true);setError('');const signal=controller.current.signal;try{const p=await callArkme<SpeakerGroupJobs>('speaker-directory.group-action',{action:'jobs',...(more&&page?.nextCursor?{cursor:page.nextCursor}:{})},signal);if(!signal.aborted)setPage({...p,items:more?[...page?.items??[],...p.items]:p.items})}catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:tr('任务读取失败'))}finally{if(!signal.aborted)setLoading(false)}}
 if(job)return <SpeakerGroupTask initialJob={job} onBack={()=>{setJob(undefined);void load()}}/>
 return <div style={{marginTop:12}}><button style={button} disabled={loading} onClick={()=>void load()}>{tr('最近归并任务')}</button>{error&&<p role="alert">{error}</p>}{page?.items.map((j,i)=><button key={i} style={{...button,margin:6}} onClick={()=>setJob(j)}>{tr(j.action==='undo'?'撤销':'统一标记')} · {j.totalCount}{tr('段')} · {tr(labels[j.state])}</button>)}{page?.nextCursor&&<button style={button} disabled={loading} onClick={()=>void load(true)}>{tr('加载更多任务')}</button>}{page&&!page.items.length&&!page.nextCursor&&<p>{tr('暂无已提交任务')}</p>}</div>
}

function SpeakerGroupConflicts({conflicts,total}:{conflicts:SpeakerGroupConflict[];total:number}){
 const [limit,setLimit]=useState(20)
 const [rows,setRows]=useState<Record<string,ArkmeRecordingWorkbenchItem>>({}),[errors,setErrors]=useState<Record<string,string>>({}),[busy,setBusy]=useState('')
 const controller=useRef(new AbortController()),playback=useRecordingPlayback('/arkme-self/api/media')
 useEffect(()=>{const c=new AbortController();controller.current=c;return()=>c.abort()},[])
 const read=async(ref:string)=>{setBusy(ref);setErrors(old=>({...old,[ref]:''}));const signal=controller.current.signal
  try{const value=await callArkme<SpeakerGroupConflictItem>('speaker-directory.group-action',{action:'conflict',conflictRef:ref},signal);if(!signal.aborted)setRows(old=>({...old,[ref]:value.item}))}
  catch(e){if(!signal.aborted)setErrors(old=>({...old,[ref]:e instanceof Error?e.message:tr('冲突片段暂不可读')}))}finally{if(!signal.aborted)setBusy('')}}
 return <div aria-label={tr('冲突片段定位')}>{total>limit&&<p>{tr('先显示')} {Math.min(limit,conflicts.length)} / {total} {tr('条冲突')}</p>}{conflicts.slice(0,limit).map((conflict,index)=>{const row=rows[conflict.conflictRef];return <div key={conflict.conflictRef} style={{padding:'8px 0',borderBottom:`1px solid ${color.border}`}}>
  <button style={button} disabled={!!busy} onClick={()=>void read(conflict.conflictRef)}>{tr('读取冲突片段')} {index+1}</button>
  {row&&<><p>{new Date(row.startAtMillis).toLocaleString()} · {row.speakerLabel}</p><p>{row.text}</p><button style={button} disabled={playback.isLoading} onClick={()=>{if(playback.activeItemRef===row.itemRef)void playback.toggle(row);else void playback.playItem(row)}}>{tr(playback.activeItemRef===row.itemRef&&playback.isPlaying?'暂停回听':'回听当前片段')}</button><button style={button} onClick={()=>{playback.stop();const day=new Date(row.startAtMillis);day.setHours(0,0,0,0);arkmeUi.showRecordingTarget(day.getTime(),row.startAtMillis)}}>{tr('定位原文')}</button></>}
  {errors[conflict.conflictRef]&&<p role="alert" style={{color:color.danger}}>{errors[conflict.conflictRef]}</p>}
 </div>})}{limit<conflicts.length&&<button style={button} onClick={()=>setLimit(v=>v+20)}>{tr('更多冲突片段')}</button>}{playback.error&&<p role="alert" style={{color:color.danger}}>{playback.error}</p>}</div>
}
