// @vitest-environment jsdom
import { act, createRef, useRef } from 'react'
import { useModalLayer } from '@deepseek-ai/dsh-client-ui-primitives'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmePointsHistoryDialog } from '../src/client/ArkmePointsHistoryDialog.js'
import { connectArkmeLocale } from '../src/client/locale.js'
import { aiPointsPeriods, type ArkmeAiPointsStatisticsQuery } from '../src/ai-points-statistics.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/read-intent-visibility.js', () => ({ suspendArkmeVisibleReadIntent: () => () => {} }))
let root: Root, host: HTMLDivElement
const row = { businessCode: 'arkme', requestUid: 'one', model: 'DeepSeek Pro', chargedPoints: '1', modelPoints: '1', services: [], grantedPoints: '0.5', purchasedPoints: '0.5', createdAt: Date.parse('2026-11-04T00:00:00Z'), completedAt: Date.parse('2026-11-04T00:00:01Z'), tokens: { cacheHitInput: '0', cacheMissInput: '0', output: '0' } }
function response(params: Record<string, any>) {
  const has = params.expectedAccountScope !== 'prod:22' && row.createdAt >= Date.parse(`${params.fromDate}T00:00:00+08:00`) && row.createdAt < Date.parse(`${params.untilDate}T00:00:00+08:00`)
  return { accountScope: params.expectedAccountScope, unit: 'ai_points', fromDate: params.fromDate, untilDate: params.untilDate, observedAt: params.settledBefore, chargedPoints: has ? '1' : '0', items: has ? [row] : [], nextBeforeId: '' }
}
const dispatch = async (operation: string,params:Record<string,any>) => operation === 'account.points.statistics' ? summary(params) : response(params)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T09:00:00Z'))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  connectArkmeLocale({ getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  mocks.call.mockReset().mockImplementation(dispatch)
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
  expect(mocks.call.mock.calls.map(([op]) => op)).toEqual(['account.points.statistics'])
  expect(document.querySelector('.arkme-points-history-selection')?.textContent).toContain('11/4 · 1 积分')
  const reads = mocks.call.mock.calls.length
  await click('查看DSH 对话消费明细')
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('明细')
  expect(document.querySelector('.arkme-points-history-filter')?.textContent).toBe('DSH 对话')
  expect(document.querySelector('summary strong')?.textContent).toBe('DSH 对话')
  expect(document.querySelector('.arkme-points-call')?.textContent).toContain('赠送 0.5 · 充值 0.5')
  expect(mocks.call).toHaveBeenCalledTimes(reads + 1)
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

it('keeps Escape owned by the points dialog after a type trigger unmounts and focus reaches the body', async () => {
  const parentClose = vi.fn(), childClose = vi.fn()
  function Parent({ open }: { open: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    useModalLayer(ref, true, parentClose)
    return <div role="dialog" aria-modal="true" ref={ref}>{open && <ArkmePointsHistoryDialog scope="prod:11" revision={0} onClose={childClose} />}</div>
  }
  await act(async () => root.render(<Parent open={false} />))
  await act(async () => root.render(<Parent open />))
  await click('查看DSH 对话消费明细')
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  await act(async () => document.body.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(true)
  expect(childClose).toHaveBeenCalledOnce()
  expect(parentClose).not.toHaveBeenCalled()
})

it('cancels account-scoped reads and discards delayed previous-account responses', async () => {
  const releases: (() => void)[] = [], signals: AbortSignal[] = []
  mocks.call.mockImplementation((_op, params, signal) => { signals.push(signal); return new Promise(resolve => releases.push(() => resolve(response(params)))) })
  await render()
  mocks.call.mockImplementation(dispatch)
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
  mocks.call.mockImplementation(dispatch)
  await click('重试'); expect(document.querySelector('.arkme-points-history-overview strong')?.textContent).toBe('1 积分')
})

function summary(params: Record<string, unknown>) {
  const query = { fromDate: params.fromDate, untilDate: params.untilDate, timezone: params.timezone, grain: params.grain } as ArkmeAiPointsStatisticsQuery
  const buckets = aiPointsPeriods(query).map(period => {
    const has = params.expectedAccountScope !== 'prod:22' && row.createdAt >= Date.parse(`${period.fromDate}T00:00:00+08:00`) && row.createdAt < Date.parse(`${period.untilDate}T00:00:00+08:00`)
    return { ...period, chargedPoints: has ? '1' : '0', types: has ? [{ businessCode: 'arkme', chargedPoints: '1' }] : [] }
  })
  return { accountScope: params.expectedAccountScope, unit: 'ai_points', query, buckets, chargedPoints: buckets.some(bucket => bucket.chargedPoints === '1') ? '1' : '0', observedAt: Date.now() }
}
it('opens statistics with one aggregate request and fetches only the selected type on entering details', async () => {
  mocks.call.mockImplementation(async (operation, params) => {
    if (operation === 'account.points.statistics') return summary(params)
    if (operation === 'account.points.consumption.range') return { accountScope: params.expectedAccountScope, unit: 'ai_points', fromDate: params.fromDate, untilDate: params.untilDate, observedAt: params.settledBefore, chargedPoints: '1', items: [row], nextBeforeId: '' }
    throw new Error('legacy statement scan was not expected')
  })
  await render()
  expect(mocks.call.mock.calls.map(([operation]) => operation)).toEqual(['account.points.statistics'])
  expect(document.querySelectorAll('.arkme-points-history-columns > button')).toHaveLength(15)
  await click('查看DSH 对话消费明细')
  expect(mocks.call.mock.calls.map(([operation]) => operation)).toEqual(['account.points.statistics', 'account.points.consumption.range'])
  expect(mocks.call.mock.calls.at(-1)?.[1]).toMatchObject({ fromDate: '2026-11-04', untilDate: '2026-11-05', businessCodes: ['arkme'], limit: 20, settledBefore: Date.now() })
  expect(document.querySelectorAll('details')).toHaveLength(1)
  await click('统计')
  await act(async () => document.querySelector<HTMLButtonElement>('.arkme-points-history-columns > button')!.click())
  expect(mocks.call).toHaveBeenCalledTimes(2)
  expect(document.querySelector('.arkme-points-history-selection')?.textContent).toContain('0 积分')
})
it('refuses to combine a changed detail total with its statistical snapshot', async () => {
  mocks.call.mockImplementation(async (operation, params) => operation === 'account.points.statistics' ? summary(params)
    : { accountScope: params.expectedAccountScope, unit: 'ai_points', fromDate: params.fromDate, untilDate: params.untilDate, observedAt: params.settledBefore, chargedPoints: '2', items: [row], nextBeforeId: '' })
  await render(); await click('查看DSH 对话消费明细')
  expect(document.querySelectorAll('details')).toHaveLength(0)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('账单已更新')
})

it.each(['complete', 'duplicate', 'missing'] as const)('checks the full amount and identity across detail pages: %s', async mode => {
  mocks.call.mockImplementation(async (operation, params) => {
    if (operation === 'account.points.statistics') return summary(params)
    const last = Boolean(params.beforeId)
    return { accountScope: params.expectedAccountScope, unit: 'ai_points', fromDate: params.fromDate, untilDate: params.untilDate,
      observedAt: params.settledBefore, chargedPoints: '1', nextBeforeId: last ? '' : '100',
      items: last && mode === 'missing' ? [] : [{ ...row, requestUid: last && mode !== 'duplicate' ? 'two' : 'one', chargedPoints: '0.5', modelPoints: '0.5', grantedPoints: '0', purchasedPoints: '0.5' }] }
  })
  await render(); await click('明细')
  expect(document.querySelectorAll('details')).toHaveLength(1)
  await click('加载更多')
  expect(mocks.call.mock.calls.at(-1)?.[1]).toMatchObject({ beforeId: '100', settledBefore: Date.now() })
  if (mode === 'complete') expect(document.querySelectorAll('details')).toHaveLength(2)
  else {
    expect(document.querySelectorAll('details')).toHaveLength(0)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('账单已更新')
  }
})

it('cancels a pending aggregate detail request when leaving the detail tab', async () => {
  let signal: AbortSignal | undefined, release: (() => void) | undefined
  mocks.call.mockImplementation(async (operation, params, requestSignal) => {
    if (operation === 'account.points.statistics') return summary(params)
    signal = requestSignal
    return await new Promise(resolve => { release = () => resolve({ accountScope: params.expectedAccountScope, unit: 'ai_points', fromDate: params.fromDate, untilDate: params.untilDate, observedAt: params.settledBefore, chargedPoints: '1', items: [row], nextBeforeId: '' }) })
  })
  await render(); await click('明细'); expect(signal?.aborted).toBe(false)
  await click('统计'); expect(signal?.aborted).toBe(true)
  await act(async () => release?.())
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('统计')
  expect(document.querySelectorAll('details')).toHaveLength(0)
})
