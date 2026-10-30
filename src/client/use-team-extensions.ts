import { useCallback, useEffect, useRef, useState } from 'react'
import { createArkmeSdk } from '../sdk/index.js'
import type { TeamConversation, TeamExtensionPage, TeamMessage } from '../team-app-contract.js'
import { subscribeTeamMessageChanges } from './team-messaging-events.js'
import { invalidateTeamMessageRead, teamChangeAffectsSource } from './team-source-read.js'

export function useTeamExtensions(accountKey:string,conversation:Pick<TeamConversation,'ref'|'key'>,message:TeamMessage) {
 const conversationRef=conversation.ref,conversationKey=conversation.key
 const [page,setPage]=useState<TeamExtensionPage>()
 const [error,setError]=useState(''),[loading,setLoading]=useState(false),[invalidated,setInvalidated]=useState(false)
 const saved=useRef(new Map<string,TeamExtensionPage>()),pageScope=useRef('')
 const scope=`${accountKey}:${conversationKey}:${message.key}`
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
   const code=(error as {body?:{code?:string}})?.body?.code
   if(!['local-network-unavailable','arkme-network-error','arkme-timeout','team-dependency_unavailable','team-rate_limited'].includes(code??'')) {
    saved.current.clear();state.current=undefined;setPage(undefined);setInvalidated(true)
   }
   setError(error instanceof Error?error.message:'延展加载失败，请重试')
  }}
  finally{if(!controller.signal.aborted&&mounted.current)setLoading(false)}
 },[conversationRef,message.ref,message.key,scope])
 useEffect(()=>{
  mounted.current=true
  if(pageScope.current!==scope){state.current=undefined;setPage(undefined);setInvalidated(false)}
  else if(state.current&&state.current.message.version!==message.version){
   const change={kind:'team.message.changed',messageKey:message.key}
   state.current={...state.current,message:invalidateTeamMessageRead(state.current.message,change,conversationKey),items:state.current.items.map(row=>invalidateTeamMessageRead(row,change,conversationKey))}
   setPage(state.current)
  }
  void load()
  return ()=>{mounted.current=false;pending.current?.abort()}
 },[load,message.version,scope,conversationKey])
 useEffect(()=>subscribeTeamMessageChanges((account,receiptOnly,change)=>{
  if(account!==accountKey||receiptOnly||!teamChangeAffectsSource(change,{conversationKey}))return
  if(change?.kind==='team.message.changed'&&change.messageKey){
   const project=(value:TeamExtensionPage):TeamExtensionPage=>({...value,
    message:invalidateTeamMessageRead(value.message,change,conversationKey),
    items:value.items.map(row=>invalidateTeamMessageRead(row,change,conversationKey)),throughSeq:0})
   for(const [key,value] of saved.current)saved.current.set(key,project(value))
   if(state.current){state.current=project(state.current);setPage(state.current)}
  }else{
   // Unknown/reconnect and access changes still remove every stale snapshot.
   saved.current.clear();state.current=undefined;setPage(undefined);setInvalidated(true)
  }
  void load()
 }),[accountKey,conversationKey,load])
 return {page:pageScope.current===scope&&page?.message.key===message.key?page:undefined,error,loading,invalidated,retry:()=>{void load()},more:()=>{void load(true)}}
}
