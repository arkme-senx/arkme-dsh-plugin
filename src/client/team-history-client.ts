import { useCallback, useEffect, useRef, useState } from 'react'
import type { TeamHistoryAction, TeamHistoryOptions, TeamHistoryResponse } from '../team-history-contract.js'
import { callArkme } from './api.js'
import { subscribeTeamMessageChanges } from './team-messaging-events.js'

export function historyCall(conversationRef:string,accountKey:string,action:TeamHistoryAction,options:TeamHistoryOptions,signal:AbortSignal) {
  return callArkme<TeamHistoryResponse>('team.app.history',{conversationRef,expectedAccountKey:accountKey,action,options},signal)
}
export function waitHistoryPoll(signal:AbortSignal):Promise<void>{
  signal.throwIfAborted()
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(signal.reason)}
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},1500)
    signal.addEventListener('abort',abort,{once:true})
  })
}
/** Technical progress only; a ready manifest still needs the chosen verified read. */
export async function prepareHistory(conversationRef:string,accountKey:string,action:TeamHistoryAction,options:TeamHistoryOptions,signal:AbortSignal,onProgress?:(result:TeamHistoryResponse)=>void):Promise<TeamHistoryResponse>{
  let result=await historyCall(conversationRef,accountKey,action,options,signal)
  for(;;){
    signal.throwIfAborted()
    onProgress?.(result)
    if(result.state==='ready')return result
    if(result.state==='failed'||result.state==='cancelled')throw new Error(result.reason||'历史处理未完成，请重试')
    await waitHistoryPoll(signal)
    result=await historyCall(conversationRef,accountKey,result.resultRef?(action.startsWith('exports/')?'exports/state':'analysis/state'):action,{...options,...(result.resultRef?{resultRef:result.resultRef}:{})},signal)
  }
}
export const historyTimezone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
export function localDateWindow(from:string,through:string){
  const date=(v:string)=>{const [y,m,d]=v.split('-').map(Number);return new Date(y!,m!-1,d!)}
  const start=from?date(from):undefined,end=through?date(through):undefined
  if(end)end.setDate(end.getDate()+1)
  return {...(start?{fromAt:start.getTime()}:{}),...(end?{untilAt:end.getTime()}:{}),timezone:historyTimezone()}
}
/** One bounded page stream. Query changes abort earlier reads, and content events
 * clear displayed excerpts. New ordinary messages retain the frozen page. */
export function useTeamHistoryPage(conversationRef:string,accountKey:string,action:TeamHistoryAction,options:TeamHistoryOptions,enabled=true,scopeKey=conversationRef,optionsKey?:string){
  const [page,setPage]=useState<TeamHistoryResponse>(),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0),[windowed,setWindowed]=useState(false)
  const active=useRef<AbortController>(),value=useRef<TeamHistoryResponse>(),busy=useRef(false)
  const signature=optionsKey??JSON.stringify(options),current=useRef(options);current.current=options
  const reference=useRef(conversationRef);reference.current=conversationRef
  const load=useCallback(async(more=false)=>{
    if(more&&busy.current)return
    if(!more)active.current?.abort()
    const controller=more?active.current:new AbortController()
    if(!controller||controller.signal.aborted)return
    active.current=controller;busy.current=true;setLoading(true);setError('')
    if(!more){value.current=undefined;setPage(undefined);setWindowed(false)}
    const original=value.current
    try{
      let next=await historyCall(reference.current,accountKey,action,{...current.current,...(more&&original?.cursor?{cursor:original.cursor}:{})},controller.signal)
      while(next.state==='index_preparing'){
        setPage(next);await waitHistoryPoll(controller.signal)
        next=await historyCall(reference.current,accountKey,action,current.current,controller.signal)
      }
      if(next.state!=='ready')throw new Error(next.reason||'历史数据尚未就绪')
      if(controller.signal.aborted||active.current!==controller)return
      if(more&&original){
        if(next.hasMore&&(!next.cursor||next.cursor===original.cursor))throw new Error('历史分页异常，请重新查询')
        next={...next,messages:[...new Map([...original.messages,...next.messages].map(m=>[m.key,m])).values()],words:[...original.words,...next.words],participants:[...original.participants,...next.participants]}
      }
      if(next.messages.length>200){setWindowed(true);next={...next,messages:next.messages.slice(-200)}}
      value.current=next;setPage(next)
    }catch(caught){if(!controller.signal.aborted&&active.current===controller){value.current=undefined;setPage(undefined);setError(caught instanceof Error?caught.message:'历史读取失败，请重试')}}
    finally{if(active.current===controller){busy.current=false;if(!controller.signal.aborted)setLoading(false)}}
  },[scopeKey,accountKey,action,signature,revision])
  useEffect(()=>{if(enabled)void load();else{active.current?.abort();setPage(undefined);setLoading(false)}return()=>active.current?.abort()},[load,enabled])
  useEffect(()=>subscribeTeamMessageChanges((account,receiptOnly)=>{if(account===accountKey&&!receiptOnly){active.current?.abort();value.current=undefined;setPage(undefined);setError('团队内容已更新，请刷新查询');setLoading(false)}}),[accountKey])
  return {page,loading,error,windowed,more:()=>load(true),refresh:()=>setRevision(n=>n+1)}
}
