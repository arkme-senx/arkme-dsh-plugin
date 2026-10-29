// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamConversationTools } from '../src/client/TeamConversationTools.js'
import { findSelectedMessageText } from '../src/client/message-selection-search.js'
import type { TeamConversation, TeamMessage } from '../src/team-app-contract.js'
const {call,request,download}=vi.hoisted(()=>({call:vi.fn(),request:vi.fn(),download:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:call}))
vi.mock('../src/client/local-directory-preferences.js',()=>({localDirectoryPreferences:{subscribe:()=>()=>{},read:()=>({})},useLocalDirectoryPreferenceHydration:()=>{}}))
vi.mock('../src/client/outgoing-call-ui-controller.js',()=>({outgoingCallUi:{request}}))
vi.mock('../src/client/conversation-export.js',()=>({downloadArkmeConversationMarkdown:download}))
vi.mock('../src/client/ArkmeDetailShell.js',()=>({ArkmeDetailShell:({children,onClose}:any)=><section data-test-panel><button onClick={onClose}>关闭面板</button>{children}</section>}))
vi.mock('../src/client/ArkmeCalendarSurface.js',()=>({ArkmeSelfCalendarPopover:({open,index,onSelectIndexedDay}:any)=>open?<section data-test-calendar><button onClick={()=>{void index.loadMonth({startDate:'2026-10-01',endDate:'2026-10-31',timezone:'Asia/Shanghai'},new AbortController().signal).then(()=>onSelectIndexedDay('2026-10-19'))}}>2026-10-19</button></section>:null}))
vi.mock('../src/client/PrivateChatActions.js',()=>({conversationExportActionItem:(a:any)=>({id:'export',label:'导出',invoke:a.invoke}),ConversationActionsMenu:({trigger,items}:any)=><><button aria-label="更多团队对话操作" onClick={()=>trigger.onOpenChange(!trigger.open)}>更多</button>{trigger.open&&items.map((a:any)=><div key={a.id}><button disabled={a.busy===true} aria-pressed={a.checked} onClick={()=>{if(!a.keepOpenOnSelect)trigger.onOpenChange(false);a.invoke()}}>{a.label}</button>{a.error&&<span role="status">{a.error}</span>}</div>)}</>}))
const conversation:TeamConversation={ref:'team-ref',key:'conv',side:'team',visitor:{nickname:'访客'},channel:{teamRef:'team',name:'即我',jotmoId:'arkme',publicRef:'public',link:'',enabled:true,revision:1,canManage:false},lastSeq:20,latestTeamReplySeq:0,myReadSeq:20,unread:0,needsReply:false,blocked:false,revision:1,updatedAt:1}
const message=(seq:number):TeamMessage=>({key:`m${seq}`,ref:`r${seq}`,seq,revision:1,version:1,own:false,side:'external',sender:{nickname:'访客',personKey:'v'},state:'published',createdAt:new Date(2026,9,19,10).getTime(),canEdit:false,canDelete:false,contentStatus:'available',media:[],content:{template_kind:1,text_content:`关键词 ${seq}`}})
const page=(messages:TeamMessage[],hasMore=false,cursor='')=>({state:'ready',messages,words:[],days:[],participants:[],hasMore,cursor})
let host:HTMLDivElement,root:Root
const locate=vi.fn(),onOpen=vi.fn()
const byLabel=(name:string)=>host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
const byText=(name:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===name)!
const mount=(account='prod:11')=>root.render(<TeamConversationTools key={account} conversation={conversation} accountKey={account} host={{current:host}} overlayOpen={false} onOpenPanel={onOpen} onLocate={locate} resolveIdentity={p=>p} getReadingDate={()=>undefined}/>)
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.clearAllMocks();localStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);call.mockImplementation(async(op:string,p:any)=>op==='team.app.notification-policy.get'?{muted:false,policyVersion:0,notifyAfterSeq:0}:p?.action==='dates'?{...page([]),resultRef:'dates',days:[{date:'2026-10-19',count:1,message:message(20)}]}:page([message(20)]));locate.mockResolvedValue(undefined)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('queries only on demand, passes the selected text to the backend and locates server anchors',async()=>{
  await act(async()=>mount());expect(call).not.toHaveBeenCalled()
  await act(async()=>{expect(findSelectedMessageText('team-ref','关键词')).toBe(true)})
  expect(call.mock.lastCall![0]).toBe('team.app.history');expect(call.mock.lastCall![1]).toMatchObject({action:'query',options:{keyword:'关键词'}})
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-team-history-hit="m20"]')!.click())
  expect(locate).toHaveBeenCalledWith(expect.objectContaining({key:'m20'}),expect.any(AbortSignal));expect(host.querySelector('[data-test-panel]')).toBeNull()
  await act(async()=>byLabel('按日期查看团队消息').click());await act(async()=>byText('2026-10-19').click())
  expect(locate).toHaveBeenCalledTimes(2);expect(call.mock.calls.some(([op])=>op==='team.app.timeline')).toBe(false)
})
it('uses bounded stable pages, clears invalid results, and never downloads failed exports',async()=>{
  call.mockResolvedValueOnce(page([message(20)],true,'cursor-one')).mockRejectedValueOnce(new Error('快照失效'))
  await act(async()=>mount());await act(async()=>{findSelectedMessageText('team-ref','关键词')})
  expect(host.textContent).toContain('关键词 20')
  await act(async()=>byText('加载更多').click());expect(host.textContent).toContain('快照失效');expect(host.textContent).not.toContain('关键词 20')
  expect(call.mock.calls[1]![1]).toMatchObject({options:{cursor:'cursor-one',keyword:'关键词'}})
  call.mockRejectedValue(new Error('网络中断'))
  await act(async()=>byLabel('更多团队对话操作').click());await act(async()=>byText('导出').click())
  expect(download).not.toHaveBeenCalled();expect(host.textContent).toContain('网络中断')
})
it('aborts old account reads and never renders a late result in the new account',async()=>{
  let finish!:(p:ReturnType<typeof page>)=>void
  call.mockImplementationOnce(()=>new Promise<ReturnType<typeof page>>(r=>finish=r))
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
it('shows verified server activity and real word counts with source-message paging',async()=>{
  const hourly=Array.from({length:24},(_,hour)=>({hour,weekday:null,messages:hour===10?1:0,systemMessages:0,participants:hour===10?1:0})),weekly=Array.from({length:168},(_,i)=>({hour:i%24,weekday:Math.floor(i/24)+1,messages:i===10?1:0,systemMessages:0,participants:i===10?1:0}))
  call.mockImplementation(async(_op:string,p:any)=>p.action==='analysis/create'?{...page([]),resultRef:'result'}:p.action==='analysis/result'?{...page([]),resultRef:'result',activity:{id:'result',updatedAt:1,totalMessages:1,activeDays:1,participants:1,systemMessages:0,fromAt:null,toAt:null,hourly,weekly}}:p.action==='analysis/words'?{...page([]),resultRef:'result',words:[{word:'中文',count:3,messageCount:1,sourceRef:'word-ref'}]}:page([message(20)]))
  await act(async()=>mount());await act(async()=>byLabel('对话分析').click())
  expect(host.querySelectorAll('.ca-bar')).toHaveLength(24);expect(host.textContent).toContain('消息量1')
  await act(async()=>byText('词频分析').click());expect(host.textContent).toContain('中文');expect(host.textContent).not.toContain('尚未接通')
  await act(async()=>host.querySelector<HTMLButtonElement>('.cw-cloud button')!.click())
  expect(call.mock.lastCall![1]).toMatchObject({action:'analysis/sources',options:{resultRef:'result',sourceRef:'word-ref'}})
  expect(host.textContent).toContain('关键词 20')
})
it('keeps export in the header menu without duplicating avatar private chat or directory pin actions',async()=>{
  await act(async()=>mount());await act(async()=>byLabel('更多团队对话操作').click())
  expect(byText('导出')).toBeDefined()
  expect(byText('发起私聊')).toBeUndefined();expect(byText('置顶')).toBeUndefined();expect(byText('取消置顶')).toBeUndefined()
  expect(call).toHaveBeenCalledWith('team.app.notification-policy.get',{conversationRef:'team-ref',expectedAccountKey:'prod:11'},expect.any(AbortSignal))
})
it('sets confirmed personal mute through the existing menu without local fake state',async()=>{
  call.mockImplementation(async(op:string)=>({muted:op.endsWith('.set'),policyVersion:op.endsWith('.set')?1:0,notifyAfterSeq:20}))
  await act(async()=>mount());await act(async()=>byLabel('更多团队对话操作').click())
  expect(byText('消息免打扰').disabled).toBe(false)
  await act(async()=>byText('消息免打扰').click())
  expect(call).toHaveBeenLastCalledWith('team.app.notification-policy.set',{conversationRef:'team-ref',expectedAccountKey:'prod:11',muted:true},expect.any(AbortSignal))
  expect(byText('消息免打扰').getAttribute('aria-pressed')).toBe('true');expect(localStorage.length).toBe(0)
  expect(byText('导出')).toBeDefined()
})
it('does not invert the setting after an unknown write failure',async()=>{
  call.mockImplementation(async(op:string)=>{if(op.endsWith('.set'))throw new Error('设置未确认');return {muted:false,policyVersion:0,notifyAfterSeq:0}})
  await act(async()=>mount());await act(async()=>byLabel('更多团队对话操作').click());await act(async()=>byText('消息免打扰').click())
  expect(byText('消息免打扰').getAttribute('aria-pressed')).toBe('false');expect(host.textContent).toContain('设置未确认')
})
