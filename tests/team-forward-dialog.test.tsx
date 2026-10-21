// @vitest-environment jsdom
import {act,StrictMode} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {TeamForwardDialog} from '../src/client/TeamForwardDialog.js'
import {TeamForwardAttempt} from '../src/client/team-forward-attempt.js'
import type {ArkmeSourceItem} from '../src/types.js'
import type {TeamConversation} from '../src/team-app-contract.js'

const mocks=vi.hoisted(()=>({native:vi.fn(),team:vi.fn(),admit:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.native}))
vi.mock('../src/sdk/index.js',()=>({createArkmeSdk:()=>({listTeamConversations:mocks.team})}))
vi.mock('../src/client/direct-message-admission.js',()=>({requireDirectMessageSendAllowed:mocks.admit}))
vi.mock('../src/client/ArkmeAvatar.js',()=>({ArkmeDirectorySourceAvatar:()=>null,ArkmeUserAvatar:()=>null}))
vi.mock('../src/client/ArkmeTeamAvatar.js',()=>({ArkmeTeamChannelAvatar:()=>null}))
vi.mock('../src/client/team-avatar-image-runtime.js',()=>({teamAvatarImages:{}}))
const source=(key:string,kind:ArkmeSourceItem['kind']='private_chat'):ArkmeSourceItem=>({kind,sourceKey:key,sourceRef:`ref-${key}`,displayName:key,activeAtMillis:1,unreadCount:0})
const team=(key:string,blocked=false):TeamConversation=>({key,ref:`team-ref-${key}`,side:'team',channel:{name:key,enabled:true},visitor:{nickname:'访客'},blocked} as TeamConversation)
const page=(items:unknown[])=>({items,hasMore:false})
let host:HTMLDivElement,root:Root
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 mocks.native.mockReset();mocks.team.mockReset();mocks.admit.mockReset().mockResolvedValue(undefined)
 mocks.native.mockResolvedValue(page([source('自己','send_to_self'),source('同事')]))
 mocks.team.mockImplementation(async(side:string)=>page(side==='team'?[team('客服'),team('屏蔽',true)]:[]))
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals()})
const dialog=()=>document.querySelector<HTMLElement>('[role="dialog"]')!
const row=(name:string)=>[...dialog().querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(button=>button.textContent?.includes(name))!
const click=async(button:HTMLElement)=>{await act(async()=>button.click())}
const sendButton=()=>dialog().querySelector<HTMLButtonElement>('button[aria-label="发送转发"]')!

it('uses native targets and real Team targets, retains partial failures and retries only unresolved commands',async()=>{
 const sender=vi.fn().mockResolvedValueOnce({itemUid:'native',localState:'synced'}).mockRejectedValueOnce(new Error('响应丢失')).mockResolvedValue({itemUid:'team',localState:'synced'})
 const attempt=new TeamForwardAttempt('conversation',[{messageRef:'message',version:3}],sender),complete=vi.fn()
 await act(async()=>root.render(<TeamForwardDialog attempt={attempt} previewTitle="转发消息" previewSubtitle="正文" onClose={()=>{}} onComplete={complete}/>))
 await click(row('屏蔽'));expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('暂时不能发送')
 await click(row('同事'));await click(row('客服'))
 expect(dialog().querySelectorAll('[aria-pressed="true"]')).toHaveLength(2)
 await click(sendButton())
 expect(complete).not.toHaveBeenCalled();expect(dialog().textContent).toContain('响应丢失')
 const firstTeam=sender.mock.calls[1]![0]
 expect(sender.mock.calls[0]![0].target).toEqual({kind:'source',sourceRef:'ref-同事'})
 expect(firstTeam.target).toEqual({kind:'team',conversationRef:'team-ref-客服'})
 expect(dialog().querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(true)
 await click(sendButton())
 expect(sender).toHaveBeenCalledTimes(3);expect(sender.mock.calls[2]![0]).toEqual(firstTeam)
 expect(complete).toHaveBeenCalledOnce()
})

it('loads owner topics through the existing directory and enforces the five-target limit',async()=>{
 mocks.native.mockImplementation(async(_method:string,args:{directory:string})=>page(args.directory==='send_to_self'?[source('本人主题','topic')]:Array.from({length:6},(_,index)=>source(`同事${index}`)).concat(source('自己','send_to_self'))))
 const sender=vi.fn(),attempt=new TeamForwardAttempt('source',[{messageRef:'message',version:1}],sender)
 await act(async()=>root.render(<TeamForwardDialog attempt={attempt} previewTitle="消息" previewSubtitle="" onClose={()=>{}} onComplete={()=>{}}/>))
 for(let i=0;i<5;i++)await click(row(`同事${i}`))
 await click(row('同事5'))
 expect(dialog().querySelectorAll('[aria-pressed="true"]')).toHaveLength(5)
 expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('最多选择 5')
 await click(dialog().querySelector<HTMLElement>('[aria-label="选择本人主题"]')!)
 expect(row('本人主题')).toBeTruthy()
 expect(mocks.native).toHaveBeenLastCalledWith('sources.list',{directory:'send_to_self',limit:50},expect.any(AbortSignal))
 expect(sender).not.toHaveBeenCalled()
})

it('owns keyboard focus and blocks dismissal during send, then aborts before starting another target on unmount',async()=>{
 let resolve!:(value:unknown)=>void
 const sender=vi.fn(async()=>await new Promise(done=>{resolve=done})),complete=vi.fn(),close=vi.fn()
 const trigger=document.createElement('button');document.body.append(trigger);trigger.focus()
 const attempt=new TeamForwardAttempt('source',[{messageRef:'message',version:1}],sender)
 try{
  await act(async()=>root.render(<TeamForwardDialog attempt={attempt} previewTitle="消息" previewSubtitle="" onClose={close} onComplete={complete}/>))
  const first=dialog().querySelector<HTMLElement>('button')!
  expect(document.activeElement).toBe(first)
  act(()=>first.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})))
  expect(document.activeElement?.textContent).toContain('屏蔽')
  trigger.focus();expect(document.activeElement).toBe(first)
  await click(row('同事'));await click(row('客服'))
  act(()=>sendButton().click())
  expect(document.activeElement).toBe(dialog())
  act(()=>dialog().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})))
  expect(close).not.toHaveBeenCalled()
  await act(async()=>root.render(null))
  expect(sender.mock.calls[0]![1].aborted).toBe(true)
  await act(async()=>resolve({itemUid:'accepted',localState:'synced'}))
  expect(sender).toHaveBeenCalledOnce();expect(complete).not.toHaveBeenCalled()
  expect(attempt.hasSent('private_chat:同事')).toBe(true)
  expect(document.activeElement).toBe(trigger)
 }finally{trigger.remove()}
})

it('reloads after the development StrictMode lifecycle and releases every request on retirement',async()=>{
 const sender=vi.fn(),attempt=new TeamForwardAttempt('source',[{messageRef:'message',version:1}],sender)
 await act(async()=>root.render(<StrictMode><TeamForwardDialog attempt={attempt} previewTitle="消息" previewSubtitle="" onClose={()=>{}} onComplete={()=>{}}/></StrictMode>))
 expect(row('客服')).toBeTruthy();expect(row('同事')).toBeTruthy()
 expect(mocks.team.mock.calls.some(call=>!call[2].aborted)).toBe(true)
 await act(async()=>root.render(null))
 expect(mocks.team.mock.calls.every(call=>call[2].aborted)).toBe(true)
})


it('confirms IME text before submitting a forwarding comment with Enter',async()=>{
 const sender=vi.fn().mockResolvedValue({itemUid:'accepted',localState:'synced'})
 const attempt=new TeamForwardAttempt('source',[{messageRef:'message',version:1}],sender)
 await act(async()=>root.render(<TeamForwardDialog attempt={attempt} previewTitle="消息" previewSubtitle="" onClose={()=>{}} onComplete={()=>{}}/>))
 await click(row('同事'))
 const input=dialog().querySelector<HTMLTextAreaElement>('textarea')!
 await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})))
 expect(sender).not.toHaveBeenCalled()
 await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,bubbles:true,cancelable:true})))
 expect(sender).not.toHaveBeenCalled()
 await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true})))
 expect(sender).not.toHaveBeenCalled()
 await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})))
 expect(sender).toHaveBeenCalledOnce()
})
