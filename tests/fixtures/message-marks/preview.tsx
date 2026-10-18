// Isolated visual fixture: all annotation storage is in memory; no login or cloud requests.
import React, { useMemo, useReducer, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArkmeMessageContent } from '../../../src/client/ArkmeRichContent.js'
import { ArkmeMessageTextSelectionToolbar } from '../../../src/client/ArkmeMessageTextSelection.js'
import { UnderlineLayer } from '../../../src/client/ArkmeMessageUnderlines.js'
import { MessageUnderlineSession, underlineTargetKey } from '../../../src/client/message-underline-session.js'
import { quoteDigest } from '../../../src/client/message-quote-selection.js'
import { quoteCanonicalText } from '../../../src/message-quote.js'
import type { ArkmeTimelineItem } from '../../../src/types.js'
import './style.css'
const item: ArkmeTimelineItem = { itemUid:'fixture',recordOwnerUserId:42,messageActionRef:'fixture-only',isMe:false,status:1,title:'',textContent:'我们先把**录音的关键信息**整理好。\n\n重点关注原始内容和多人交流的上下文，标记不会改动原文。\n\n链接仍有自己的样式：[查看相关资料](#related)。',textFormat:'markdown',senderName:'宏顺',sendAtMillis:1 }
const target={sourceRef:'fixture-only',item}, text=quoteCanonicalText(item)
const sourceDigest=await quoteDigest(item)
function anchorOf(value:string){const start=text.indexOf(value),end=start+value.length;return {version:1 as const,projection:'arkme-text-v1' as const,sourceDigest,start,end,text:value,prefix:text.slice(Math.max(0,start-32),start),suffix:text.slice(end,end+32)}}
const initial=[{id:'mine',actorId:42,actorName:'你',mine:true,anchor:anchorOf('录音的关键信息'),state:'available' as const}, {id:'other',actorId:7,actorName:'宏顺',mine:false,anchor:anchorOf('录音的关键信息'),state:'available' as const}, {id:'other-2',actorId:9,actorName:'周鹏',mine:false,anchor:anchorOf('原始内容和多人交流的上下文'),state:'available' as const}]
function Fixture(){
 const [revision,update]=useReducer((v:number)=>v+1,0),[dark,setDark]=useState(false),[reply,setReply]=useState('')
 const session=useMemo(()=>{
  const s=new MessageUnderlineSession(target.sourceRef,42,update);s.capability={supported:true,maxLength:2000}
  s.snapshots.set(underlineTargetKey(target),{revision:1,accessible:true,items:initial})
  s.read=async()=>{};s.change=async(t,change)=>{const key=underlineTargetKey(t),prev=s.snapshots.get(key)!;s.snapshots.set(key,{...prev,revision:prev.revision+1,items:change.kind==='remove'?prev.items.filter(m=>m.id!==change.annotationId):[...prev.items,{id:change.operationId,actorId:42,actorName:'你',mine:true,anchor:change.anchor,state:'available'}]});update()}
  return s
 },[])
 return <main><header><div><h1>消息背景标记</h1><p>本地示例 · 仅验证界面交互，不连接账号或云端</p></div><button onClick={()=>{document.body.toggleAttribute('data-ds-dark-theme',!dark);setDark(!dark)}}>{dark?'浅色模式':'暗色模式'}</button></header>
 <section><small>宏顺 · 消息正文</small><article><ArkmeMessageContent item={item} sourceRef={target.sourceRef}/></article></section>
 <p className="hint">点击黄色文字：复制、全选、取消自己的标记、回复。拖选其他文字也可标记。</p>
 <output>{reply ? `回复引用：${reply}` : `当前标记：${session.snapshots.get(underlineTargetKey(target))!.items.map(m=>`${m.mine?'你':m.actorName}「${m.anchor.text}」`).join(' · ')}`}</output>
 <UnderlineLayer session={session} revision={revision}/><ArkmeMessageTextSelectionToolbar replySourceRef={target.sourceRef} onReply={(_,quote)=>setReply(quote.text)}
 onUnderline={async(t,anchor)=>{await session.change(t,{kind:'add',anchor,operationId:crypto.randomUUID()});return undefined}}
 getMarks={t=>session.snapshots.get(underlineTargetKey(t))?.items??[]}
 onRemoveMark={async(t,mark)=>{if(!mark.mine)return '只能取消自己的标记';await session.change(t,{kind:'remove',annotationId:mark.id,operationId:crypto.randomUUID()});return undefined}}/>
 </main>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
