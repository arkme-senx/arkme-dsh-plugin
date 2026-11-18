// @vitest-environment jsdom
import {act} from 'react'
import {writeFile} from 'node:fs/promises'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {TeamConversationPane} from '../src/client/TeamMessagingPanel.js'
import {arkmeAuthStore} from '../src/client/auth-store.js'
import {invalidateTeamMessages} from '../src/client/team-messaging-events.js'
import type {TeamConversation} from '../src/team-app-contract.js'
const mocks=vi.hoisted(()=>({call:vi.fn(),candidates:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/social-action-guard.js',()=>({requirePhoneForSocialAction:async()=>{},isSocialBindingRequired:()=>false}))
vi.mock('../src/sdk/index.js',()=>({createArkmeSdk:()=>({fileCapabilities:async()=>({maxAttachments:9,maxImageBytes:1024,maxFileBytes:2048}),localFileUrl:(ref:string)=>`/local/${ref}`})}))
const conversation:TeamConversation={ref:'conv',key:'key',channel:{teamRef:'team',name:'Team',jotmoId:'fixture',publicRef:'a'.repeat(32),link:'',enabled:true,revision:1,canManage:false},side:'team',lastSeq:0,latestTeamReplySeq:0,myReadSeq:0,unread:0,needsReply:false,blocked:false,revision:1,updatedAt:1}
const page={items:[{personRef:'person-member',personKey:'member',nickname:'Member'},{personRef:'person-visitor',personKey:'visitor',nickname:'Visitor'}],hasMore:true,nextCursor:'next'}
let host:HTMLDivElement,root:Root,current=conversation
const editor=()=>host.querySelector<HTMLElement>('[data-arkme-rich-composer]')!
const options=()=>[...host.querySelectorAll<HTMLButtonElement>('[role=option]')]
async function mount(){await act(async()=>root.render(<TeamConversationPane conversation={current} accountKey="test:7777" onChanged={()=>{}}/>))}
async function input(text:string){if(!editor())await mount();await act(async()=>{const el=editor();el.focus();el.textContent=text;const range=document.createRange();range.selectNodeContents(el);range.collapse(false);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}))})}
async function key(value:string,extra:KeyboardEventInit={}){await act(async()=>editor().dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...extra})))}
beforeEach(async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('IntersectionObserver',class{observe(){}disconnect(){}})
 localStorage.clear();arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:7777});current=conversation
 mocks.candidates.mockReset().mockResolvedValue(page);mocks.call.mockReset().mockImplementation(async(op:string,p:any,signal:AbortSignal)=>op==='team.messages.mention-candidates'?mocks.candidates(p,signal):op==='team.app.timeline'?{conversation:current,messages:[],hasMore:false,beforeSeq:0}:op==='arrangements.conversation.recognition.get'?{accountScope:p.expectedAccountScope,enabled:true,version:0,effectiveEnabled:true,blockedReason:''}:op==='arrangements.conversation.list'?{items:[],hasMore:false,nextCursor:''}:[])
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('opens current members and visitor on typed @, filters locally and inserts the selected token without sending',async()=>{
 await input('@');expect(options().map(v=>v.textContent)).toEqual(['Member','Visitor']);expect(mocks.candidates).toHaveBeenCalledOnce()
 await input('@Vis');expect(options().map(v=>v.textContent)).toEqual(['Visitor']);expect(mocks.candidates).toHaveBeenCalledOnce()
 await key('Enter');expect(editor().textContent).toBe('@Visitor ');expect(host.querySelector('[data-arkme-mention-popup]')).toBeNull()
 expect(mocks.call.mock.calls.some(([op])=>op==='team.app.send.enqueue')).toBe(false)
 const saved=Object.values(localStorage).join('');expect(saved).toContain('person-visitor');expect(saved).toContain('Visitor')
})
it('keeps pages explicit and bounded; arrow/Tab select from the new page',async()=>{
 await input('@');mocks.candidates.mockResolvedValueOnce({items:[{personRef:'person-next',personKey:'next',nickname:'Next'}],hasMore:false})
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="下一页成员"]')!.click())
 expect(mocks.candidates).toHaveBeenCalledTimes(2);expect(mocks.candidates.mock.calls[1]![0].options.cursor).toBe('next');expect(options().map(v=>v.textContent)).toEqual(['Next'])
 await key('ArrowDown');await key('Tab');expect(editor().textContent).toBe('@Next ')
})
it('shows read errors with an explicit retry and never loops requests',async()=>{
 let reject!:(error:unknown)=>void;mocks.candidates.mockImplementation(()=>new Promise((_,fail)=>{reject=fail}));await input('@');await act(async()=>reject(new Error('unavailable')));expect(host.textContent).toContain('候选加载失败');expect(mocks.candidates).toHaveBeenCalledTimes(2)
 expect(mocks.candidates.mock.calls[0]![1].aborted).toBe(true)
 mocks.candidates.mockResolvedValueOnce(page)
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='重试')!.click());expect(options()).toHaveLength(2);expect(mocks.candidates).toHaveBeenCalledTimes(3)
 await key('Escape');expect(host.querySelector('[data-arkme-mention-popup]')).toBeNull()
})
it.each(['change','logout','unmount'])('aborts a pending directory and discards late results after %s',async kind=>{
 let finish!:(value:unknown)=>void;mocks.candidates.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 await input('@');const signal=mocks.candidates.mock.calls.at(-1)![1] as AbortSignal,complete=finish
 expect(signal.aborted).toBe(false)
 await act(async()=>{if(kind==='change')invalidateTeamMessages('test:7777');else if(kind==='logout')arkmeAuthStore.setAuth({status:'logged-out',environment:'test'});else root.render(null)})
 expect(signal.aborted).toBe(true);await act(async()=>complete(page));expect(host.querySelector('[data-arkme-mention-popup]')).toBeNull()
})
it('does not fetch members from an external-side composer or while disabled',async()=>{
 current={...conversation,side:'external'};await act(async()=>root.render(<TeamConversationPane key="external" conversation={current} accountKey="test:7777" onChanged={()=>{}}/>));await input('@');expect(mocks.candidates).not.toHaveBeenCalled()
})
it.each(['loading','empty'])('never sends Enter while candidates are %s',async mode=>{
 if(mode==='loading')mocks.candidates.mockImplementation(()=>new Promise(()=>{}))
 await input(mode==='empty'?'@Nobody':'@');await key('Enter')
 expect(mocks.call.mock.calls.some(([op])=>op==='team.app.send.enqueue')).toBe(false)
 expect(editor().textContent).toBe(mode==='empty'?'@Nobody':'@')
 if(mode==='empty')expect(host.querySelector('[aria-label="下一页成员"]')).not.toBeNull()
})
it.each([{isComposing:true},{keyCode:229}])('does not select or send an IME Enter %j',async event=>{
 await input('@');await key('Enter',event);expect(editor().textContent).toBe('@');expect(options()).toHaveLength(2)
 expect(mocks.call.mock.calls.some(([op])=>op==='team.app.send.enqueue')).toBe(false)
})
it('pointer selection preserves the mention identity while typing after it; Escape stays dismissed on keyup',async()=>{
 await input('@');await act(async()=>options()[1]!.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})))
 await act(async()=>{const el=editor();el.append(document.createTextNode('hello'));const range=document.createRange();range.selectNodeContents(el);range.collapse(false);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'hello'}))})
 expect(editor().textContent).toBe('@Visitor hello');expect(Object.values(localStorage).join('')).toContain('person-visitor')
 await input('@');expect(options()).toHaveLength(2);await key('Escape');expect(host.querySelector('[data-arkme-mention-popup]')).toBeNull();await act(async()=>editor().dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',bubbles:true})))
 expect(host.querySelector('[data-arkme-mention-popup]')).toBeNull()
})
it('keeps unrelated message hints from restarting the member page; matching access invalidation closes it',async()=>{
 await input('@');await act(async()=>invalidateTeamMessages('test:7777',false,{kind:'team.message.published',conversationKeys:['key']}))
 expect(options()).toHaveLength(2);expect(mocks.candidates).toHaveBeenCalledOnce()
 await act(async()=>invalidateTeamMessages('test:7777',false,{kind:'team.member.changed',conversationKeys:['different']}));expect(options()).toHaveLength(2)
 await act(async()=>invalidateTeamMessages('test:7777',false,{kind:'team.member.changed',conversationKeys:['key']}));expect(options()).toHaveLength(0)
})
it('reuses only the same composer bounded candidate page on close/reopen without another directory request',async()=>{
 const measuredPage={items:Array.from({length:51},(_,i)=>({personRef:`person-${i}`,personKey:`key-${i}`,nickname:`Member ${i}`})),hasMore:false}
 mocks.candidates.mockImplementation(async()=>{await new Promise(resolve=>setTimeout(resolve,120));return measuredPage})
 const start=performance.now();await input('@');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,130))});const first=performance.now()-start
 expect(mocks.candidates).toHaveBeenCalledTimes(2);expect(mocks.candidates.mock.calls[0]![1].aborted).toBe(true)
 await key('Escape');await input('');const secondStart=performance.now();await input('@');if(options().length===0)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,130))});const reopened=performance.now()-secondStart
 if(process.env.ARKME_MENTION_UI_METRICS)await writeFile(process.env.ARKME_MENTION_UI_METRICS,JSON.stringify({fixture:'same mounted composer, 50 members + visitor, fixed120ms read; NOT production latency',first,reopened,requests:mocks.candidates.mock.calls.length},null,2))
 expect(options()).toHaveLength(51);expect(mocks.candidates).toHaveBeenCalledTimes(2)
})
it.each(['membership','reconnect','focus','online'])('retires the closed picker page on %s before it can be reused',async reason=>{
 await input('@');await key('Escape');await input('')
 await act(async()=>{
  if(reason==='membership')invalidateTeamMessages('test:7777',false,{kind:'team.member.changed',conversationKeys:['key']})
  else if(reason==='reconnect')invalidateTeamMessages('test:7777')
  else window.dispatchEvent(new Event(reason))
 })
 await input('@');expect(mocks.candidates).toHaveBeenCalledTimes(2);expect(options()).toHaveLength(2)
})
it('bounds retained suggestion freshness and does not retain results across a conversation owner change',async()=>{
 await input('@');await key('Escape');await input('')
 const now=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(now+30_001)
 try{await input('@');expect(mocks.candidates).toHaveBeenCalledTimes(2)}finally{clock.mockRestore()}
 await key('Escape');current={...conversation,ref:'other-ref',key:'other-key'}
 await act(async()=>root.render(<TeamConversationPane key="other" conversation={current} accountKey="test:7777" onChanged={()=>{}}/>));await input('@')
 expect(mocks.candidates).toHaveBeenCalledTimes(3);expect(mocks.candidates.mock.calls[2]![0].conversationRef).toBe('other-ref')
})
it('does not reuse a closed picker page after logout and login',async()=>{
 await input('@');await key('Escape');await input('')
 await act(async()=>arkmeAuthStore.setAuth({status:'logged-out',environment:'test'}))
 await act(async()=>arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:7777}))
 await input('@');expect(mocks.candidates).toHaveBeenCalledTimes(2)
})

it('prepares on entering the interactive conversation so the first @ has candidates immediately',async()=>{
 await mount();expect(mocks.candidates).toHaveBeenCalledOnce();expect(host.querySelector('[data-arkme-mention-popup]')).toBeNull()
 await input('@');expect(options().map(v=>v.textContent)).toEqual(['Member','Visitor']);expect(mocks.candidates).toHaveBeenCalledOnce()
})
it.each(['blocked','sourceOnly','disabled'])('does not prepare a %s conversation without a usable mention composer',async reason=>{
 current={...conversation,...(reason==='blocked'?{blocked:true}:reason==='sourceOnly'?{sourceOnly:true}:{channel:{...conversation.channel,enabled:false}})}
 await mount();expect(mocks.candidates).not.toHaveBeenCalled()
})

it('keeps prepared DOM rows during a slow refresh and a retryable network error',async()=>{
 await mount();let reject!:(error:unknown)=>void;mocks.candidates.mockImplementation(()=>new Promise((_,fail)=>{reject=fail}))
 await act(async()=>window.dispatchEvent(new Event('focus')));await input('@')
 expect(options()).toHaveLength(2);expect(host.textContent).not.toContain('正在查找')
 await act(async()=>reject(Object.assign(new Error('network'),{body:{code:'local-network-unavailable',retryable:true}})))
 expect(options()).toHaveLength(2);expect(host.textContent).toContain('部分候选加载失败');expect(host.textContent).not.toContain('正在查找')
 mocks.candidates.mockResolvedValueOnce(page)
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='重试')!.click());expect(options()).toHaveLength(2);expect(mocks.candidates).toHaveBeenCalledTimes(4)
})
it('keeps six selectable Team rows and the active person when expired suggestions refresh with rotated person refs',async()=>{
 const people=Array.from({length:6},(_,i)=>({personRef:`old-person-${i}`,personKey:`stable-person-${i}`,nickname:`Person ${i}`}))
 mocks.candidates.mockResolvedValueOnce({items:people,hasMore:false})
 await mount();await input('@');expect(options()).toHaveLength(6)
 await key('Escape');await input('')
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+34_001)
 try{
  let finish!:(page:unknown)=>void;mocks.candidates.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  await input('@');await key('ArrowDown');expect(options()).toHaveLength(6);expect(mocks.candidates).toHaveBeenCalledTimes(2)
  await act(async()=>finish({items:people.map((person,i)=>({...person,personRef:`new-person-${i}`})),hasMore:false}))
  expect(options()).toHaveLength(6);expect(options().every(option=>!option.disabled)).toBe(true)
  expect(options().filter(option=>option.getAttribute('aria-selected')==='true').map(option=>option.textContent)).toEqual(['Person 1'])
  await key('Enter');expect(editor().textContent).toBe('@Person 1 ')
  const saved=Object.values(localStorage).join('');expect(saved).toContain('new-person-1');expect(saved).not.toContain('old-person-1')
 }finally{clock.mockRestore()}
})
