// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeCalendarCell, ArkmeSelfCalendarPopover } from '../src/client/ArkmeCalendarSurface.js'
import { CALENDAR_DEFAULT_HEIGHT, calendarPopoverLayout, readCalendarHeight, writeCalendarHeight } from '../src/client/use-calendar-popover-layout.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn(), ArkmeClientError: class extends Error {} }))
let root: Root, host: HTMLDivElement, anchor: HTMLButtonElement
const close = vi.fn()
const index = { loading: false, error: '', retry: vi.fn(), value: {
  scope: 'group_chat' as const, timezone: 'Asia/Shanghai', startDate: '2026-08-01', endDate: '2026-09-30', refreshedAtMillis: 1,
  days: [{ bucketDate: '2026-08-04', count: 2, protectedCount: 0, hasRecords: true }],
} }
const panel = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const handle = () => document.querySelector<HTMLElement>('[data-arkme-calendar-resize]')!
const render = async (open = true, account = 'alice', sourceRef = 'private') => act(async () => root.render(
  <ArkmeSelfCalendarPopover open={open} accountScope={account} sourceRef={sourceRef} scopeKey={sourceRef}
    anchor={{ current: anchor }} index={index} getReadingDate={() => '2026-08-04'} onClose={close} onSelectRecord={() => {}} />))
const pointer = async (type: string, y: number, button = 0, id = 1) => act(async () => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { clientY: y, button, pointerId: id })
  handle().dispatchEvent(event)
})
const key = async (key: string) => act(async () => handle().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
const resizeWindow = async (height: number) => act(async () => {
  vi.stubGlobal('innerHeight', height)
  window.dispatchEvent(new Event('resize'))
})
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('innerWidth', 1200); vi.stubGlobal('innerHeight', 1100)
  localStorage.clear(); close.mockClear()
  host = document.createElement('div'); anchor = document.createElement('button')
  anchor.getBoundingClientRect = () => ({ right: 1100, bottom: 48, top: 20, left: 1072, height: 28, width: 28, x: 1072, y: 20, toJSON: () => ({}) })
  document.body.append(host, anchor); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); anchor.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('defaults to a taller shared calendar with no duplicated navigation row and a fixed weekday strip', async () => {
  await render()
  expect(panel().style.height).toBe(`${CALENDAR_DEFAULT_HEIGHT}px`)
  expect(panel().style.display).toBe('flex')
  expect(panel().querySelector('header')).toBeNull()
  expect(panel().querySelector('[aria-label="上个月"]')).toBeNull()
  expect(panel().querySelectorAll('[data-calendar-month]').length).toBeGreaterThan(1)
  const scroll = panel().querySelector<HTMLElement>('[data-arkme-calendar-months]')!
  expect(scroll.style.height).toBe('')
  expect(scroll.style.flex).toBe('1 1 0%')
  expect(handle().getAttribute('aria-valuenow')).toBe('760')
})

it('drags the bottom edge, keeps its top fixed and persists only on release across sources and remounts', async () => {
  await render()
  const top = panel().style.top
  await pointer('pointerdown', 800)
  await pointer('pointermove', 900)
  expect(panel().style.height).toBe('860px')
  expect(panel().style.top).toBe(top)
  expect(readCalendarHeight('alice')).toBeUndefined()
  await pointer('pointerup', 900)
  expect(readCalendarHeight('alice')).toBe(860)
  await render(false)
  await render(true, 'alice', 'topic')
  expect(panel().style.height).toBe('860px')
  await act(async () => root.unmount())
  root = createRoot(host)
  await render(true, 'alice', 'send-to-self')
  expect(panel().style.height).toBe('860px')
  expect(panel().querySelector('[data-calendar-date="2026-08-04"]')?.getAttribute('data-selected')).toBe('true')
})

it('temporarily clamps to a small viewport, including reopening, without replacing the saved preference', async () => {
  writeCalendarHeight('alice', 900)
  await render()
  await resizeWindow(550)
  expect(panel().style.height).toBe('526px')
  expect(Number.parseFloat(panel().style.top) + Number.parseFloat(panel().style.height)).toBeLessThanOrEqual(538)
  expect(readCalendarHeight('alice')).toBe(900)
  await render(false); await render()
  expect(panel().style.height).toBe('526px')
  await resizeWindow(1100)
  expect(panel().style.height).toBe('900px')
  expect(readCalendarHeight('alice')).toBe(900)
})

it('isolates accounts and reloads the previous account preference', async () => {
  writeCalendarHeight('alice', 920)
  await render()
  await render(true, 'bob')
  expect(panel().style.height).toBe('760px')
  await key('ArrowUp')
  expect(readCalendarHeight('bob')).toBe(720)
  await render()
  expect(panel().style.height).toBe('920px')
})

it.each(['pointercancel', 'lostpointercapture'])('cancels an interrupted drag on %s without saving it', async event => {
  await render()
  await pointer('pointerdown', 800); await pointer('pointermove', 650)
  expect(panel().style.height).toBe('610px')
  await pointer(event, 650)
  expect(panel().style.height).toBe('760px')
  expect(readCalendarHeight('alice')).toBeUndefined()
})

it('ignores secondary buttons and unrelated pointers, and clamps deliberate resizing to the viewport', async () => {
  await render()
  await pointer('pointerdown', 800, 2); await pointer('pointermove', 600)
  expect(panel().style.height).toBe('760px')
  await pointer('pointerdown', 800); await pointer('pointermove', 600, 0, 2)
  expect(panel().style.height).toBe('760px')
  await pointer('pointermove', 9000); await pointer('pointerup', 9000)
  expect(panel().style.height).toBe('1032px')
  expect(readCalendarHeight('alice')).toBe(1032)
})

it('supports keyboard resizing without selecting dates or closing the calendar', async () => {
  await render()
  await key('ArrowDown'); expect(panel().style.height).toBe('800px')
  await key('Home'); expect(panel().style.height).toBe('360px')
  await key('End'); expect(panel().style.height).toBe('1032px')
  expect(readCalendarHeight('alice')).toBe(1032)
  expect(close).not.toHaveBeenCalled()
})

it('does not reanchor the panel when its own months scroll', async () => {
  await render()
  await pointer('pointerdown', 800); await pointer('pointermove', 900); await pointer('pointerup', 900)
  const top = panel().style.top
  await act(async () => panel().querySelector('[data-arkme-calendar-months]')!.dispatchEvent(new Event('scroll', { bubbles: true })))
  expect(panel().style.top).toBe(top)
  expect(panel().style.height).toBe('860px')
})

it('handles invalid or unavailable storage without breaking rendering', async () => {
  localStorage.setItem('dsh-arkme:calendar-height:v1:alice', 'NaN')
  expect(readCalendarHeight('alice')).toBeUndefined()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
  await render(); await key('ArrowUp')
  expect(panel().style.height).toBe('720px')
  writeCalendarHeight(undefined, 800)
  expect(readCalendarHeight(undefined)).toBeUndefined()
})

it('fits both axes even if the anchor lies near the bottom or outside a narrow viewport', () => {
  const result = calendarPopoverLayout({ right: 1200, bottom: 1000 }, 320, 500, 900)
  expect(result).toMatchObject({ top: 12, left: 12, height: 476 })
})

it.each([
  [0, 2, '群聊互动 2 条'], [3, 0, '私聊 3 条'], [3, 2, '私聊 3 条 · 群聊互动 2 条'], [0, 0, ''],
])('keeps the tooltip concise with %i messages and %i interactions', async (messages, interactions, title) => {
  await act(async () => root.render(<ArkmeCalendarCell date={new Date(2026, 7, 4)} selected={false} disabled={false}
    onClick={() => {}} incomplete meta={{ bucketDate: '2026-08-04', count: Number(messages) + Number(interactions),
      hasRecords: true, protectedCount: 0, conversationCounts: { messages: Number(messages), interactions: Number(interactions) } }} />))
  const day = host.querySelector('button')!
  expect(day.hasAttribute('title')).toBe(false)
  await act(async () => day.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
  if (title) expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(title)
  else expect(document.querySelector('[role="tooltip"]')).toBeNull()
})
