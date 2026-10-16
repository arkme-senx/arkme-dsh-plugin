import { useEffect, useRef, useState } from 'react'
import type { ArkmeArrangementEvidence, ArkmeArrangementSourceTarget, ArkmeCallHistoryItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeUi } from './ui-controller.js'
import { ArkmeTimelineDetailDrawer } from './ArkmeNoteDetails.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeCallDetailContent } from './ArkmeCallDetailContent.js'
import { recordingSourceLocalDate } from '../arrangement-recording-source.js'
import { tr } from './locale.js'
import { useArrangementSourceQuotes } from './arrangement-source-quotes.js'

const labels: Record<ArkmeArrangementEvidence['kind'], string> = {record:'快记或聊天',audio_summary:'录音总结',call:'通话',input:'直接输入',voice_input:'语音输入',agent:'助手创建',manual:'手动创建'}
export function ArkmeArrangementSources({ arrangementRef, sources, expanded, onNavigate }: {arrangementRef:string;sources:ArkmeArrangementEvidence[];expanded:boolean;onNavigate?():void}) {
  const [target,setTarget]=useState<ArkmeArrangementSourceTarget>()
  const [pending,setPending]=useState(''), [error,setError]=useState(''), [original,setOriginal]=useState(false)
  const [failedEvidence,setFailedEvidence]=useState<ArkmeArrangementEvidence>()
  const quotes=useArrangementSourceQuotes(arrangementRef,sources,expanded)
  const request=useRef<AbortController>()
  const callContainer=useRef<HTMLDivElement>(null)
  useEffect(()=>{setTarget(undefined);setPending('');setError('');setFailedEvidence(undefined);setOriginal(false);return ()=>{request.current?.abort()}},[arrangementRef])
  useEffect(()=>{
    if(target?.kind!=='call') return
    const candidates=target.detail.transcriptSegments.filter(s=>target.startMillis!==undefined ? s.startMillis===target.startMillis : target.quote.trim()!=='' && s.text.includes(target.quote.trim()))
    if(candidates.length!==1) return
    const node=[...(callContainer.current?.querySelectorAll<HTMLElement>('[data-arkme-call-utterance]')??[])].find(el=>el.dataset.arkmeCallUtterance===candidates[0]!.segmentId)
    node?.scrollIntoView({block:'center'}); if(node) {node.style.outline='2px solid var(--dsw-alias-border-l2, #b3cdbd)';node.style.borderRadius='8px'}
  },[target])
  async function open(e:ArkmeArrangementEvidence) {
    request.current?.abort(); const controller=new AbortController(); request.current=controller; setPending(e.id); setError(''); setFailedEvidence(undefined)
    try {
      const value=await callArkme<ArkmeArrangementSourceTarget>('arrangements.source.open',{arrangementRef,evidenceId:e.id},controller.signal)
      if(controller.signal.aborted) return
      if(value.kind==='audio_summary') {onNavigate?.(); arkmeUi.showRecordingSummaryTarget(recordingSourceLocalDate({kind:'daily-summary',state:'ready',dateStamp:value.dateStamp,tzOffsetMillis:value.tzOffsetMillis}).getTime(),value.summaryId)}
      else if(value.kind==='conversation') {onNavigate?.(); arkmeUi.showConversationTarget(value.source,value.itemUid,value.sendAtMillis,undefined,undefined,true)}
      else setTarget(value)
    } catch(err) {if(!controller.signal.aborted) {setError(err instanceof Error?err.message:tr('来源加载失败'));setFailedEvidence(e)}}
    finally {if(!controller.signal.aborted) setPending('')}
  }
  const initial=sources.filter(e=>e.role==='initial'), supplementary=sources.filter(e=>e.role==='supplement'), related=sources.filter(e=>e.role==='related')
  const row=(e:ArkmeArrangementEvidence,showText:boolean)=>{
    const quote=showText&&e.readOnExpand?quotes.quote(e.id):undefined
    return <div className="arkme-arrangement-source-item" key={e.id}>
    {e.canOpen && quote?.state!=='unavailable' ? <button className="arkme-arrangement-recording-source" type="button" disabled={!!pending} onClick={event=>{event.stopPropagation();void open(e)}}>{tr(labels[e.kind])}{e.sourceDate?` · ${Number(e.sourceDate.slice(5,7))}月${Number(e.sourceDate.slice(8,10))}日`:''} · {pending===e.id?tr('正在打开…'):tr('查看原文')} ↗</button>
      : <div className="arkme-arrangement-recording-unavailable">{tr(labels[e.kind])}{e.unavailableReason?` · ${tr(e.unavailableReason)}`:''}</div>}
    {quote?.state==='loading'&&<div role="status" className="arkme-arrangement-content-empty">{tr('正在读取来源…')}</div>}
    {quote?.state==='ready'&&<div className="arkme-arrangement-content-text">{quote.text||tr('原文没有文字内容')}</div>}
    {quote?.state==='unavailable'&&<div className="arkme-arrangement-content-empty">{quote.reason}</div>}
    {quote?.state==='error'&&<div role="alert" className="arkme-arrangement-content-empty">{quote.message} <button type="button" className="arkme-arrangement-recording-source" aria-label={tr(`重试读取${labels[e.kind]}来源`)} onClick={event=>{event.stopPropagation();quotes.retry(e.id)}}>{tr('重试')}</button></div>}
    {showText&&!e.readOnExpand&&e.text&&<div className="arkme-arrangement-content-text">{e.text}</div>}
  </div>
  }
  let history:ArkmeCallHistoryItem|undefined
  if(target?.kind==='call') {const d=target.detail; history={...d,peerDisplayName:d.title,canOpenDetail:true,canRedial:false,stableId:d.stableId??d.callRef}}
  return <>
    {expanded?<>{!!initial.length&&<strong>{tr('识别依据')}</strong>}{initial.map(e=>row(e,true))}
      {!!supplementary.length&&<><strong>{tr('后续补充依据')}</strong>{supplementary.map(e=>row(e,true))}</>}
      {!!related.length&&<details onClick={event=>event.stopPropagation()}><summary>{tr('关联资料')} ({related.length})</summary>{related.map(e=>row(e,true))}</details>}</>
      : initial.slice(0,1).map(e=>row(e,false))}
    {error&&<div role="alert" className="arkme-arrangement-content-empty">{error} {failedEvidence&&<button type="button" className="arkme-arrangement-recording-source" onClick={event=>{event.stopPropagation();void open(failedEvidence)}}>{tr('重试')}</button>}</div>}
    {target?.kind==='document'&&<ArkmeDetailShell title={target.title} label={target.title} onClose={()=>setTarget(undefined)}><div style={{whiteSpace:'pre-wrap'}}>{target.text}</div></ArkmeDetailShell>}
    {target?.kind==='record'&&<ArkmeTimelineDetailDrawer item={target.item} canExtend={false} showOriginal={original} onToggleOriginal={()=>setOriginal(v=>!v)} onClose={()=>setTarget(undefined)}/>}
    {target?.kind==='call'&&history&&<ArkmeDetailShell title={tr('来源通话')} label={tr('来源通话')} onClose={()=>setTarget(undefined)}><div ref={callContainer}><ArkmeCallDetailContent selectedItem={history} detail={target.detail} detailState="ready" compact/></div></ArkmeDetailShell>}
  </>
}
