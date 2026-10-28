// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTeamVisitorActions } from '../src/client/TeamVisitorActions.js'
import { TeamVisitorRecords } from '../src/client/TeamVisitorRecords.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { TeamConversation, TeamMessage } from '../src/team-app-contract.js'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
const conversation = { ref: 'conversation-ref', key: 'conversation-key', side: 'team', visitor: { nickname: '访客' } } as TeamConversation
const message = (seq: number, side: 'team' | 'external' = 'external'): TeamMessage => ({ key: `m${seq}`, ref: `ref${seq}`, seq, revision: 1, side,
  own: false, sender: { nickname: side === 'team' ? '同事' : '访客' }, state: 'published', createdAt: Date.now(), canEdit: false, canDelete: false,
  version: 1, contentStatus: 'available', media: [], content: { template_kind: 1, text_content: `正文 ${seq}` } })
let host: HTMLDivElement, root: Root
const onRecords = vi.fn(), onOpen = vi.fn(), onClose = vi.fn(), onLocate = vi.fn()
function Harness({ value = conversation }: { value?: TeamConversation }) {
  const actions = useTeamVisitorActions({ conversation: value, accountKey: 'prod:90', onRecords, onOpen })
  return <>{actions.avatar(<span>头像</span>)}{actions.layer}</>
}
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
const findButton = (name: string) => [...document.querySelectorAll('button')].find(node => node.textContent === name)!
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  vi.clearAllMocks(); call.mockReset(); onLocate.mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('shows the shared user card; only explicit Send opens the verified private conversation', async () => {
  const activate = vi.spyOn(arkmeUi, 'activateNotificationSource').mockImplementation(() => {})
  const source = { sourceRef: 'private-source', kind: 'private_chat' }
  call.mockResolvedValue({ source })
  await act(async () => root.render(<Harness />))
  await act(async () => host.querySelector('button')!.click())
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('访客 的用户卡片')
  expect(call).not.toHaveBeenCalled()
  await act(async () => { findButton('发送消息').click(); await tick() })
  expect(call).toHaveBeenCalledExactlyOnceWith('team.app.visitor.private.open', { conversationRef: 'conversation-ref', expectedAccountKey: 'prod:90' }, expect.any(AbortSignal))
  expect(activate).toHaveBeenCalledWith(source)
  expect(host.querySelector('[role="dialog"]')).toBeNull()
})

it('closes on the scrim and Escape, and cancels a pending open without late navigation', async () => {
  const activate = vi.spyOn(arkmeUi, 'activateNotificationSource').mockImplementation(() => {})
  let resolve!: (result: unknown) => void
  call.mockImplementation(() => new Promise(done => { resolve = done }))
  await act(async () => root.render(<Harness />))
  await act(async () => host.querySelector('button')!.click())
  await act(async () => host.querySelector('[role="presentation"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => host.querySelector('button')!.click())
  await act(async () => findButton('发送消息').click())
  expect(findButton('正在打开…').disabled).toBe(true)
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(call.mock.calls[0]![2].aborted).toBe(true)
  await act(async () => { resolve({ source: {} }); await tick() })
  expect(activate).not.toHaveBeenCalled()
})

it('keeps failures in the card and supports retry; right-click opens only this visitor records', async () => {
  call.mockRejectedValue(new Error('账号暂不可用'))
  await act(async () => root.render(<Harness />))
  await act(async () => host.querySelector('button')!.click())
  await act(async () => { findButton('发送消息').click(); await tick() })
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('账号暂不可用')
  expect(findButton('发送消息').disabled).toBe(false)
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  await act(async () => host.querySelector('button')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 })))
  const menu = document.querySelector('[role="menu"]')!
  expect(menu.textContent).toContain('看TA的快记')
  await act(async () => menu.querySelector<HTMLElement>('[role="menuitem"]')!.click())
  expect(onRecords).toHaveBeenCalledOnce()
})

it('never exposes visitor actions to the external viewer', async () => {
  await act(async () => root.render(<Harness value={{ ...conversation, side: 'external' }} />))
  expect(host.querySelector('button')).toBeNull()
})

it('paginates external records only, deduplicates them, and locates the chosen source', async () => {
  call.mockImplementation(async (_op, payload) => ({ conversation,
    messages: payload.beforeSeq ? [message(7), message(8), message(6, 'team')] : [message(10, 'team'), message(9), message(8)],
    hasMore: !payload.beforeSeq, beforeSeq: payload.beforeSeq ? 6 : 8 }))
  await act(async () => { root.render(<TeamVisitorRecords conversation={conversation} accountKey="prod:90" onClose={onClose} onLocate={onLocate} />); await tick() })
  expect([...host.querySelectorAll('[data-team-visitor-record]')].map(n => n.getAttribute('data-team-visitor-record'))).toEqual(['m9', 'm8'])
  await act(async () => { findButton('加载更早消息').click(); await tick() })
  expect([...host.querySelectorAll('[data-team-visitor-record]')].map(n => n.getAttribute('data-team-visitor-record'))).toEqual(['m9', 'm8', 'm7'])
  expect(call.mock.calls[1]![1]).toMatchObject({ beforeSeq: 8, expectedAccountKey: 'prod:90' })
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-team-visitor-record="m7"] button')!.click(); await tick() })
  expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({ key: 'm7' }), expect.any(AbortSignal))
  expect(onClose).toHaveBeenCalledOnce()
})

it('skips team-only pages without falsely reporting empty results, hides deleted content', async () => {
  call.mockImplementation(async (_op, payload) => ({ conversation,
    messages: payload.beforeSeq ? [message(2), { ...message(1), contentStatus: 'deleted' }] : [message(4, 'team')],
    hasMore: !payload.beforeSeq, beforeSeq: payload.beforeSeq ? 1 : 4 }))
  await act(async () => { root.render(<TeamVisitorRecords conversation={conversation} accountKey="prod:90" onClose={onClose} onLocate={onLocate} />); await tick() })
  expect(call).toHaveBeenCalledTimes(2)
  expect(host.querySelectorAll('[data-team-visitor-record]')).toHaveLength(1)
  expect(host.textContent).not.toContain('暂无快记')
})

it('keeps loaded records on network error and retries the same page, clears them on lost access', async () => {
  let failed = true
  call.mockImplementation(async (_op, payload) => {
    if (payload.beforeSeq && failed) throw new Error('网络失败')
    return { conversation, messages: [message(5)], hasMore: true, beforeSeq: 5 }
  })
  await act(async () => { root.render(<TeamVisitorRecords conversation={conversation} accountKey="prod:90" onClose={onClose} onLocate={onLocate} />); await tick() })
  await act(async () => { findButton('加载更早消息').click(); await tick() })
  expect(host.querySelectorAll('[data-team-visitor-record]')).toHaveLength(1)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('网络失败')
  call.mockRejectedValue({ body: { code: 'team-not_accessible' } })
  await act(async () => { findButton('重试').click(); await tick() })
  expect(call.mock.calls.at(-1)![1].beforeSeq).toBe(5)
  expect(host.querySelectorAll('[data-team-visitor-record]')).toHaveLength(0)
})

it('offers mention and mentioned-record actions only for sealed people, never self mention',async()=>{
 const onMention=vi.fn()
 function MentionHarness({self=false}:{self?:boolean}){const a=useTeamVisitorActions({conversation:{...conversation,visitor:{nickname:'同名',personRef:'person-ref',personKey:'person-key',isMe:self}},accountKey:'test:90',onRecords,onOpen,onMention});return <>{a.avatar(<span>头像</span>)}{a.layer}</>}
 await act(async()=>root.render(<MentionHarness/>))
 await act(async()=>host.querySelector('button')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true})))
 await act(async()=>[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(n=>n.textContent==='@同名')!.click())
 expect(onMention).toHaveBeenCalledWith(expect.objectContaining({personRef:'person-ref'}))
 await act(async()=>host.querySelector('button')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true})))
 await act(async()=>[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(n=>n.textContent==='@TA的快记')!.click())
 expect(onRecords).toHaveBeenCalledWith(expect.objectContaining({personRef:'person-ref'}),'mentioned')
 await act(async()=>root.render(<MentionHarness self/>))
 await act(async()=>host.querySelector('button')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true})))
 expect(document.querySelector('[role="menu"]')?.textContent).toContain('@我的快记')
 expect([...document.querySelectorAll('[role="menuitem"]')].some(n=>n.textContent==='@同名')).toBe(false)
})
it('reads exactly one sparse mention page, continues explicitly and aborts after unmount',async()=>{
 const person={nickname:'同名',personRef:'sealed',personKey:'key'}
 call.mockResolvedValue({conversation,messages:[],hasMore:true,beforeSeq:50})
 await act(async()=>{root.render(<TeamVisitorRecords conversation={conversation} accountKey="test:90" mode="mentioned" person={person} onClose={onClose} onLocate={onLocate}/>);await tick()})
 expect(call).toHaveBeenCalledOnce();expect(call.mock.calls[0]![1]).toMatchObject({personRef:'sealed',personMode:'mentioned'})
 expect(host.textContent).not.toContain('暂无快记')
 call.mockResolvedValue({conversation,messages:[message(40,'team')],hasMore:false,beforeSeq:40})
 await act(async()=>{findButton('加载更早消息').click();await tick()})
 expect(host.querySelectorAll('[data-team-visitor-record]')).toHaveLength(1)
})
it('bounds loaded people rows at 200 while keeping an explicit path back to latest',async()=>{
 let seq=300
 const person={nickname:'访客',personRef:'sealed',personKey:'key'}
 call.mockImplementation(async()=>{const messages=Array.from({length:50},()=>({...message(seq--),sender:{nickname:'访客',personKey:'key'}}));return {conversation,messages,hasMore:true,beforeSeq:seq+1}})
 await act(async()=>{root.render(<TeamVisitorRecords conversation={conversation} accountKey="test:90" person={person} onClose={onClose} onLocate={onLocate}/>);await tick()})
 for(let i=0;i<4;i++)await act(async()=>{findButton('加载更早消息').click();await tick()})
 expect(call).toHaveBeenCalledTimes(5)
 expect(host.querySelectorAll('[data-team-visitor-record]')).toHaveLength(200)
 expect(findButton('返回最新快记')).toBeDefined()
})
it('aborts old person pages and never mixes late results into a replacement identity',async()=>{
 let finish!:(value:unknown)=>void
 call.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValue({conversation,messages:[{...message(2),sender:{nickname:'second',personKey:'second'}}],hasMore:false,beforeSeq:2})
 const render=(ref:string)=><TeamVisitorRecords conversation={conversation} accountKey="test:90" person={{nickname:ref,personRef:ref,personKey:ref}} onClose={onClose} onLocate={onLocate}/>
 await act(async()=>{root.render(render('first'));await tick()})
 const firstSignal=call.mock.calls[0]![2]
 await act(async()=>{root.render(render('second'));await tick()})
 expect(firstSignal.aborted).toBe(true)
 await act(async()=>{finish({conversation,messages:[message(99)],hasMore:false,beforeSeq:99});await tick()})
 expect([...host.querySelectorAll('[data-team-visitor-record]')].map(n=>n.getAttribute('data-team-visitor-record'))).toEqual(['m2'])
})
