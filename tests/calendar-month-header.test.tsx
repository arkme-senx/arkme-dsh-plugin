// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeCalendarMonthHeader } from '../src/client/ArkmeCalendarMonthHeader.js'

let root: Root, host: HTMLDivElement
const changed = vi.fn(), todayClicked = vi.fn(), outerKey = vi.fn()
const today = new Date(2026, 9, 13)
function Calendar({ initial = new Date(2026, 7, 1), allowFuture = false }: { initial?: Date; allowFuture?: boolean }) {
  const [month, setMonth] = useState(initial)
  const [date, setDate] = useState(new Date(2026, 7, 9))
  return <div onKeyDown={outerKey}>
    <ArkmeCalendarMonthHeader visibleMonth={month} selectedDate={date} today={today} allowFuture={allowFuture}
      onVisibleMonthChange={value => { changed(value); setMonth(value) }}
      onToday={() => { todayClicked(); setMonth(new Date(2026, 9, 1)); setDate(today) }} />
  </div>
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
  .find(node => node.getAttribute('aria-label') === label || node.textContent === label)!
const click = async (label: string) => act(async () => button(label).click())
const open = () => click('选择年月')
const dialog = () => document.querySelector('[role="dialog"]')
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  changed.mockClear(); todayClicked.mockClear(); outerKey.mockClear()
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<Calendar />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('orders previous, plain month/year, next and today consistently', () => {
  expect([...host.querySelectorAll('button')].map(node => node.getAttribute('aria-label') ?? node.textContent))
    .toEqual(['上个月', '选择年月', '下个月', '回到今日'])
  expect(button('选择年月').textContent).toBe('2026年 8月')
  expect(button('选择年月').querySelector('svg')).toBeNull()
  expect(button('回到今日').querySelector('svg')).toBeNull()
})

it('stages the year without changing the date, then applies and closes on month selection', async () => {
  await open()
  expect(document.activeElement).toBe(button('2026'))
  expect(button('11月').disabled).toBe(true)
  await click('2025')
  expect(changed).not.toHaveBeenCalled()
  expect(button('选择年月').textContent).toBe('2026年 8月')
  expect(button('11月').disabled).toBe(false)
  await click('11月')
  expect(changed).toHaveBeenLastCalledWith(new Date(2025, 10, 1))
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(button('选择年月'))
})

it('cancels a draft year via Escape without closing the surrounding calendar', async () => {
  await open()
  await click('2025')
  await act(async () => button('2025').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(dialog()).toBeNull()
  expect(changed).not.toHaveBeenCalled()
  expect(outerKey).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(button('选择年月'))
  await open()
  expect(button('2026').getAttribute('aria-pressed')).toBe('true')
  await click('关闭年月选择')
  expect(dialog()).toBeNull()
})

it('supports keyboard year selection and returning to today after month navigation', async () => {
  await open()
  await act(async () => button('2026').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  expect(document.activeElement).toBe(button('2025'))
  await click('12月')
  await click('下个月')
  expect(changed).toHaveBeenLastCalledWith(new Date(2026, 0, 1))
  await click('回到今日')
  expect(todayClicked).toHaveBeenCalledOnce()
  expect(button('选择年月').textContent).toBe('2026年 10月')
  expect(button('下个月').disabled).toBe(true)
  expect(button('回到今日').disabled).toBe(true)
})

it('stops previous-month navigation at the supported lower bound', async () => {
  await act(async () => { root.unmount(); root = createRoot(host); root.render(<Calendar initial={new Date(1970, 0, 1)} />) })
  expect(button('上个月').disabled).toBe(true)
  await click('上个月')
  expect(changed).not.toHaveBeenCalled()
})

it('allows future months and years only for a planning calendar', async () => {
  await act(async () => { root.unmount(); root = createRoot(host); root.render(<Calendar initial={new Date(2026, 9, 1)} allowFuture />) })
  expect(button('下个月').disabled).toBe(false)
  await click('下个月')
  expect(changed).toHaveBeenLastCalledWith(new Date(2026, 10, 1))
  await open()
  await click('2027')
  await click('1月')
  expect(changed).toHaveBeenLastCalledWith(new Date(2027, 0, 1))
  await click('回到今日')
  expect(button('选择年月').textContent).toBe('2026年 10月')
})

it('preserves an open picker across window blur and resizing', async () => {
  await open()
  await click('2025')
  await act(async () => { button('2025').blur(); window.dispatchEvent(new Event('resize')) })
  expect(dialog()).not.toBeNull()
  expect(button('2025').getAttribute('aria-pressed')).toBe('true')
  expect(changed).not.toHaveBeenCalled()
  await click('8月')
  expect(changed).toHaveBeenLastCalledWith(new Date(2025, 7, 1))
})
