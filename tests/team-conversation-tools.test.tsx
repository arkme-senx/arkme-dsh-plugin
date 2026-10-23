// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamConversationTools } from '../src/client/TeamConversationTools.js'
import { findSelectedMessageText } from '../src/client/message-selection-search.js'
import type { TeamConversation, TeamMessage, TeamTimeline } from '../src/team-app-contract.js'
const {call,request,download}=vi.hoisted(()=>({call:vi.fn(),request:vi.fn(),download:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:call}))
vi.mock('../src/client/local-directory-preferences.js',()=>({localDirectoryPreferences:{subscribe:()=>()=>{},read:()=>({})},useLocalDirectoryPreferenceHydration:()=>{}}))
vi.mock('../src/client/outgoing-call-ui-controller.js',()=>({outgoingCallUi:{request}}))
vi.mock('../src/client/conversation-export.js',()=>({downloadArkmeConversationMarkdown:download}))
vi.mock('../src/client/ArkmeDetailShell.js',()=>({ArkmeDetailShell:({children,onClose}:any)=><section data-test-panel><button onClick={onClose}>关闭面板</button>{children}</section>}))
vi.mock('../src/client/ArkmeCalendarSurface.js',()=>({ArkmeSelfCalendarPopover:({open,index,onSelectIndexedDay}:any)=>open?<section data-test-calendar>{index.notice}{index.value.days.map((d:any)=><button key={d.bucketDate} onClick={()=>onSelectIndexedDay(d.bucketDate)}>{d.bucketDate}</button>)}</section>:null}))
vi.mock('../src/client/PrivateChatActions.js',()=>({conversationExportActionItem:(a:any)=>({id:'export',label:'导出',invoke:a.invoke}),ConversationActionsMenu:({trigger,items}:any)=><><button aria-label="更多团队对话操作" onClick={()=>trigger.onOpenChange(!trigger.open)}>更多</button>{trigger.open&&items.map((a:any)=><div key={a.id}><button onClick={()=>{if(!a.keepOpenOnSelect)trigger.onOpenChange(false);a.invoke()}}>{a.label}</button>{a.error&&<span role="status">{a.error}</span>}</div>)}</>}))
const conversation:TeamConversation={ref:'team-ref',key:'conv',side:'team',visitor:{nickname:'访客'},channel:{teamRef:'team',name:'即我',jotmoId:'arkme',publicRef:'public',link:'',enabled:true,revision:1,canManage:false},lastSeq:20,latestTeamReplySeq:0,myReadSeq:20,unread:0,needsReply:false,blocked:false,revision:1,updatedAt:1}
const message=(seq:number):TeamMessage=>({key:`m${seq}`,ref:`r${seq}`,seq,revision:1,version:1,own:false,side:'external',sender:{nickname:'访客',personKey:'v'},state:'published',createdAt:new Date(2026,9,19,10).getTime(),canEdit:false,canDelete:false,contentStatus:'available',media:[],content:{template_kind:1,text_content:`关键词 ${seq}`}})
const page=(messages:TeamMessage[],hasMore=false,beforeSeq=0):TeamTimeline=>({conversation,messages,hasMore,beforeSeq})
let host:HTMLDivElement,root:Root
const locate=vi.fn(),onOpen=vi.fn()
const byLabel=(name:string)=>host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
const byText=(name:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===name)!
const mount=(account='prod:11')=>root.render(<TeamConversationTools key={account} conversation={conversation} accountKey={account} host={{current:host}} overlayOpen={false} onOpenPanel={onOpen} onLocate={locate} resolveIdentity={p=>p} getReadingDate={()=>undefined}/>)
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.clearAllMocks();localStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);call.mockResolvedValue(page([message(20)]));locate.mockResolvedValue(undefined)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('loads only on demand, shares history across search/calendar, and locates a hit',async()=>{
  await act(async()=>mount());expect(call).not.toHaveBeenCalled()
  await act(async()=>{expect(findSelectedMessageText('team-ref','关键词')).toBe(true)})
  expect(host.textContent).toContain('1 条匹配')
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-team-history-hit="m20"]')!.click())
  expect(locate).toHaveBeenCalledWith(expect.objectContaining({key:'m20'}),expect.any(AbortSignal));expect(host.querySelector('[data-test-panel]')).toBeNull()
  await act(async()=>byLabel('按日期查看团队消息').click());expect(call).toHaveBeenCalledTimes(1)
  await act(async()=>byText('2026-10-19').click());expect(locate).toHaveBeenCalledTimes(2)
})
it('shows incremental results, keeps failed partial reads, and never exports incomplete history',async()=>{
  let finish!:(p:TeamTimeline)=>void
  call.mockResolvedValueOnce(page([message(20)],true,20)).mockImplementationOnce(()=>new Promise<TeamTimeline>(r=>finish=r))
  await act(async()=>mount());await act(async()=>{findSelectedMessageText('team-ref','关键词')})
  expect(host.textContent).toContain('正在读取历史 · 1 条');expect(host.textContent).toContain('关键词 20')
  await act(async()=>finish(page([message(20)],true,20)))
  expect(host.textContent).toContain('分页异常');expect(host.textContent).toContain('结果尚不完整')
  call.mockRejectedValue(new Error('网络中断'))
  await act(async()=>byLabel('更多团队对话操作').click());await act(async()=>byText('导出').click())
  expect(download).not.toHaveBeenCalled();expect(host.textContent).toContain('网络中断')
})
it('aborts old account reads and never renders a late result in the new account',async()=>{
  let finish!:(p:TeamTimeline)=>void
  call.mockImplementationOnce(()=>new Promise<TeamTimeline>(r=>finish=r))
  await act(async()=>mount());await act(async()=>byLabel('搜索团队消息').click())
  const signal=call.mock.calls[0]![2] as AbortSignal
  await act(async()=>mount('prod:22'));expect(signal.aborted).toBe(true)
  await act(async()=>finish(page([message(19)])));expect(host.textContent).not.toContain('关键词 19')
  await act(async()=>byLabel('搜索团队消息').click());expect(call.mock.lastCall![1]).toMatchObject({expectedAccountKey:'prod:22'})
})
it('offers personal calls without opening a private chat until explicit choice, then uses the authorized source',async()=>{
  await act(async()=>mount());await act(async()=>byLabel('呼叫访客').click())
  expect(document.body.textContent).toContain('以个人身份语音通话');expect(call).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled()
  call.mockResolvedValue({source:{sourceRef:'verified-private',displayName:'访客',kind:'private_chat'}})
  await act(async()=>byText('以个人身份语音通话').click())
  expect(call).toHaveBeenCalledWith('team.app.visitor.private.open',{conversationRef:'team-ref',expectedAccountKey:'prod:11'},expect.any(AbortSignal))
  expect(request).toHaveBeenCalledWith({sourceRef:'verified-private',displayName:'访客',mediaType:'audio'})
})
it('shows real local activity and an honest unsupported word-frequency state',async()=>{
  await act(async()=>mount());await act(async()=>byLabel('对话分析').click())
  expect(host.querySelectorAll('.ca-bar')).toHaveLength(24);expect(host.textContent).toContain('消息量1')
  await act(async()=>byText('词频分析').click());expect(host.textContent).toContain('团队词频分析尚未接通')
  expect(call.mock.calls.every(([op])=>op==='team.app.timeline')).toBe(true)
})
it('keeps export in the header menu without duplicating avatar private chat or directory pin actions',async()=>{
  await act(async()=>mount());await act(async()=>byLabel('更多团队对话操作').click())
  expect(byText('导出')).toBeDefined()
  expect(byText('发起私聊')).toBeUndefined();expect(byText('置顶')).toBeUndefined();expect(byText('取消置顶')).toBeUndefined()
  expect(call).not.toHaveBeenCalled()
})
it('keeps the team mute entry actionable and explains missing backend support without saving a fake setting',async()=>{
  await act(async()=>mount());await act(async()=>byLabel('更多团队对话操作').click())
  expect(byText('消息免打扰').disabled).toBe(false)
  await act(async()=>byText('消息免打扰').click())
  expect(host.querySelector('[role="status"]')?.textContent).toBe('暂缺后端支持，免打扰尚未生效')
  expect(byText('导出')).toBeDefined();expect(call).not.toHaveBeenCalled();expect(localStorage.length).toBe(0)
  await act(async()=>byLabel('更多团队对话操作').click());await act(async()=>byLabel('更多团队对话操作').click())
  expect(host.querySelector('[role="status"]')).toBeNull();expect(byText('消息免打扰')).toBeDefined()
})
