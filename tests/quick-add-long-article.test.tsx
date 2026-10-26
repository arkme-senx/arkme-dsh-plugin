// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeQuickAddButton } from '../src/client/ArkmeQuickAdd.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), auth: { auth: { status: 'authenticated', environment: 'prod', userId: 42 } }, listeners: new Set<() => void>() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call, ArkmeClientError: class extends Error {} }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { getSnapshot: () => mocks.auth, subscribe: (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener) } } }))
vi.mock('../src/client/ArkmeLongArticleDialog.js', () => ({ ArkmeLongArticleDialog: (props: any) => <section role="dialog" aria-label="长文编辑器" data-test-target={props.sourceRef} data-test-manual-send={!!props.sendOnConfirm}>
  <button onClick={props.onClose}>关闭测试长文</button>
</section> }))
let host: HTMLDivElement, root: Root
const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label)!
const target = { sourceRef: 'signed-self-target', kind: 'send_to_self', displayName: '发给自己' }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.call.mockReset().mockResolvedValue(target)
  mocks.auth = { auth: { status: 'authenticated', environment: 'prod', userId: 42 } }
  host = document.createElement('div'); host.style.cssText = 'width:100px;overflow:hidden'; document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); mocks.listeners.clear(); vi.unstubAllGlobals() })
async function open(available = true) {
  await act(async () => root.render(<ArkmeQuickAddButton onContactAdd={() => {}} onSourceCreated={() => {}} onNewDshSession={() => {}} {...(available ? { longArticleAccountKey: 'prod:42' } : {})} />))
  await act(async () => trigger().click())
}
it('puts 添加长文 after the DSH entry and opens the shared editor above the clipped directory with only the self destination', async () => {
  await open()
  expect([...document.querySelectorAll('[role="menuitem"]')].slice(0, 3).map(node => node.textContent)).toEqual(['新建 DSH 会话', '添加长文', '添加联系人'])
  await act(async () => button('添加长文').click())
  expect(document.querySelector('[role="menu"]')).toBeNull()
  const editor = document.querySelector('[aria-label="长文编辑器"]')!
  expect(editor.getAttribute('data-test-target')).toBe('signed-self-target')
  expect(editor.getAttribute('data-test-manual-send')).toBe('false')
  expect(host.contains(editor)).toBe(false)
  expect(mocks.call).toHaveBeenCalledExactlyOnceWith('sources.self-target', {}, expect.any(AbortSignal))
  await act(async () => button('关闭测试长文').click())
  expect(document.activeElement).toBe(trigger())
})
it('leaves contacts and other quick-add locations unchanged when no article scope is supplied', async () => {
  await open(false); expect(button('添加长文')).toBeUndefined(); expect(mocks.call).not.toHaveBeenCalled()
})
it('shows a recoverable failure, rejects any non-self target, and retries without sending content', async () => {
  mocks.call.mockResolvedValueOnce({ ...target, kind: 'private_chat' })
  await open(); await act(async () => button('添加长文').click())
  expect(document.body.textContent).toContain('暂时无法读取发给自己')
  expect(document.querySelector('[aria-label="长文编辑器"]')).toBeNull()
  await act(async () => button('重试').click())
  expect(document.querySelector('[data-test-target="signed-self-target"]')).not.toBeNull()
  expect(mocks.call.mock.calls.every(([op]) => op === 'sources.self-target')).toBe(true)
})
it('aborts a pending destination read on cancellation and ignores its late response', async () => {
  let finish!: (value: unknown) => void
  mocks.call.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await open(); await act(async () => button('添加长文').click())
  expect(document.body.textContent).toContain('正在准备长文')
  const signal = mocks.call.mock.calls[0]![2] as AbortSignal
  await act(async () => button('关闭').click()); expect(signal.aborted).toBe(true)
  await act(async () => finish(target))
  expect(document.querySelector('[aria-label="长文编辑器"]')).toBeNull()
  expect(document.activeElement).toBe(trigger())
})
it('ignores an old destination when the account changes before loading completes', async () => {
  let finish!: (value: unknown) => void
  mocks.call.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await open(); await act(async () => button('添加长文').click())
  const signal = mocks.call.mock.calls[0]![2] as AbortSignal
  await act(async () => { mocks.auth = { auth: { status: 'authenticated', environment: 'prod', userId: 43 } }; mocks.listeners.forEach(listener => listener()) })
  expect(signal.aborted).toBe(true)
  await act(async () => finish(target))
  expect(document.querySelector('[aria-label="长文编辑器"]')).toBeNull()
})
