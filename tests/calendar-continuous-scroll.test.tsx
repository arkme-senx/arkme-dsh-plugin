// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeCalendarMultiMonthView } from '../src/client/ArkmeCalendarSurface.js'
import { jumpCalendarMonth, visibleCalendarMonth } from './helpers/calendar-navigation.js'

const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: api.call, ArkmeClientError: class extends Error {} }))
let host: HTMLDivElement, root: Root
const select = vi.fn()
const date = (key: string) => new Date(`${key}T00:00:00`)
const today = date('2026-09-18')
const index = { loading: false, error: '', retry: vi.fn(), value: {
  scope: 'group_chat' as const, startDate: '2024-01-01', endDate: '2026-09-18', timezone: 'Asia/Shanghai',
  refreshedAtMillis: Date.now(), totalDayCount: 3, days: [
    { bucketDate: '2024-01-01', count: 1, hasRecords: true, protectedCount: 0 },
    { bucketDate: '2026-08-12', count: 44, hasRecords: true, protectedCount: 0 },
    { bucketDate: '2026-09-01', count: 3, hasRecords: true, protectedCount: 0 },
  ],
} }
const months = () => [...host.querySelectorAll<HTMLElement>('[data-calendar-month]')]
const monthKeys = () => months().map(el => el.dataset.calendarMonth)
const visibleMonth = () => visibleCalendarMonth(host)
const scroller = () => host.querySelector<HTMLDivElement>('[data-arkme-calendar-months]')!
const rectangle = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 350, width: 350, x: 0, y: top, toJSON: () => ({}) })
const geometry = () => {
  const el = scroller()
  Object.defineProperties(el, {
    clientHeight: { configurable: true, value: 370 },
    scrollHeight: { configurable: true, get: () => months().length * 300 + 30 },
  })
  el.getBoundingClientRect = () => rectangle(100, 370)
  for (const section of months()) section.getBoundingClientRect = () => rectangle(130 + months().indexOf(section) * 300 - el.scrollTop, 300)
}
const render = async (selected = '2026-08-12') => {
  await act(async () => root.render(<ArkmeCalendarMultiMonthView today={today} selectedDate={date(selected)}
    timezone="Asia/Shanghai" index={index} onSelect={select} />))
  geometry()
}
const scrollTo = async (top: number) => {
  await act(async () => {
    scroller().dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    scroller().scrollTop = top
    scroller().dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  geometry()
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  select.mockClear(); api.call.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('opening August includes populated September below it without changing the reading selection', async () => {
  await render()
  expect(monthKeys()).toEqual(['2026-07', '2026-08', '2026-09'])
  expect(visibleMonth()).toBe('2026-08')
  expect(host.querySelector('header')).toBeNull()
  expect(host.querySelector('[aria-label="上个月"]')).toBeNull()
  expect(host.querySelector<HTMLButtonElement>('[aria-label="2026-09-01 3 条记录"]')?.disabled).toBe(false)
  expect(host.querySelector('[data-calendar-date="2026-08-12"]')?.getAttribute('data-selected')).toBe('true')
  expect(api.call).not.toHaveBeenCalled()
})

it('scrolling into September tracks visible months but neither selects a date nor navigates messages', async () => {
  await render()
  await scrollTo(scroller().scrollHeight - scroller().clientHeight)
  expect(visibleMonth()).toBe('2026-09')
  expect(host.querySelector('[aria-label="下个月"]')).toBeNull()
  expect(host.querySelector('[data-calendar-date="2026-08-12"]')?.getAttribute('data-selected')).toBe('true')
  expect(select).not.toHaveBeenCalled()
  await scrollTo(300)
  expect(visibleMonth()).toBe('2026-08')
})

it('previous-month navigation preserves newer months and browsing does not reset after count refresh', async () => {
  await render()
  await jumpCalendarMonth(host, '2026-07')
  expect(visibleMonth()).toBe('2026-07')
  expect(monthKeys()).toContain('2026-09')
  await render()
  expect(visibleMonth()).toBe('2026-07')
  expect(select).not.toHaveBeenCalled()
})

it('extends old history towards the present in small batches without moving the scroll position', async () => {
  await render('2024-01-01')
  expect(monthKeys()).toEqual(['2024-01', '2024-02'])
  const oldTop = scroller().scrollHeight - scroller().clientHeight
  await scrollTo(oldTop)
  expect(monthKeys()).toEqual(['2024-01', '2024-02', '2024-03', '2024-04', '2024-05'])
  expect(scroller().scrollTop).toBe(oldTop)
  expect(visibleMonth()).toBe('2024-02')
  for (let pass = 0; pass < 12 && monthKeys().at(-1) !== '2026-09'; pass++) {
    await scrollTo(scroller().scrollHeight - scroller().clientHeight)
  }
  expect(monthKeys().at(-1)).toBe('2026-09')
  expect(monthKeys()).not.toContain('2026-10')
  expect(select).not.toHaveBeenCalled()
  expect(api.call).not.toHaveBeenCalled()
})

it('prepending older months preserves the visible content instead of jumping to the beginning', async () => {
  await render()
  const oldHeight = scroller().scrollHeight
  await scrollTo(10)
  expect(monthKeys()[0]).toBe('2026-04')
  expect(monthKeys().at(-1)).toBe('2026-09')
  expect(scroller().scrollTop).toBe(10 + scroller().scrollHeight - oldHeight)
  expect(visibleMonth()).toBe('2026-07')
})

it('month picker jumps to a bounded window with a newer neighbour rather than terminating at its target', async () => {
  await render()
  await jumpCalendarMonth(host, '2024-06')
  expect(visibleMonth()).toBe('2024-06')
  expect(monthKeys()).toEqual(['2024-05', '2024-06', '2024-07'])
  expect(select).not.toHaveBeenCalled()
})
