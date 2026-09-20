import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.read, ArkmeClientError: class extends Error {} }))
vi.mock('../src/client/ArkmeRichContent.js', () => ({ ArkmeMessageContent: ({ item }: { item: { textContent: string } }) => <div data-rich-content>{item.textContent}</div> }))
vi.mock('../src/client/ArkmeNoteDetails.js', () => ({
  ArkmeTimelineDetailDrawer: ({ item }: { item: { textContent: string } }) => <div data-complete-detail>{item.textContent}</div>,
  ForwardRecordsDetail: () => <div>转发记录</div>,
}))
import { ArkmePersonalDayCalendar } from '../src/client/ArkmePersonalDayCalendar.js'
import { arkmeCalendarMonths } from '../src/client/calendar-month-cache.js'
import { arkmeCalendarInvalidations } from '../src/client/calendar-invalidation-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { personalDateKey } from '../src/client/existing-day-activity-reader.js'

let view: ReactTestRenderer | undefined
const today = new Date(), date = personalDateKey(today)
const dateStamp = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
const stringify = (node: unknown): string => JSON.stringify(node)
const text = () => stringify(view!.toJSON())
const clickText = async (label: string) => act(async () => {
  view!.root.findAllByType('button').find(node => node.props.children === label)!.props.onClick()
})
beforeEach(() => {
  arkmeCalendarMonths.activateAccount(undefined)
  mocks.read.mockReset().mockImplementation(async (operation, params) => {
    if (operation === 'calendar.activity') {
      if (params.mode === 'buckets') return { daily_data: [], coverage: { status: 'complete' } }
      if (params.source === 'record') return { items: [{ occurred_at: new Date(`${params.body.bucket_date}T12:00:00`).getTime(), record_projection: {
        recordUid: 'mine', accessState: 'available', protected: false, title: '我的记录', preview: '自己的内容', textContent: '完整图文',
        content: { itemUid: 'mine', textContent: '完整图文' },
      } }], has_more: false }
      if (params.source === 'audio') return { items: [{ start_at: params.body.start_at + 3600000, end_at: params.body.start_at + 7200000, source_label: '我的录音' }], has_more: false }
      return { items: [], has_more: false }
    }
    if (operation === 'calendar.buckets') return { scope: 'self', ...params, refreshedAtMillis: Date.now(), days: [{ bucketDate: date, count: 2, protectedCount: 0, hasRecords: true }] }
    if (operation === 'recordings.calendar') return { ...params, days: [{ dateStamp, durationMillis: 3600000, hasRecording: true, unreviewedCount: 0 }] }
    if (operation === 'calendar.records') return { scope: 'self', bucketDate: params.bucketDate, timezone, refreshedAtMillis: Date.now(), hasMore: false,
      items: [{ recordUid: 'mine', sendAtMillis: new Date(`${params.bucketDate}T12:00:00`).getTime(), accessState: 'available', protected: false,
        title: '我的记录', preview: '自己的内容', textContent: '完整图文', templateKind: 1, displayKind: 0, sourceKind: 'self', creationSource: 0 }] }
    if (operation === 'recordings.day') return { dateStamp: params.dateStamp, totalDurationMillis: 3600000,
      coverage: { state: 'ready', intervals: [{ startAtMillis: params.dateStamp + 3600000, endAtMillis: params.dateStamp + 7200000, sourceLabel: '我的录音', status: 'saved' }] },
      transcript: { state: 'empty', items: [], message: '', processingCount: 0, totalDurationMillis: 0 } }
    throw new Error(`unexpected ${operation}`)
  })
})
afterEach(() => { act(() => view?.unmount()); view = undefined; arkmeCalendarMonths.activateAccount(undefined); vi.restoreAllMocks() })
async function mount(accountScope = 'prod:123') { await act(async () => { view = create(<ArkmePersonalDayCalendar accountScope={accountScope} onClose={() => {}} />) }) }

describe('first-rail personal day calendar', () => {
  it('loads month/day using the production documented reader and keeps per-source index', async () => {
    await mount()
    expect(mocks.read.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(['calendar.buckets', 'calendar.activity', 'recordings.calendar']))
    expect(text()).toContain('自己的内容')
    expect(text()).toContain('录音索引有内容')
    expect(text()).toContain('当前来源已加载')
    const labels = view!.root.findAllByType('button').map(button => button.props.children)
    expect(labels).toContain('个人记录'); expect(labels).toContain('录音')
    expect(labels).toContain('对话'); expect(labels).not.toContain('私聊'); expect(labels).toContain('通话'); expect(labels).toContain('原始明细')
  })
  it('renders rich details lazily without navigation/read receipts until explicitly requested', async () => {
    const navigate = vi.spyOn(arkmeUi, 'showRecordingTarget').mockImplementation(() => {})
    await mount()
    await act(async () => view!.root.findByProps({ 'data-activity-id': 'note:mine' }).findByType('button').props.onClick())
    expect(view!.root.findByProps({ 'data-rich-content': true }).props.children).toBe('完整图文')
    await clickText('查看完整快记')
    expect(view!.root.findByProps({ 'data-complete-detail': true }).props.children).toBe('完整图文')
    const audio = view!.root.findAllByType('article').find(node => node.props['data-activity-id']?.startsWith('recording:'))!
    await act(async () => audio.findByType('button').props.onClick())
    expect(view!.root.findAllByProps({ 'data-complete-detail': true })).toHaveLength(0)
    expect(navigate).not.toHaveBeenCalled()
    await clickText('前往原始来源')
    expect(navigate).toHaveBeenCalledExactlyOnceWith(dateStamp, dateStamp + 3600000)
    expect(mocks.read.mock.calls.every(call => ['calendar.buckets', 'calendar.activity', 'recordings.calendar'].includes(call[0]))).toBe(true)
  })
  it('refreshes current date on invalidation, cancels reads on close, and resets account state', async () => {
    await mount()
    const count = () => mocks.read.mock.calls.filter(call => call[0] === 'calendar.activity' && call[1].source === 'record').length
    const before = count()
    await act(async () => arkmeCalendarInvalidations.publish({ dateKey: date }))
    expect(count()).toBe(before + 1)
    await act(async () => view!.update(<ArkmePersonalDayCalendar accountScope="prod:456" onClose={() => {}} />))
    expect(count()).toBe(before + 2)
    await act(async () => view!.unmount())
  })
  it('aborts outstanding requests when the calendar closes', async () => {
    mocks.read.mockImplementation(async () => new Promise(() => {}))
    await mount()
    const signals = mocks.read.mock.calls.map(call => call[2])
    expect(signals.every(signal => signal.aborted === false)).toBe(true)
    await act(async () => view!.unmount())
    expect(signals.every(signal => signal.aborted === true)).toBe(true)
  })
  it('does not call domain APIs with no authenticated account', async () => {
    await mount('')
    expect(mocks.read).not.toHaveBeenCalled()
    expect(text()).toContain('账号范围尚未确认')
  })
  it('selects a date with no record count and still reads recording coverage', async () => {
    await mount()
    const day = today.getDate() === 1 ? today : new Date(today.getFullYear(), today.getMonth(), 1)
    await act(async () => view!.root.findByProps({ 'data-calendar-date': personalDateKey(day) }).props.onClick())
    expect(mocks.read.mock.calls.filter(call => call[0] === 'calendar.activity' && call[1].source === 'audio').at(-1)?.[1].body.start_at).toBe(new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime())
  })
})
