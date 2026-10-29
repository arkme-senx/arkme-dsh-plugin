// @vitest-environment jsdom
import { act } from 'react'
import { Simulate } from 'react-dom/test-utils'
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
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.clearAllMocks();call.mockReset();request.mockReset();localStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);call.mockImplementation(async(op:string,p:any)=>op==='team.app.people.remarks'?{items:[]}:p?.action==='participants'?{...page([]),resultRef:'people'}:op==='team.app.notification-policy.get'?{muted:false,policyVersion:0,notifyAfterSeq:0}:p?.action==='dates'?{...page([]),resultRef:'dates',days:[{date:'2026-10-19',count:1,message:message(20)}]}:page([message(20)]));locate.mockResolvedValue(undefined)})
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
  await act(async()=>byText('显示更多结果').click());expect(host.textContent).toContain('快照失效');expect(host.textContent).not.toContain('关键词 20')
  expect(call.mock.calls[1]![1]).toMatchObject({options:{cursor:'cursor-one',keyword:'关键词'}})
  call.mockRejectedValue(new Error('网络中断'))
  await act(async()=>byLabel('更多团队对话操作').click());await act(async()=>byText('导出').click())
  expect(download).not.toHaveBeenCalled();expect(host.textContent).toContain('网络中断')
})
it('aborts old account reads and never renders a late result in the new account',async()=>{
  let finish!:(p:ReturnType<typeof page>)=>void
  call.mockImplementationOnce(()=>new Promise<ReturnType<typeof page>>(r=>finish=r))
  await act(async()=>mount());await act(async()=>{findSelectedMessageText('team-ref','关键词')})
  const signal=call.mock.calls[0]![2] as AbortSignal
  await act(async()=>mount('prod:22'));expect(signal.aborted).toBe(true)
  await act(async()=>finish(page([message(19)])));expect(host.textContent).not.toContain('关键词 19')
  await act(async()=>{findSelectedMessageText('team-ref','新账号关键词')});expect(call.mock.lastCall![1]).toMatchObject({expectedAccountKey:'prod:22'})
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
  call.mockImplementation(async(op:string,p:any)=>op==='team.app.people.remarks'?{items:[]}:p.action==='participants'?{...page([]),resultRef:'people'}:p.action==='analysis/create'?{...page([]),resultRef:'result'}:p.action==='analysis/result'?{...page([]),resultRef:'result',activity:{id:'result',updatedAt:1,totalMessages:1,activeDays:1,participants:1,systemMessages:0,fromAt:null,toAt:null,hourly,weekly}}:p.action==='analysis/words'?{...page([]),resultRef:'result',words:[{word:'中文',count:3,messageCount:1,sourceRef:'word-ref'}]}:page([message(20)]))
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
it('restarts historical sender recovery with a new result and no stale cursor',async()=>{
  let accepts=0
  call.mockImplementation(async(_op:string,p:any)=>{
    if(p.action!=='participants')return {...page([]),resultRef:'analysis',activity:activity()}
    if(!p.options.resultRef){accepts++;return {...page([]),resultRef:`people-${accepts}`}}
    if(p.options.resultRef==='people-1'&&p.options.cursor)throw new Error('人员结果已过期')
    return {...page([],accepts===1,accepts===1?'old-cursor':''),resultRef:`people-${accepts}`,participants:[]}
  })
  await act(async()=>mount());await act(async()=>byLabel('对话分析').click())
  expect(host.textContent).toContain('人员结果已过期')
  await act(async()=>byText('重试').click())
  expect(accepts).toBe(2)
  const requests=call.mock.calls.filter(([,p])=>p.action==='participants')
  expect(requests.at(-1)![1].options).toMatchObject({resultRef:'people-2'})
  expect(requests.at(-1)![1].options.cursor).toBeUndefined()
})
const input=(label:string)=>host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
const change=async(node:HTMLInputElement|HTMLSelectElement,value:string)=>{await act(async()=>{Simulate.change(node,{target:{value}} as any)})}
const settleDebounce=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,350))})
const historyRequests=()=>call.mock.calls.filter(([op])=>op==='team.app.history').map(([,params])=>params)
const activity=(count=1)=>({id:'result',updatedAt:1,totalMessages:count,activeDays:count?1:0,participants:count?1:0,systemMessages:0,fromAt:null,toAt:null,
  hourly:Array.from({length:24},(_,hour)=>({hour,weekday:null,messages:hour===10?count:0,systemMessages:0,participants:hour===10&&count?1:0})),
  weekly:Array.from({length:168},(_,i)=>({hour:i%24,weekday:Math.floor(i/24)+1,messages:i===10?count:0,systemMessages:0,participants:i===10&&count?1:0}))})
function mockAnalysis(people:any[]=[],count=1){
  call.mockImplementation(async(op:string,p:any)=>{
    if(op==='team.app.people.remarks')return {items:[]}
    if(p.action==='participants')return {...page([]),resultRef:'people',participants:people}
    if(p.action==='analysis/create')return {...page([]),resultRef:'result'}
    if(p.action==='analysis/result')return {...page([]),resultRef:'result',activity:activity(count)}
    return page([message(20)])
  })
}
it('preserves the empty search, original controls, focus and three-line result presentation',async()=>{
  await act(async()=>mount());await act(async()=>byLabel('搜索团队消息').click())
  expect(historyRequests()).toHaveLength(0)
  expect(host.textContent).toContain('输入关键词，查找消息或附件名称')
  expect(host.querySelectorAll('[data-test-panel] input')).toHaveLength(1)
  expect(host.querySelector('select')).toBeNull();expect(host.querySelector('input[type="date"]')).toBeNull()
  const search=input('搜索团队聊天关键词')
  expect(search.style.padding).toBe('8px 10px');expect(search.style.borderRadius).toBe('8px');expect(search.placeholder).toBe('搜索此对话')
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30))});expect(document.activeElement).toBe(search)
  await change(search,'关键词');await settleDebounce()
  const row=host.querySelector<HTMLButtonElement>('[data-team-history-hit]')!
  expect(row.lastElementChild?.getAttribute('style')).toContain('-webkit-line-clamp: 3')
  expect(row.lastElementChild?.getAttribute('style')).toContain('font-size: 14px')
  expect(row.textContent).not.toContain('查看原消息')
  await change(search,'  ')
  expect(host.querySelector('[data-team-history-hit]')).toBeNull();expect(host.textContent).toContain('输入关键词，查找消息或附件名称')
  await settleDebounce();expect(historyRequests()).toHaveLength(1)
})
it('retains search text on reopening and keeps analysis month/person state independent',async()=>{
  mockAnalysis([{personKey:'p',personRef:'person-p',nickname:'同事'}])
  await act(async()=>mount());await act(async()=>{findSelectedMessageText('team-ref','关键词')})
  await act(async()=>byText('关闭面板').click());await act(async()=>byLabel('搜索团队消息').click())
  expect(input('搜索团队聊天关键词').value).toBe('关键词')
  await act(async()=>byLabel('对话分析').click())
  expect(input('分析月份').type).toBe('month');expect(input('分析月份').value).toBe('')
  await change(input('分析月份'),'2026-10')
  const request=historyRequests().filter(p=>p.action==='analysis/create').at(-1)!
  expect(request.options).toMatchObject({fromAt:new Date(2026,9,1).getTime(),untilAt:new Date(2026,10,1).getTime(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})
  expect(request.options.keyword).toBeUndefined();expect(request.options.contentKind).toBeUndefined()
  await change(host.querySelector<HTMLSelectElement>('select[aria-label="分析成员"]')!,'p')
  expect(historyRequests().filter(p=>p.action==='analysis/create').at(-1)!.options).toMatchObject({personRef:'person-p'})
  await act(async()=>byText('全部时间').click())
  const all=historyRequests().filter(p=>p.action==='analysis/create').at(-1)!.options
  expect(all.fromAt).toBeUndefined();expect(all.untilAt).toBeUndefined();expect(all.personRef).toBe('person-p')
  await act(async()=>byText('关闭面板').click());await act(async()=>byLabel('对话分析').click())
  expect(input('分析月份').value).toBe('');expect(host.querySelector('select')!.value).toBe('all')
  await act(async()=>byLabel('搜索团队消息').click());expect(input('搜索团队聊天关键词').value).toBe('关键词')
  const query=historyRequests().filter(p=>p.action==='query').at(-1)!.options
  expect(query).toEqual({keyword:'关键词'})
})
it('automatically pages historical identities into the original select and preserves distinct same-name authors',async()=>{
  mockAnalysis()
  const underlying=call.getMockImplementation()!
  call.mockImplementation(async(op:string,p:any,s:AbortSignal)=>{
    if(p.action!=='participants')return underlying(op,p,s)
    if(!p.options.resultRef)return {...page([]),resultRef:'people'}
    const second=!!p.options.cursor
    return {...page([],!second,second?'':'next'),resultRef:'people',participants:second?[{personKey:'p2',personRef:'r2',nickname:'重名'}]:[{personKey:'self',personRef:'me',nickname:'自己',isMe:true},{personKey:'p1',personRef:'r1',nickname:'重名'}]}
  })
  await act(async()=>mount());await act(async()=>byLabel('对话分析').click())
  expect([...host.querySelectorAll('select option')].map(o=>o.textContent)).toEqual(['全部成员','我','重名','重名'])
  expect(host.textContent).not.toContain('选择历史发送者');expect(host.textContent).not.toContain('更多历史发送者')
  const select=host.querySelector('select')!
  await change(select,'p2');expect(historyRequests().filter(p=>p.action==='analysis/create').at(-1)!.options.personRef).toBe('r2')
  await change(select,'self');expect(historyRequests().filter(p=>p.action==='analysis/create').at(-1)!.options).toMatchObject({sender:'self'})
})
it('keeps the original empty activity and 24/168 bucket drilldown without fake local statistics',async()=>{
  mockAnalysis([],0)
  await act(async()=>mount());await act(async()=>byLabel('对话分析').click())
  expect(host.textContent).toContain('此范围暂无消息活动');expect(host.querySelector('.ca-bar')).toBeNull()
  mockAnalysis([],1);await act(async()=>byText('刷新').click())
  expect(host.querySelectorAll('.ca-bar')).toHaveLength(24)
  await act(async()=>byText('一周内').click());expect(host.querySelectorAll('.ca-cell')).toHaveLength(168)
  await act(async()=>host.querySelectorAll<HTMLButtonElement>('.ca-cell')[10]!.click())
  expect(historyRequests().at(-1)).toMatchObject({action:'analysis/sources',options:{resultRef:'result',hour:10,weekday:1}})
  expect(host.textContent).toContain('关键词 20')
  await act(async()=>byText('返回分布').click());expect(host.querySelectorAll('.ca-cell')).toHaveLength(168)
})

it('invalidates displayed summaries when source location loses access and keeps the original inline locating state',async()=>{
  await act(async()=>mount());await act(async()=>{findSelectedMessageText('team-ref','关键词')})
  let fail!:(error:Error)=>void
  locate.mockImplementationOnce(()=>new Promise((_resolve,reject)=>{fail=reject}))
  await act(async()=>host.querySelector<HTMLButtonElement>('[data-team-history-hit]')!.click())
  const row=host.querySelector<HTMLButtonElement>('[data-team-history-hit]')!
  expect(row.disabled).toBe(true);expect(row.textContent).toContain('正在定位…')
  await act(async()=>fail(new Error('原消息无权访问')))
  expect(host.querySelector('[data-team-history-hit]')).toBeNull();expect(host.textContent).toContain('原消息无权访问')
})
