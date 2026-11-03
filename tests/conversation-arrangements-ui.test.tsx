// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
const mock = vi.hoisted(() => ({ call: vi.fn(), navigate: vi.fn(), manage: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: { showConversationTarget: mock.navigate, showArrangements: mock.manage } }))
import { ArkmeConversationArrangements } from '../src/client/ArkmeConversationArrangements.js'
const source = { sourceRef: 'source-a', sourceKey: 'chat-a', kind: 'group_chat', displayName: '硬件项目组' } as ArkmeSourceItem
const item = { id: 'event-a', relatedRef: 'shared-ref', title: '周五15:00到研发会议室和李工确认样机', description: '带测试结果', status: 'following',
  sources: [{ itemUid: 'record-a', recordOwnerUserId: 11, sender: '李工', sendAtMillis: 1000, text: '周五下午三点，到研发会议室确认样机。' }] }
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); mock.call.mockReset(); mock.navigate.mockReset(); mock.manage.mockReset()
  host = document.createElement('div'); host.setAttribute('data-arkme-active-conversation-identity', 'chat-a'); document.body.append(host)
  root = createRoot(host)
  mock.call.mockImplementation(async (operation: string) => operation.endsWith('.detail') ? item : { items: [item], hasMore: false, nextCursor: '' })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })
async function render(account = 'prod:12') { await act(async () => root.render(<ArkmeConversationArrangements source={source} accountScope={account} active refreshRevision={0} />)); await act(async () => { await vi.advanceTimersByTimeAsync(260) }) }
async function click(text: string) { const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text)); expect(button).toBeTruthy(); await act(async () => button!.click()) }
it('opens a shared list above the composer and locates the exact source message', async () => {
  await render(); expect(host.textContent).toContain('相关安排 · 1'); await click('相关安排')
  expect(host.textContent).toContain('硬件项目组'); expect(host.textContent).toContain(item.title)
  await click('定位原消息'); expect(mock.navigate).toHaveBeenCalledWith(source, 'record-a', 1000, 11, undefined, true)
  expect(host.querySelector('[role="dialog"]')).toBeNull()
})
it('rechecks shared detail and offers no write control to another member', async () => {
  await render(); await click('相关安排'); await click('周五15:00')
  expect(mock.call).toHaveBeenCalledWith('arrangements.conversation.detail', { sourceRef: 'source-a', relatedRef: 'shared-ref' }, expect.any(AbortSignal))
  expect(host.textContent).toContain('来源对话'); expect(host.textContent).not.toContain('管理我的安排')
})
it('shows errors as errors and never as an empty count', async () => {
  mock.call.mockRejectedValue(new Error('无权读取当前对话'))
  await render(); expect(host.textContent).toContain('相关安排 !'); expect(host.textContent).not.toContain('相关安排 · 0')
  await click('相关安排'); expect(host.querySelector('[role="alert"]')?.textContent).toContain('无权读取当前对话')
})
it('clears the previous account before starting a new read', async () => {
  await render(); await click('相关安排'); expect(host.textContent).toContain(item.title)
  mock.call.mockImplementation(() => new Promise(() => {}))
  await render('prod:13'); expect(host.textContent).not.toContain(item.title); expect(host.querySelector('[role="dialog"]')).toBeNull()
})
it('deduplicates another page and never calls a partial page an empty conversation', async () => {
  mock.call.mockResolvedValueOnce({ items: [], hasMore: true, nextCursor: 'page-2' }).mockResolvedValueOnce({ items: [item, item], hasMore: false, nextCursor: '' })
  await render(); await click('相关安排'); expect(host.textContent).toContain('可以继续加载')
  await click('加载更多'); expect(host.querySelectorAll('article')).toHaveLength(1)
})

it('clears an open source quote when a fresh list revokes that arrangement', async () => {
  await render(); await click('相关安排'); await click('周五15:00')
  expect(host.textContent).toContain('周五下午三点，到研发会议室确认样机。')
  mock.call.mockResolvedValue({ items: [], hasMore: false, nextCursor: '' })
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  await act(async () => { await vi.advanceTimersByTimeAsync(260) })
  expect(host.textContent).not.toContain('周五下午三点，到研发会议室确认样机。')
  expect(host.textContent).toContain('当前对话暂无未完成安排')
})
