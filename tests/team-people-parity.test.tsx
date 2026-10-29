// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TeamConversation, TeamIdentity, TeamMessage } from '../src/team-app-contract.js'
import { useTeamVisitorActions } from '../src/client/TeamVisitorActions.js'
import { TeamVisitorRecords } from '../src/client/TeamVisitorRecords.js'
import { useTeamPersonNames } from '../src/client/use-team-person-names.js'
import { TeamMessageDetail } from '../src/client/TeamMessageDetail.js'
import { arkmeUi } from '../src/client/ui-controller.js'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
const conversation = { ref:'conversation', key:'key', side:'team', channel:{ name:'测试团队' }, visitor:{nickname:'访客'} } as TeamConversation
const person: TeamIdentity = { nickname:'同事昵称', personKey:'colleague', personRef:'person-ref', isMe:false }
const message = (key: string, who = person): TeamMessage => ({key,ref:key,seq:1,revision:1,side:'team',sender:who,own:false,state:'published',createdAt:1792400000000,
  canEdit:false,canDelete:false,contentStatus:'available',version:1,media:[],content:{template_kind:1,text_content:`正文 ${key}`}})
let host: HTMLDivElement, root: Root
const onRecords = vi.fn(), onClose = vi.fn(), onLocate = vi.fn()
function Actions({who = person}: {who?:TeamIdentity}) {
  const actions = useTeamVisitorActions({conversation,accountKey:'prod:90',onRecords,onOpen() {}})
  return <>{actions.avatar(<span>头像</span>,who)}{actions.layer}</>
}
function Names({account = 'prod:90', people = [person]}: {account?:string;people?:TeamIdentity[]}) {
  const name = useTeamPersonNames(conversation,account,people)
  return <>{people.map(p=><span key={p.personKey}>{name(p).nickname}</span>)}</>
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); vi.stubGlobal('IntersectionObserver',class {observe(){}disconnect(){}})
  vi.clearAllMocks(); call.mockReset(); host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!
it('uses a verified internal person ref for private chat, and the same person for records',async()=>{
  const activate=vi.spyOn(arkmeUi,'activateNotificationSource').mockImplementation(()=>{})
  call.mockResolvedValue({source:{sourceRef:'chat'}})
  await act(async()=>root.render(<Actions/>));await act(async()=>host.querySelector('button')!.click())
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('同事昵称 的用户卡片')
  await act(async()=>button('发送消息').click())
  expect(call).toHaveBeenCalledWith('team.app.person.private.open',{conversationRef:'conversation',expectedAccountKey:'prod:90',personRef:'person-ref'},expect.any(AbortSignal))
  expect(activate).toHaveBeenCalledWith({sourceRef:'chat'})
  await act(async()=>host.querySelector('button')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true})))
  await act(async()=>[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(n=>n.textContent==='看TA的快记')!.click())
  expect(onRecords).toHaveBeenCalledWith(person)
})
it('shows own profile without a private-chat send button and supports own records',async()=>{
  await act(async()=>root.render(<Actions who={{...person,isMe:true}}/>));await act(async()=>host.querySelector('button')!.click())
  expect(button('发送消息')).toBeUndefined();expect(call).not.toHaveBeenCalled()
  await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})))
  await act(async()=>host.querySelector('button')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true})))
  expect(document.querySelector('[role="menu"]')?.textContent).toContain('看我的快记')
})
it('asks the server to filter by sealed identity, never by an editable display name',async()=>{
  call.mockImplementation(async(op:string)=>op==='team.app.preflight'?[message('mine')]:{state:'ready',messages:[{...message('mine'),historyPreview:true}],words:[],days:[],participants:[],hasMore:false})
  await act(async()=>root.render(<TeamVisitorRecords conversation={conversation} accountKey="prod:90" person={{...person,nickname:'我的备注'}} onClose={onClose} onLocate={onLocate}/>))
  expect(call).toHaveBeenCalledWith('team.app.history',expect.objectContaining({action:'query',options:expect.objectContaining({personRef:'person-ref',personMode:'owner'})}),expect.any(AbortSignal))
  expect(host.querySelectorAll('[data-team-visitor-record]')).toHaveLength(1)
  expect(host.textContent).toContain('我的备注的快记');expect(host.textContent).not.toContain('正文 other')
})
it('renders immediately before remarks arrive, updates in place, and clears a removed remark on focus',async()=>{
  let resolve!: (v:unknown)=>void
  call.mockImplementation(()=>new Promise(done=>{resolve=done}))
  await act(async()=>root.render(<Names/>));expect(host.textContent).toBe('同事昵称')
  await act(async()=>resolve({items:[{personKey:'colleague',remark:'宏顺'}]}));expect(host.textContent).toBe('宏顺')
  call.mockResolvedValue({items:[{personKey:'colleague',remark:''}]})
  await act(async()=>window.dispatchEvent(new Event('focus')));expect(host.textContent).toBe('同事昵称')
})
it('does not request remarks again for equivalent reference refreshes, and preserves names on network failure',async()=>{
  call.mockResolvedValue({items:[{personKey:'colleague',remark:'宏顺'}]})
  await act(async()=>root.render(<Names/>))
  await act(async()=>root.render(<Names people={[{...person,personRef:'fresh-ref'}]}/>))
  expect(call).toHaveBeenCalledTimes(1)
  call.mockRejectedValue(new Error('offline'))
  await act(async()=>window.dispatchEvent(new Event('focus')));expect(host.textContent).toBe('宏顺')
})
it('clears old account presentation immediately and ignores late results',async()=>{
  let resolve!: (v:unknown)=>void
  call.mockImplementation(()=>new Promise(done=>{resolve=done}))
  await act(async()=>root.render(<Names/>));const previous=resolve
  await act(async()=>root.render(<Names account="prod:91"/>))
  expect(call.mock.calls[0]![2].aborted).toBe(true)
  await act(async()=>previous({items:[{personKey:'colleague',remark:'旧账号备注'}]}))
  expect(host.textContent).toBe('同事昵称')
})
it('uses the common author/time layout, no redundant title, resizable shell and source location',async()=>{
  await act(async()=>root.render(<TeamMessageDetail accountKey="test:11" message={message('detail',{...person,nickname:'宏顺'})} conversation={conversation} avatar={<button>头像</button>} onClose={onClose} onLocate={onLocate}/>))
  expect(host.querySelector('[data-arkme-detail-author]')?.textContent).toContain('宏顺')
  expect(host.querySelector('[data-arkme-detail-author]')?.textContent).toContain('2026')
  expect(host.querySelector('h2')?.textContent).not.toBe('消息详情')
  expect(host.querySelector('[role="separator"]')).toBeTruthy()
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="所在对话：测试团队 · 访客"]')!.click())
  expect(onLocate).toHaveBeenCalledOnce();expect(host.textContent).not.toContain('相关快记暂未接通')
  expect(host.querySelector('[role="alert"]')).toBeTruthy()
  expect(host.querySelector('textarea')).toBeNull()
})
it('hydrates only the visible identity-filtered page through the existing authorized batch read and renders original media',async()=>{
  const full={...message('photo'),media:[{key:'image',ref:'image-ref',name:'原图.png',mimeType:'image/png',size:20,url:'https://example.invalid/photo.png'}]}
  call.mockImplementation(async(op:string)=>op==='team.app.preflight'?[full]:{state:'ready',messages:[{...message('photo'),historyPreview:true,historyMedia:[{name:'原图.png',kind:'image'}]}],words:[],days:[],participants:[],hasMore:false})
  await act(async()=>root.render(<TeamVisitorRecords conversation={conversation} accountKey="prod:90" person={person} onClose={onClose} onLocate={onLocate}/>))
  expect(call).toHaveBeenCalledWith('team.app.preflight',{conversationRef:'conversation',expectedAccountKey:'prod:90',selections:[{messageRef:'photo',version:1}]},expect.any(AbortSignal))
  expect(host.querySelector('img[src="https://example.invalid/photo.png"]')).toBeTruthy()
  expect(button('查看原消息')).toBeTruthy();expect(call.mock.calls.some(([op])=>op==='team.app.timeline')).toBe(false)
})
it('clears a page when its exact version cannot be hydrated and retries using a fresh query',async()=>{
  let attempt=0
  call.mockImplementation(async(op:string)=>{
    if(op==='team.app.preflight')return [{...message('mine'),version:++attempt===1?2:1}]
    return {state:'ready',messages:[{...message('mine'),historyPreview:true}],words:[],days:[],participants:[],hasMore:false}
  })
  await act(async()=>root.render(<TeamVisitorRecords conversation={conversation} accountKey="prod:90" person={person} onClose={onClose} onLocate={onLocate}/>))
  expect(host.querySelector('[data-team-visitor-record]')).toBeNull();expect(host.textContent).toContain('历史内容已变化')
  await act(async()=>button('重试').click());expect(host.querySelector('[data-team-visitor-record]')).toBeTruthy()
  expect(call.mock.calls.filter(([op])=>op==='team.app.history')).toHaveLength(2)
})
it('never shows late hydrated messages after account changes or unauthorized page refreshes',async()=>{
  let finish!:(value:unknown)=>void
  call.mockImplementation(async(op:string)=>op==='team.app.preflight'?new Promise(resolve=>{finish=resolve}):{state:'ready',messages:[{...message('old'),historyPreview:true}],words:[],days:[],participants:[],hasMore:false})
  const render=(account:string)=>root.render(<TeamVisitorRecords conversation={conversation} accountKey={account} person={person} onClose={onClose} onLocate={onLocate}/>)
  await act(async()=>render('prod:90'));const old=finish,oldSignal=call.mock.lastCall![2] as AbortSignal
  await act(async()=>render('prod:91'));expect(oldSignal.aborted).toBe(true)
  await act(async()=>old([message('old')]));expect(host.querySelector('[data-team-visitor-record]')).toBeNull()
  await act(async()=>finish([message('old')]));expect(host.querySelector('[data-team-visitor-record]')).toBeTruthy()
  call.mockRejectedValue(new Error('无权访问'))
  const {invalidateTeamMessages}=await import('../src/client/team-messaging-events.js')
  await act(async()=>invalidateTeamMessages('prod:91'))
  expect(host.querySelector('[data-team-visitor-record]')).toBeNull()
  await act(async()=>button('重试').click());expect(host.querySelector('[data-team-visitor-record]')).toBeNull();expect(host.textContent).toContain('无权访问')
})
