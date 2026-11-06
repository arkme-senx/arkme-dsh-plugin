import {useCallback,useEffect,useRef,useState} from 'react'
import type {TeamConversation} from '../team-app-contract.js'
import type {TeamGroupPage,TeamGroupSourceCard} from '../team-group-contract.js'
import type {ArkmeSourceItem,ArkmeTimelineItem} from '../types.js'
import {callArkme} from './api.js'
import {arkmeUi} from './ui-controller.js'
import {arkmeComposerDraftStore,arkmeSourceComposerDraftKey} from './composer-draft-store.js'
import {arkmeTheme} from './arkme-theme.js'
import {conversationTimeLabel} from './conversation-directory-presentation.js'
import {tr,useArkmeLocale} from './locale.js'
import {subscribeTeamWorkspaceChanges} from './team-messaging-events.js'

/** Cards navigate or reply to their exact original source. They create no DM. */
export function TeamGroupSourceCards({accountKey,conversation}:{accountKey:string;conversation:TeamConversation}) {
  useArkmeLocale()
  const [page,setPage]=useState<TeamGroupPage<TeamGroupSourceCard>>(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const request=useRef<AbortController>(),lifecycle=useRef<AbortController>(),refreshPending=useRef(false),latest=useRef(page)
  const load=useCallback(async(more=false):Promise<void>=>{
    const life=lifecycle.current
    if(!life||life.signal.aborted)return
    if(request.current){if(!more)refreshPending.current=true;return}
    if(more&&!latest.current?.hasMore)return
    const controller=new AbortController();request.current=controller;refreshPending.current=false;setBusy(true);setError('')
    try {
      const next=await callArkme<TeamGroupPage<TeamGroupSourceCard>>('team.app.sources.cards',{expectedAccountKey:accountKey,conversationRef:conversation.ref,...(more?{cursor:latest.current?.nextCursor}:{})},controller.signal)
      if(controller.signal.aborted)return
      if(!Array.isArray(next.items)||typeof next.hasMore!=='boolean'||next.hasMore&&!next.nextCursor)throw new Error(tr('来源群返回异常，请重试'))
      const value={...next,items:[...new Map([...(more?latest.current?.items??[]:[]),...next.items].map(card=>[card.key,card])).values()]}
      latest.current=value;setPage(value)
    }catch(e){if(!controller.signal.aborted){setError(e instanceof Error?e.message:tr('来源群暂不可用'));setPage(undefined);latest.current=undefined}}
    finally{
      if(request.current===controller){
        request.current=undefined
        if(!life.signal.aborted){setBusy(false);if(refreshPending.current)void load()}
      }
    }
  },[accountKey,conversation.ref])
  useEffect(()=>{
    // The parent key owns account/conversation state; rotating sealed refs only refresh cards.
    const life=new AbortController();lifecycle.current=life;refreshPending.current=false
    void load()
    const stop=subscribeTeamWorkspaceChanges(account=>{if(account===accountKey)void load()})
    const focus=()=>{void load()},timer=setInterval(()=>{if(document.visibilityState==='visible')void load()},60_000)
    window.addEventListener('focus',focus)
    return()=>{life.abort();request.current?.abort();request.current=undefined;refreshPending.current=false;stop();clearInterval(timer);window.removeEventListener('focus',focus)}
  },[accountKey,load])
  const reply=async(card:TeamGroupSourceCard)=>{
    const life=lifecycle.current
    if(!life||life.signal.aborted||request.current)return
    const controller=new AbortController();request.current=controller;setBusy(true);setError('')
    try {
      const value=await callArkme<{source:ArkmeSourceItem;item:ArkmeTimelineItem}>('team.app.sources.locate',{expectedAccountKey:accountKey,anchorRef:card.latestRef},controller.signal)
      if(controller.signal.aborted)return
      if(!value.item.messageActionRef||value.source.accessKind!=='team_delegation')throw new Error(tr('原群消息已变化，请刷新来源'))
      const actor=Number(accountKey.split(':').at(-1)),key=arkmeSourceComposerDraftKey(actor,value.source)
      arkmeComposerDraftStore.setExtensionTarget(key,value.item)
      arkmeUi.selectSource(value.source,true)
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:tr('来源群暂不可用'))}
    finally{
      if(request.current===controller){
        request.current=undefined
        if(!life.signal.aborted){setBusy(false);if(refreshPending.current)void load()}
      }
    }
  }
  if(!page?.items.length&&!error&&!conversation.sourceOnly&&!conversation.hasGroupSources)return null
  return <section aria-label={tr('来源群聊')} style={{padding:'8px 16px',borderBottom:`1px solid ${arkmeTheme.borderSoft}`,fontSize:12,maxHeight:'25%',minHeight:0,overflowY:'auto',flexShrink:1}}>
    <strong>{tr('来源群聊')}</strong>
    {page?.items.map(card=><div key={card.key} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0'}}><button type="button" disabled={busy} onClick={()=>arkmeUi.selectSource(card.source)} style={{border:0,background:'transparent',color:arkmeTheme.text,cursor:'pointer',textAlign:'left',flex:1}}>{card.source.displayName}<small style={{marginLeft:8,color:arkmeTheme.secondary}}>{conversationTimeLabel(card.activityAt)}</small></button><button type="button" disabled={busy} onClick={()=>{void reply(card)}}>{tr('回复到此群')}</button></div>)}
    {busy&&!page&&<span role="status">{tr('正在加载…')}</span>}
    {page?.hasMore&&<button type="button" disabled={busy} onClick={()=>{void load(true)}}>{tr('更多来源群')}</button>}
    {error&&<div role="alert">{error} <button type="button" disabled={busy} onClick={()=>{void load()}}>{tr('重试')}</button></div>}
  </section>
}
