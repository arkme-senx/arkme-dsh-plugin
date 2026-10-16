import { ArkmeAutomaticAiSettings } from '../ArkmeAutomaticAiSettings.js'
import { ExploreSettingsDialog } from './ExploreSettingsDialog.js'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import { Pause } from '@phosphor-icons/react/dist/icons/Pause'
import { EXPLORE_LABELS, EXPLORE_MODULES, type ExploreModule, type ExplorePage, type ExploreItem, type ExploreDetail, type ExploreAction, type ExploreMutation, type ExploreSource } from '../../explore-contract.js'
import { callArkme } from '../api.js'
import { arkmeUi } from '../ui-controller.js'
import { arkmeAuthStore } from '../auth-store.js'
import { ArkmeDetailShell } from '../ArkmeDetailShell.js'
import { ArkmeTimelineDetailDrawer } from '../ArkmeNoteDetails.js'
import { useRecordingPlayback } from '../recordings/useRecordingPlayback.js'
import { tr, useArkmeLocale, arkmeIntlLocale } from '../locale.js'
import { exploreIcons } from './ExploreNavigation.js'

const message=(e:unknown)=>e instanceof Error?e.message:tr('加载失败，请重试')
const date=(value:number)=>value>0?new Intl.DateTimeFormat(arkmeIntlLocale(),{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(value):''
interface ExploreViewMemory { filter:string; query:string; page:ExplorePage|undefined; selected:ExploreItem|undefined; listTop:number; detailTop:number; savedAt:number }
const remembered=new Map<string,ExploreViewMemory>()
let memoryScope=''

export function ExploreSurface({module,accountScope}:{module:ExploreModule;accountScope:string}) {
  useArkmeLocale()
  if(memoryScope!==accountScope){remembered.clear();memoryScope=accountScope}
  const cached=remembered.get(module)
  const initial=cached&&Date.now()-cached.savedAt<120000?cached:undefined
  const restore=useRef(!!initial?.page)
  const [filter,setFilter]=useState(initial?.filter??''),[query,setQuery]=useState(initial?.query??''),[search,setSearch]=useState(initial?.query??'')
  const [page,setPage]=useState<ExplorePage|undefined>(initial?.page),[loading,setLoading]=useState(false),[error,setError]=useState(''),[moreError,setMoreError]=useState('')
  const [selected,setSelected]=useState<ExploreItem|undefined>(initial?.selected),[detail,setDetail]=useState<ExploreDetail>(),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('')
  const [settings,setSettings]=useState(false),[capabilities,setCapabilities]=useState(false)
  const managedAnalysis=module==='profile'||module==='goals'
  const [actionMenu,setActionMenu]=useState(false),[mutation,setMutation]=useState<{action:ExploreAction;ref:string}>(),[notice,setNotice]=useState('')
  const [source,setSource]=useState<ExploreSource>(),[sourcePending,setSourcePending]=useState(''),[sourceError,setSourceError]=useState(''),[original,setOriginal]=useState(false)
  const pageRequest=useRef<AbortController>(),detailRequest=useRef<AbortController>(),sourceRequest=useRef<AbortController>()
  const sentinel=useRef<HTMLDivElement>(null),scrollRoot=useRef<HTMLDivElement>(null),detailSentinel=useRef<HTMLDivElement>(null),detailRoot=useRef<HTMLDivElement>(null)
  const menuRoot=useRef<HTMLDivElement>(null)
  const selectedRef=useRef(selected);selectedRef.current=selected
  const pageRef=useRef(page);pageRef.current=page
  useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),250);return()=>clearTimeout(timer)},[search])
  const position=useRef({listTop:initial?.listTop??0,detailTop:initial?.detailTop??0})
  const memory=useRef({filter,query,page,selected});memory.current={filter,query,page,selected}
  useEffect(()=>()=>{remembered.set(module,{...memory.current,...position.current,savedAt:Date.now()})},[module])
  useEffect(()=>{if(scrollRoot.current)scrollRoot.current.scrollTop=position.current.listTop},[])
  useEffect(()=>{if(detail&&detailRoot.current)detailRoot.current.scrollTop=position.current.detailTop},[!!detail])
  const load=useCallback(async(more=false)=>{
    pageRequest.current?.abort();const c=new AbortController();pageRequest.current=c
    setLoading(true);if(more)setMoreError('');else setError('')
    const previous=pageRef.current
    try {
      const next=await callArkme<ExplorePage>('explore.list',{module,filter,query,...(more&&previous?.nextCursor?{cursor:previous.nextCursor}:{})},c.signal)
      if(c.signal.aborted)return
      const value=more&&previous?{...next,items:[...previous.items,...next.items.filter(x=>!previous.items.some(y=>y.key===x.key))]}:next
      setPage(value)
      if(!more&&selectedRef.current){const fresh=value.items.find(x=>x.key===selectedRef.current?.key);if(fresh)setSelected(fresh)}
    }catch(e){if(!c.signal.aborted)(more?setMoreError:setError)(message(e))}
    finally{if(!c.signal.aborted)setLoading(false)}
  },[module,filter,query])
  useEffect(()=>{if(restore.current){restore.current=false;return()=>pageRequest.current?.abort()}setPage(undefined);setSelected(undefined);position.current={listTop:0,detailTop:0};setNotice('');setMoreError('');void load();return()=>pageRequest.current?.abort()},[load])
  useEffect(()=>()=>{detailRequest.current?.abort();sourceRequest.current?.abort()},[])
  useEffect(()=>{
    if(!actionMenu)return
    const dismiss=(event:PointerEvent)=>{if(event.target instanceof Node&&!menuRoot.current?.contains(event.target))setActionMenu(false)}
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setActionMenu(false);menuRoot.current?.querySelector('button')?.focus()}}
    document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape)}
  },[actionMenu])
  useEffect(()=>{
    if(!page?.nextCursor||loading||error||moreError||!sentinel.current)return
    const observer=new IntersectionObserver(entries=>{if(entries.some(x=>x.isIntersecting))void load(true)},{root:scrollRoot.current,rootMargin:'200px'})
    observer.observe(sentinel.current);return()=>observer.disconnect()
  },[page?.nextCursor,loading,error,moreError,load])
  // Refresh task state without discarding loaded pages or the open source drawer.
  useEffect(()=>{
    if(!page?.progress?.active)return
    const controller=new AbortController();let pending=false
    const timer=setInterval(async()=>{
      if(document.visibilityState!=='visible'||loading||pending)return
      pending=true
      try{
        const next=await callArkme<ExplorePage>('explore.list',{module,filter,query},controller.signal)
        if(controller.signal.aborted)return
        setPage(current=>{if(!current)return current;const {progress:_,...base}=current;return {...base,actions:next.actions,contextRef:next.contextRef,...(next.analysisEnabled!==undefined?{analysisEnabled:next.analysisEnabled}:{}),...(next.progress?{progress:next.progress}:{})}})
        if(!next.progress?.active)setNotice(tr('分析状态已更新，可刷新查看最新内容'))
      }catch{ /* Retain the last owner state and its update time after a transient failure. */ }
      finally{pending=false}
    },15000)
    return()=>{clearInterval(timer);controller.abort()}
  },[page?.progress?.active,module,filter,query,loading])
  const readDetail=useCallback(async(item:ExploreItem,cursor?:string)=>{
    detailRequest.current?.abort();const c=new AbortController();detailRequest.current=c;setDetailLoading(true);setDetailError('')
    try{const value=await callArkme<ExploreDetail>('explore.detail',{ref:item.ref,...(cursor?{cursor}:{})},c.signal);if(c.signal.aborted)return
      setDetail(previous=>{if(!cursor||!previous)return value;const {nextCursor:_,...base}=previous;return {...base,evidence:[...previous.evidence,...value.evidence.filter(x=>!previous.evidence.some(y=>y.key===x.key))],...(value.nextCursor?{nextCursor:value.nextCursor}:{})}})
    }catch(e){if(!c.signal.aborted)setDetailError(message(e))}finally{if(!c.signal.aborted)setDetailLoading(false)}
  },[])
  useEffect(()=>{sourceRequest.current?.abort();setSourcePending('');setSource(undefined);setDetail(undefined);setDetailError('');setSourceError('');if(selected)void readDetail(selected);return()=>detailRequest.current?.abort()},[selected,readDetail])
  useEffect(()=>{
    if(!selected||!detail?.nextCursor||detailLoading||detailError||!detailSentinel.current)return
    const observer=new IntersectionObserver(entries=>{if(entries.some(x=>x.isIntersecting))void readDetail(selected,detail.nextCursor)},{root:detailRoot.current,rootMargin:'150px'})
    observer.observe(detailSentinel.current);return()=>observer.disconnect()
  },[selected,detail,detailLoading,detailError,readDetail])
  const openSource=async(ref:string)=>{
    sourceRequest.current?.abort();const c=new AbortController();sourceRequest.current=c;setSourcePending(ref);setSourceError('')
    try{const result=await callArkme<ExploreSource>('explore.source',{ref},c.signal);if(c.signal.aborted)return
      if(result.kind==='conversation')arkmeUi.showConversationTarget(result.source,result.itemUid,result.sendAtMillis,undefined,undefined,true)
      else setSource(result)
    }catch(e){if(!c.signal.aborted)setSourceError(message(e))}finally{if(!c.signal.aborted)setSourcePending('')}
  }
  const startAction=(action:ExploreAction,ref:string)=>{setActionMenu(false);setMutation({action,ref});setNotice('')}
  const Icon=exploreIcons[module]
  return <section className="arkme-explore" aria-label={tr(EXPLORE_LABELS[module])}>
    <header className="explore-header"><Icon size={25}/><span className="explore-muted">{tr('探索')} /</span><h2><select aria-label={tr('切换探索板块')} value={module} onChange={e=>e.target.value==='world'?arkmeUi.showWorld():arkmeUi.showExplore(e.target.value as ExploreModule)}>{[...EXPLORE_MODULES,'world' as const].map(m=><option value={m} key={m}>{tr(EXPLORE_LABELS[m])}</option>)}</select></h2>
      <div className="explore-header-actions"><span className="explore-muted">{page?`${page.total}`:''}</span><button className="explore-icon" aria-label={tr('刷新内容')} title={tr('刷新内容')} disabled={loading} onClick={()=>void load()}><ArrowClockwise size={18}/></button>
      {(!!page?.actions.length||module!=='relations')&&<div ref={menuRoot} style={{position:'relative'}}><button className="explore-icon" aria-label={tr('更多操作')} aria-expanded={actionMenu} onClick={()=>setActionMenu(v=>!v)}><DotsThree size={23}/></button>{actionMenu&&<div style={{position:'absolute',right:0,top:'100%',zIndex:3,padding:6,minWidth:150,borderRadius:8,background:'var(--dsw-specific-menu,#fff)',boxShadow:'0 4px 20px #0002'}}>{managedAnalysis&&<button className="explore-icon" style={{display:'block',width:'100%',textAlign:'left',padding:10}} onClick={()=>{setActionMenu(false);setCapabilities(true)}}>{tr('自动使用额度')}</button>}{module!=='relations'&&module!=='goals'&&<button className="explore-icon" style={{display:'block',width:'100%',textAlign:'left',padding:10}} onClick={()=>{setActionMenu(false);setSettings(true)}}>{tr(module==='profile'?'数据范围':'分析设置')}</button>}{page?.actions.map(a=><button className="explore-icon" style={{display:'block',width:'100%',textAlign:'left',padding:10}} key={a.id} onClick={()=>startAction(a,page!.contextRef)}>{tr(a.label)}</button>)}</div>}</div>}</div>
    </header>
    {managedAnalysis&&page&&page.analysisEnabled!==true&&<div className="explore-notice" role="status"><span>{tr(page.analysisEnabled===false?'尚未开启分析':'暂时无法确认分析设置')}</span><button className="explore-source-link" onClick={()=>setCapabilities(true)}>{tr('自动使用额度')}</button></div>}
    {page?.progress&&<div className="explore-notice" role="status"><span>{tr(page.progress.label)}</span>{page.progress.total!==undefined&&page.progress.total>0&&<span>{page.progress.completed} / {page.progress.total}</span>}{page.progress.updatedAt>0&&<span>{tr('更新于')} {date(page.progress.updatedAt)}</span>}</div>}
    {notice&&<div className="explore-notice" role="status">{notice}</div>}
    <div className="explore-workspace" data-selected={!!selected}>
      <aside className="explore-list-pane" aria-label={`${tr(EXPLORE_LABELS[module])}${tr('列表')}`}>
        {!!page?.filters.length&&<div className="explore-filters">{page.filters.map((f,index)=><button type="button" className="explore-filter" key={f.key} aria-pressed={filter===f.key||module==='profile'&&!filter&&index===0} onClick={()=>setFilter(f.key)}>{tr(f.label)}{f.count!==undefined&&f.count>0?<span style={{marginLeft:5,opacity:.6}}>{f.count}</span>:null}</button>)}</div>}
        {module==='relations'&&<input className="explore-search" aria-label={tr('搜索关系')} placeholder={tr('搜索名称或别名')} value={search} onChange={e=>setSearch(e.target.value)}/>}
        <div className="explore-list" ref={scrollRoot} onScroll={e=>{position.current.listTop=e.currentTarget.scrollTop}}>
          {error&&<div role="alert" className="explore-error">{error}<button className="explore-source-link" onClick={()=>void load()}>{tr('重试')}</button></div>}
          {page?.items.map(item=><button type="button" className="explore-row" aria-current={selected?.key===item.key} key={item.key} onClick={()=>{position.current.detailTop=0;setSelected(item);setActionMenu(false)}}><div className="explore-row-title"><span>{item.title}</span>{item.count!==undefined&&<span className="explore-muted">{item.count}</span>}</div>{item.summary&&<div className="explore-row-summary">{item.summary}</div>}<div className="explore-row-meta">{item.category&&<span>{item.category}</span>}{item.linkedContactName&&item.linkedContactName!==item.title&&<span>{tr('关联联系人')}：{item.linkedContactName}</span>}{item.status&&<span>{tr(item.status)}</span>}{item.dateLabel?<span>{item.dateLabel}</span>:item.date>0&&<span>{date(item.date).split(' ')[0]}</span>}</div></button>)}
          {!loading&&!error&&page&&!page.items.length&&<div className="explore-empty"><Icon size={36} weight="thin"/><span>{tr(page.emptyMessage??(query?'没有找到匹配的内容':'还没有相关内容'))}</span></div>}
          {loading&&<div className="explore-more" role="status">{tr('正在加载…')}</div>}
          {moreError?<div role="alert" className="explore-error">{moreError}<button className="explore-source-link" onClick={()=>void load(true)}>{tr('重试加载')}</button></div>:<div ref={sentinel} className="explore-more" aria-hidden="true"/>}
        </div>
      </aside>
      <main className="explore-detail" ref={detailRoot} onScroll={e=>{position.current.detailTop=e.currentTarget.scrollTop}}>
        {selected?<><button className="explore-mobile-back explore-button" onClick={()=>setSelected(undefined)}><ArrowLeft size={16}/>{tr('返回列表')}</button><h1>{detail?.item.title??selected.title}</h1><div className="explore-muted">{(detail?.item??selected).category} {(detail?.item??selected).status}</div>
          {(detail?.item.summary??selected.summary)&&<p className="explore-detail-summary">{detail?.item.summary??selected.summary}</p>}
          {detail&&<><div className="explore-detail-actions">{detail.actions.map(a=><button className="explore-button" key={a.id} onClick={()=>startAction(a,selected.ref)}>{tr(a.label)}</button>)}</div>
          {detail.fields.filter(f=>f.value!==detail.item.summary).map((f,i)=><section key={`${f.label}:${i}`} className="explore-field"><h3>{tr(f.label)}</h3><p>{f.value}</p></section>)}
          <section className="explore-sources"><h3>{tr('识别依据与相关记录')}</h3>{detail.evidence.map(e=><article className="explore-evidence" data-anchor={e.anchor} key={e.key}><div className="explore-muted">{e.speaker&&<strong>{e.speaker} · </strong>}{e.label}{e.date>0&&` · ${date(e.date)}`}{e.anchor&&` · ${tr('关键依据')}`}</div><p>{e.text||tr('查看来源内容')}</p>{e.ref?<button className="explore-source-link" disabled={!!sourcePending} onClick={()=>void openSource(e.ref!)}>{sourcePending===e.ref?tr('正在打开…'):tr('定位原文')} ↗</button>:<span className="explore-muted">{tr(e.unavailableReason??'来源暂不可定位')}</span>}</article>)}{!detail.evidence.length&&<p className="explore-muted">{tr('暂未提供可查看的来源依据')}</p>}</section>
          {detail.notice&&<p className="explore-muted">{tr(detail.notice)}</p>}
          {sourceError&&<div role="alert" className="explore-error">{sourceError}</div>}
          </>}
          {detailLoading&&<div role="status" className="explore-more">{tr('正在加载详情…')}</div>}
          {detailError?<div role="alert" className="explore-error">{detailError}<button className="explore-source-link" onClick={()=>void readDetail(selected,detail?.nextCursor)}>{tr('重试')}</button></div>:<div ref={detailSentinel} className="explore-more"/>}
        </>:<div className="explore-empty"><Icon size={46} weight="thin"/><span>{tr('选择一条内容，查看详情和来源')}</span>{page?.notice&&<span className="explore-muted" style={{maxWidth:370}}>{tr(page.notice)}</span>}</div>}
      </main>
    </div>
    {capabilities&&<ArkmeDetailShell title={tr('自动使用额度')} label={tr('自动使用额度')} onClose={()=>{setCapabilities(false);void load()}}><ArkmeAutomaticAiSettings accountScope={accountScope}/></ArkmeDetailShell>}
    {settings&&<ExploreSettingsDialog module={module} onClose={()=>setSettings(false)} onChanged={()=>void load()}/>}
    {mutation&&<ExploreMutationDialog module={module} request={mutation} detail={detail} onClose={()=>setMutation(undefined)} onSaved={()=>{const id=mutation.action.id;setMutation(undefined);setNotice(tr('已保存'));if(['delete','dismiss'].includes(id)){setSelected(undefined);setDetail(undefined)}else if(selected)void readDetail(selected);void load()}}/>}
    {source?.kind==='record'&&<ArkmeTimelineDetailDrawer item={source.item} canExtend={false} showOriginal={original} onToggleOriginal={()=>setOriginal(v=>!v)} onClose={()=>setSource(undefined)}/>}
    {source?.kind==='recording'&&<ExploreRecordingSource source={source} onClose={()=>setSource(undefined)}/>}
  </section>
}

function ExploreMutationDialog({module,request,detail,onClose,onSaved}:{module:ExploreModule;request:{action:ExploreAction;ref:string};detail:ExploreDetail|undefined;onClose:()=>void;onSaved:()=>void}) {
  const [value,setValue]=useState(request.action.id==='correct'?detail?.item.summary??'':''),[title,setTitle]=useState(detail?.item.title??''),[saving,setSaving]=useState(false),[error,setError]=useState('')
  const [calendarType,setCalendarType]=useState<'solar'|'lunar'>(detail?.dateInput?.calendarType??'solar'),[year,setYear]=useState(detail?.dateInput?.year?String(detail.dateInput.year):''),[month,setMonth]=useState(detail?.dateInput?.month?String(detail.dateInput.month):''),[day,setDay]=useState(detail?.dateInput?.day?String(detail.dateInput.day):''),[leapMonth,setLeapMonth]=useState(detail?.dateInput?.leapMonth??false),[targetRef,setTargetRef]=useState('')
  const controller=useRef<AbortController>();useEffect(()=>()=>controller.current?.abort(),[])
  const id=request.action.id,needsText=['correct','supplement','create'].includes(id)
  const submit=async()=>{if(saving)return;const c=new AbortController();controller.current=c;setSaving(true);setError('')
    try{const input:ExploreMutation={ref:request.ref,action:id,...(needsText?{value}:{}),...(id==='reclassify'?{targetRef}:{}),...(id==='confirm'?{title,calendarType,year:year?Number(year):0,month:Number(month),day:Number(day),leapMonth}:{})}
      await callArkme('explore.mutate',{...input},c.signal);if(!c.signal.aborted)onSaved()
    }catch(e){if(!c.signal.aborted)setError(message(e))}finally{if(!c.signal.aborted)setSaving(false)}
  }
  return <ArkmeDetailShell title={tr(request.action.label)} label={tr(request.action.label)} onClose={()=>{if(!saving)onClose()}}><form className="arkme-explore-dialog" onSubmit={e=>{e.preventDefault();void submit()}}>
    {needsText?<label>{tr(id==='create'?'事件名称':'内容')}<textarea autoFocus value={value} onChange={e=>setValue(e.target.value)} maxLength={10000} required/></label>:id==='confirm'?<><label>{tr('名称')}<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={200} required/></label><label>{tr('历法')}<select value={calendarType} onChange={e=>setCalendarType(e.target.value as 'solar'|'lunar')}><option value="solar">{tr('公历')}</option><option value="lunar">{tr('农历')}</option></select></label><div className="explore-date-fields"><label>{tr('年份（可不填）')}<input type="number" min={1} max={9999} value={year} onChange={e=>setYear(e.target.value)}/></label><label>{tr('月')}<input type="number" min={1} max={12} value={month} required onChange={e=>setMonth(e.target.value)}/></label><label>{tr('日')}<input type="number" min={1} max={calendarType==='lunar'?30:31} value={day} required onChange={e=>setDay(e.target.value)}/></label></div>{calendarType==='lunar'&&<label><input style={{width:'auto',marginRight:8}} type="checkbox" checked={leapMonth} onChange={e=>setLeapMonth(e.target.checked)}/>{tr('闰月')}</label>}</>:id==='reclassify'?<label>{tr('目标事件分类')}<select required value={targetRef} onChange={e=>setTargetRef(e.target.value)}><option value="">{tr('选择分类')}</option>{detail?.reclassifyTargets?.map(x=><option key={x.ref} value={x.ref}>{x.label}</option>)}</select></label>:<p className="explore-muted">{tr(id==='delete'?module==='relations'?'删除该识别实体及其关联展示？原始记录保留。':'删除这条档案内容？原始记录保留。':id==='dismiss'?'忽略这条识别结果？':id==='stop'?'停止当前分析，保留已有结果。':id==='refresh'||id==='activate'||id==='resume'?'将按当前数据范围进行分析，可能产生 AI 用量。已有结果会继续保留。':request.action.label)}</p>}
    {error&&<div role="alert" className="explore-error">{error}</div>}
    <div style={{display:'flex',justifyContent:'flex-end',gap:10}}><button type="button" className="explore-button" disabled={saving} onClick={onClose}>{tr('取消')}</button><button type="submit" className="explore-button explore-primary" disabled={saving}>{saving?tr('正在保存…'):tr('确认')}</button></div>
  </form></ArkmeDetailShell>
}

function ExploreRecordingSource({source,onClose}:{source:Extract<ExploreSource,{kind:'recording'}>;onClose:()=>void}) {
  const auth=useSyncExternalStore(arkmeAuthStore.subscribe,arkmeAuthStore.getSnapshot,arkmeAuthStore.getSnapshot)
  const playback=useRecordingPlayback(auth.config?.mediaPath??'/arkme-self/api/media'),root=useRef<HTMLDivElement>(null)
  useEffect(()=>{root.current?.querySelector('[data-selected="true"]')?.scrollIntoView({block:'center'})},[])
  return <ArkmeDetailShell title={tr('录音原文')} label={tr('录音原文')} onClose={onClose}><div className="arkme-explore-dialog" ref={root}><div className="explore-muted">{date(source.items.find(x=>x.itemId===source.focusItemId)?.startAtMillis??source.dateStamp)} · {tr(source.items[0]?.transcriptSource==='doubao'?'豆包转写':'系统转写')}</div>
    {source.items.map(item=>{const target=source.playbackTargets?.find(x=>x.itemId===item.itemId)?.item??(item.transcriptSource==='system'?item:undefined);const playing=!!target&&playback.isPlaying&&playback.activeItemRef===target.itemRef;return <article className="explore-source-row" data-selected={item.itemId===source.focusItemId} key={item.itemId}><div style={{display:'flex',alignItems:'center',gap:8}}><strong>{item.isSelf?tr('你'):item.speakerLabel}</strong><span className="explore-muted">{date(item.startAtMillis).split(' ').at(-1)}</span><button className="explore-icon" style={{marginLeft:'auto'}} title={target?undefined:tr('这段原文暂无可播放的音频片段')} aria-label={playing?tr('暂停'):tr('播放这段录音')} disabled={playback.isLoading||!target} onClick={()=>{if(playing)playback.pause();else if(target)void playback.playItem(target,item.startAtMillis)}}>{playing?<Pause size={18}/>:<Play size={18}/>}</button></div>{item.text}</article>})}
    {playback.error&&<div role="alert" className="explore-error">{playback.error}</div>}{playback.isLoading&&<div role="status">{tr('录音加载中…')}</div>}
    {source.segment&&<button className="explore-button" onClick={()=>{onClose();arkmeUi.showRecordingTarget(source.dateStamp,source.items.find(x=>x.itemId===source.focusItemId)!.startAtMillis,source.segment)}}>{tr('在全天转写中查看')}</button>}
  </div></ArkmeDetailShell>
}
