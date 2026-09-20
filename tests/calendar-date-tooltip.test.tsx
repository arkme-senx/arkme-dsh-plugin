// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeCalendarCell } from '../src/client/ArkmeCalendarSurface.js'

let root: Root, host: HTMLDivElement
const clicked = vi.fn()
const meta = { bucketDate: '2026-09-20', count: 3, protectedCount: 0, hasRecords: true,
  conversationCounts: { messages: 2, interactions: 1 } }
const props = { date: new Date(2026, 8, 20), meta, selected: false, disabled: false, onClick: clicked }
const day = () => host.querySelector('button')!
const tip = () => document.querySelector<HTMLElement>('[role="tooltip"]')
const render = (overrides: Partial<ComponentProps<typeof ArkmeCalendarCell>> = {}) => act(() => root.render(<ArkmeCalendarCell {...props} {...overrides} />))
const hover = () => act(() => { day().dispatchEvent(new MouseEvent('pointerover', { bubbles: true })) })
const leave = () => act(() => { day().dispatchEvent(new MouseEvent('pointerout', { bubbles: true })) })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // No test advances timers: display and dismissal must work in the same event turn.
  vi.useFakeTimers()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  clicked.mockClear()
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals()
})

it('immediately shows the exact existing breakdown and immediately removes it on pointer leave', () => {
  render(); expect(tip()).toBeNull(); expect(day().hasAttribute('title')).toBe(false)
  hover()
  expect(tip()?.textContent).toBe('私聊 2 条 · 群聊互动 1 条')
  expect(day().getAttribute('aria-describedby')).toBe(tip()?.id)
  expect(tip()?.parentElement).toBe(document.body)
  expect(tip()?.style.pointerEvents).toBe('none')
  expect(day().textContent).toBe('203')
  leave()
  expect(tip()).toBeNull(); expect(day().hasAttribute('aria-describedby')).toBe(false)
})

it('supports keyboard focus and blur and preserves date selection', () => {
  render()
  act(() => day().focus())
  expect(tip()).not.toBeNull()
  act(() => day().blur())
  expect(tip()).toBeNull()
  hover()
  act(() => day().click())
  expect(clicked).toHaveBeenCalledTimes(1)
  expect(tip()).toBeNull()
})

it.each(['scroll', 'resize', 'blur', 'Escape', 'pointercancel'])('dismisses immediately on %s', kind => {
  render(); hover(); expect(tip()).not.toBeNull()
  act(() => {
    if (kind === 'scroll') host.dispatchEvent(new Event('scroll', { bubbles: false }))
    else if (kind === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: kind }))
    else if (kind === 'pointercancel') day().dispatchEvent(new Event(kind, { bubbles: true }))
    else window.dispatchEvent(new Event(kind))
  })
  expect(tip()).toBeNull()
})

it('updates counts while hovered, but never retains the old date hint when a cell is reused', () => {
  render(); hover()
  render({ meta: { ...meta, conversationCounts: { messages: 4, interactions: 0 } } })
  expect(tip()?.textContent).toBe('私聊 4 条')
  render({ date: new Date(2026, 8, 21) })
  expect(tip()).toBeNull()
})

it('switches between adjacent dates without leaving a duplicate tooltip', () => {
  act(() => root.render(<><ArkmeCalendarCell {...props} /><ArkmeCalendarCell {...props}
    date={new Date(2026, 8, 21)} meta={{ ...meta, conversationCounts: { messages: 5, interactions: 0 } }} /></>))
  hover()
  const next = host.querySelectorAll('button')[1]!
  act(() => {
    day().dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: next }))
    next.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: day() }))
  })
  expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1)
  expect(tip()?.textContent).toBe('私聊 5 条')
})

it('does not show unsupported details for empty, disabled, unknown, or touch-hovered dates', () => {
  render({ meta: { ...meta, conversationCounts: { messages: 0, interactions: 0 } } }); hover()
  expect(tip()).toBeNull(); leave()
  render({ disabled: true }); hover(); expect(tip()).toBeNull(); leave()
  render({ unknown: true }); hover(); expect(tip()).toBeNull(); leave()
  render()
  const event = new MouseEvent('pointerover', { bubbles: true })
  Object.defineProperty(event, 'pointerType', { value: 'touch' })
  act(() => { day().dispatchEvent(event) })
  expect(tip()).toBeNull()
})

it('flips above dates at the bottom and clamps to both horizontal viewport edges', () => {
  vi.stubGlobal('innerWidth', 320); vi.stubGlobal('innerHeight', 240)
  let x = 280
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const value = this.tagName === 'BUTTON'
      ? { left: x, top: 200, right: x + 40, bottom: 240, width: 40, height: 40 }
      : { left: 0, top: 0, right: 200, bottom: 30, width: 200, height: 30 }
    return { ...value, x: value.left, y: value.top, toJSON: () => value }
  })
  render(); hover()
  expect(tip()?.style.left).toBe('112px'); expect(tip()?.style.top).toBe('164px')
  leave(); x = 0; hover()
  expect(tip()?.style.left).toBe('8px')
})

it('removes its portal and event listeners when the calendar closes', () => {
  const remove = vi.spyOn(document, 'removeEventListener')
  render(); hover()
  act(() => root.render(null))
  expect(tip()).toBeNull()
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), true)
  expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function))
})
