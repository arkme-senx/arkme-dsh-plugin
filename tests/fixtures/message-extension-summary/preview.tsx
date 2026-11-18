// Isolated synthetic reader; production components and transport remain unchanged.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArkmeMessageContent } from '../../../src/client/ArkmeRichContent.js'
import { MessageQuoteThreadsProvider, MessageQuoteThreadBadge } from '../../../src/client/MessageQuoteThreads.js'
import { invalidateMessageQuoteSources } from '../../../src/client/message-quote-invalidations.js'
import type { ArkmeTimelineItem } from '../../../src/types.js'
import '../message-marks/style.css'
const item: ArkmeTimelineItem={itemUid:'fixture-source',messageActionRef:'fixture-action',recordOwnerUserId:8,sequence:1,recordVersion:1,isMe:false,status:1,title:'',textContent:'可以。可以。引用只标记第二处。',senderName:'同事',sendAtMillis:1}
function Fixture(){
 const [opened,setOpened]=useState(false)
 const scenario=async(value:string)=>{await fetch('/__scenario/'+value,{method:'POST'});invalidateMessageQuoteSources()}
 return <main><header><div><h1>原消息评论汇总</h1><p>隔离合成数据 · 只加载原消息 · 无账号与生产请求</p></div></header>
 <section><small>同事 · 原消息</small><MessageQuoteThreadsProvider scope="fixture:chat" sourceRef="fixture-source" chat items={[item]} onOpenComments={()=>setOpened(true)}><article><ArkmeMessageContent item={item} sourceRef="fixture-source"/><MessageQuoteThreadBadge item={item}/></article></MessageQuoteThreadsProvider></section>
 <p><button onClick={()=>scenario('zero')}>模拟全部删除</button> <button onClick={()=>scenario('fail')}>模拟读取失败</button> <button onClick={()=>scenario('ready')}>恢复 125 条</button></p>
 {opened&&<output>已触发原评论打开回调；树与分页继续由既有 owner 读取。</output>}
 </main>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
