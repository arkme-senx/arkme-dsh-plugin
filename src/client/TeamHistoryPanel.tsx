import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TeamConversation, TeamMessage } from '../team-app-contract.js'
import type { TeamHistoryOptions, TeamHistoryResponse } from '../team-history-contract.js'
import type { ConversationActivitySelection } from '../conversation-activity.js'
import { historyCall, historyTimezone, localDateWindow, prepareHistory, useTeamHistoryPage } from './team-history-client.js'
import { subscribeTeamMessageChanges } from './team-messaging-events.js'
import { ActivityChart, conversationActivityStyles } from './statistics/ConversationActivity.js'
import { ConversationWordsCloud, conversationAnalysisStyles } from './statistics/ConversationAnalysis.js'
import { TeamMessageContent } from './TeamMessageContent.js'
import { tr } from './locale.js'
import { arkmeTheme } from './arkme-theme.js'
import { useTeamPersonNames } from './use-team-person-names.js'

export function TeamHistoryRows({messages,conversation,accountKey,onLocate}:{messages:TeamMessage[];conversation:TeamConversation;accountKey:string;onLocate(message:TeamMessage):void}){
  const identity=useTeamPersonNames(conversation,accountKey,messages.map(m=>m.sender))
  return <>{messages.map(message=><button key={message.key} type="button" data-team-history-hit={message.key} onClick={()=>onLocate(message)} style={{display:'block',width:'100%',textAlign:'left',padding:'12px 0',border:0,borderBottom:`1px solid ${arkmeTheme.borderSoft}`,background:'transparent',color:arkmeTheme.text,cursor:'pointer'}}>
    <span style={{display:'block',fontSize:12,color:arkmeTheme.secondary}}>{message.own?tr('我'):identity(message.sender).nickname} · {message.createdAt>0?new Date(message.createdAt).toLocaleString():tr('时间未提供')}</span>
    <TeamMessageContent message={message}/><small>{tr('查看原消息')}</small>
  </button>)}</>
}
function PageStatus({owner}:{owner:ReturnType<typeof useTeamHistoryPage>}){
  return <>{owner.windowed&&<p>{tr('当前仅保留最近加载的 200 条摘要，刷新可返回起点')}</p>}{owner.loading&&<p role="status">{tr(owner.page?.state==='index_preparing'?'正在准备历史索引…':'正在读取…')}</p>}{owner.error&&<p role="alert">{owner.error}</p>}
    <button type="button" disabled={owner.loading} onClick={owner.refresh}>{tr(owner.error?'重新查询':'刷新')}</button>
    {owner.page?.hasMore&&<button type="button" disabled={owner.loading} onClick={()=>void owner.more()}>{tr('加载更多')}</button>}</>
}
export function TeamHistoryPanel({conversation,accountKey,kind,initialKeyword,onLocate}:{conversation:TeamConversation;accountKey:string;kind:'search'|'analysis';initialKeyword:string;onLocate(message:TeamMessage):void}){
  const [keyword,setKeyword]=useState(initialKeyword),[sender,setSender]=useState('all'),[from,setFrom]=useState(''),[until,setUntil]=useState(''),[media,setMedia]=useState<TeamHistoryOptions['contentKind']>(),[tab,setTab]=useState<'words'|'activity'>('activity')
  const [debounced,setDebounced]=useState(keyword),[people,setPeople]=useState<TeamHistoryResponse>(),[peopleBusy,setPeopleBusy]=useState(false),[peopleError,setPeopleError]=useState('')
  const lifetime=useRef<AbortController>(),peopleRequest=useRef<string>(),scope=JSON.stringify([accountKey,conversation.key,conversation.side])
  useEffect(()=>{lifetime.current=new AbortController();return()=>lifetime.current?.abort()},[scope])
  useEffect(()=>{setKeyword(initialKeyword)},[initialKeyword])
  useEffect(()=>{const timer=setTimeout(()=>setDebounced(keyword.trim()),300);return()=>clearTimeout(timer)},[keyword])
  const person=people?.participants.find(p=>p.personKey===sender)
  const options:TeamHistoryOptions={...localDateWindow(from,until),...(kind==='search'&&debounced?{keyword:debounced}:{}),...(media?{contentKind:media}:{}),...(sender==='self'?{sender:'self'}:person?.personRef?{personRef:person.personRef}:{})}
  const invalidRange=!!(from&&until&&from>until)
  const search=useTeamHistoryPage(conversation.ref,accountKey,'query',options,kind==='search'&&!invalidRange,scope)
  const loadPeople=async(reset=false)=>{
    if(peopleBusy)return
    setPeopleBusy(true);setPeopleError('');if(reset){setPeople(undefined);peopleRequest.current=undefined}peopleRequest.current??=crypto.randomUUID()
    const signal=lifetime.current!.signal
    try{
      const previous=reset?undefined:people
      let result=previous
      if(!result?.resultRef){result=await prepareHistory(conversation.ref,accountKey,'participants',{requestId:peopleRequest.current,timezone:historyTimezone()},signal)}
      const page=await historyCall(conversation.ref,accountKey,'participants',{resultRef:result.resultRef!,...(previous?.cursor?{cursor:previous.cursor}:{}),limit:100},signal)
      if(!signal.aborted)setPeople({...page,participants:[...(previous?.participants??[]),...page.participants]})
    }catch(error){if(!signal.aborted)setPeopleError(error instanceof Error?error.message:'人员读取失败')}
    finally{if(!signal.aborted)setPeopleBusy(false)}
  }
  const render=(messages:TeamMessage[]) => <TeamHistoryRows messages={messages} conversation={conversation} accountKey={accountKey} onLocate={onLocate}/>
  return <div className="conversation-words"><style>{conversationAnalysisStyles}{conversationActivityStyles}</style>
    {kind==='search'&&<input autoFocus type="search" aria-label={tr('搜索团队聊天关键词')} placeholder={tr('搜索此对话')} value={keyword} onChange={e=>setKeyword(e.target.value)} style={{width:'100%',boxSizing:'border-box',padding:10}}/>}
    {kind==='analysis'&&<div className="cw-controls">{(['activity','words'] as const).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{tr(t==='activity'?'活跃时间':'词频分析')}</button>)}</div>}
    <div className="cw-controls">
      <select aria-label={tr('筛选发送者')} value={sender} onChange={e=>setSender(e.target.value)}><option value="all">{tr('全部发送者')}</option><option value="self">{tr('我')}</option>{people?.participants.filter(p=>p.personKey&&!p.isMe).map(p=><option key={p.personKey} value={p.personKey}>{p.nickname}</option>)}</select>
      {conversation.side==='team'&&(!people||people.hasMore)&&<button disabled={peopleBusy} onClick={()=>void loadPeople()}>{tr(peopleBusy?'正在读取…':people?'更多历史发送者':'选择历史发送者')}</button>}
      <input type="date" aria-label={tr('开始日期')} value={from} onChange={e=>setFrom(e.target.value)}/><input type="date" aria-label={tr('结束日期')} value={until} onChange={e=>setUntil(e.target.value)}/>
      <select aria-label={tr('消息类型')} value={media??''} onChange={e=>setMedia((e.target.value||undefined) as TeamHistoryOptions['contentKind'])}><option value="">{tr('全部类型')}</option>{(['text','image','video','audio','file'] as const).map((v,i)=><option key={v} value={v}>{tr(['文字','图片','视频','音频','文件'][i]!)}</option>)}</select>
    </div>
    {peopleError&&<p role="alert">{peopleError}<button onClick={()=>void loadPeople(true)}>{tr('重试')}</button></p>}
    <p className="cw-muted">{historyTimezone()} · {tr('按实际发送消息统计；点击摘要定位原消息')}</p>
    {invalidRange?<p role="alert">{tr('结束日期不能早于开始日期')}</p>:kind==='search'?<>
      <PageStatus owner={search}/>{search.page?.indexing&&<p role="status">{tr('新消息正在索引，当前显示已完成范围')}</p>}
      {render(search.page?.messages??[])}{search.page?.state==='ready'&&!search.page.messages.length&&<p>{tr('此范围暂无匹配消息')}</p>}
    </>:<TeamHistoryAnalysis key={scope} conversation={conversation} accountKey={accountKey} options={options} kind={tab} render={render}/>}
  </div>
}
function TeamHistoryAnalysis({conversation,accountKey,options,kind,render}:{conversation:TeamConversation;accountKey:string;options:TeamHistoryOptions;kind:'words'|'activity';render(messages:TeamMessage[]):ReactNode}){
  const [manifest,setManifest]=useState<TeamHistoryResponse>(),[result,setResult]=useState<TeamHistoryResponse>(),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  const [weekly,setWeekly]=useState(false),[view,setView]=useState<'cloud'|'list'>('cloud'),[selection,setSelection]=useState<{sourceRef:string}|ConversationActivitySelection>()
  const signature=JSON.stringify(options),current=useRef({conversationRef:conversation.ref,options});current.current={conversationRef:conversation.ref,options}
  const scope=JSON.stringify([accountKey,conversation.key,conversation.side]),active=useRef<AbortController>()
  useEffect(()=>{
    const controller=new AbortController(),requestId=crypto.randomUUID();active.current=controller;setManifest(undefined);setResult(undefined);setError('');setSelection(undefined)
    void prepareHistory(current.current.conversationRef,accountKey,'analysis/create',{...current.current.options,analysisKind:kind,requestId},controller.signal,setManifest)
      .then(async ready=>{if(kind==='activity'){const verified=await historyCall(current.current.conversationRef,accountKey,'analysis/result',{resultRef:ready.resultRef!},controller.signal);if(!controller.signal.aborted)setResult(verified)}else if(!controller.signal.aborted)setResult(ready)})
      .catch(error=>{if(!controller.signal.aborted){setResult(undefined);setError(error instanceof Error?error.message:'分析失败，请重试')}})
    return()=>controller.abort()
  },[scope,signature,kind,revision])
  useEffect(()=>subscribeTeamMessageChanges((account,receiptOnly)=>{if(account===accountKey&&!receiptOnly){active.current?.abort();setResult(undefined);setManifest(undefined);setError('团队内容已更新，请重新分析')}}),[accountKey])
  const words=useTeamHistoryPage(conversation.ref,accountKey,'analysis/words',{resultRef:result?.resultRef??'',limit:100},!!result&&kind==='words',scope)
  const sourceOptions:TeamHistoryOptions={resultRef:result?.resultRef??'',...selection&&'sourceRef' in selection?{sourceRef:selection.sourceRef}:selection?{hour:selection.hour,...(selection.weekday!==null?{weekday:selection.weekday}:{})}:{}}
  const sources=useTeamHistoryPage(conversation.ref,accountKey,'analysis/sources',sourceOptions,!!result&&!!selection,scope)
  return <>
    <button onClick={()=>setRevision(n=>n+1)}>{tr('重新分析')}</button>
    {error&&<p role="alert">{error}</p>}{!result&&!error&&<p role="status">{tr('正在分析…')} {manifest?.processedThroughSeq??0} / {conversation.lastSeq}{manifest?.reason?` · ${tr('服务暂不可用，正在重试')}`:''}</p>}
    {result&&selection?<><button onClick={()=>setSelection(undefined)}>{tr('返回分析')}</button><p>{sources.page?.totalInSnapshot??''} {tr('条消息')}</p><PageStatus owner={sources}/>{render(sources.page?.messages??[])}</>:result&&kind==='words'?<>
      <PageStatus owner={words}/><button onClick={()=>setView(v=>v==='cloud'?'list':'cloud')}>{tr(view==='cloud'?'查看列表':'查看词云')}</button>
      <ConversationWordsCloud words={(words.page?.words??[]).map(w=>({key:w.sourceRef,text:w.word,count:w.count,messageCount:w.messageCount}))} view={view} onSelect={sourceRef=>setSelection({sourceRef})} onList={()=>setView('list')}/>
    </>:result?.activity?<>
      <div className="ca-metrics"><div>{tr('消息量')}<strong>{result.activity.totalMessages}</strong></div><div>{tr('活跃天数')}<strong>{result.activity.activeDays}</strong></div><div>{tr('已知参与者')}<strong>{result.activity.participants}</strong></div></div>
      {!!result.unknownTime&&<p>{result.unknownTime} {tr('条消息时间未提供，未计入时间分布')}</p>}
      <div className="cw-controls"><button aria-pressed={!weekly} onClick={()=>setWeekly(false)}>{tr('一天内')}</button><button aria-pressed={weekly} onClick={()=>setWeekly(true)}>{tr('一周内')}</button></div>
      <ActivityChart result={result.activity} weekly={weekly} onSelect={setSelection}/>
    </>:null}
  </>
}
