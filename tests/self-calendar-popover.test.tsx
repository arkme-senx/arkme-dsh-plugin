// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeCalendarRecordItem } from '../src/types.js'

const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({
  callArkme: api.call,
  ArkmeClientError: class extends Error { body = { message: this.message } },
}))

import { ArkmeSelfCalendarPopover } from '../src/client/ArkmeCalendarSurface.js'
import { jumpCalendarMonth, visibleCalendarMonth } from './helpers/calendar-navigation.js'

let root: Root
let host: HTMLDivElement
let anchor: HTMLButtonElement

const localDateKey = (date: Date) => [
  String(date.getFullYear()).padStart(4, '0'),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-')

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  anchor = document.createElement('button')
  anchor.getBoundingClientRect = () => ({
    x: 800, y: 20, top: 20, right: 828, bottom: 48, left: 800, width: 28, height: 28,
    toJSON: () => ({}),
  })
  document.body.append(host, anchor)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  anchor.remove()
  api.call.mockReset()
  vi.unstubAllGlobals()
})

it('reuses the counted month calendar and resolves a populated day before navigation', async () => {
  const today = new Date()
  const todayKey = localDateKey(today)
  const record: ArkmeCalendarRecordItem = {
    recordUid: 'record-on-selected-day', sendAtMillis: today.getTime(), accessState: 'available',
    title: '', textContent: '当天记录', preview: '当天记录', sourceKind: 'self',
    creationSource: 0, templateKind: 1, displayKind: 0, protected: false,
  }
  api.call.mockImplementation(async (operation: string) => {
    if (operation === 'calendar.buckets') return {
      days: [{ bucketDate: todayKey, count: 3, protectedCount: 0, hasRecords: true }],
    }
    if (operation === 'calendar.records') return { items: [record], hasMore: false }
    throw new Error(operation)
  })
  const close = vi.fn()
  const select = vi.fn()

  await act(async () => {
    root.render(<ArkmeSelfCalendarPopover
      open
      sourceRef="selected-topic"
      anchor={{ current: anchor }}
      onClose={close}
      onSelectRecord={select}
    />)
  })

  const day = document.querySelector<HTMLButtonElement>(`[aria-label="${todayKey} 3 条记录"]`)
  expect(day).not.toBeNull()
  expect(day?.textContent).toContain('3')
  await act(async () => { day?.click() })

  expect(api.call.mock.calls.map(([operation]) => operation)).toEqual(['calendar.buckets', 'calendar.records'])
  expect(api.call.mock.calls[0]?.[1]).toMatchObject({ sourceRef: 'selected-topic' })
  expect(api.call.mock.calls[1]?.[1]).toMatchObject({ bucketDate: todayKey, limit: 1, sourceRef: 'selected-topic' })
  expect(close).toHaveBeenCalledOnce()
  expect(select).toHaveBeenCalledWith(record)
})

it('hands the date off immediately so closing the popover does not own the ongoing locate', async () => {
  const todayKey = localDateKey(new Date())
  api.call.mockResolvedValue({ days: [{ bucketDate: todayKey, count: 1, hasRecords: true }] })
  const selectDate = vi.fn(), selectRecord = vi.fn(), close = vi.fn()
  await act(async () => root.render(<ArkmeSelfCalendarPopover open anchor={{ current: anchor }}
    accountScope="immediate-date-test" onSelectDate={selectDate} onSelectRecord={selectRecord} onClose={close} />))
  await act(async () => document.querySelector<HTMLButtonElement>(`[aria-label="${todayKey} 1 条记录"]`)!.click())
  expect(selectDate).toHaveBeenCalledWith({ bucketDate: todayKey, timezone: expect.any(String) })
  expect(close).toHaveBeenCalledOnce()
  expect(selectRecord).not.toHaveBeenCalled()
  expect(api.call.mock.calls.map(([operation]) => operation)).toEqual(['calendar.buckets'])
})

it('discards old counts when the topic changes while a month request is pending', async () => {
  const todayKey = localDateKey(new Date())
  let resolveOld!: (value: unknown) => void
  api.call.mockImplementation((_operation: string, params: { sourceRef: string }) => params.sourceRef === 'old'
    ? new Promise(resolve => { resolveOld = resolve })
    : Promise.resolve({ days: [{ bucketDate: todayKey, count: 2, hasRecords: true }] }))
  const render = (sourceRef: string) => root.render(<ArkmeSelfCalendarPopover
    open sourceRef={sourceRef} anchor={{ current: anchor }} onClose={() => {}} onSelectRecord={() => {}}
  />)
  await act(async () => render('old'))
  const oldSignal = api.call.mock.calls[0]?.[2] as AbortSignal
  await act(async () => render('new'))
  expect(oldSignal.aborted).toBe(true)
  await act(async () => resolveOld({ days: [{ bucketDate: todayKey, count: 99, hasRecords: true }] }))
  expect(document.querySelector(`[aria-label="${todayKey} 2 条记录"]`)).not.toBeNull()
  expect(document.querySelector(`[aria-label="${todayKey} 99 条记录"]`)).toBeNull()
})

it('keeps an empty date in the calendar and reports it without requesting records', async () => {
  api.call.mockResolvedValue({ days: [] })
  await act(async () => {
    root.render(<ArkmeSelfCalendarPopover
      open
      anchor={{ current: anchor }}
      onClose={() => {}}
      onSelectRecord={() => {}}
    />)
  })
  const emptyDay = document.querySelector<HTMLButtonElement>('button[data-selected="false"]:not(:disabled)')
  expect(emptyDay).not.toBeNull()
  await act(async () => { emptyDay?.click() })

  expect(document.body.textContent).toContain('这一天没有发给自己的记录')
  expect(api.call.mock.calls.map(([operation]) => operation)).toEqual(['calendar.buckets'])
})

it('loads the newly selected month even when it was already mounted offscreen', async () => {
  api.call.mockResolvedValue({ days: [] })
  await act(async () => root.render(<ArkmeSelfCalendarPopover open sourceRef="month-switch"
    anchor={{ current: anchor }} onClose={() => {}} onSelectRecord={() => {}} />))
  const previous = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
  await jumpCalendarMonth(document, localDateKey(previous).slice(0, 7))
  expect(api.call.mock.calls.some(([operation, params]) => operation === 'calendar.buckets' && params.startDate === localDateKey(previous))).toBe(true)
})

it.each(['send_to_self', 'topic'])('uses the shared reading-date interaction for %s without loading today first', async sourceRef => {
  api.call.mockResolvedValue({ days: [{ bucketDate: '2020-01-02', count: 1, hasRecords: true }] })
  const reading = vi.fn(() => '2020-01-02')
  const onSelect = vi.fn()
  const render = (open: boolean) => root.render(<ArkmeSelfCalendarPopover open={open} sourceRef={sourceRef}
    accountScope={`reading:${sourceRef}`} anchor={{ current: anchor }} getReadingDate={reading}
    onClose={() => {}} onSelectRecord={() => {}} onSelectDate={onSelect} />)
  await act(async () => render(true))
  expect(visibleCalendarMonth(document)).toBe('2020-01')
  expect(document.querySelector('[data-calendar-date="2020-01-02"]')?.getAttribute('data-selected')).toBe('true')
  expect(api.call.mock.calls.every(([operation, params]) => operation !== 'calendar.buckets' || params.startDate.startsWith('2019-') || params.startDate.startsWith('2020-'))).toBe(true)
  expect(document.body.textContent).not.toContain('回到今日')
  await jumpCalendarMonth(document, '2019-12')
  expect(onSelect).not.toHaveBeenCalled()
  await act(async () => render(false))
  reading.mockReturnValue('2019-12-03')
  await act(async () => render(true))
  expect(visibleCalendarMonth(document)).toBe('2019-12')
  expect(reading).toHaveBeenCalledTimes(2)
})

it.each(['send_to_self', 'topic'])('loads newer %s months only when browsed and reuses previous counts', async sourceRef => {
  const current = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const previous = new Date(current.getFullYear(), current.getMonth() - 1, 12)
  const previousKey = localDateKey(new Date(previous.getFullYear(), previous.getMonth(), 1))
  const currentKey = localDateKey(current)
  api.call.mockImplementation(async (_operation: string, params: { startDate: string }) => ({
    days: [{ bucketDate: params.startDate, count: 7, hasRecords: true }],
  }))
  await act(async () => root.render(<ArkmeSelfCalendarPopover open sourceRef={sourceRef}
    accountScope={`continuous:${sourceRef}`} anchor={{ current: anchor }} getReadingDate={() => localDateKey(previous)}
    onClose={() => {}} onSelectRecord={() => {}} />))
  const requests = () => api.call.mock.calls.filter(([operation]) => operation === 'calendar.buckets').map(([, params]) => params.startDate)
  expect(requests()).toEqual([previousKey])
  const scroll = document.querySelector<HTMLDivElement>('[data-arkme-calendar-months]')!
  const sections = [...scroll.querySelectorAll<HTMLElement>('[data-calendar-month]')]
  expect(sections.at(-1)?.dataset.calendarMonth).toBe(currentKey.slice(0, 7))
  Object.defineProperties(scroll, { clientHeight: { value: 370 }, scrollHeight: { value: 930 } })
  const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 350, width: 350, x: 0, y: top, toJSON: () => ({}) })
  scroll.getBoundingClientRect = () => rect(100, 370)
  sections.forEach((section, i) => { section.getBoundingClientRect = () => rect(130 + i * 300 - scroll.scrollTop, 300) })
  const move = async (top: number) => act(async () => {
    scroll.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    scroll.scrollTop = top
    scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await move(560)
  expect(requests()).toEqual([previousKey, currentKey])
  expect(document.querySelector<HTMLButtonElement>(`[aria-label="${currentKey} 7 条记录"]`)?.disabled).toBe(false)
  await move(300)
  await move(560)
  expect(requests()).toEqual([previousKey, currentKey])
})
