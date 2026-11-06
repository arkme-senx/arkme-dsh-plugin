import{useEffect,useRef,useState,useSyncExternalStore}from'react'
import type{WorldSoundReceipt}from'../world-sound-contract.js'
import{ArkmeConfirmDialog}from'./ArkmeConfirmDialog.js'
import{arkmeAuthStore}from'./auth-store.js'
import{callArkme}from'./api.js'
import{arkmeTheme as c}from'./arkme-theme.js'
import{worldSoundPlayback}from'./world-sound-playback.js'
import{tr}from'./locale.js'
export function WorldSoundPublicationAction({recordRef,onWithdrawn}:{recordRef:string;onWithdrawn():void}){
 const auth=useSyncExternalStore(arkmeAuthStore.subscribe,arkmeAuthStore.getSnapshot,arkmeAuthStore.getSnapshot).auth
 const account=auth?.status==='authenticated'?`${auth.environment}:${auth.userId}`:''
 const [can,setCan]=useState(false),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const active=useRef<AbortController>()
 useEffect(()=>{const request=new AbortController();setCan(false);setOpen(false);if(account)void callArkme<WorldSoundReceipt>('world.sound-excerpts',{accountKey:account,action:'management',recordRef},request.signal).then(v=>{if(!request.signal.aborted)setCan(v.publicRequested&&v.canManage)}).catch(()=>{});return()=>{request.abort();active.current?.abort()}},[account,recordRef])
 if(!can)return null
 return <><button type="button" onClick={()=>setOpen(true)} style={{border:0,background:'transparent',color:c.secondary,fontSize:12,cursor:'pointer'}}>{tr('取消公开发布')}</button>{open&&<ArkmeConfirmDialog titleId="world-sound-withdraw" title={tr('取消公开声音摘录')} description={tr('取消后，世界中的文字与声音将停止公开。原始录音或通话保持私有。')} confirmLabel={tr('取消公开')} busyLabel={tr('正在取消…')} cancelLabel={tr('返回')} busy={busy} error={error} onClose={()=>setOpen(false)} onConfirm={()=>{if(busy)return;const request=new AbortController();active.current=request;setBusy(true);setError('');void callArkme<WorldSoundReceipt>('world.sound-excerpts',{accountKey:account,action:'management',recordRef,withdraw:true},request.signal).then(()=>{if(request.signal.aborted)return;worldSoundPlayback.stop();window.dispatchEvent(new CustomEvent('arkme-world-publications-changed'));window.dispatchEvent(new Event('arkme-reaction-policy-changed'));onWithdrawn()}).catch(e=>{if(!request.signal.aborted)setError(e instanceof Error?e.message:tr('操作失败，请重试'))}).finally(()=>{if(!request.signal.aborted)setBusy(false)})}}/>}</>
}
