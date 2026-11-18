// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
import { useConversationRecognitionAction } from '../src/client/ConversationRecognitionControl.js'
import { useConversationRecognition } from '../src/client/use-conversation-recognition.js'
import { ArkmeConversationArrangements } from '../src/client/ArkmeConversationArrangements.js'
import type { ArkmeSourceItem } from '../src/types.js'
import type { TeamConversation } from '../src/team-app-contract.js'
let host: HTMLDivElement, root: Root, account: string
const source = { sourceRef: 'recognition-source', sourceKey: 'recognition-chat', kind: 'private_chat', displayName: '测试对方' } as ArkmeSourceItem
let enabled: boolean, version: number, failWrite: boolean, loseResponse: boolean
const value = () => ({ accountScope: account, enabled, version, enabledAt: 0, effectiveEnabled: enabled, blockedReason: enabled ? '' : '已关闭' })
function Harness({ scope = 'chat', kind = 'private_chat' }: { scope?: 'chat'|'team'; kind?: ArkmeSourceItem['kind'] }) {
  const action = useConversationRecognitionAction(account, source.sourceRef, scope, true)
  return <><button onClick={action.invoke}>{action.label}</button>{action.error && <p role="alert">{action.error}</p>}
    {scope === 'chat' ? <ArkmeConversationArrangements source={{ ...source, kind }} accountScope={account} active refreshRevision={0} />
      : <ArkmeConversationArrangements teamConversation={{ ref: source.sourceRef, key: 'recognition-team', side: 'team', channel: { name: '测试通道' }, visitor: { nickname: '测试访客' } } as TeamConversation} accountScope={account} active refreshRevision={0} />}</>
}
beforeEach(() => {
  vi.useFakeTimers(); account = `test:recognition-${crypto.randomUUID()}`; enabled = true; version = 0; failWrite = false; loseResponse = false
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  mock.call.mockReset(); mock.call.mockImplementation(async (op, params) => {
    if (op === 'arrangements.conversation.recognition.get') return value()
    if (op === 'arrangements.conversation.recognition.set') {
      if (failWrite) throw new Error('网络失败')
      enabled = params.enabled; version++
      if (loseResponse) throw new Error('回包丢失')
      return value()
    }
    return { items: [], hasMore: false, nextCursor: '' }
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })
async function render(scope: 'chat'|'team' = 'chat') { await act(async () => { root.render(<Harness scope={scope} />) }); await act(async () => { await vi.advanceTimersByTimeAsync(260) }) }
async function toggle() { await act(async () => host.querySelector<HTMLElement>('[role="switch"][aria-label="安排识别"]')!.click()) }
it('budgets passive preparation but upgrades an explicit refresh and ignores the retired read', async () => {
  let state!: ReturnType<typeof useConversationRecognition>
  function Preparation() { state=useConversationRecognition(account, source.sourceRef, 'team', true); return <p>{String(state.value?.enabled)}</p> }
  const reads: Array<{signal:AbortSignal;resolve(value:unknown):void}>=[]
  mock.call.mockImplementation((_op,_params,signal)=>new Promise(resolve=>reads.push({signal,resolve})))
  await act(async()=>root.render(<Preparation/>))
  expect(reads).toHaveLength(1);expect(mock.call.mock.calls[0]?.[3]).toEqual({priority:'background'})
  await act(async()=>{void state.refresh()})
  expect(reads[0]!.signal.aborted).toBe(true);expect(reads).toHaveLength(2)
  expect(mock.call.mock.calls[1]?.[3]).toBeUndefined()
  await act(async()=>reads[1]!.resolve(value()));expect(host.textContent).toBe('true')
  await act(async()=>reads[0]!.resolve({...value(),enabled:false}));expect(host.textContent).toBe('true')
})
it('shares confirmed state between the menu and shortcut, and restores it on enable', async () => {
  await render(); expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true'); expect(host.textContent).toContain('相关安排')
  await toggle(); expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false'); expect(host.textContent).not.toContain('相关安排')
  await toggle(); expect(host.textContent).toContain('相关安排')
  const writes = mock.call.mock.calls.filter(([op]) => op.endsWith('.set'))
  expect(writes.map(([, p]) => [p.enabled,p.expectedVersion])).toEqual([[false,0],[true,1]])
})
it('keeps the previous confirmed state on failed save and displays feedback', async () => {
  await render(); failWrite = true; await toggle()
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true'); expect(host.textContent).toContain('相关安排'); expect(host.querySelector('[role="alert"]')?.textContent).toContain('网络失败')
})
it('reads back a lost write response without retrying the write', async () => {
  await render(); loseResponse = true; await toggle()
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false'); expect(host.textContent).not.toContain('相关安排')
  expect(mock.call.mock.calls.filter(([op]) => op.endsWith('.set'))).toHaveLength(1)
  expect(mock.call.mock.calls.find(([op])=>op.endsWith('.set'))?.[3]).toBeUndefined()
  expect(mock.call.mock.calls.filter(([op])=>op.endsWith('.get')).at(-1)?.[3]).toBeUndefined()
})
it('shows benefit text without toggling when the info icon is clicked', async () => {
  await render(); await act(async () => { const info=host.querySelector<HTMLElement>('[aria-label="安排识别说明"]')!; info.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); info.click() })
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('减少遗漏、方便跟进')
  expect(mock.call.mock.calls.filter(([op]) => op.endsWith('.set'))).toHaveLength(0)
})
it('uses the same setting control for Team while sending its opaque Team reference', async () => {
  await render('team'); await toggle()
  expect(mock.call.mock.calls.find(([op]) => op.endsWith('.set'))?.[1]).toMatchObject({ teamConversationRef: source.sourceRef, enabled: false })
  expect(mock.call.mock.calls.find(([op]) => op.endsWith('.set'))?.[1].sourceRef).toBeUndefined()
})
it('clears the previous account state before the next account loads', async () => {
  await render(); await toggle(); account = `test:other-${crypto.randomUUID()}`; enabled = true; version = 0; await render()
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true'); expect(host.textContent).toContain('相关安排')
})

it('does not flash the shortcut while a saved OFF preference is loading',async()=>{
 let resolve!: (value:unknown)=>void
 mock.call.mockImplementation(op=>op==='arrangements.conversation.recognition.get'?new Promise(r=>{resolve=r}):Promise.resolve({items:[],hasMore:false,nextCursor:''}))
 await render();expect(host.textContent).not.toContain('相关安排')
 enabled=false;version=1
 await act(async()=>resolve(value()))
 expect(host.textContent).not.toContain('相关安排');expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
})

it('lets a confirmed switch interrupt background refresh and ignores its stale reply',async()=>{
 await render()
 let resolve!:(value:unknown)=>void
 const stale=value()
 mock.call.mockImplementation((op,params)=>{
  if(op==='arrangements.conversation.recognition.get')return new Promise(r=>{resolve=r})
  if(op==='arrangements.conversation.recognition.set'){enabled=params.enabled;version++;return Promise.resolve(value())}
  return Promise.resolve({items:[],hasMore:false,nextCursor:''})
 })
 await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(host.querySelector('[role="switch"]')?.getAttribute('aria-disabled')).not.toBe('true')
 await toggle();await act(async()=>resolve(stale))
 expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');expect(host.textContent).not.toContain('相关安排')
})

it.each(['private_chat', 'group_chat', 'team'] as const)('keeps an unknown %s preference hidden after a cold read failure and retries without writing', async kind => {
  enabled = false; version = 3
  let failRead = true
  mock.call.mockImplementation(async op => {
    if (op === 'arrangements.conversation.recognition.get') {
      if (failRead) throw new Error('读取失败')
      return value()
    }
    return { items: [], hasMore: false, nextCursor: '' }
  })
  await act(async () => { root.render(<Harness scope={kind === 'team' ? 'team' : 'chat'} kind={kind === 'team' ? 'private_chat' : kind} />) })
  expect(host.querySelector('[aria-label="相关安排"]')).toBeNull()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('读取失败')
  expect(host.textContent).toContain('重试')
  expect(mock.call.mock.calls.filter(([op]) => op === 'arrangements.conversation.list')).toHaveLength(0)
  failRead = false
  await act(async () => { host.querySelector<HTMLButtonElement>('button')!.click() })
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  expect(host.querySelector('[aria-label="相关安排"]')).toBeNull()
  expect(mock.call.mock.calls.filter(([op]) => op.endsWith('.set'))).toHaveLength(0)
})

it.each([true, false])('retains the last confirmed enabled=%s preference when a later refresh fails', async initial => {
  enabled = initial
  await render()
  mock.call.mockImplementation(async op => {
    if (op === 'arrangements.conversation.recognition.get') throw new Error('刷新失败')
    return { items: [], hasMore: false, nextCursor: '' }
  })
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe(String(initial))
  expect(Boolean(host.querySelector('[aria-label="相关安排"]'))).toBe(initial)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('刷新失败')
  expect(mock.call.mock.calls.filter(([op]) => op.endsWith('.set'))).toHaveLength(0)
})
