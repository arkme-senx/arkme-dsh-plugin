// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ArkmeChatCalendar } from '../src/client/ArkmeChatCalendar.js'
import { jumpCalendarMonth, visibleCalendarMonth } from './helpers/calendar-navigation.js'
import { arkmeCalendarInvalidations } from '../src/client/calendar-invalidation-store.js'
import { arkmeCalendarMonths } from '../src/client/calendar-month-cache.js'

const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: api.call, ArkmeClientError: class extends Error {} }))
let root: Root, host: HTMLDivElement
const select = vi.fn(), opened = vi.fn(), readingDate = vi.fn<() => string | undefined>()
const anchor = { recordUid: 'old-message', recordOwnerUserId: 91, sendAtMillis: 1577923200000 }
const page = { scope: 'group_chat', startDate: '0001-01-01', endDate: '9999-12-31', timezone: 'Asia/Shanghai',
  refreshedAtMillis: Date.now(), totalDayCount: 2, days: [
    { bucketDate: '2019-12-03', count: 5, hasRecords: true, protectedCount: 0, anchor },
    { bucketDate: '2020-01-02', count: 12, hasRecords: true, protectedCount: 0, anchor },
  ] }
const button = () => host.querySelector<HTMLButtonElement>('button')!
const render = async (sourceRef = 'group', interactions?: Parameters<typeof ArkmeChatCalendar>[0]['interactions']) => act(async () => root.render(<ArkmeChatCalendar key={sourceRef}
  sourceRef={sourceRef} scopeKey={sourceRef} accountScope="chat-calendar-ui" getReadingDate={readingDate} onSelect={select} onOpen={opened} interactions={interactions} />))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  api.call.mockReset(); api.call.mockResolvedValue(page); select.mockClear(); opened.mockClear(); readingDate.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); arkmeCalendarMonths.activateAccount(undefined); localStorage.clear(); vi.unstubAllGlobals() })

it('uses a shared icon-only header action with active-day tooltip and multi-month navigation', async () => {
  await render()
  expect(button().title).toContain('2 个日期')
  expect(button().textContent).toBe('')
  expect(button().style.width).toBe('28px')
  expect(button().style.height).toBe('28px')
  expect(button().getAttribute('aria-haspopup')).toBe('dialog')
  expect(button().getAttribute('data-arkme-feedback')).toBe('neutral')
  expect(api.call).toHaveBeenCalledWith('calendar.chat-statistics', expect.objectContaining({ sourceRef: 'group', timezoneOffsetMillis: expect.any(Number) }), expect.any(AbortSignal))
  await act(async () => button().click())
  expect(document.querySelectorAll('[data-calendar-month]').length).toBeGreaterThan(1)
  expect(document.querySelector('[data-calendar-month="2020-01"]')).not.toBeNull()
  const date = document.querySelector<HTMLButtonElement>('[aria-label="2020-01-02 12 条记录"]')!
  expect(date.textContent).toContain('12条')
  await act(async () => date.click())
  expect(select).toHaveBeenCalledWith({ bucketDate: '2020-01-02', timezone: expect.any(String), anchor })
  expect(document.querySelector('[aria-label="会话日历"]')).toBeNull()
  expect(api.call).toHaveBeenCalledTimes(1)
  await act(async () => button().click())
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭会话日历"]')!.click())
  expect(api.call).toHaveBeenCalledTimes(1)
})

it('shows loading rather than 0 dates, and permits opening while loading', async () => {
  let resolve!: (value: unknown) => void
  api.call.mockReturnValue(new Promise(done => { resolve = done }))
  await render()
  expect(button().title).not.toContain('0 个日期')
  expect(host.querySelector('[aria-label="正在加载日历"]')).not.toBeNull()
  await act(async () => button().click())
  expect(document.body.textContent).toContain('正在加载日历')
  expect(document.querySelector('[aria-label$="待加载"]')).not.toBeNull()
  await act(async () => resolve(page))
  expect(button().title).toContain('2 个日期')
})

it('shows failure and retry rather than an empty calendar, and closes on Escape', async () => {
  api.call.mockRejectedValue(new Error('网络暂不可用'))
  await render()
  await act(async () => button().click())
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('网络暂不可用')
  expect(document.body.textContent).not.toContain('暂无聊天记录')
  api.call.mockResolvedValue(page)
  const retry = [...document.querySelectorAll('button')].find(item => item.textContent === '重试')!
  expect(retry.style.borderRadius).toBe('6px')
  expect(retry.getAttribute('data-arkme-feedback')).toBe('neutral')
  await act(async () => retry.click())
  expect(button().title).toContain('2 个日期')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(document.querySelector('[aria-label="会话日历"]')).toBeNull()
})

it('refreshes after message events while preserving counts, and never shares dates across conversations', async () => {
  await render()
  api.call.mockResolvedValue({ ...page, totalDayCount: 3 })
  await act(async () => arkmeCalendarInvalidations.publish({ dateKey: '2026-09-18' }))
  expect(button().title).toContain('3 个日期')
  api.call.mockResolvedValue({ ...page, totalDayCount: 0, days: [] })
  await render('other-private-chat')
  expect(button().title).toContain('0 个日期')
  await act(async () => button().click())
  expect(document.body.textContent).toContain('暂无聊天记录')
})

it('does not trigger a date scan for legacy statistics without owner anchors', async () => {
  api.call.mockResolvedValue({ ...page, days: [{ ...page.days[1], anchor: undefined }] })
  await render()
  await act(async () => button().click())
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="2020-01-02 12 条记录"]')!.click())
  expect(document.body.textContent).toContain('当天定位信息暂不可用')
  expect(select).not.toHaveBeenCalled()
  expect(api.call).toHaveBeenCalledTimes(1)
})

it('opens at the reading date rather than today or the newest bucket, then resamples after scrolling', async () => {
  readingDate.mockReturnValue('2019-12-03')
  await render()
  await act(async () => button().click())
  expect(visibleCalendarMonth(document)).toBe('2019-12')
  expect(document.querySelector('[data-calendar-date="2019-12-03"]')?.getAttribute('data-selected')).toBe('true')
  expect(document.body.textContent).not.toContain('回到今日')
  expect(readingDate).toHaveBeenCalledTimes(1)
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  readingDate.mockReturnValue('2020-01-02')
  await act(async () => button().click())
  expect(visibleCalendarMonth(document)).toBe('2020-01')
  expect(document.querySelector('[data-calendar-date="2020-01-02"]')?.getAttribute('data-selected')).toBe('true')
  expect(readingDate).toHaveBeenCalledTimes(2)
  expect(api.call).toHaveBeenCalledTimes(1)
})

it('month browsing and failed navigation do not replace the actual reading date', async () => {
  readingDate.mockReturnValue('2020-01-02')
  await render()
  await act(async () => button().click())
  await jumpCalendarMonth(document, '2019-12')
  expect(visibleCalendarMonth(document)).toBe('2019-12')
  expect(select).not.toHaveBeenCalled()
  // Refreshing counts must not snap a manually browsed calendar back to the reading month.
  await act(async () => arkmeCalendarInvalidations.publish({ dateKey: '2020-01-02' }))
  expect(visibleCalendarMonth(document)).toBe('2019-12')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="2019-12-03 5 条记录"]')!.click())
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ bucketDate: '2019-12-03' }))
  // The locator did not complete, so the conversation still reports its original date.
  await act(async () => button().click())
  expect(visibleCalendarMonth(document)).toBe('2020-01')
  expect(document.querySelector('[data-calendar-date="2020-01-02"]')?.getAttribute('data-selected')).toBe('true')
})

it('does not let a late statistics response override a known reading date', async () => {
  readingDate.mockReturnValue('2019-12-03')
  let finish!: (value: unknown) => void
  api.call.mockReturnValue(new Promise(resolve => { finish = resolve }))
  await render()
  await act(async () => button().click())
  expect(visibleCalendarMonth(document)).toBe('2019-12')
  await act(async () => finish(page))
  expect(visibleCalendarMonth(document)).toBe('2019-12')
  expect(document.querySelector('[data-calendar-date="2019-12-03"]')?.getAttribute('data-selected')).toBe('true')
})

it('reuses loaded interactions for counts and selection without another API request on each opening', async () => {
  api.call.mockResolvedValue({ ...page, scope: 'private_chat' })
  const moment = { momentId: 'group-mention', momentRef: 'opaque', occurredAtMillis: new Date(2020, 0, 3, 12).getTime(),
    groupName: '群', senderName: '成员', senderIsMe: false, summary: '互动', degraded: false }
  const retry = vi.fn()
  await render('private', { moments: [moment, moment], state: 'success', retry })
  expect(button().title).toContain('已知 3 个日期')
  await act(async () => button().click())
  const day = document.querySelector<HTMLButtonElement>('[data-calendar-date="2020-01-03"]')!
  expect(day.disabled).toBe(false)
  expect(day.hasAttribute('title')).toBe(false)
  await act(async () => day.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('群聊互动 1 条')
  expect(day.textContent).toBe('31条')
  expect(document.body.textContent).toContain('历史统计可能不完整')
  await act(async () => day.click())
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ bucketDate: '2020-01-03',
    momentAnchor: { momentId: moment.momentId, occurredAtMillis: moment.occurredAtMillis, contextAnchor: anchor } }))
  await act(async () => button().click())
  expect(api.call).toHaveBeenCalledTimes(1)
  await render('private', { moments: [moment], state: 'error', retry })
  expect(document.body.textContent).toContain('群聊互动加载失败')
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === '重试互动')!.click())
  expect(retry).toHaveBeenCalledTimes(1)
  expect(day.disabled).toBe(false)
  await render('other-chat')
  expect(button().title).not.toContain('3 个日期')
})

it('does not label unconfirmed empty days as no records while interactions are loading', async () => {
  api.call.mockResolvedValue({ ...page, scope: 'private_chat', days: [], totalDayCount: 0 })
  await render('private', { moments: [], state: 'loading', retry: vi.fn() })
  await act(async () => button().click())
  expect(document.body.textContent).toContain('正在加载群聊互动')
  expect(document.body.textContent).not.toContain('暂无聊天记录')
  expect(document.querySelector('[aria-label$="暂无已加载记录"]')).not.toBeNull()
})
