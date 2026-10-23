// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePrivateMessageDnd } from '../src/client/private-message-dnd.js'
import { ConversationActionsMenu } from '../src/client/PrivateChatActions.js'
import type { ArkmeChatNotificationResult, ArkmeSourceItem } from '../src/types.js'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: call }))
const policy = (messageDnd = false, version = 1): ArkmeChatNotificationResult => ({ messageDnd, chatNotificationPolicyUpdatedAtMillis: version })
const source: ArkmeSourceItem = { sourceRef: 'private-ref', sourceKey: 'private-key', kind: 'private_chat', displayName: '同事', isMuted: false, chatNotificationPolicyUpdatedAtMillis: 1 }
const updated = vi.fn((_target, result) => result.messageDnd)
let root: Root, host: HTMLDivElement
const anchor = createRef<HTMLButtonElement>()
function Probe({ target = source, account = 'prod:11', open = true } = {}) {
  const item = usePrivateMessageDnd(account, target, open, updated)
  return <><button ref={anchor}>更多</button>{item && open && <ConversationActionsMenu items={[item]} anchor={anchor} onClose={() => {}} />}</>
}
const render = async (props = {}) => { await act(async () => { root.render(<Probe {...props} />) }) }
const toggle = () => document.querySelector<HTMLElement>('[role=switch]')!
const click = async () => { await act(async () => { toggle().click() }) }
function pending<T>() { let resolve!: (v: T) => void, reject!: (v: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a;reject=b }); return { promise, resolve, reject } }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); call.mockReset(); updated.mockClear()
  call.mockResolvedValue(policy()); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('shows an immediate pending switch, deduplicates clicks and restores the persisted value on remount', async () => {
  let saved = policy(); const write = pending<ArkmeChatNotificationResult>()
  call.mockImplementation(op => op === 'chat.notification.set' ? write.promise : Promise.resolve(saved))
  await render(); expect(toggle().getAttribute('aria-checked')).toBe('false')
  await click(); expect(toggle().getAttribute('aria-checked')).toBe('true'); expect(toggle().getAttribute('aria-disabled')).toBe('true')
  await click(); expect(call.mock.calls.filter(c => c[0] === 'chat.notification.set')).toHaveLength(1)
  saved = policy(true, 2); await act(async () => write.resolve(saved))
  expect(toggle().getAttribute('aria-disabled')).toBeNull(); expect(updated).toHaveBeenCalledWith(source, saved)
  await act(async () => root.render(null)); await render(); expect(toggle().getAttribute('aria-checked')).toBe('true')
})
it('keeps the menu open when activating the row, not just the inner switch', async () => {
  await render(); await act(async () => document.querySelector<HTMLButtonElement>('[role=menuitem]')!.click())
  expect(document.querySelector('[role=menu]')).not.toBeNull()
  expect(call).toHaveBeenCalledWith('chat.notification.set', { sourceRef: 'private-ref', enabled: true }, expect.any(AbortSignal))
})
it('restores the last verified value and reports an unconfirmed save', async () => {
  call.mockImplementation(op => op === 'chat.notification.set' ? Promise.reject(new Error('offline')) : Promise.resolve(policy()))
  await render(); await click()
  expect(toggle().getAttribute('aria-checked')).toBe('false')
  expect(document.body.textContent).toContain('免打扰未确认保存，请重试')
})
it('reconciles a lost write response without resubmitting the mutation', async () => {
  call.mockResolvedValueOnce(policy()).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(policy(true, 3))
  await render(); await click(); expect(toggle().getAttribute('aria-checked')).toBe('true')
  expect(document.body.textContent).not.toContain('未确认保存')
  expect(call.mock.calls.filter(c => c[0] === 'chat.notification.set')).toHaveLength(1)
})
it('ignores a read started before a write and older policy responses', async () => {
  const read = pending<ArkmeChatNotificationResult>()
  call.mockImplementation(op => op === 'chat.notification.get' ? read.promise : Promise.resolve(policy(true, 9)))
  await render(); await click(); await act(async () => read.resolve(policy(false, 1)))
  expect(toggle().getAttribute('aria-checked')).toBe('true')
  await render({ open: false }); call.mockResolvedValue(policy(false, 2)); await render()
  expect(toggle().getAttribute('aria-checked')).toBe('true')
})
it('does not leak a pending write or late acknowledgement into another account or conversation', async () => {
  const write = pending<ArkmeChatNotificationResult>()
  call.mockImplementation(op => op === 'chat.notification.set' ? write.promise : Promise.resolve(policy()))
  await render(); await click(); updated.mockClear()
  await render({ account: 'prod:22', target: { ...source, sourceRef: 'new', sourceKey: 'other' } })
  expect(toggle().getAttribute('aria-checked')).toBe('false')
  await act(async () => write.resolve(policy(true, 8)))
  expect(toggle().getAttribute('aria-checked')).toBe('false')
  expect(updated.mock.calls.some(c => c[0].sourceRef === source.sourceRef)).toBe(false)
})
it('does not invent an off state without policy evidence, and offers read retry', async () => {
  call.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(policy(true, 3))
  const target = { ...source }; delete target.isMuted; delete target.chatNotificationPolicyUpdatedAtMillis
  await render({ target }); expect(toggle()).toBeNull(); expect(document.body.textContent).toContain('重试')
  await act(async () => document.querySelector<HTMLButtonElement>('[role=menuitem]')!.click())
  expect(toggle().getAttribute('aria-checked')).toBe('true')
})
it('continues saving when navigating away and restores the pending intent when returning', async () => {
  const write = pending<ArkmeChatNotificationResult>()
  call.mockImplementation(op => op === 'chat.notification.set' ? write.promise : Promise.resolve(policy()))
  await render(); await click()
  const signal = call.mock.calls.find(c => c[0] === 'chat.notification.set')![2] as AbortSignal
  await render({ target: { ...source, kind: 'group_chat' } }); expect(toggle()).toBeNull(); expect(signal.aborted).toBe(false)
  await render(); expect(toggle().getAttribute('aria-checked')).toBe('true'); expect(toggle().getAttribute('aria-disabled')).toBe('true')
  await act(async () => write.resolve(policy(true, 4)))
  expect(toggle().getAttribute('aria-checked')).toBe('true'); expect(toggle().getAttribute('aria-disabled')).toBeNull()
})
