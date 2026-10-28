// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import type { ConversationActivityState } from '../src/conversation-activity.js'
import { result } from './fixtures/conversation-activity.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), locate: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call, ArkmeClientError: class extends Error {} }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: { showConversationTarget: mocks.locate } }))
import { ConversationAnalysisPanel } from '../src/client/statistics/ConversationAnalysis.js'
const source: ArkmeSourceItem = { sourceRef: 'signed', sourceKey: 'chat1', kind: 'private_chat', displayName: '周鹏', activeAtMillis: 1, unreadCount: 0 }
const wordsMissing = { supported: false, stale: false, result: null, job: null }
const state: ConversationActivityState = { supported: true, stale: false, result, progress: null }
let root: Root, host: HTMLDivElement
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(x => (x.getAttribute('aria-label') ?? x.textContent) === name)!
const click = async (name: string) => act(async () => { expect(button(name), name).toBeDefined(); button(name).click(); await tick() })
const render = async (props = {}) => act(async () => { root.render(<ConversationAnalysisPanel source={source} accountScope="prod:7" refreshRevision="0" onClose={() => {}} {...props}/>); await tick() })
const open = async (props = {}) => { await render(props); await click('活跃时间') }
const chooseRange = async (value: string) => act(async () => { const el = host.querySelector<HTMLSelectElement>('[aria-label="分析时间范围"]')!; el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); await tick() })
const fill = async (name: string, value: string) => act(async () => { const el = host.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); await tick() })
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); sessionStorage.clear(); mocks.call.mockReset(); mocks.locate.mockReset(); mocks.call.mockImplementation(async op => op.startsWith('chat.activity.') ? state : wordsMissing) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('opens activity independently of unavailable words, defaults all history/all senders', async () => {
  await open()
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('活跃时间')
  expect(mocks.call).toHaveBeenLastCalledWith('chat.activity.read', expect.objectContaining({ sourceRef: 'signed', sender: 'all', fromDate: null, toDate: null }), expect.any(AbortSignal))
  expect([...host.querySelectorAll('.ca-metrics strong')].map(x => x.textContent)).toEqual(['15', '2', '2'])
  expect(host.querySelectorAll('.ca-bar')).toHaveLength(24)
  expect(host.textContent).toContain('含系统通知 3 条')
  expect(host.textContent).not.toContain('词频服务尚未接通')
  expect(mocks.call.mock.calls.every(c => !c[0].endsWith('.create'))).toBe(true)
})
it('shows hourly counts/percentages on hover and a full 7x24 weekly heatmap', async () => {
  await open()
  const bin = [...host.querySelectorAll<HTMLButtonElement>('.ca-bar')][9]!
  await act(async () => { bin.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await tick() })
  expect(host.querySelector('.ca-hint')?.textContent).toContain('10 条消息 · 66.7% · 2 人 · 系统通知 2 条')
  expect(host.textContent).toContain('最活跃时段：09:00–10:00')
  await click('一周内')
  expect(host.querySelectorAll('.ca-cell')).toHaveLength(168)
  expect(host.querySelector('.ca-peak')?.textContent).toContain('周二 09:00–10:00')
  expect([...host.querySelectorAll<HTMLButtonElement>('.ca-cell')].filter(b => !b.disabled)).toHaveLength(2)
})
it('retains textless media in bucket details and navigates to the original message', async () => {
  const close = vi.fn()
  mocks.call.mockImplementation(async op => op === 'chat.activity.read' ? state : op === 'chat.activity.messages' ? { items: [{ key: 'm1', sourceRef: 'opaque', senderName: '周鹏', preview: '', sentAt: result.fromAt, kind: 'image' }], total: 1, nextCursor: null } : op === 'chat.activity.source' ? { messageUid: 'm1', sendAtMillis: result.fromAt, recordOwnerUserId: 1001 } : wordsMissing)
  await open({ onClose: close }); await click('一周内')
  await act(async () => { host.querySelector<HTMLButtonElement>('.ca-cell:not(:disabled)')!.click(); await tick() })
  expect(mocks.call).toHaveBeenLastCalledWith('chat.activity.messages', expect.objectContaining({ resultId: 'a1', hour: 9, weekday: 2 }), expect.any(AbortSignal))
  expect(host.textContent).toContain('[图片]')
  await click('定位消息')
  expect(mocks.call).toHaveBeenLastCalledWith('chat.activity.source', expect.objectContaining({ resultId: 'a1', hour: 9, weekday: 2, messageSourceRef: 'opaque' }), expect.any(AbortSignal))
  expect(mocks.locate).toHaveBeenCalledWith(source, 'm1', result.fromAt, 1001)
  expect(close).toHaveBeenCalledOnce()
})
it('supports historical group senders through the activity owner and retains enabled picker on same-tab click', async () => {
  vi.useFakeTimers()
  mocks.call.mockImplementation(async op => op === 'chat.activity.participants' ? { items: [{ ref: 'p1', name: '小林', former: true, isSelf: false }], nextCursor: null } : op === 'chat.activity.read' ? state : wordsMissing)
  await open({ source: { ...source, kind: 'group_chat', displayName: '项目群' } })
  await click('活跃时间')
  expect(button('全部人 ▾').disabled).toBe(false)
  await click('全部人 ▾'); await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  await click('小林 · 已离开')
  expect(mocks.call).toHaveBeenLastCalledWith('chat.activity.read', expect.objectContaining({ sender: 'p1' }), expect.any(AbortSignal))
  expect(mocks.call.mock.calls.some(c => c[0] === 'chat.word-frequency.participants')).toBe(false)
})
it('shares the chosen sender and date range between tabs but never their result data', async () => {
  await open(); await click('我'); await chooseRange('month')
  const q = mocks.call.mock.calls.at(-1)![1]
  await click('词频')
  expect(mocks.call).toHaveBeenLastCalledWith('chat.word-frequency.state', q, expect.any(AbortSignal))
  expect(host.querySelector('.ca-metrics')).toBeNull()
  expect(host.textContent).toContain('对话词频服务尚未接通')
})
it('applies custom dates explicitly and preserves the edited value', async () => {
  await open(); await chooseRange('custom')
  const before = mocks.call.mock.calls.length
  await fill('分析开始日期', '2026-10-01')
  expect(host.textContent).toContain('日期更改尚未应用')
  expect(mocks.call.mock.calls.length).toBe(before)
  await click('应用')
  expect(mocks.call).toHaveBeenLastCalledWith('chat.activity.read', expect.objectContaining({ fromDate: '2026-10-01' }), expect.any(AbortSignal))
  expect(host.textContent).not.toContain('日期更改尚未应用')
})
it('clears old results when selecting a person and ignores a late response after another filter', async () => {
  await open()
  let resolve!: (v: ConversationActivityState) => void
  mocks.call.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await click('我'); const signal = mocks.call.mock.calls.at(-1)![2] as AbortSignal
  expect(host.querySelector('.ca-metrics')).toBeNull()
  await click('周鹏'); expect(signal.aborted).toBe(true)
  await act(async () => { resolve({ ...state, result: { ...result, totalMessages: 999 } }); await tick() })
  expect(host.querySelector('.ca-metrics')?.textContent).not.toContain('999')
})
it('shows unsupported distinctly from empty counts and allows word tab to work separately', async () => {
  mocks.call.mockImplementation(async op => op === 'chat.activity.read' ? { supported: false, stale: false, result: null, progress: null } : wordsMissing)
  await open()
  expect(host.textContent).toContain('会话活跃时间服务尚未接通')
  expect(host.querySelector('.ca-bars')).toBeNull()
  expect(host.querySelector('.ca-metrics')).toBeNull()
})
it('polls indexing progress while visible, stops on errors, and aborts on tab switch', async () => {
  vi.useFakeTimers()
  mocks.call.mockImplementation(async op => op === 'chat.activity.read' ? { ...state, result: null, progress: { completed: 20, total: 100 } } : wordsMissing)
  await open(); expect(host.textContent).toContain('正在整理历史消息 · 20 / 100')
  const count = mocks.call.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(mocks.call.mock.calls.length).toBe(count + 1)
  let resolve!: (v: ConversationActivityState) => void
  mocks.call.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await click('刷新统计'); const signal = mocks.call.mock.calls.at(-1)![2] as AbortSignal
  await click('词频'); expect(signal.aborted).toBe(true)
  await act(async () => { resolve(state); await tick() })
  expect(host.querySelector('.ca-metrics')).toBeNull()
})
it('shows an explicit zero result without inventing a busiest hour', async () => {
  mocks.call.mockImplementation(async op => op === 'chat.activity.read' ? { ...state, result: { ...result, totalMessages: 0, activeDays: 0, systemMessages: 0, participants: 0, fromAt: null, toAt: null, hourly: [], weekly: [] } } : wordsMissing)
  await open()
  expect(host.textContent).toContain('此范围暂无消息活动')
  expect(host.textContent).not.toContain('最活跃时段')
})

it('uses the existing system notification source action with no invented record owner', async () => {
  mocks.call.mockImplementation(async op => op === 'chat.activity.read' ? state : op === 'chat.activity.messages' ? { items: [{ key: 'system', sourceRef: 'opaque', senderName: '系统通知', preview: '群聊已创建', sentAt: result.fromAt, kind: 'system' }], total: 1, nextCursor: null } : op === 'chat.activity.source' ? { messageUid: 'chat-event:signed-system', sendAtMillis: result.fromAt, systemRef: 'opaque-system-anchor' } : wordsMissing)
  await open(); await act(async () => { host.querySelector<HTMLButtonElement>('.ca-bar:not(:disabled)')!.click(); await tick() })
  await click('定位消息')
  expect(mocks.locate).toHaveBeenCalledWith(source, 'chat-event:signed-system', result.fromAt, undefined, undefined, false, false, undefined, 'opaque-system-anchor')
})
