import {useEffect,useRef,useState,useSyncExternalStore} from 'react'
import {createPortal} from 'react-dom'
import type {RecordExcerptOriginal} from '../record-excerpt.js'
import {tr,useArkmeLocale} from './locale.js'
import {callArkme} from './api.js'
import {arkmeAuthStore} from './auth-store.js'
import {arkmeTheme} from './arkme-theme.js'
import {quoteCanonicalText} from '../message-quote.js'
import {ArkmeRichText} from './ArkmeRichText.js'

/** Each open reads the saved locator and source ACL again. No offline fallback. */
export function ExcerptOriginal({recordUid,sourceRef,messageActionRef}:{recordUid:string;sourceRef?:string;messageActionRef?:string}) {
 useArkmeLocale()
 const wasOpen=useRef(false)
 const auth=useSyncExternalStore(arkmeAuthStore.subscribe,arkmeAuthStore.getSnapshot,arkmeAuthStore.getSnapshot).auth
 const account=auth?.status==='authenticated'?`${auth.environment}:${auth.userId}`:''
 const [open,setOpen]=useState(false),[result,setResult]=useState<RecordExcerptOriginal>(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const request=useRef<AbortController>(),panel=useRef<HTMLDivElement>(null),opener=useRef<HTMLButtonElement>(null)
 useEffect(()=>{request.current?.abort();wasOpen.current=false;setOpen(false);setResult(undefined);setError('');setBusy(false);return()=>request.current?.abort()},[account,recordUid])
 useEffect(()=>{if(open)panel.current?.querySelector<HTMLButtonElement>('button')?.focus();else if(wasOpen.current)opener.current?.focus();wasOpen.current=open},[open])
 const close=()=>{request.current?.abort();setOpen(false);setResult(undefined);setError('');setBusy(false)}
 const load=async()=>{
  request.current?.abort();const controller=new AbortController();request.current=controller
  setOpen(true);setBusy(true);setResult(undefined);setError('')
  try {const value=await callArkme<RecordExcerptOriginal>('excerpt.original',{recordUid,...(sourceRef&&messageActionRef?{sourceRef,messageActionRef}:{})},controller.signal);if(!controller.signal.aborted)setResult(value)}
  catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'当前无法核验原文权限，请稍后重试')}
  finally {if(!controller.signal.aborted)setBusy(false)}
 }
 return <><button ref={opener} type="button" onClick={event=>{event.stopPropagation();void load()}} style={{border:0,padding:'4px 0',background:'transparent',color:arkmeTheme.accent,cursor:'pointer'}}>{tr('查看原文')}</button>
 {open&&createPortal(<div onMouseDown={event=>{if(event.target===event.currentTarget)close()}} style={{position:'fixed',inset:0,zIndex:12100,background:'#0005',display:'grid',placeItems:'center',padding:20}}>
 <div ref={panel} role="dialog" aria-modal="true" aria-label={tr('引用原文')} onKeyDown={event=>{
  if(event.key==='Escape'){event.stopPropagation();close()}
  if(event.key==='Tab'){const buttons=Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')),first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
 }} style={{width:600,maxWidth:'100%',maxHeight:'80vh',overflow:'auto',background:arkmeTheme.menu,color:arkmeTheme.text,padding:20,borderRadius:12}}>
 <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><strong>{result?.title??tr('引用原文')}</strong><button type="button" onClick={close}>{tr('关闭')}</button></div>
 {busy&&<p role="status">{tr('正在核验原文访问权限…')}</p>}
 {error&&<><p role="alert">{error}</p><p>{tr('已发送摘录仍保留，当前未打开原文。')}</p><button type="button" onClick={()=>void load()}>{tr('重新核验')}</button></>}
 {result&&<div style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',marginTop:16}}>{result.selection?(()=>{const text=quoteCanonicalText({textContent:result.text,textFormat:result.textFormat??'plain'});return <>{text.slice(0,result.selection.start)}<mark>{text.slice(result.selection.start,result.selection.end)}</mark>{text.slice(result.selection.end)}</>})():<ArkmeRichText text={result.text} linkLabelMode="raw"/>}</div>}
 </div></div>,document.body)}</>
}
