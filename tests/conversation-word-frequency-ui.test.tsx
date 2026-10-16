// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import type { ConversationWordsState } from '../src/conversation-word-frequency.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), locate: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call, ArkmeClientError: class extends Error {} }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: { showConversationTarget: mocks.locate } }))
import { ConversationAnalysisPanel } from '../src/client/statistics/ConversationAnalysis.js'
const source: ArkmeSourceItem = { sourceRef: 'signed', sourceKey: 'chat1', kind: 'private_chat', displayName: '周鹏', activeAtMillis: 1, unreadCount: 0 }
const state: ConversationWordsState = { supported: true, stale: false, job: null, result: { id: 'r1', updatedAt: 100, fromAt: 10, toAt: 100, analyzedMessages: 8, eligibleMessages: 10, excludedMessages: 2, voiceTranscriptMessages: 1,
  words: [{ key: 'w1', text: '工作', count: 6, messageCount: 3 }, { key: 'w2', text: '录音', count: 12, messageCount: 4 }] } }
let root: Root, host: HTMLDivElement
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(x => (x.getAttribute('aria-label') ?? x.textContent) === name)!
const render = async (props = {}) => act(async () => { root.render(<ConversationAnalysisPanel source={source} accountScope="prod:7" refreshRevision="0" onClose={() => {}} {...props} />); await tick() })
const click = async (name: string) => act(async () => { expect(button(name), name).toBeDefined(); button(name).click(); await tick() })
const select = async (name: string, value: string) => act(async () => { const el = host.querySelector<HTMLSelectElement>(`[aria-label="${name}"]`)!; el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); await tick() })
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); sessionStorage.clear(); mocks.call.mockReset(); mocks.locate.mockReset(); mocks.call.mockResolvedValue(state) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('defaults to full conversation history, cloud first, with distinct counts', async () => {
  await render()
  expect(mocks.call).toHaveBeenCalledWith('chat.word-frequency.state', expect.objectContaining({ fromDate: null, toDate: null, sender: 'all', sourceRef: 'signed' }), expect.any(AbortSignal))
  expect([...host.querySelectorAll('.cw-cloud button')].map(x => x.textContent)).toEqual(['录音12', '工作6'])
  expect(host.textContent).toContain('已统计 8 / 10 条可分析消息')
  expect(host.textContent).toContain('语音转写，未经原音核验')
  await click('查看列表')
  expect(host.querySelector('.cw-list')?.textContent).toContain('涉及 3 条消息')
})
it('keeps private sender scopes separate and clears old results during slow reads', async () => {
  await render()
  let resolve!: (v: ConversationWordsState) => void
  mocks.call.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await click('我')
  expect(host.querySelector('.cw-cloud')).toBeNull()
  expect(mocks.call).toHaveBeenLastCalledWith('chat.word-frequency.state', expect.objectContaining({ sender: 'self' }), expect.any(AbortSignal))
  const oldSignal = mocks.call.mock.calls.at(-1)![2] as AbortSignal
  await click('周鹏')
  expect(oldSignal.aborted).toBe(true)
  expect(mocks.call).toHaveBeenLastCalledWith('chat.word-frequency.state', expect.objectContaining({ sender: 'peer' }), expect.any(AbortSignal))
  await act(async () => { resolve({ ...state, result: { ...state.result!, words: [{ key: 'wrong', text: '旧筛选', count: 1, messageCount: 1 }] } }); await tick() })
  expect(host.textContent).not.toContain('旧筛选')
})
it('changes time range without narrowing to loaded message pages', async () => {
  await render(); await select('分析时间范围', 'month')
  const q = mocks.call.mock.calls.at(-1)![1]
  expect(q.fromDate).toMatch(/^\d{4}-\d{2}-01$/)
  expect(q.toDate > q.fromDate).toBe(true)
  expect(q.sender).toBe('all')
  await select('分析时间范围', 'all')
  expect(mocks.call.mock.calls.at(-1)![1]).toMatchObject({ fromDate: null, toDate: null })
})
it('has an honest unsupported state with no fabricated cloud or writable action', async () => {
  mocks.call.mockResolvedValue({ supported: false, stale: false, result: null, job: null })
  await render()
  expect(host.textContent).toContain('对话词频服务尚未接通')
  expect(button('开始分析').disabled).toBe(true)
  expect(host.querySelector('.cw-cloud')).toBeNull()
})
it('selects departed historical group senders and can return to all or self', async () => {
  vi.useFakeTimers()
  mocks.call.mockImplementation(async op => op.endsWith('.participants') ? { items: [{ ref: 'former', name: '小林', isSelf: false, former: true }], nextCursor: null } : state)
  await render({ source: { ...source, kind: 'group_chat', displayName: '项目群' } })
  await click('全部人 ▾')
  await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  expect(host.textContent).toContain('小林 · 已离开')
  await click('小林 · 已离开')
  expect(mocks.call).toHaveBeenLastCalledWith('chat.word-frequency.state', expect.objectContaining({ sender: 'former' }), expect.any(AbortSignal))
  await click('小林 ▾'); await click('我')
  expect(mocks.call).toHaveBeenLastCalledWith('chat.word-frequency.state', expect.objectContaining({ sender: 'self' }), expect.any(AbortSignal))
  await click('我 ▾'); await click('全部人')
  expect(mocks.call).toHaveBeenLastCalledWith('chat.word-frequency.state', expect.objectContaining({ sender: 'all' }), expect.any(AbortSignal))
})
it('opens exact word messages and navigates with a freshly authorized source', async () => {
  const close = vi.fn()
  mocks.call.mockImplementation(async op => op.endsWith('.state') ? state : op.endsWith('.source') ? { messageUid: 'm1', sendAtMillis: 100 } : { items: [{ key: 'm1', senderName: '周鹏', text: '工作工作', count: 2, sentAt: 100, basis: 'text', sourceRef: 'opaque' }], total: 1, nextCursor: null })
  await render({ onClose: close }); await click('工作，6 次')
  expect(mocks.call).toHaveBeenCalledWith('chat.word-frequency.messages', expect.objectContaining({ resultId: 'r1', wordKey: 'w1', sender: 'all' }), expect.any(AbortSignal))
  expect(host.textContent).toContain('工作工作')
  await click('定位消息')
  expect(mocks.call).toHaveBeenLastCalledWith('chat.word-frequency.source', expect.objectContaining({ messageSourceRef: 'opaque', resultId: 'r1', sourceRef: 'signed' }), expect.any(AbortSignal))
  expect(close).toHaveBeenCalledOnce()
  expect(mocks.locate).toHaveBeenCalledWith(source, 'm1', 100)
})
it('preserves source errors without erroneously retrying message pagination', async () => {
  mocks.call.mockImplementation(async op => { if (op.endsWith('.source')) throw new Error('原消息不可查看'); return op.endsWith('.state') ? state : { items: [{ key: 'm', senderName: '我', text: '工作', count: 1, sentAt: 100, basis: 'text', sourceRef: 'x' }], total: 1, nextCursor: null } })
  await render(); await click('工作，6 次'); await click('定位消息')
  expect(host.textContent).toContain('原消息不可查看')
  expect(button('重试')).toBeUndefined()
  expect(mocks.locate).not.toHaveBeenCalled()
})
it('reuses unknown create request across close and reopen; never auto starts', async () => {
  mocks.call.mockImplementation(async op => { if (op.endsWith('.create')) throw new Error('network'); return state })
  await render()
  expect(mocks.call.mock.calls.every(c => c[0].endsWith('.state'))).toBe(true)
  await click('更新统计')
  const id = mocks.call.mock.calls.find(c => c[0].endsWith('.create'))![1].requestId
  await act(async () => { root.render(null); await tick() }); await render(); await click('核对提交')
  expect(mocks.call.mock.calls.filter(c => c[0].endsWith('.create')).map(c => c[1].requestId)).toEqual([id, id])
})
it('aborts pending read on close and ignores its late result', async () => {
  let resolve!: (v: ConversationWordsState) => void
  mocks.call.mockImplementation(() => new Promise(done => { resolve = done })); await render()
  const signal = mocks.call.mock.calls[0]![2] as AbortSignal
  await act(async () => { root.render(null); await tick() })
  expect(signal.aborted).toBe(true)
  await act(async () => { resolve(state); await tick() })
  expect(host.textContent).toBe('')
})
