import {useCallback,useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react'
import {ArrowLeft} from '@phosphor-icons/react/dist/icons/ArrowLeft'
import {UserPlus} from '@phosphor-icons/react/dist/icons/UserPlus'
import {TeamEntryRemovalList} from './TeamEntryRemovalFeedback.js'
import {useTeamConversationEntryActions} from './TeamConversationEntryActions.js'
import {ArkmePinnedCorner} from './ArkmePinnedCorner.js'
import type {TeamChannel} from '../team-app-contract.js'
import type {TeamWorkspaceEntry,TeamWorkspacePage} from '../team-group-contract.js'
import {callArkme} from './api.js'
import {ArkmeOverlayScrollArea} from './ArkmeOverlayScrollArea.js'
import {ArkmeSourceAvatar} from './ArkmeAvatar.js'
import {ArkmeTopicTagBadge} from './ArkmeTopicTagBadge.js'
import {TeamConversationRow} from './TeamMessagingPanel.js'
import {conversationDirectoryStyles as styles,conversationTimeLabel} from './conversation-directory-presentation.js'
import {openTeamMessages,subscribeTeamMessageChanges,subscribeTeamWorkspaceChanges} from './team-messaging-events.js'
import {openTeamOutbound} from './team-outbound.js'
import {arkmeUi} from './ui-controller.js'
import {arkmeTheme} from './arkme-theme.js'
import {tr,useArkmeLocale} from './locale.js'
import {teamDirectoryPreferences,teamEntryHidden,teamEntryPinned,teamEntryKey,teamFolderEntryKey,useTeamDirectoryPreferences,type TeamEntryTarget} from './team-directory-preferences.js'
import {readTeamDirectory,subscribeTeamDirectory} from './team-conversation-directory.js'
import {openedTeamConversations} from './team-opened-conversations.js'

/** One server cursor owns the mixed stream. Client rows are presentation only. */
export function TeamWorkspaceDirectory({accountKey,teamRef,channel:initialChannel,selectedKey,onBack}:{accountKey:string;teamRef:string;channel?:TeamChannel|undefined;selectedKey?:string|undefined;onBack():void}) {
  useArkmeLocale()
  const [channel,setChannel]=useState(initialChannel),[rows,setRows]=useState<TeamWorkspaceEntry[]>([]),[page,setPage]=useState<TeamWorkspacePage>(),[loading,setLoading]=useState(false),[error,setError]=useState(''),[pinRows,setPinRows]=useState<TeamWorkspaceEntry[]>([]),[showRemoved,setShowRemoved]=useState(false)
  const controller=useRef<AbortController>(),lifecycle=useRef<AbortController>(),refreshPending=useRef(false),latest=useRef(page),scroll=useRef<HTMLDivElement>(null),sentinel=useRef<HTMLDivElement>(null),restored=useRef(false)
  const scope=JSON.stringify([accountKey,channel?.jotmoId??teamRef])
  const preferences=useTeamDirectoryPreferences(accountKey)
  const privateDirectory=useSyncExternalStore(subscribeTeamDirectory,()=>readTeamDirectory(accountKey),()=>readTeamDirectory(accountKey))
  const pins:TeamWorkspaceEntry[]=page?privateDirectory.items.filter(c=>c.side==='team'&&c.channel.jotmoId===channel?.jotmoId&&teamEntryPinned(preferences,{kind:'conversation',conversation:c}))
    .map(c=>({kind:'customer',key:`pinned:${c.key}`,activityAt:c.updatedAt,conversation:c})):[]
  const targetFor=(row:TeamWorkspaceEntry):TeamEntryTarget=>row.kind==='customer'?{kind:'conversation',conversation:row.conversation}:{kind:'group',source:row.source,entryKey:row.entryKey,entryRef:row.entryRef,channel}
  // Existing private-contact snapshots retain their ordinary offline behavior.
  // Delegated group bodies enter only through a currently authorized mixed page.
  const cachedCustomers:TeamWorkspaceEntry[]=privateDirectory.items.filter(c=>c.side==='team'&&c.channel.jotmoId===channel?.jotmoId)
    .map(conversation=>({kind:'customer',key:conversation.key,activityAt:conversation.updatedAt,conversation}))
  const openedCustomers:TeamWorkspaceEntry[]=openedTeamConversations.read(accountKey).filter(c=>c.channel.jotmoId===channel?.jotmoId)
    .map(conversation=>({kind:'customer',key:conversation.key,activityAt:conversation.updatedAt,conversation}))
  const allRows=[...new Map([...openedCustomers,...pins,...pinRows,...(page?rows:cachedCustomers)].map(row=>[row.kind==='customer'?`customer:${row.conversation.key}`:`group:${row.source.sourceKey}`,row])).values()]
    .filter(row=>teamDirectoryPreferences.canPresentTarget(accountKey,targetFor(row)))
    .sort((a,b)=>Number(teamEntryPinned(preferences,targetFor(b)))-Number(teamEntryPinned(preferences,targetFor(a)))||b.activityAt-a.activityAt||(a.key<b.key?1:a.key>b.key?-1:0))
  const visibleRows=allRows.filter(row=>!teamEntryHidden(preferences,targetFor(row))),removed=allRows.filter(row=>teamEntryHidden(preferences,targetFor(row)))
  useEffect(()=>{
    if(!page||!channel)return
    const request=new AbortController()
    void(async()=>{
      await teamDirectoryPreferences.hydrate(accountKey,true)
      await teamDirectoryPreferences.reconcileTargets(accountKey,rows.map(targetFor),request.signal)
      request.signal.throwIfAborted()
      const targets=teamDirectoryPreferences.workspacePins(accountKey,teamFolderEntryKey(channel),new Set(rows.map(r=>teamEntryKey(targetFor(r)))))
      const found:TeamWorkspaceEntry[]=[]
      for(let i=0;i<targets.length;i+=100) {
        const next=await callArkme<TeamWorkspacePage>('team.app.workspace.request',{expectedAccountKey:accountKey,request:{operation:'resolve-entries',teamRef,entries:targets.slice(i,i+100)}},request.signal)
        if(!next.complete||next.resetRequired)throw new Error(tr('来源权限已变化，请刷新目录'))
        found.push(...next.items)
      }
      request.signal.throwIfAborted()
      setPinRows(found)
    })().catch(()=>{if(!request.signal.aborted)setPinRows([])})
    return()=>request.abort()
  },[accountKey,teamRef,rows,channel])
  const load=useCallback(async(more=false):Promise<void>=>{
    const life=lifecycle.current
    if(!life||life.signal.aborted)return
    // A head invalidation supersedes paging; repeated hints need only one read.
    if(controller.current){if(!more)refreshPending.current=true;return}
    const previous=latest.current
    if(more&&(!previous?.hasMore||!previous.complete))return
    const request=new AbortController();controller.current=request;refreshPending.current=false;setLoading(true);setError('')
    try {
      const next=await callArkme<TeamWorkspacePage>('team.app.workspace',{expectedAccountKey:accountKey,teamRef,...(more?{cursor:previous!.nextCursor}:{})},request.signal)
      if(request.signal.aborted)return
      if(!Array.isArray(next.items)||typeof next.complete!=='boolean'||typeof next.hasMore!=='boolean'||next.hasMore&&!next.nextCursor||more&&next.complete&&next.hasMore&&next.nextCursor===previous?.nextCursor)throw new Error(tr('团队目录分页异常，请重试'))
      latest.current=next;setPage(next)
      setRows(old=>[...new Map([...(more&&!next.resetRequired?old:[]),...next.items].map(row=>[row.key,row])).values()])
    } catch(e) {
      if(request.signal.aborted)return
      setError(e instanceof Error?e.message:tr('团队目录暂时无法加载'))
      if(/team-(not_accessible|account-changed)|login-|team_group_(forbidden|membership_stale)/.test(String((e as {body?:{code?:string}})?.body?.code))){setRows([]);setPinRows([]);latest.current=undefined;setPage(undefined)}
    } finally {
      if(controller.current===request){
        controller.current=undefined
        if(!life.signal.aborted){setLoading(false);if(refreshPending.current)void load()}
      }
    }
  },[accountKey,teamRef])
  useEffect(()=>{if(initialChannel)setChannel(initialChannel)},[initialChannel])
  useEffect(()=>{
    // The parent key owns account/team state; rotating sealed refs only refresh rows.
    const life=new AbortController();lifecycle.current=life;refreshPending.current=false
    if(!initialChannel)void callArkme<TeamChannel>('team.app.channel',{expectedAccountKey:accountKey,teamRef},life.signal).then(value=>{if(!life.signal.aborted){setChannel(value);arkmeUi.resolveTeamDirectory(teamRef,value)}}).catch(e=>{if(!life.signal.aborted)setError(e instanceof Error?e.message:tr('团队暂不可用'))})
    void load()
    const stop=subscribeTeamMessageChanges(account=>{if(account===accountKey)void load()})
    const stopWorkspace=subscribeTeamWorkspaceChanges(account=>{if(account===accountKey)void load()})
    const focus=()=>{void load()},timer=setInterval(()=>{if(document.visibilityState==='visible')void load()},60_000)
    window.addEventListener('focus',focus)
    return()=>{life.abort();controller.current?.abort();controller.current=undefined;refreshPending.current=false;stop();stopWorkspace();clearInterval(timer);window.removeEventListener('focus',focus)}
  },[accountKey,teamRef,load])
  useLayoutEffect(()=>{
    if((!page&&!allRows.length)||!channel||restored.current||!scroll.current)return
    scroll.current.scrollTop=arkmeUi.readTeamDirectoryScroll(scope);restored.current=true
  },[page,scope,allRows.length])
  useLayoutEffect(()=>{
    if(!selectedKey||!scroll.current||!channel)return
    const selected=[...scroll.current.querySelectorAll<HTMLElement>('[data-team-conversation-key],[data-team-group-source-key]')]
      .find(row=>(row.dataset.teamConversationKey??row.dataset.teamGroupSourceKey)===selectedKey)
    if(!selected)return
    const container=scroll.current.getBoundingClientRect(),row=selected.getBoundingClientRect()
    if(row.top<container.top)scroll.current.scrollTop-=container.top-row.top
    else if(row.bottom>container.bottom)scroll.current.scrollTop+=row.bottom-container.bottom
  },[scope,selectedKey,page,JSON.stringify(visibleRows.map(row=>row.kind==='customer'?row.conversation.key:row.source.sourceKey))])
  useEffect(()=>{
    if(!page?.hasMore||!page.complete||loading||error||!sentinel.current||!scroll.current||typeof IntersectionObserver==='undefined')return
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))void load(true)},{root:scroll.current,rootMargin:'160px'})
    observer.observe(sentinel.current);return()=>observer.disconnect()
  },[page,loading,error,load])
  return <section aria-label={tr('团队会话列表')} style={{width:'100%',height:'100%',minHeight:0,display:'flex',flexDirection:'column',color:arkmeTheme.text,background:arkmeTheme.base}}>
    <header data-arkme-window-drag-region="conversation" style={{minHeight:64,flex:'none',display:'flex',alignItems:'center',gap:8,padding:'0 16px',boxSizing:'border-box'}}>
      <button type="button" data-arkme-feedback="neutral" aria-label={tr('返回 Arkme 会话列表')} onClick={onBack} style={{width:30,height:30,display:'grid',placeItems:'center',padding:0,border:0,borderRadius:8,background:'transparent',color:'inherit',cursor:'pointer'}}><ArrowLeft size={20}/></button>
      <h2 style={{fontSize:15,lineHeight:'24px',fontWeight:500,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{channel?.name??tr('团队对话')}</h2>
      <button type="button" data-arkme-feedback="neutral" aria-label={tr('联系用户')} disabled={!channel} style={{marginLeft:'auto',width:32,height:32,display:'grid',placeItems:'center',padding:0,border:0,borderRadius:8,background:'transparent',color:'inherit',cursor:'pointer'}} onClick={()=>openTeamOutbound({accountKey,teamJotmoId:channel?.jotmoId})}><UserPlus size={20}/></button>
    </header>
    <ArkmeOverlayScrollArea ref={scroll} aria-label={tr('团队会话列表')} style={{padding:'0 6px 8px'}} onScroll={e=>{if(restored.current)arkmeUi.rememberTeamDirectoryScroll(scope,e.currentTarget.scrollTop)}}>
      <div role="tree" aria-label={channel?.name??tr('团队对话')}><TeamEntryRemovalList accountKey={accountKey} targets={allRows.map(targetFor)} visible={visibleRows.map(targetFor)}>
        {targets=>targets.map(target=>target.kind==='conversation'
          ?<TeamConversationRow key={teamEntryKey(target)} accountKey={accountKey} conversation={target.conversation} showTeamName={false} selected={selectedKey===target.conversation.key} role="treeitem" onClick={()=>openTeamMessages({kind:'conversation',conversation:target.conversation})}/>
          :target.kind==='group'?<TeamWorkspaceGroupRow key={target.entryKey} accountKey={accountKey} target={target} selected={selectedKey===target.source.sourceKey}/>:null)}
      </TeamEntryRemovalList></div>
      {!!removed.length&&<div><button type="button" style={{border:0,padding:'8px 12px',background:'transparent',color:arkmeTheme.secondary,fontSize:12,cursor:'pointer'}} onClick={()=>setShowRemoved(v=>!v)}>{tr(showRemoved?'收起已移除对话':`查看已移除对话 (${removed.length})`)}</button>
        {showRemoved&&removed.map(row=>row.kind==='customer'?<TeamConversationRow key={row.key} accountKey={accountKey} conversation={row.conversation} showTeamName={false} onClick={()=>openTeamMessages({kind:'conversation',conversation:row.conversation})}/>:<TeamWorkspaceGroupRow key={row.key} accountKey={accountKey} target={targetFor(row) as Extract<TeamEntryTarget,{kind:'group'}>} selected={false}/>)}</div>}
      {(!page&&loading&&!visibleRows.length)&&<p className="team-empty" role="status">{tr('正在加载团队对话…')}</p>}
      {page?.complete&&!visibleRows.length&&!page.hasMore&&!error&&<p className="team-empty">{tr('还没有团队对话')}</p>}
      {(error||page&&!page.complete||page?.resetRequired)&&<div role="alert" className="team-opening-error"><p>{error||tr(page?.resetRequired?'来源权限已变化，请刷新目录':'部分来源暂不可用，当前列表尚不完整')}</p><button type="button" disabled={loading} onClick={()=>{void load()}}>{tr('重试')}</button></div>}
      {page?.hasMore&&page.complete&&<div ref={sentinel} style={{minHeight:28,textAlign:'center',fontSize:12,color:arkmeTheme.secondary}}><button type="button" disabled={loading} onClick={()=>{void load(true)}}>{tr(loading?'正在加载更多…':'加载更多')}</button></div>}
    </ArkmeOverlayScrollArea>
  </section>
}

function TeamWorkspaceGroupRow({accountKey,target,selected}:{accountKey:string;target:Extract<TeamEntryTarget,{kind:'group'}>;selected:boolean}) {
  const actions=useTeamConversationEntryActions(accountKey,target),source=target.source
  return <><button type="button" role="treeitem" aria-selected={selected} data-team-group-source-key={source.sourceKey} data-arkme-feedback="neutral" onContextMenu={actions.onContextMenu} style={{...styles.chatRow,...(selected?{background:arkmeTheme.active}:{}),...actions.rowStyle}} onClick={()=>{void actions.open(()=>arkmeUi.selectSource(source))}}>
    <span style={styles.sourceAvatarWrap}><ArkmeSourceAvatar kind="group" groupAvatar={source.groupAvatar} avatarRefs={source.avatarRefs} size={38}/>{source.unreadCount>0&&<span style={styles.mentionUnread}>{source.unreadCount>99?'99+':source.unreadCount}</span>}</span>
    <span data-arkme-conversation-content style={styles.chatContent}><span style={styles.chatTop}><span style={styles.entryName}>{source.displayName}</span><ArkmeTopicTagBadge label={tr('群聊')} truncate/><span style={{...styles.chatTime,marginLeft:'auto'}}>{conversationTimeLabel(source.activeAtMillis)}</span></span><span style={styles.chatBottom}><span style={styles.preview}>{source.latestPreview||tr('代表团队参与群聊')}</span></span></span>
    {actions.pinned&&<ArkmePinnedCorner/>}{actions.feedback}
  </button>{actions.overlays}</>
}
