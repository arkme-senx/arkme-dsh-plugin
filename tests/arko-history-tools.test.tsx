// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ArkmeArkoHistoryTools } from '../src/client/ArkmeArkoHistoryTools.js'
import { callArkme } from '../src/client/api.js'
import { downloadArkmeConversationMarkdown } from '../src/client/conversation-export.js'
import type { ArkmeArkoHistoryItem } from '../src/types.js'
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn() }))
vi.mock('../src/client/conversation-export.js', () => ({ downloadArkmeConversationMarkdown: vi.fn() }))
let host: HTMLDivElement, root: Root
const locate = vi.fn(), clear = vi.fn(), capabilities = vi.fn(), panelOpen = vi.fn()
const item = (id: number, text: string): ArkmeArkoHistoryItem => ({ messageId: id, sessionId: 7, role: id % 2 ? 'user' : 'assistant', text, reasoning: '', createdAtMillis: new Date(2026, 9, id).getTime(), status: 1, createdRecordUids: [] })
const items = [item(1, '很早的目标消息'), item(2, '更新的目标回复'), item(3, '最新消息')]
const click = async (selector: string) => { await act(async () => { document.querySelector<HTMLElement>(selector)!.click() }) }
const menuItem = async (label: string) => { await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(node => node.textContent === label)!.click() }) }
const openMenu = () => click('[aria-label="更多 Arko 操作"]')
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', vi.fn())
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.mocked(callArkme).mockImplementation(async (op, args) => {
    if (op !== 'arko.history') throw new Error(`unexpected ${op}`)
    return (args?.offset === 0 ? { items: items.slice(1).reverse(), hasMore: true, nextOffset: 2 } : { items: items.slice(0, 1), hasMore: false }) as never
  })
  await act(async () => root.render(<ArkmeArkoHistoryTools accountScope="test:1" name="小助" host={{ current: host }} disabled={false} clearDisabled={false} detailOpen={false}
    onClear={clear} onCapabilities={capabilities} onOpenPanel={panelOpen} onLocate={locate} getReadingDate={() => '2026-10-01'} />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks() })
it('searches beyond the initial page and locates the selected original message', async () => {
  await click('[aria-label="搜索 Arko 对话"]')
  const input = document.querySelector<HTMLInputElement>('[aria-label="搜索 Arko 关键词"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '目标')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(document.querySelectorAll('[data-arko-search-hit]')).toHaveLength(2)
  expect(host.textContent).toContain('已读取 3 条历史')
  await click('[data-arko-search-hit="1"]')
  expect(locate).toHaveBeenCalledWith(items, items[0])
  expect(document.querySelector('[role="dialog"][aria-label="搜索 Arko 对话"]')).toBeNull()
})
it('renders a shared calendar using original message dates', async () => {
  await click('[aria-label="按日期查看 Arko 对话"]')
  expect(document.querySelector('[aria-label="会话日历"]')).not.toBeNull()
  expect(document.querySelector('[aria-label="会话日历"]')!.textContent).toContain('已读取 3 条历史')
})
it('exports all history and exposes context/capabilities in the more menu', async () => {
  await openMenu(); await menuItem('导出')
  expect(downloadArkmeConversationMarkdown).toHaveBeenCalledWith(expect.stringContaining('小助-对话-'), expect.stringContaining('很早的目标消息'))
  expect(host.textContent).toContain('已导出 3 条消息')
  await openMenu(); await menuItem('清除上下文'); expect(clear).toHaveBeenCalledOnce()
  await openMenu(); await menuItem('小助 能干什么'); expect(capabilities).toHaveBeenCalledOnce()
})
it('retains partial search results but never downloads an incomplete export', async () => {
  const original = vi.mocked(callArkme).getMockImplementation()!
  vi.mocked(callArkme).mockImplementation((op, args, signal) => args?.offset === 2 ? Promise.reject(new Error('网络中断')) : original(op, args, signal))
  await openMenu(); await menuItem('导出')
  expect(downloadArkmeConversationMarkdown).not.toHaveBeenCalled()
  expect(host.textContent).toContain('网络中断')
  await click('[aria-label="搜索 Arko 对话"]')
  expect(host.textContent).toContain('当前结果不完整 · 已读取 2 条')
})
it('aborts a pending export when the account-scoped toolbar unmounts', async () => {
  let finish!: (value: unknown) => void
  let requestSignal: AbortSignal | undefined
  vi.mocked(callArkme).mockImplementation((_op, _args, signal) => {
    requestSignal = signal
    return new Promise(resolve => { finish = resolve }) as never
  })
  await openMenu(); await menuItem('导出')
  await act(async () => root.render(<div />))
  expect(requestSignal?.aborted).toBe(true)
  await act(async () => finish({ items, hasMore: false }))
  expect(downloadArkmeConversationMarkdown).not.toHaveBeenCalled()
})
