// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import type { TeamConversation } from '../src/team-app-contract.js'
const mock = vi.hoisted(() => ({ call: vi.fn(), navigate: vi.fn(), manage: vi.fn(), prepare: vi.fn(), play: vi.fn(), cancel: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: { showConversationTarget: mock.navigate, showArrangements: mock.manage } }))
vi.mock('../src/client/arrangement-completion-sound.js', () => ({ prepareArrangementCompletionSound: mock.prepare }))
import { ArkmeConversationArrangements } from '../src/client/ArkmeConversationArrangements.js'
const source = { sourceRef: 'source-a', sourceKey: 'chat-a', kind: 'group_chat', displayName: '硬件项目组' } as ArkmeSourceItem
const item = { id: 'event-a', relatedRef: 'personal-ref', arrangementRef: 'owned-ref', title: '周五15:00到研发会议室和李工确认样机', description: '带测试结果', status: 'following',
  reminderEnabled: false, reminderState: '', createdAtMillis: 1000, updatedAtMillis: 1000,
  sources: [{ itemUid: 'record-a', recordOwnerUserId: 11, sender: '李工', sendAtMillis: 1000, text: '周五下午三点，到研发会议室确认样机。' }] }
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); mock.call.mockReset(); mock.navigate.mockReset(); mock.manage.mockReset()
  localStorage.clear(); mock.play.mockReset(); mock.cancel.mockReset(); mock.prepare.mockReset().mockImplementation(() => ({ play: mock.play, cancel: mock.cancel }))
  host = document.createElement('div'); host.setAttribute('data-arkme-active-conversation-identity', 'chat-a'); document.body.append(host)
  root = createRoot(host)
  mock.call.mockImplementation(async (operation: string) => operation.endsWith('.detail') ? item
    : operation === 'arrangements.occurrences.events' ? { state: 'ready', events: [] } : { items: [item], hasMore: false, nextCursor: '' })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })
async function render(account = 'prod:12') { await act(async () => root.render(<ArkmeConversationArrangements source={source} accountScope={account} active refreshRevision={0} />)); await act(async () => { await vi.advanceTimersByTimeAsync(260) }) }
async function click(text: string) { const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text)); expect(button).toBeTruthy(); await act(async () => button!.click()) }
it.each(['team','external'] as const)('uses the same list for the %s side of a team conversation',async side=>{
  const team={ref:'opaque-team-conversation',key:'team-key',side,channel:{name:'设计工作室'},visitor:{nickname:'王工'}} as TeamConversation
  await act(async()=>root.render(<ArkmeConversationArrangements teamConversation={team} accountScope="prod:12" active refreshRevision={1}/>))
  await act(async()=>{await vi.advanceTimersByTimeAsync(260)})
  expect(mock.call.mock.calls.find(([op])=>op==='arrangements.conversation.list')?.[1]).toEqual({teamConversationRef:team.ref,cursor:''})
  await click('相关安排')
  expect(host.textContent).toContain('设计工作室');expect(host.textContent).toContain('仅显示我在此对话中的安排')
  expect(host.querySelector('.arkme-arrangement-completion-control')).not.toBeNull()
  await click('周五15:00');expect(document.querySelector('[aria-modal=true]')).not.toBeNull()
})
it('labels the personal scope and opens the existing arrangement detail', async () => {
  await render(); expect(host.textContent).toContain('相关安排 · 1'); await click('相关安排')
  expect(host.textContent).toContain('仅显示我在此对话中的安排')
  expect(host.textContent).toContain('带测试结果')
  await click('周五15:00'); expect(mock.manage).not.toHaveBeenCalled()
  expect(mock.call.mock.calls.some(([operation]) => operation === 'arrangements.conversation.detail')).toBe(false)
  expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull()
  expect(host.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭安排详情"]')!.click())
  expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull()
  expect(host.querySelectorAll('article')).toHaveLength(1)
})
it('uses one row action, omits duplicate descriptions and keeps counts out of filters', async () => {
  mock.call.mockResolvedValue({ items: [{ ...item, description: ` ${item.title}\n` }], hasMore: true, nextCursor: 'page-2' })
  await render(); await click('相关安排')
  const row = host.querySelector('article')!
  expect(row.querySelector('[role="checkbox"]')).not.toBeNull()
  expect(row.querySelector('.arkme-related-arrangement-description')).toBeNull()
  expect(host.textContent).not.toContain('查看详情与来源')
  expect(host.textContent).toContain('已加载1条')
  expect([...host.querySelectorAll('.arkme-related-arrangements-tabs button')].map(b => b.textContent)).toEqual(['未完成', '已完成'])
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

it('removes stale personal results after refresh', async () => {
  await render(); await click('相关安排'); expect(host.textContent).toContain(item.title)
  mock.call.mockResolvedValue({ items: [], hasMore: false, nextCursor: '' })
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  await act(async () => { await vi.advanceTimersByTimeAsync(260) })
  expect(host.textContent).not.toContain(item.title)
  expect(host.textContent).toContain('我在当前对话中暂无未完成安排')
})

it('shows skeletons only for the initial read, not over existing rows during refresh', async () => {
  let resolve: (value: unknown) => void = () => {}
  mock.call.mockImplementation(() => new Promise(done => { resolve = done }))
  await render(); await click('相关安排')
  expect(host.querySelector('.arkme-related-arrangements-skeleton')).not.toBeNull()
  await act(async () => resolve({ items: [item], hasMore: false, nextCursor: '' }))
  expect(host.querySelector('.arkme-related-arrangements-skeleton')).toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新相关安排"]')!.click())
  await act(async () => { await vi.advanceTimersByTimeAsync(260) })
  expect(host.querySelector('.arkme-related-arrangements-skeleton')).toBeNull()
  expect(host.querySelectorAll('article')).toHaveLength(1)
  expect(host.querySelector('.arkme-related-arrangements-spinning')).not.toBeNull()
  expect(host.textContent).not.toContain('正在读取相关安排')
  await act(async () => resolve({ items: [], hasMore: false, nextCursor: '' }))
  expect(host.querySelectorAll('article')).toHaveLength(0)
})

it('keeps loaded rows after a refresh failure and replaces them on successful retry', async () => {
  await render(); await click('相关安排')
  mock.call.mockRejectedValueOnce(new Error('暂时无法连接'))
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新相关安排"]')!.click())
  await act(async () => { await vi.advanceTimersByTimeAsync(260) })
  expect(host.querySelectorAll('article')).toHaveLength(1)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('刷新失败，保留上次结果')
  expect(host.textContent).toContain('相关安排 · 1')
  mock.call.mockResolvedValueOnce({ items: [], hasMore: false, nextCursor: '' })
  await click('重试')
  expect(host.querySelectorAll('article')).toHaveLength(0)
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

it('keeps earlier pages and retries the same cursor after a load-more failure', async () => {
  mock.call.mockResolvedValueOnce({ items: [item], hasMore: true, nextCursor: 'page-2' })
  await render(); await click('相关安排')
  mock.call.mockRejectedValueOnce(new Error('下一页暂不可用'))
  await click('加载更多')
  expect(host.querySelectorAll('article')).toHaveLength(1)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('下一页暂不可用')
  mock.call.mockResolvedValueOnce({ items: [{ ...item, id: 'event-b', arrangementRef: 'owned-b', title: '下周继续确认' }], hasMore: false, nextCursor: '' })
  await click('重试加载')
  expect(mock.call.mock.calls.at(-1)?.[1]).toMatchObject({ sourceRef: 'source-a', cursor: 'page-2' })
  expect(host.querySelectorAll('article')).toHaveLength(2)
  expect(host.textContent).toContain('已加载2条')
})

it('omits undated metadata and only marks unfinished past times overdue', async () => {
  const past = Date.now() - 60_000
  mock.call.mockResolvedValue({ items: [{ ...item, status: 'identified' }, { ...item, id: 'dated', arrangementRef: 'dated', dueAtMillis: past },
    { ...item, id: 'done', arrangementRef: 'done', status: 'completed', dueAtMillis: past }], hasMore: false, nextCursor: '' })
  await render(); await click('相关安排')
  expect(host.textContent).not.toContain('未定时间')
  const undated = [...host.querySelectorAll('article')].find(row => !row.querySelector('time'))!
  expect(undated.querySelector('.arkme-related-arrangement-meta')).toBeNull()
  expect(host.querySelector('time')?.getAttribute('data-overdue')).toBe('true')
  await click('已完成')
  expect(host.querySelector('time')?.getAttribute('data-overdue')).toBe('false')
})

it('keeps pagination and scroll while opening a dialog and closing it with Escape', async () => {
  mock.call.mockImplementation(async (op: string, args: { cursor?: string }) => op === 'arrangements.detail' ? item
    : op === 'arrangements.occurrences.events' ? { state: 'ready', events: [] }
      : args.cursor ? { items: [{ ...item, id: 'other', arrangementRef: 'other', title: '第二页安排' }], hasMore: false, nextCursor: '' }
        : { items: [item], hasMore: true, nextCursor: 'page-2' })
  await render(); await click('相关安排'); await click('加载更多')
  const list = host.querySelector('.arkme-related-arrangements')!.parentElement!; list.scrollTop = 160
  await click('周五15:00')
  expect(document.querySelector('[aria-modal="true"]')).not.toBeNull()
  const readsBefore = mock.call.mock.calls.filter(([op]) => op === 'arrangements.conversation.list').length
  await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(60_260) })
  expect(mock.call.mock.calls.filter(([op]) => op === 'arrangements.conversation.list')).toHaveLength(readsBefore)
  const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); document.body.append(menu)
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  expect(document.querySelector('[aria-modal="true"]')).not.toBeNull(); menu.remove()
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  expect(document.querySelector('[aria-modal="true"]')).toBeNull()
  expect(host.querySelector('.arkme-related-arrangements')!.parentElement).toBe(list)
  expect(list.scrollTop).toBe(160)
  expect(host.querySelectorAll('article')).toHaveLength(2)
  expect(mock.manage).not.toHaveBeenCalled()
})

it.each(['identified', 'following'])('completes once and undoes to the original %s status without opening detail', async status => {
  let record = { ...item, status }
  mock.call.mockImplementation(async (op: string, args: { intent?: string }) => {
    if (op === 'arrangements.detail') return { ...record }
    if (op === 'arrangements.mutate') {
      record = { ...record, status: args.intent === 'complete' ? 'completed' : args.intent === 'cancel-follow' ? 'identified' : 'following', updatedAtMillis: record.updatedAtMillis + 1 }
      return { arrangementRef: record.arrangementRef, intent: args.intent, outcome: 'confirmed', item: { ...record } }
    }
    return { items: [record], hasMore: false, nextCursor: '' }
  })
  await render(); await click('相关安排')
  await act(async () => host.querySelector<HTMLButtonElement>('article [role="checkbox"]')!.click())
  expect(document.querySelector('[aria-modal="true"]')).toBeNull()
  expect(host.querySelectorAll('article')).toHaveLength(0)
  expect(record.status).toBe('completed')
  expect(mock.prepare).toHaveBeenCalledTimes(1); expect(mock.play).toHaveBeenCalledTimes(1)
  await click('已完成'); expect(host.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true')
  await click('撤销'); expect(record.status).toBe(status)
  expect(mock.prepare).toHaveBeenCalledTimes(1); expect(mock.play).toHaveBeenCalledTimes(1)
  expect(mock.call.mock.calls.filter(([op]) => op === 'arrangements.mutate').map(([, args]) => args.intent)).toEqual(status === 'identified' ? ['complete', 'cancel-complete', 'cancel-follow'] : ['complete', 'cancel-complete'])
})

it('guards repeated completion and ignores an account switch before a pending read resolves', async () => {
  await render(); await click('相关安排')
  let resolve: (value: unknown) => void = () => {}
  mock.call.mockImplementation(() => new Promise(done => { resolve = done }))
  const checkbox = host.querySelector<HTMLButtonElement>('article [role="checkbox"]')!
  await act(async () => { checkbox.click(); checkbox.click() })
  expect(checkbox.getAttribute('aria-checked')).toBe('true'); expect(checkbox.disabled).toBe(true)
  expect(host.querySelector('article')?.getAttribute('data-completed')).toBe('true')
  expect(mock.prepare).toHaveBeenCalledTimes(1); expect(mock.play).not.toHaveBeenCalled()
  expect(mock.call.mock.calls.filter(([op]) => op === 'arrangements.detail')).toHaveLength(1)
  await render('prod:13')
  await act(async () => resolve(item))
  expect(mock.call.mock.calls.filter(([op]) => op === 'arrangements.mutate')).toHaveLength(0)
  expect(host.querySelector('article')).toBeNull()
  expect(mock.cancel).toHaveBeenCalledTimes(1); expect(mock.play).not.toHaveBeenCalled()
})

it('keeps the item on an uncertain mutation and never replays the write', async () => {
  await render(); await click('相关安排')
  mock.call.mockImplementation(async (op: string) => {
    if (op === 'arrangements.detail') return item
    if (op === 'arrangements.mutate') throw new Error('write outcome uncertain')
    return { items: [item], hasMore: false, nextCursor: '' }
  })
  await act(async () => host.querySelector<HTMLButtonElement>('article [role="checkbox"]')!.click())
  expect(host.querySelectorAll('article')).toHaveLength(1)
  expect(host.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('false')
  expect(host.querySelector('article')?.getAttribute('data-completed')).toBe('false')
  expect(mock.cancel).toHaveBeenCalledTimes(1); expect(mock.play).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('未能确认安排状态')
  expect(host.textContent).not.toContain('撤销')
  expect(mock.call.mock.calls.filter(([op]) => op === 'arrangements.mutate')).toHaveLength(1)
})

it('rejects an unrelated owner response before completion or dialog display', async () => {
  await render(); await click('相关安排')
  mock.call.mockImplementation(async (op: string) => op === 'arrangements.detail' ? { ...item, arrangementRef: 'another-owner', title: '不应展示' } : { state: 'ready', events: [] })
  await act(async () => host.querySelector<HTMLButtonElement>('article [role="checkbox"]')!.click())
  expect(mock.call.mock.calls.filter(([op]) => op === 'arrangements.mutate')).toHaveLength(0)
  await click('周五15:00')
  expect(document.querySelector('[aria-modal="true"]')?.textContent).toContain('详情加载失败')
  expect(document.querySelector('[aria-modal="true"]')?.textContent).not.toContain('不应展示')
})

it('keeps multiple loaded pages on background refresh and starts over only on manual refresh', async () => {
  mock.call.mockImplementation(async (_op: string, args: { cursor?: string }) => args.cursor
    ? { items: [{ ...item, id: 'page-2', arrangementRef: 'page-2' }], hasMore: false, nextCursor: '' }
    : { items: [item], hasMore: true, nextCursor: 'page-2' })
  await render(); await click('相关安排'); await click('加载更多')
  expect(host.querySelectorAll('article')).toHaveLength(2)
  await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(60_300) })
  expect(host.querySelectorAll('article')).toHaveLength(2)
  expect(mock.call.mock.calls.filter(([op]) => op === 'arrangements.conversation.list')).toHaveLength(2)
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新相关安排"]')!.click())
  await act(async () => { await vi.advanceTimersByTimeAsync(260) })
  expect(host.querySelectorAll('article')).toHaveLength(1)
})
