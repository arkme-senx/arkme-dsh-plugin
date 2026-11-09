import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import type {TeamConversation} from '../team-app-contract.js'
import type {TeamMentionCandidatePage} from '../team-message-contract.js'
import {callArkme} from './api.js'
import {arkmeAuthStore} from './auth-store.js'
import {subscribeTeamMessageChanges} from './team-messaging-events.js'
import {arkmeMentionCandidateMatches,type ArkmeMentionCandidate} from './mention-candidates.js'

// Same freshness bound as the ordinary conversation-members owner. Retained
// suggestions are draft presentation, never authority for sending a mention.
const PAGE_FRESH_MS=30_000
interface RetainedPage {scope:object;cursor:string|undefined;page:TeamMentionCandidatePage;expiresAt:number}

/** One mounted composer, one page and one read; opening @ never replaces its owner. */
export function useTeamMentionCandidates(conversation:TeamConversation,accountKey:string,scope:object,open:boolean,query:string,onInvalidated:()=>void,enabled:boolean){
 const ownerScope=useMemo(()=>({}),[scope,accountKey,conversation.key,conversation.side])
 const [position,setPosition]=useState<{scope:object;cursor?:string}>({scope:ownerScope})
 const cursor=position.scope===ownerScope?position.cursor:undefined
 const current=useRef({ownerScope,conversation,onInvalidated,enabled,cursor});current.current={ownerScope,conversation,onInvalidated,enabled,cursor}
 const [reprepare,setReprepare]=useState(0)
 const [state,setState]=useState<{scope:object;cursor:string|undefined;error?:boolean}>()
 const request=useRef<{scope:object;cursor:string|undefined;controller:AbortController}>()
 const retained=useRef<RetainedPage>(),failed=useRef<{scope:object;cursor:string|undefined}>()
 const sameAccount=()=>{const auth=arkmeAuthStore.getSnapshot().auth;return auth?.status==='authenticated'&&`${auth.environment}:${auth.userId}`===accountKey}
 const prepare=useCallback((force=false)=>{
  if(!enabled||!current.current.enabled||document.visibilityState==='hidden'||current.current.ownerScope!==ownerScope||current.current.cursor!==cursor||!sameAccount())return
  if(request.current?.scope===ownerScope&&request.current.cursor===cursor&&!request.current.controller.signal.aborted)return
  const previous=retained.current?.scope===ownerScope&&retained.current.cursor===cursor?retained.current:undefined
  if(!force&&(previous&&previous.expiresAt>Date.now()||failed.current?.scope===ownerScope&&failed.current.cursor===cursor))return
  request.current?.controller.abort()
  const controller=new AbortController();request.current={scope:ownerScope,cursor,controller};failed.current=undefined
  const active=()=>!controller.signal.aborted&&request.current?.controller===controller&&current.current.ownerScope===ownerScope&&current.current.cursor===cursor&&current.current.enabled&&sameAccount()
  setState({scope:ownerScope,cursor})
  const value=current.current.conversation
  void callArkme<TeamMentionCandidatePage>('team.messages.mention-candidates',{conversationRef:value.ref,teamRef:value.channel.teamRef,options:{limit:50,...(cursor?{cursor}:{})}},controller.signal).then(page=>{
   if(!active())return
   retained.current={scope:ownerScope,cursor,page,expiresAt:Date.now()+PAGE_FRESH_MS}
   setState({scope:ownerScope,cursor})
  },error=>{
   if(!active())return
   // Only explicitly retryable transport/service failures may retain draft suggestions.
   if((error as {body?:{retryable?:boolean}})?.body?.retryable!==true)retained.current=undefined
   failed.current={scope:ownerScope,cursor};setState({scope:ownerScope,cursor,error:true})
  }).finally(()=>{if(request.current?.controller===controller)request.current=undefined})
 },[ownerScope,cursor,enabled,accountKey])
 useEffect(()=>{
  prepare()
  return()=>{request.current?.controller.abort();retained.current=undefined;failed.current=undefined}
 },[prepare,reprepare])
 useEffect(()=>{if(open)prepare()},[open,prepare])
 // Keep the composer's prepared page through picker close. Focus/online make it
 // stale and refresh in place; actual access/membership changes retire it first.
 useEffect(()=>{
  if(!enabled)return
  const value=current.current.conversation
  const invalidate=()=>{
   retained.current=undefined;failed.current=undefined;request.current?.controller.abort();setState(undefined)
   current.current.onInvalidated();setReprepare(value=>value+1)
  }
  const refresh=()=>{if(retained.current?.scope===ownerScope)retained.current.expiresAt=0;prepare(true)}
  const stopAuth=arkmeAuthStore.subscribe(()=>{if(!sameAccount())invalidate()})
  const stopChanges=subscribeTeamMessageChanges((account,receiptOnly,change)=>{
   if(account!==accountKey||receiptOnly)return
   if(change?.conversationKeys?.length&&!change.conversationKeys.includes(value.key))return
   if(change&&['team.message.published','team.message.changed','team.receipt.changed','team.reaction.changed','team.annotation.changed','team.notification-policy.changed','team.entry-preference.changed'].includes(change.kind))return
   invalidate()
  })
  const visibility=()=>{if(document.visibilityState==='hidden')request.current?.controller.abort();else prepare()}
  window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',visibility)
  return()=>{stopAuth();stopChanges();window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',visibility)}
 },[ownerScope,enabled,accountKey,prepare])
 const page=open&&enabled&&sameAccount()&&retained.current?.scope===ownerScope&&retained.current.cursor===cursor?retained.current.page:undefined
 const error=state?.scope===ownerScope&&state.cursor===cursor&&state.error===true
 const candidates=useMemo<ArkmeMentionCandidate[]>(()=> (page?.items??[]).filter(person=>person.personRef&&person.personKey&&arkmeMentionCandidateMatches({displayName:person.nickname},query)).map(person=>({kind:'member',mentionRef:person.personRef!,memberRef:person.personKey!,teamPersonKey:person.personKey!,displayName:person.nickname,mentionDisplayName:person.nickname,...(person.imageRef?{teamImage:{ref:person.imageRef,...(person.imageKey?{key:person.imageKey}:{})}}:{}),role:'member',status:'active',isSelf:person.isMe===true,isOwner:false,joinedAtMillis:0,recordCount:0,mentionCount:0,statsKnown:false})),[page,query])
 return {candidates,loading:open&&!page&&!error,error,prepare:()=>prepare(!!failed.current),
  hasMore:page?.hasMore===true&&!!page.nextCursor&&page.nextCursor!==cursor,hasPrevious:!!cursor,
  retry:()=>prepare(true),first:()=>setPosition({scope:ownerScope}),next:()=>{if(page?.hasMore&&page.nextCursor&&page.nextCursor!==cursor)setPosition({scope:ownerScope,cursor:page.nextCursor})},
  pageKey:cursor??'',canSelect:(candidate:ArkmeMentionCandidate)=>open&&enabled&&current.current.enabled&&current.current.ownerScope===ownerScope&&current.current.cursor===cursor&&retained.current?.page===page&&sameAccount()&&candidate.kind==='member'&&!!page?.items.some(v=>v.personRef===candidate.mentionRef),
 }
}
