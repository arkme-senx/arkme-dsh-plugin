import { expect, it, vi } from 'vitest'
import { parseDayReviewResult } from '../src/calendar-day-review.js'
import { projectDayReviewRecordingSection, createArkmeSdk } from '../src/sdk/index.js'
const q = { accountScope: 'test:1', bucketDate: '2026-10-15', timezone: 'Asia/Shanghai' }
const details = { scene: '会议', roles: ['同事'], events: ['确定计划'], mood: '', todos: ['复核'], quotes: ['明天复核'], other_info: [{ label: '注意', value: '需要复核' }] }
const raw = () => ({ schema_version: 1, scope: 'calendar_day', date: q.bucketDate, time_zone: q.timezone, id: 'r', snapshot_id: 's', generated_at: 1, model_name: 'model', source_kinds: ['chat', 'audio'],
 coverage: [{ kind: 'chat', status: 'partial', count: 2, details: { query_status: 'complete', content_status: 'partial', history_status: 'unknown', relation_status: 'partial', visible_count: 3, text_count: 1, media_count: 2, skipped_count: 1 } }, { kind: 'audio', status: 'empty', count: 0 }],
 sources: [{ ref: 'm', kind: 'chat', label: '消息' }], summary: [{ text: '计划', source_refs: ['m'], details }], timeline: [{ text: '计划', title: '复核', source_refs: ['m'], start_at: null, end_at: null, details }] })
it('preserves complete details, overlapping media counts and actual scope without inventing time or speakers', () => {
 const result = parseDayReviewResult(raw(), q)
 expect(result.summary[0]?.details?.otherInfo).toEqual([{ label: '注意', value: '需要复核' }])
 expect(result.coverage[0]?.details).toMatchObject({ visibleCount: 3, textCount: 1, mediaCount: 2, skippedCount: 1 })
 const section = projectDayReviewRecordingSection(result, q)
 expect(section.sourceScope).toEqual(['chat'])
 expect(section.timeZoneOffsetMillis).toBe(28800000)
 expect(projectDayReviewRecordingSection(result, { bucketDate: '2026-03-08', timezone: 'America/New_York' }).timeZoneOffsetMillis).toBe(-18000000)
 expect(projectDayReviewRecordingSection(result, { bucketDate: '2026-11-01', timezone: 'America/New_York' }).timeZoneOffsetMillis).toBe(-14400000)
 expect(section.items[0]?.timelineEvents[0]).toMatchObject({ startAt: '', endAt: '', scene: '会议', participants: ['同事'], todo: '复核', dialoguePoints: [{ speakerName: '', quote: '明天复核', isSelf: false }] })
})
it('keeps old results readable and rejects malformed new fields at the boundary', () => {
 const old = raw(); delete (old.summary[0] as { details?: unknown }).details; delete (old.timeline[0] as { details?: unknown }).details
 expect(parseDayReviewResult(old, q).timeline[0]?.details).toBeUndefined()
 expect(() => parseDayReviewResult({ ...raw(), summary: [{ ...raw().summary[0], details: { ...details, quotes: null } }] }, q)).toThrow()
 const bad = raw(); bad.coverage[0]!.details!.visible_count = 2
 expect(() => parseDayReviewResult(bad, q)).toThrow()
})
it('disposal aborts subscription reads without generating or retaining a timer', async () => {
 vi.useFakeTimers()
 try {
  let active: AbortSignal | undefined
  const calls: string[] = [], listener = vi.fn()
  const sdk = createArkmeSdk({ fetchImpl: async (_, init) => {
   const op = JSON.parse(String(init?.body)).operation; calls.push(op)
   if (op === 'provider.capabilities') return new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: { calendarDayReview: true } } }))
   active = init?.signal ?? undefined
   return new Promise((_, reject) => active!.addEventListener('abort', () => reject(active!.reason), { once: true }))
  } })
  const dispose = sdk.subscribeDayReview(q, listener)
  await vi.advanceTimersByTimeAsync(0); dispose(); await vi.advanceTimersByTimeAsync(60000)
  expect(active?.aborted).toBe(true); expect(listener).not.toHaveBeenCalled()
  expect(calls).toEqual(['provider.capabilities', 'calendar.day-review.state']); expect(vi.getTimerCount()).toBe(0)
 } finally { vi.useRealTimers() }
})

it('preserves large detail lists up to the source capacity while keeping quotations bounded', () => {
 for (const field of ['roles', 'events', 'todos'] as const) {
  const input = raw(); input.summary[0]!.details = { ...details, [field]: Array.from({ length: 100 }, (_, i) => `事项 ${i}`) }
  expect(parseDayReviewResult(input, q).summary[0]!.details![field]).toHaveLength(100)
  input.summary[0]!.details[field].push('超限')
  expect(() => parseDayReviewResult(input, q)).toThrow()
 }
 const input = raw(); input.summary[0]!.details = { ...details, quotes: Array(33).fill('原话') }
 expect(() => parseDayReviewResult(input, q)).toThrow()
})
