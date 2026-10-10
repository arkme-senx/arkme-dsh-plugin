import { expect, it } from 'vitest'
import type { ArkmeCalendarBucketPage, ArkmeInterwovenMention } from '../src/types.js'
import { mergeConversationCalendar, conversationCalendarNotice } from '../src/client/conversation-calendar.js'

const time = (day: number, hour = 12) => Date.UTC(2026, 8, day, hour)
const moment = (id: string, day: number, hour = 12): ArkmeInterwovenMention => ({ momentId: id, momentRef: `ref:${id}`,
  occurredAtMillis: time(day, hour), groupName: '群', senderName: '人', senderIsMe: false, summary: '互动', degraded: false })
const anchor = { recordUid: 'private-record', recordOwnerUserId: '9223372036854775806', sendAtMillis: time(2) }
const page: ArkmeCalendarBucketPage = { scope: 'private_chat', timezone: 'UTC', startDate: '0001-01-01', endDate: '9999-12-31',
  refreshedAtMillis: 1, totalDayCount: 1, days: [{ bucketDate: '2026-09-02', count: 2, hasRecords: true, protectedCount: 0, anchor }] }

it('unions dates, deduplicates cards, preserves counts and does not mutate the server cache', () => {
  const input = structuredClone(page)
  const card = moment('one', 2)
  const result = mergeConversationCalendar(page, [card, card, moment('two', 4)], 0)!
  expect(result.totalDayCount).toBe(2)
  expect(result.days.map(day => [day.bucketDate, day.count])).toEqual([['2026-09-02', 3], ['2026-09-04', 1]])
  expect(result.days[0]?.conversationCounts).toEqual({ messages: 2, interactions: 1 })
  expect(result.days[0]?.momentAnchor).toBeUndefined()
  expect(result.days[1]?.momentAnchor).toEqual({ momentId: 'two', occurredAtMillis: time(4), contextAnchor: anchor })
  expect(page).toEqual(input)
  expect(mergeConversationCalendar(page, [card], 0)?.days[0]?.count).toBe(3)
})

it('selects the earliest row on mixed days and never substitutes a group record into the private around route', () => {
  const early = moment('early', 2, 9)
  const result = mergeConversationCalendar(page, [moment('later', 2, 15), early], 0)!
  expect(result.days[0]?.momentAnchor).toEqual({ momentId: 'early', occurredAtMillis: time(2, 9), contextAnchor: anchor })
  expect(result.days[0]?.anchor).toEqual(anchor)
})

it('uses the statistics timezone offset, handles cross-day timestamps, ignores invalid moments', () => {
  const result = mergeConversationCalendar(page, [moment('late', 2, 20), { ...moment('bad', 3), occurredAtMillis: NaN }], 8 * 3600_000)!
  expect(result.days.map(day => day.bucketDate)).toEqual(['2026-09-02', '2026-09-03'])
})

it('can navigate interaction-only conversations without a fake message owner or full message scan', () => {
  const result = mergeConversationCalendar({ ...page, days: [], totalDayCount: 0 }, [moment('only', 4)], 0)!
  expect(result.days[0]?.momentAnchor).toEqual({ momentId: 'only', occurredAtMillis: time(4) })
  expect(result.days[0]?.anchor).toBeUndefined()
})

it('does not guess missing message anchors or mix interactions into group/self calendars', () => {
  const legacy = { ...page, days: [{ ...page.days[0]!, anchor: undefined }] } as ArkmeCalendarBucketPage
  expect(mergeConversationCalendar(legacy, [moment('one', 2)], 0)?.days[0]?.momentAnchor).toBeUndefined()
  expect(mergeConversationCalendar(undefined, [moment('one', 2)], 0)).toBeUndefined()
  const group = { ...page, scope: 'group_chat' as const }
  expect(mergeConversationCalendar(group, [moment('one', 2)], 0)).toBe(group)
})

it('never promises complete historical totals from a bootstrap and distinguishes failure from empty', () => {
  for (const state of ['success', 'empty', 'partial', 'error'] as const) expect(conversationCalendarNotice(state)).toContain('不完整')
  expect(conversationCalendarNotice('loading')).toContain('正在加载')
  expect(conversationCalendarNotice('disabled')).toBe('')
})
