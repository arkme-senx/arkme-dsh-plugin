// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmePointsHistoryDialog } from '../src/client/ArkmePointsHistoryDialog.js'
import { connectArkmeLocale } from '../src/client/locale.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/read-intent-visibility.js', () => ({ suspendArkmeVisibleReadIntent: () => () => {} }))
let root: Root, host: HTMLDivElement
const row = { businessCode: 'arkme', requestUid: 'one', model: 'DeepSeek Pro', chargedPoints: '1', modelPoints: '1', services: [], grantedPoints: '0.5', purchasedPoints: '0.5', createdAt: Date.parse('2026-11-04T00:00:00Z'), completedAt: Date.parse('2026-11-04T00:00:01Z'), tokens: { cacheHitInput: '0', cacheMissInput: '0', output: '0' } }
const response = (params: Record<string, string>) => ({ accountScope: params.expectedAccountScope, unit: 'ai_points', month: params.month,
  chargedPoints: params.month === '2026-11' ? '1' : '0', items: params.month === '2026-11' ? [row] : [], nextBeforeId: '' })
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T09:00:00Z'))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  connectArkmeLocale({ getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  mocks.call.mockReset().mockImplementation(async (_op, params) => response(params))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const render = async (scope = 'prod:11') => { await act(async () => root.render(<ArkmePointsHistoryDialog scope={scope} revision={0} onClose={vi.fn()} />)) }
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === name || button.getAttribute('aria-label') === name)!
const click = async (name: string) => { await act(async () => button(name).click()) }

it('opens a modal in statistics with fifteen days and drills into the selected type with real charges', async () => {
  await render()
  expect(document.querySelector('dialog[open]')).not.toBeNull()
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('统计')
  expect(button('按天').getAttribute('aria-pressed')).toBe('true')
  expect(document.querySelectorAll('.arkme-points-history-columns > button')).toHaveLength(15)
  expect(mocks.call.mock.calls.every(([, params]) => params.limit === 100)).toBe(true)
  expect(document.querySelector('.arkme-points-history-selection')?.textContent).toContain('11/4 · 1 积分')
  const reads = mocks.call.mock.calls.length
  await click('查看DSH 对话消费明细')
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('明细')
  expect(document.querySelector('.arkme-points-history-filter')?.textContent).toBe('DSH 对话')
  expect(document.querySelector('summary strong')?.textContent).toBe('DSH 对话')
  expect(document.querySelector('.arkme-points-call')?.textContent).toContain('赠送 0.5 · 充值 0.5')
  expect(mocks.call).toHaveBeenCalledTimes(reads)
  await click('清除类型筛选'); expect(document.querySelector('.arkme-points-history-filter')).toBeNull()
})

it('changes grain and selected time without mixing the day totals or request cursors', async () => {
  await render(); await click('按周')
  expect(document.querySelectorAll('.arkme-points-history-columns > button')).toHaveLength(8)
  await click('按月')
  expect(document.querySelectorAll('.arkme-points-history-columns > button')).toHaveLength(12)
  await click('按天'); await click('明细')
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="明细时间范围"]')!
  await act(async () => { select.value = '2026-11-03'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(document.querySelectorAll('details')).toHaveLength(0)
  expect(select.closest('[role="tabpanel"]')?.textContent).toContain('该时段暂无积分消费')
  expect(mocks.call.mock.calls.every(([, params]) => !params.beforeId)).toBe(true)
})

it('supports tab keyboard navigation, Escape and focus restoration on unmount', async () => {
  const trigger = document.createElement('button'); document.body.append(trigger)
  const ref = createRef<HTMLElement>(); (ref as { current: HTMLElement }).current = trigger
  const close = vi.fn()
  await act(async () => root.render(<ArkmePointsHistoryDialog scope="prod:11" revision={0} onClose={close} returnFocusRef={ref} />))
  await act(async () => button('统计').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
  expect(document.activeElement?.textContent).toBe('明细')
  const event = new Event('cancel', { cancelable: true })
  await act(async () => document.querySelector('dialog')!.dispatchEvent(event))
  expect(close).toHaveBeenCalledTimes(1); expect(event.defaultPrevented).toBe(true)
  await act(async () => root.render(null)); expect(document.activeElement).toBe(trigger); trigger.remove()
})

it('cancels account-scoped reads and discards delayed previous-account responses', async () => {
  const releases: (() => void)[] = [], signals: AbortSignal[] = []
  mocks.call.mockImplementation((_op, params, signal) => { signals.push(signal); return new Promise(resolve => releases.push(() => resolve(response(params)))) })
  await render()
  mocks.call.mockImplementation(async (_op, params) => ({ ...response(params), chargedPoints: '0', items: [] }))
  await render('prod:22')
  expect(signals.every(signal => signal.aborted)).toBe(true)
  await act(async () => releases.forEach(release => release()))
  expect(document.querySelector('.arkme-points-history-overview strong')?.textContent).toBe('0 积分')
  expect(document.querySelector('.arkme-points-history-selection')?.textContent).toContain('0 积分')
})

it('keeps a failed read explicit and retries without displaying a partial total', async () => {
  mocks.call.mockRejectedValue(new Error('offline'))
  await render(); expect(document.querySelector('[role="alert"]')).not.toBeNull()
  expect(document.querySelector('.arkme-points-history-overview')).toBeNull()
  mocks.call.mockImplementation(async (_op, params) => response(params))
  await click('重试'); expect(document.querySelector('.arkme-points-history-overview strong')?.textContent).toBe('1 积分')
})
