import { useCallback, useEffect, useRef, useState } from 'react'
import { createArkmeSdk } from '../sdk/index.js'
import type { TeamExtensionPage, TeamMessage } from '../team-app-contract.js'
import { subscribeTeamMessageChanges } from './team-messaging-events.js'

export function useTeamExtensions(conversationRef:string,message:TeamMessage) {
 const [page,setPage]=useState<TeamExtensionPage>()
 const [error,setError]=useState(''),[loading,setLoading]=useState(false),[invalidated,setInvalidated]=useState(false)
 const saved=useRef(new Map<string,TeamExtensionPage>()),pageScope=useRef('')
 const scope=`${conversationRef}:${message.key}`
 const pending=useRef<AbortController>(),state=useRef<TeamExtensionPage>(),mounted=useRef(true)
 const load=useCallback(async(more=false)=>{
  pending.current?.abort();const controller=new AbortController();pending.current=controller
  setLoading(true);setError('')
  const previous=more?state.current:undefined
  try {
   const restore=!more?saved.current.get(scope):undefined
   let next=await createArkmeSdk().readTeamExtensions(conversationRef,message.ref,previous?{afterSeq:previous.nextSeq,throughSeq:previous.throughSeq}:restore?{throughSeq:restore.throughSeq}:{},controller.signal)
   const targetCount=restore?.items.length ?? 0
   while(next?.items && next.hasMore && next.items.length<targetCount){
     if(controller.signal.aborted||!mounted.current)return
     const part=await createArkmeSdk().readTeamExtensions(conversationRef,message.ref,{afterSeq:next.nextSeq,throughSeq:next.throughSeq},controller.signal)
     if(part.nextSeq<=next.nextSeq || part.message.key!==message.key)throw new Error('延展分页状态无效，请重试')
     next={...part,items:[...next.items,...part.items]}
   }
   if(controller.signal.aborted||!mounted.current)return
   if(!next?.message || next.message.key!==message.key||!Array.isArray(next.items)||next.hasMore&&(!next.nextSeq||previous&&next.nextSeq<=previous.nextSeq))throw new Error('延展分页状态无效，请重试')
   const merged=previous?{...next,items:[...new Map([...previous.items,...next.items].map(row=>[row.key,row])).values()]}:next
   state.current=merged;pageScope.current=scope;saved.current.set(scope,merged);setPage(merged);setInvalidated(false)
  }catch(error){if(!controller.signal.aborted&&mounted.current){
   saved.current.clear();state.current=undefined;setPage(undefined);setInvalidated(true)
   setError(error instanceof Error?error.message:'延展加载失败，请重试')
  }}
  finally{if(!controller.signal.aborted&&mounted.current)setLoading(false)}
 },[conversationRef,message.ref,message.key,scope])
 useEffect(()=>{
  mounted.current=true;state.current=undefined;setPage(undefined);setInvalidated(false);void load()
  return ()=>{mounted.current=false;pending.current?.abort()}
 },[load,message.version])
 useEffect(()=>subscribeTeamMessageChanges((_account,receiptOnly)=>{
  if(receiptOnly)return
  // Hide stale snapshots immediately; a failed refresh cannot restore them.
  saved.current.clear();state.current=undefined;setPage(undefined);setInvalidated(true);void load()
 }),[load])
 return {page:pageScope.current===scope&&page?.message.key===message.key?page:undefined,error,loading,invalidated,retry:()=>{void load()},more:()=>{void load(true)}}
}
