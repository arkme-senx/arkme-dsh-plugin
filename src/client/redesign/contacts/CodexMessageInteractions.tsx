import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { callArkme } from '../../api.js'
import { arkmeTheme } from '../../arkme-theme.js'
import { ArkmeActionMenu } from '../../ArkmeDshMenu.js'
import { ArkmeMessageTextSelectionToolbar, registerMessageTextSelectionTarget } from '../../ArkmeMessageTextSelection.js'
import { useMessageUnderlines } from '../../ArkmeMessageUnderlines.js'
import { ArkmeMessageSelectionBar } from '../../ArkmeMessageSelectionBar.js'
import { ArkmeMessageSelectionControl, ArkmeSelectActionIcon } from '../../message-selection-presentation.js'
import { quoteDomProjection } from '../../message-quote-selection.js'
import { useSelectedMessageSearch } from '../../message-selection-search.js'
import { MessageTextFind } from '../../MessageTextFind.js'
import type { MessageMarkTransport } from '../../message-underline-session.js'
import { copyText } from '../../clipboard-text.js'
import { nativeForwardDelivery } from '../../native-forward-entry.js'
import { openLocalSnapshotForward } from '../../local-snapshot-forward.js'
import { codexEventKey, codexSelectable, codexSelectionSnapshot } from './codex-message-actions.js'
import type { TeamCodexEvent, TeamCodexTask } from '../../../team-codex-contract.js'
import type { ArkmeSourceSendResult } from '../../../types.js'

const marksTransport: MessageMarkTransport = {
  capabilities: (sourceRef, signal) => callArkme('codex.local-mark.capabilities', { sourceRef }, signal),
  list: (sourceRef, markRefs, signal) => callArkme('codex.local-mark.list', { sourceRef, markRefs }, signal),
  change: (sourceRef, markRef, change, signal) => callArkme('codex.local-mark.change', { sourceRef, markRef, change }, signal),
}
export function CodexSelectableBody({ sourceRef, event, inputName, children }: { sourceRef: string; event: TeamCodexEvent; inputName: string; children: ReactNode }) {
  const ref=useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if(!ref.current) return
    const canonical=quoteDomProjection(ref.current).text
    return registerMessageTextSelectionTarget(ref.current,event.text,{ sourceRef, selectionDomain:'codex',localMarkRef:JSON.stringify([sourceRef,codexEventKey(event),canonical]),item:{
      itemUid:codexEventKey(event),title:'',textContent:canonical,textFormat:'plain',status:codexSelectable(event)?1:0,senderName:event.kind==='UserPromptSubmit'?inputName:'Codex',isMe:false,sendAtMillis:event.at,
    } })
  },[sourceRef,event.text,event.kind,event.at,event.truncated,event.eventId,event.turnId,event.sequence,inputName])
  return <div ref={ref} data-codex-body={codexEventKey(event)} style={{cursor:'text',userSelect:'text'}}>{children}</div>
}

export function useCodexMessageInteractions({ teamRef, task, events, account, userId }: { teamRef:string; task:TeamCodexTask; events:TeamCodexEvent[]; account:string; userId:number|undefined }) {
  const sourceRef=JSON.stringify(['codex',userId,JSON.stringify([teamRef,task.cloud?.sourceId??task.installationId??'local',task.id])])
  const controller=useMemo(()=>new AbortController(),[sourceRef,account])
  useEffect(()=>()=>controller.abort(),[controller])
  const [selection,setSelection]=useState<Map<string,string>>()
  const [menu,setMenu]=useState<{id:string;x:number;y:number}>()
  const [query,setQuery]=useState<string>()
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const working=useRef(false),latest=useRef(events);latest.current=events
  const marks=useMessageUnderlines(`${account}:${sourceRef}`,userId?sourceRef:undefined,userId,marksTransport)
  useSelectedMessageSearch(sourceRef,setQuery)
  const getRows=useCallback(()=>Array.from(document.querySelectorAll<HTMLElement>('[data-codex-body]')).filter(row=>row.closest('[data-codex-source]')?.getAttribute('data-codex-source')===sourceRef),[sourceRef])
  useEffect(()=>{
    setSelection(previous=>{
      if(!previous)return previous
      const next=new Map([...previous].filter(([key,text])=>events.some(event=>codexEventKey(event)===key&&event.text===text&&codexSelectable(event))))
      return next.size===previous.size?previous:next
    })
    if(menu&&!events.some(event=>codexEventKey(event)===menu.id&&codexSelectable(event)))setMenu(undefined)
  },[events])
  useEffect(()=>{
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!working.current&&!document.querySelector('[role="dialog"][aria-label="发给自己"]')&&!query){setMenu(undefined);setSelection(undefined)}}
    document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape)
  },[query])
  const toggle=(event:TeamCodexEvent)=>{
    if(working.current)return
    const key=codexEventKey(event)
    setSelection(previous=>{const next=new Map(previous);if(next.has(key))next.delete(key);else if(next.size<100)next.set(key,event.text);return next})
  }
  const act=async(work:()=>Promise<void>)=>{
    if(working.current||controller.signal.aborted)return
    working.current=true;setBusy(true);setNotice('')
    try{await work()}catch(e){if(!controller.signal.aborted)setNotice(e instanceof Error?e.message:'操作失败，请重试')}
    finally{working.current=false;if(!controller.signal.aborted)setBusy(false)}
  }
  const snapshot=()=>codexSelectionSnapshot(teamRef,task,latest.current,new Set(selection?.keys()))
  const selectedCount=selection?.size??0
  const row=menu?events.find(event=>codexEventKey(event)===menu.id):undefined
  const forward=()=>act(async()=>{
    if(!userId)throw new Error('请先登录')
    const frozen=snapshot()
    const delivery=nativeForwardDelivery((target,identity,commentText,signal)=>callArkme<ArkmeSourceSendResult>('codex.forward',{
      teamRef,id:task.id,...(task.cloud?.remote?{sourceId:task.cloud.sourceId}:{}),snapshot:frozen,expectedUserId:userId,targetSourceRef:target.sourceRef,...identity,commentText,
    },signal))
    const result=await openLocalSnapshotForward({userId,preview:{title:`Codex · ${task.title} · ${frozen.messages.length} 条消息`,subtitle:frozen.messages[0]!.text.slice(0,140)},delivery},controller.signal)
    if(result.completed&&!controller.signal.aborted){setSelection(undefined);setNotice('已转发')}
  })
  return { sourceRef, selecting:!!selection,
    selected:(event:TeamCodexEvent)=>selection?.has(codexEventKey(event))??false,
    toggle,
    contextMenu:(event:TeamCodexEvent,e:MouseEvent)=>{
      if(!codexSelectable(event))return
      e.preventDefault();e.stopPropagation()
      if(document.getSelection()?.toString().trim())return
      setMenu({id:codexEventKey(event),x:e.clientX,y:e.clientY})
    },
    check:(event:TeamCodexEvent)=>selection&&codexSelectable(event)?<ArkmeMessageSelectionControl anchor="avatar" checked={selection.has(codexEventKey(event))} disabled={busy} onToggle={()=>toggle(event)}/>:null,
    dock: selection?<ArkmeMessageSelectionBar count={selectedCount} ariaLabel="Codex 多选操作" style={{position:'absolute',inset:0,minHeight:100}} actions={[
      {id:'copy',label:'复制文本',icon:<ArkmeSelectActionIcon kind="copy"/>,disabled:!selectedCount||busy,onSelect:()=>{void act(async()=>{await copyText(snapshot().messages.map(message=>message.text).join('\n\n'));setNotice('已复制')})}},
      {id:'link',label:'复制链接',icon:<ArkmeSelectActionIcon kind="link"/>,disabled:!selectedCount||busy,onSelect:()=>setNotice('Codex 复制链接：后端接口开发中，开发完成后此功能完整可用。')},
      {id:'forward',label:'转发',icon:<ArkmeSelectActionIcon kind="forward"/>,disabled:!selectedCount||busy,onSelect:()=>{void forward()}},
      {id:'exit',label:'退出多选',icon:<ArkmeSelectActionIcon kind="close"/>,disabled:busy,onSelect:()=>{setSelection(undefined);setNotice('')}},
    ]}><span style={{width:'100%',textAlign:'center',fontSize:12,color:arkmeTheme.secondary}}>已选 {selectedCount} 条{selectedCount===100?' · 最多 100 条':''}{busy?' · 处理中…':''}</span></ArkmeMessageSelectionBar>:null,
    host:typeof document !== 'undefined' && typeof document.addEventListener === 'function'?<>
      {menu&&row&&<ArkmeActionMenu point={menu} label="Codex 消息操作" autoFocus onClose={()=>setMenu(undefined)} actions={[
        {id:'copy',label:'复制',icon:<ArkmeSelectActionIcon kind="copy"/>,onSelect:()=>{setMenu(undefined);void act(()=>copyText(row.text))}},
        {id:'select',label:'多选',icon:<ArkmeSelectActionIcon kind="select"/>,onSelect:()=>{setMenu(undefined);document.getSelection()?.removeAllRanges();setSelection(previous=>{const next=new Map(previous);if(next.size<100||next.has(codexEventKey(row)))next.set(codexEventKey(row),row.text);return next})}},
      ]}/>}
      <ArkmeMessageTextSelectionToolbar selectionDomain="codex" replySourceRef={sourceRef} onUnderline={marks.mark} getMarks={marks.getMarks} onRemoveMark={marks.remove} markStorage="local" selfNote={userId ? { sourceLabel: `Codex · ${task.title}`, accountKey: account } : undefined}/>
      {marks.layer}
      {query!==undefined&&<MessageTextFind doc={document} getRows={getRows} query={query} setQuery={setQuery} onClose={()=>setQuery(undefined)}/>}
    </>:null,
    feedback:notice?<div role="status" style={{flex:'none',fontSize:12,padding:'7px 14px',background:arkmeTheme.menu,color:arkmeTheme.secondary,display:'flex',gap:8,alignItems:'center'}}><span style={{flex:1}}>{notice}</span><button type="button" aria-label="关闭提示" onClick={()=>setNotice('')} style={{border:0,background:'transparent',color:'inherit',cursor:'pointer'}}>×</button></div>:null,
  }
}
