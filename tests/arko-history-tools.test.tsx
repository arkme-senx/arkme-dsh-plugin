// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ArkmeArkoHistoryTools } from '../src/client/ArkmeArkoHistoryTools.js'
import { ArkmeSdk } from '../src/sdk/index.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeArkoHistoryItem } from '../src/types.js'
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn() }))
let host: HTMLDivElement, root: Root
const locate = vi.fn(), clear = vi.fn(), capabilities = vi.fn(), panelOpen = vi.fn()
const item: ArkmeArkoHistoryItem = { messageRef: 'opaque-original', messageId: 1, sessionId: 7, role: 'assistant', text: '# 完整原文\n\n**目标回复**', reasoning: '', createdAtMillis: new Date(2026, 9, 1).getTime(), status: 1, createdRecordUids: [] }
const match = { messageKey: '7:1', messageRef: item.messageRef, role: 'assistant', snippet: '目标回复…', createdAtMillis: item.createdAtMillis, orderAtMillis: item.createdAtMillis, status: 1 }
const window = { items: [item], anchorMessageRef: item.messageRef, hasBefore: true, beforeCursor: 'before', hasAfter: false }
const click = async (selector: string) => { await act(async () => { document.querySelector<HTMLElement>(selector)!.click() }) }
const menuItem = async (label: string) => { await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(node => node.textContent === label)!.click() }) }
const openMenu = () => click('[aria-label="更多 Arko 操作"]')
async function enterQuery(text: string) {
 const input = document.querySelector<HTMLInputElement>('[aria-label="搜索 Arko 关键词"]')!
 await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })) })
 await act(async () => { await vi.advanceTimersByTimeAsync(350) })
}
beforeEach(async () => {
 vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
 vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', vi.fn())
 vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
 vi.spyOn(ArkmeSdk.prototype, 'arkoExport').mockImplementation((signal) => callArkme('arko.export', {}, signal))
 host = document.createElement('div'); document.body.append(host); root = createRoot(host)
 vi.mocked(callArkme).mockImplementation(async (op, args) => {
   if (op === 'arko.search') return { items: args?.cursor ? [match] : [], hasMore: !args?.cursor, nextCursor: args?.cursor ? undefined : 'continue', scanned: 500, consistency: 'live' } as never
   if (op === 'arko.context') return window as never
   if (op === 'arko.export') return { fileRef: 'arkme-generated-v1.YQ.Yg.Yw', fileName: 'Arko-对话.md', count: 3000, size: 9999, expiresAtMillis: Date.now() + 60000 } as never
   if (op === 'calendar.activity') return { daily_data: [{ date: '2026-10-01', count: 1, has_items: true }], coverage: { status: 'complete' } } as never
   throw new Error(`unexpected ${op}`)
 })
 await act(async () => root.render(<ArkmeArkoHistoryTools accountScope="test:1" name="小助" host={{ current: host }} disabled={false} clearDisabled={false} detailOpen={false}
  onClear={clear} onCapabilities={capabilities} onOpenPanel={panelOpen} onLocate={locate} getReadingDate={() => '2026-10-01'} />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })
it('debounces literal server search, continues empty pages and locates full original context', async () => {
 await click('[aria-label="搜索 Arko 对话"]')
 await act(async () => { await vi.advanceTimersByTimeAsync(350) })
 expect(callArkme).not.toHaveBeenCalled()
 await enterQuery('目标')
 expect(vi.mocked(callArkme).mock.calls.filter(([op]) => op === 'arko.search')).toHaveLength(2)
 expect(host.textContent).not.toContain('没有匹配的消息')
 expect(host.textContent).toContain('目标回复…')
 await click('[data-arko-search-hit]')
 expect(locate).toHaveBeenCalledWith(window, item)
 expect(callArkme).toHaveBeenCalledWith('arko.context', { messageRef: 'opaque-original', before: 20, after: 20 }, expect.any(AbortSignal))
 expect(vi.mocked(callArkme).mock.calls.some(([op]) => op === 'arko.history' || op === 'arko.session')).toBe(false)
})
it('loads Arko month buckets through the shared calendar without scanning messages', async () => {
 await click('[aria-label="按日期查看 Arko 对话"]')
 expect(document.querySelector('[aria-label="会话日历"]')).not.toBeNull()
 expect(callArkme).toHaveBeenCalledWith('calendar.activity', expect.objectContaining({ source: 'arko', mode: 'buckets', body: expect.objectContaining({ start_date: '2026-10-01', end_date: '2026-11-01' }) }), expect.any(AbortSignal))
 expect(vi.mocked(callArkme).mock.calls.every(([op]) => op === 'calendar.activity')).toBe(true)
})
it('downloads the verified generated artifact and preserves existing menu actions', async () => {
 await openMenu(); await menuItem('导出')
 expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
 expect(host.textContent).toContain('已导出 3000 条消息')
 await openMenu(); await menuItem('清除上下文'); expect(clear).toHaveBeenCalledOnce()
 await openMenu(); await menuItem('小助 能干什么'); expect(capabilities).toHaveBeenCalledOnce()
})
it('never starts a download on an incomplete export', async () => {
 vi.mocked(callArkme).mockRejectedValueOnce(new Error('完整性校验失败'))
 await openMenu(); await menuItem('导出')
 expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
 expect(host.textContent).toContain('完整性校验失败')
})
it('aborts pending export on unmount and prevents late download', async () => {
 let finish!: (value: unknown) => void, signal: AbortSignal | undefined
 vi.mocked(callArkme).mockImplementation((_op, _args, passed) => { signal = passed; return new Promise(resolve => { finish = resolve }) as never })
 await openMenu(); await menuItem('导出')
 await act(async () => root.render(<div />))
 expect(signal?.aborted).toBe(true)
 await act(async () => finish({ fileRef: 'arkme-generated-v1.YQ.Yg.Yw', count: 1 }))
 expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
})
it('aborts stale searches when filters change', async () => {
 await click('[aria-label="搜索 Arko 对话"]')
 let signal: AbortSignal | undefined
 vi.mocked(callArkme).mockImplementation((_op, _args, passed) => { signal = passed; return new Promise(() => {}) })
 await enterQuery('first')
 const first = signal!
 await enterQuery('second')
 expect(first.aborted).toBe(true)
 expect(signal?.aborted).toBe(false)
})

it('labels a bounded search window accurately after scanning more matches than it retains', async () => {
 let number = 0
 vi.mocked(callArkme).mockImplementation(async op => {
  if (op !== 'arko.search') throw new Error('unexpected operation')
  number++
  return { items: Array.from({ length: 50 }, (_, i) => ({ ...match, messageKey: `page-${number}-${i}`, messageRef: `page-${number}-${i}` })), hasMore: number < 5, nextCursor: number < 5 ? `cursor-${number}` : undefined, scanned: 50, consistency: 'live' } as never
 })
 await click('[aria-label="搜索 Arko 对话"]'); await enterQuery('many')
 for (let i = 0; i < 4; i++) await click('[data-arko-search-more]')
 expect(host.querySelectorAll('[data-arko-search-hit]')).toHaveLength(200)
 expect(host.textContent).toContain('当前窗口最多保留 200 条匹配')
 expect(host.textContent).toContain('当前显示 200 条匹配')
 const refresh = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === '重新搜索')!
 await act(async () => refresh.click())
 expect(vi.mocked(callArkme).mock.calls.at(-1)?.[1]).not.toHaveProperty('cursor')
 expect(host.querySelectorAll('[data-arko-search-hit]')).toHaveLength(50)
})

it('does not describe a failed first search as a completed scan or no matches', async () => {
 vi.mocked(callArkme).mockRejectedValueOnce(new Error('读取超时'))
 await click('[aria-label="搜索 Arko 对话"]'); await enterQuery('failure')
 expect(host.textContent).toContain('读取超时')
 expect(host.textContent).not.toContain('已扫描到历史末尾')
 expect(host.textContent).not.toContain('没有匹配的消息')
 expect(host.textContent).toContain('搜索未完成，请重试')
})

it('cancels pending original-message navigation when the user changes the search intent', async () => {
 let finish!: (value: unknown) => void, locationSignal!: AbortSignal
 const original = vi.mocked(callArkme).getMockImplementation()!
 vi.mocked(callArkme).mockImplementation(async (op,args,signal) => {
  if (op === 'arko.search') return { items: [match], hasMore: false, scanned: 1, consistency: 'live' } as never
  if (op === 'arko.context') { locationSignal=signal!; return await new Promise(resolve => { finish=resolve }) as never }
  return original(op,args,signal)
 })
 await click('[aria-label="搜索 Arko 对话"]'); await enterQuery('old intent')
 await click('[data-arko-search-hit]')
 expect(host.textContent).toContain('取消定位')
 await enterQuery('new intent')
 expect(locationSignal.aborted).toBe(true)
 await act(async () => finish(window))
 expect(locate).not.toHaveBeenCalled()
 expect(host.textContent).not.toContain('正在定位原消息')
})

it('shows live export counts, resets each attempt, and ignores cancelled progress/results', async () => {
 let report!: (value: {count:number}) => void, finish!: (value: never) => void, passed!: AbortSignal
 vi.mocked(ArkmeSdk.prototype.arkoExport).mockImplementation((signal,onProgress) => {passed=signal!;report=onProgress!;return new Promise(resolve=>{finish=resolve})})
 await openMenu();await menuItem('导出')
 await act(async()=>report({count:123}))
 expect(host.textContent).toContain('已读取 123 条')
 const cancel=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='取消')!
 await act(async()=>cancel.click())
 expect(passed.aborted).toBe(true)
 await act(async()=>{report({count:999});finish({fileRef:'late',count:999} as never)})
 expect(host.textContent).toContain('已取消导出')
 expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
 await openMenu();await menuItem('导出')
 expect(host.textContent).toContain('已读取 0 条')
})
it('deduplicates live search identities even when expiring locators change across pages',async()=>{
 let calls=0
 vi.mocked(callArkme).mockImplementation(async op=>{
  if(op!=='arko.search')throw new Error('unexpected')
  calls++
  return {items:[{...match,messageRef:`locator-${calls}`}],hasMore:calls<2,nextCursor:calls<2?'next':undefined,scanned:500,consistency:'live'} as never
 })
 await click('[aria-label="搜索 Arko 对话"]');await enterQuery('目标')
 expect(calls).toBe(2)
 expect(host.querySelectorAll('[data-arko-search-hit]')).toHaveLength(1)
 expect(host.querySelector('[data-arko-search-hit]')?.getAttribute('data-arko-search-hit')).toBe('locator-2')
})
it('keeps the original three-line rich-text search preview',async()=>{
 vi.mocked(callArkme).mockResolvedValue({items:[{...match,snippet:'# 标题 **目标**'}],hasMore:false,scanned:1,consistency:'live'} as never)
 await click('[aria-label="搜索 Arko 对话"]');await enterQuery('目标')
 const hit=host.querySelector('[data-arko-search-hit]')!
 expect(hit.textContent).toContain('标题 目标')
 expect(hit.textContent).not.toContain('**')
 expect(hit.querySelector('span[style*="line-clamp"]')).not.toBeNull()
})
