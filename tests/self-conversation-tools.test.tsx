// @vitest-environment jsdom
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeConversationSearch } from '../src/client/ArkmeConversationSearch.js'
import { SelfConversationStatistics } from '../src/client/statistics/SelfConversationStatistics.js'
import { callArkme } from '../src/client/api.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { findSelectedMessageText } from '../src/client/message-selection-search.js'
import type { ArkmeSourceItem } from '../src/types.js'

vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn() }))
vi.mock('../src/client/arkme-membership.js', () => ({ useMembership: () => ({ state: { status: 'ready', value: { memberType: 1 } } }) }))
const topic: ArkmeSourceItem = { sourceRef: 'signed-topic', sourceKey: 'topic:1', kind: 'topic', displayName: '工作笔记', activeAtMillis: 1, unreadCount: 0 }
let host: HTMLDivElement, root: Root
function Harness({ account = 'prod:7', source = topic }: { account?: string; source?: ArkmeSourceItem }) {
  const panel = useRef<HTMLDivElement>(null), [open, setOpen] = useState<'search' | 'statistics'>()
  return <div ref={panel}>
    <ArkmeConversationSearch source={source} host={panel} accountKey={account} label="搜索发给自己"
      open={open === 'search'} onOpenChange={value => setOpen(value ? 'search' : undefined)}/>
    <SelfConversationStatistics host={panel} accountScope={account} open={open === 'statistics'} onOpenChange={value => setOpen(value ? 'statistics' : undefined)}/>
  </div>
}
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === name || b.textContent === name)!
const click = async (name: string) => { expect(button(name), name).toBeDefined(); await act(async () => button(name).click()) }
const stats = () => host.querySelector('[role="dialog"][aria-label="发给自己统计"]')
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  sessionStorage.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.mocked(callArkme).mockImplementation(async operation => {
    if (operation === 'statistics.detail') return { days: 10, recordCount: 12, wordsCount: 100, recordMin: 4, subjectCount: 2 } as never
    if (operation === 'statistics.keywords') return { keywords: [{ keywordId: 'keyword-1', snapshotId: 'snapshot-1', text: '记录', occurrenceCount: 5, recordCount: 2 }], snapshotId: 'snapshot-1', algorithmVersion: 'v1', coverage: { complete: true, records: 12, candidateLimit: 50, returned: 1 } } as never
    if (operation === 'statistics.active') return [] as never
    if (operation === 'statistics.long') return { items: [], nextOffset: null } as never
    if (operation === 'calendar.buckets') return { days: [] } as never
    if (operation === 'search.scene') return { items: [], hasMore: false, queryGuard: { state: 'complete' } } as never
    if (operation === 'search.records') return { items: [{ recordUid: 'record', recordOwnerUserId: 7, sourceKind: 2, targetSource: topic, sendAtMillis: 1, title: '笔记原文', textContent: '记录' }], hasMore: false, queryGuard: { state: 'complete' } } as never
    throw new Error(`unexpected operation ${operation}`)
  })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks()
})

it('loads personal statistics on demand, keeps their account scope explicit inside a topic, and switches by month', async () => {
  await act(async () => root.render(<Harness/>))
  expect(callArkme).not.toHaveBeenCalled()
  await click('发给自己统计')
  expect(stats()?.textContent).toContain('全部个人快记 · 不受当前主题筛选影响')
  expect(callArkme).toHaveBeenCalledWith('statistics.detail', expect.objectContaining({ accountScope: 'prod:7', fromStamp: 0 }), expect.anything())
  expect(vi.mocked(callArkme).mock.calls.some(([op]) => op.startsWith('chat.'))).toBe(false)
  await click('按月')
  const query = vi.mocked(callArkme).mock.calls.filter(([op]) => op === 'statistics.detail').at(-1)![1] as { fromStamp: number; previousFromStamp: number }
  expect(query.fromStamp).toBeGreaterThan(0)
  expect(query.previousFromStamp).toBeLessThan(query.fromStamp)
  await click('搜索发给自己')
  expect(stats()).toBeNull()
  expect(host.querySelector('[aria-label="聊天记录搜索"]')).not.toBeNull()
})

it('opens selection search within the current topic and locates the original record', async () => {
  const locate = vi.spyOn(arkmeUi, 'showConversationTarget').mockImplementation(() => {})
  await act(async () => root.render(<Harness/>))
  await click('发给自己统计')
  await act(async () => { expect(findSelectedMessageText(topic.sourceRef, '记录')).toBe(true) })
  await act(async () => vi.advanceTimersByTimeAsync(400))
  expect(stats()).toBeNull()
  expect(callArkme).toHaveBeenCalledWith('search.records', expect.objectContaining({ sourceRef: topic.sourceRef, query: '记录' }), expect.anything())
  const result = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="聊天搜索结果"] button')].find(b => b.textContent?.includes('笔记原文'))!
  expect(result).toBeDefined()
  await act(async () => result.click())
  expect(locate).toHaveBeenCalledWith(topic, 'record', 1, 7)
  expect(host.querySelector('[aria-label="聊天记录搜索"]')).toBeNull()
})

it('leaves the statistics panel open when Escape closes a nested keyword drawer, then restores focus on exit', async () => {
  await act(async () => root.render(<Harness/>))
  await click('发给自己统计')
  await click('查看词频')
  expect(callArkme).toHaveBeenCalledWith('statistics.keywords', expect.objectContaining({ accountScope: 'prod:7', fromStamp: 0 }), expect.anything())
  expect(host.querySelector('[aria-label="词频详情"]')).not.toBeNull()
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(host.querySelector('[aria-label="词频详情"]')).toBeNull()
  expect(stats()).not.toBeNull()
  await act(async () => button('关闭发给自己统计').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(stats()).toBeNull()
  expect(document.activeElement).toBe(button('发给自己统计'))
})

it('remounts statistics for a different account and never renders the previous account results', async () => {
  await act(async () => root.render(<Harness/>)); await click('发给自己统计')
  vi.mocked(callArkme).mockImplementation(() => new Promise(() => {}))
  await act(async () => root.render(<Harness account="prod:8"/>))
  expect(callArkme).toHaveBeenCalledWith('statistics.detail', expect.objectContaining({ accountScope: 'prod:8' }), expect.anything())
  expect(stats()?.querySelector('.stats-metrics')).toBeNull()
})
