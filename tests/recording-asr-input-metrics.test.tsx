import { afterEach, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { projectRecordingDailyMetrics } from '../src/recording-daily-metrics.js'
import { projectRecordingAsrInputMetrics } from '../src/recording-asr-input-metrics.js'
import { RecordingDailyMetrics } from '../src/client/recordings/RecordingDailyMetrics.js'
import { connectArkmeLocale } from '../src/client/locale.js'

const start = new Date(2026, 9, 8).getTime(), end = start + 86400000
const session = { id: 's', belong_usr: 42, start_at: start, end_at: end }
const speech = (spans: number[][], duration_ms = spans.reduce((sum, [s, e]) => sum + e! - s!, 0)) => ({ state: 'ready', basis: 'observed', spans, duration_ms })
const child = { id: 'c', session_id: 's', start_at: 0, duration: 60000, has_asr: true, archive_size: 40,
  asr_input_metrics: speech([[1000, 3000], [5000, 9000]]) }
const metrics = (children: unknown[], sessions: unknown[] = [session]) => projectRecordingAsrInputMetrics({ session_ls: sessions, child_ls: children }, 42, start, end)
afterEach(() => connectArkmeLocale({ getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} })())

it('counts reported model input independently of text and speaker identity', () => {
  expect(metrics([{ ...child, has_asr: false }])).toEqual({ asrInputEstimatedCount: 0, asrInputDurationMillis: 6000, asrInputState: 'ready', asrInputConfirmedCount: 1, asrInputPendingCount: 0, asrInputUnknownCount: 0 })
})
it('counts overlapping input and independent recordings separately while deduplicating response children', () => {
  const overlapping = { ...child, asr_input_metrics: speech([[5000, 9000], [1000, 6000], [9000, 10000]], 10000) }
  expect(metrics([overlapping, overlapping, { ...overlapping, id: 'other-device' }]).asrInputDurationMillis).toBe(20000)
})
it('selects the newest duplicate child regardless of response order', () => {
  const newer = { ...child, upload_at: start, asr_input_metrics: speech([[0, 1000]]) }
  expect(metrics([child, newer]).asrInputDurationMillis).toBe(1000)
  expect(metrics([newer, child]).asrInputDurationMillis).toBe(1000)
})
it('uses recording ownership, including all speakers and excluding others recordings', () => {
  expect(metrics([child, { ...child, id: 'foreign', session_id: 'foreign' }], [session, { ...session, id: 'foreign', belong_usr: 7 }]).asrInputDurationMillis).toBe(6000)
  expect(metrics([child], [{ ...session, belong_usr: 0 }])).toMatchObject({ asrInputDurationMillis: 0, asrInputState: 'ready' })
  expect(metrics([child], [{ ...session, belong_usr: undefined }]).asrInputState).toBe('unavailable')
})
it('clips spans at midnight using absolute and session-relative child starts', () => {
  const spans = speech([[29000, 32000], [40000, 50000]])
  expect(metrics([{ ...child, start_at: start - 30000, asr_input_metrics: spans }]).asrInputDurationMillis).toBe(12000)
  expect(metrics([{ ...child, asr_input_metrics: spans }], [{ ...session, start_at: start - 30000 }]).asrInputDurationMillis).toBe(12000)
  expect(metrics([{ ...child, start_at: end - 30000, asr_input_metrics: spans }]).asrInputDurationMillis).toBe(1000)
  expect(metrics([{ ...child, start_at: end }]).asrInputDurationMillis).toBe(0)
})
it('keeps input readiness independent of cross-midnight archive size and transcript text', () => {
  const data = { session_ls: [session], child_ls: [{ ...child, start_at: end - 30000, asr_input_metrics: speech([[29000, 32000]]) }] }
  expect(projectRecordingDailyMetrics(data, [], 42, start, end)).toMatchObject({ archiveState: 'unavailable', asrInputState: 'ready', asrInputDurationMillis: 1000, textCount: 0 })
})
it('distinguishes confirmed silence, pending, missing historical data and a truly empty day', () => {
  expect(metrics([{ ...child, asr_input_metrics: speech([]) }])).toMatchObject({ asrInputState: 'ready', asrInputDurationMillis: 0, asrInputConfirmedCount: 1 })
  expect(metrics([{ ...child, asr_input_metrics: { state: 'processing' } }]).asrInputState).toBe('processing')
  expect(metrics([{ ...child, asr_input_metrics: undefined, asr: [{ s: 0, e: 60000, t: '文字' }] }]).asrInputState).toBe('unavailable')
  expect(metrics([], [])).toMatchObject({ asrInputState: 'ready', asrInputDurationMillis: 0 })
  expect(metrics([]).asrInputState).toBe('unavailable')
  expect(metrics([child, { ...child, id: 'missing', asr_input_metrics: undefined }])).toMatchObject({ asrInputState: 'partial', asrInputDurationMillis: 6000, asrInputUnknownCount: 1 })
})
it('keeps observed input visible while the current attempt receipt is pending', () => {
  const pending = { ...child, asr_input_metrics: { ...speech([[1000, 3000], [1000, 3000]]), state: 'processing' } }
  expect(metrics([pending])).toMatchObject({ asrInputState: 'processing', asrInputDurationMillis: 4000,
    asrInputPendingCount: 1, asrInputConfirmedCount: 1, asrInputUnknownCount: 0 })
  const daily = projectRecordingDailyMetrics({ session_ls: [session], child_ls: [pending] }, [], 42, start, end)
  const rendered = renderToStaticMarkup(<RecordingDailyMetrics metrics={daily}/>)
  expect(rendered).toContain('转写输入时长 4秒（已确认）')
  expect(rendered).toContain('处理中，统计待更新')
  expect(metrics([{ ...pending, asr_input_metrics: { ...pending.asr_input_metrics, duration_ms: 5000 } }]))
    .toMatchObject({ asrInputState: 'unavailable', asrInputPendingCount: 1, asrInputUnknownCount: 1, asrInputDurationMillis: 0 })
  expect(metrics([{ ...pending, asr_input_metrics: { ...pending.asr_input_metrics, basis: 'future-basis' } }]))
    .toMatchObject({ asrInputState: 'unavailable', asrInputPendingCount: 1, asrInputUnknownCount: 1, asrInputDurationMillis: 0 })
})
it('keeps unfinished cross-midnight children pending before SD confirms their duration', () => {
  const pending = { ...child, duration: 0, has_asr: false, asr_input_metrics: { state: 'processing', duration_ms: null, spans: null } }
  const result = metrics([pending], [{ ...session, start_at: start - 3000, end_at: start + 3000 }])
  expect(result).toMatchObject({ asrInputState: 'unavailable', asrInputPendingCount: 1,
    asrInputUnknownCount: 1, asrInputConfirmedCount: 0, asrInputDurationMillis: 0 })
  expect(metrics([{ ...pending, start_at: end }])).toMatchObject({ asrInputPendingCount: 0, asrInputUnknownCount: 0 })
  expect(metrics([{ ...pending, asr_input_metrics: { state: 'unavailable' } }])).toMatchObject({ asrInputPendingCount: 0, asrInputUnknownCount: 1 })
  const hinted = { ...pending, duration_hint: 6000 }
  const crossing = [{ ...session, start_at: start - 3000 }]
  expect(metrics([hinted], crossing)).toMatchObject({ asrInputState: 'processing', asrInputPendingCount: 1, asrInputUnknownCount: 0, asrInputDurationMillis: 0 })
  expect(metrics([hinted], [{ ...session, start_at: start - 6000 }])).toMatchObject({ asrInputPendingCount: 0, asrInputUnknownCount: 0 })
  expect(metrics([{ ...hinted, asr_input_metrics: { ...speech([[0, 6000]]), state: 'processing' } }], crossing))
    .toMatchObject({ asrInputDurationMillis: 0, asrInputPendingCount: 1, asrInputUnknownCount: 1 })
})
it.each([
  undefined, null, { state: 'ready', duration_ms: 0 }, speech([[0, 1000]], 2000), speech([[-1, 1000]]),
  speech([[0, 60001]]), speech([[0, 1.5]]), speech([[1000, 0]]), speech([[0, 1000]], NaN),
  { state: 'ready', duration_ms: '1000', spans: [[0, 1000]] }, speech([[0, Number.MAX_SAFE_INTEGER + 1]]),
  { ...speech([[0, 1000]]), basis: 'unknown' },
])('does not manufacture a duration from malformed or missing evidence: %j', asr_input_metrics => {
  expect(metrics([{ ...child, asr_input_metrics }])).toMatchObject({ asrInputState: 'unavailable', asrInputDurationMillis: 0 })
})
it('rejects unsafe timing and missing response facts', () => {
  expect(metrics([{ ...child, start_at: Number.MAX_SAFE_INTEGER }]).asrInputState).toBe('unavailable')
  expect(projectRecordingAsrInputMetrics({}, 42, start, end).asrInputState).toBe('unavailable')
  expect(projectRecordingAsrInputMetrics({ session_ls: [], child_ls: [] }, 0, start, end).asrInputState).toBe('unavailable')
})
it('renders precise duration, localized states and no stale values during loading', () => {
  const daily = projectRecordingDailyMetrics({ session_ls: [session], child_ls: [child] }, [], 42, start, end)
  const ready = { ...daily, asrInputDurationMillis: 8316000 }
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready}/>)).toContain('转写输入时长 2小时18分36秒')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready}/>)).toContain('缺少可靠记录的历史输入时长暂不可用')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={{ ...ready, asrInputDurationMillis: 500 }}/>)).toContain('不足1秒')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready} loading/>)).toContain('转写输入时长 —')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready} loading/>)).not.toContain('2小时')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready} localPending/>)).toContain('2小时18分36秒（已确认）')
  expect(renderToStaticMarkup(<RecordingDailyMetrics/>)).toContain('转写输入时长 暂不可用')
  const partial = renderToStaticMarkup(<RecordingDailyMetrics metrics={{ ...daily, asrInputState: 'partial', asrInputUnknownCount: 1 }}/>)
  expect(partial).toContain('转写输入时长 6秒（已确认）')
  expect(partial).toContain('部分转写输入时长暂不可确认')
  connectArkmeLocale({ getLocale: () => ({ active: 'en' }), subscribe: () => () => {} })()
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready}/>)).toContain('ASR input 2h 18m 36s')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={ready}/>)).toContain('Historical input without reliable records is unavailable')
})

it('preserves partial attempt totals and clearly labels historical estimates', () => {
  const partial = { ...child, asr_input_metrics: { ...speech([[1000, 3000]]), state: 'partial' } }
  expect(metrics([partial])).toMatchObject({ asrInputState: 'partial', asrInputDurationMillis: 2000, asrInputUnknownCount: 1 })
  const estimated = { ...child, asr_input_metrics: { ...speech([[1000, 3000]]), basis: 'estimated' } }
  expect(metrics([estimated])).toMatchObject({ asrInputState: 'ready', asrInputDurationMillis: 2000, asrInputEstimatedCount: 1 })
  const daily = projectRecordingDailyMetrics({ session_ls: [session], child_ls: [estimated, { ...child, id: 'measured' }] }, [], 42, start, end)
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={daily}/>)).toContain('转写输入时长 约8秒（含估算）')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={daily} localPending/>)).toContain('约8秒（部分，含估算）')
})
it('clips each repeated input separately across midnight', () => {
  const repeated = { ...child, start_at: end - 30000, asr_input_metrics: speech([[29000, 32000], [29000, 32000]]) }
  expect(metrics([repeated]).asrInputDurationMillis).toBe(2000)
})

it.each([
  ['east of UTC', '2026-10-08T00:00:00+08:00', '2026-10-09T00:00:00+08:00', '2026-10-10T00:00:00+08:00'],
  ['west of UTC', '2026-10-08T00:00:00-07:00', '2026-10-09T00:00:00-07:00', '2026-10-10T00:00:00-07:00'],
  ['short DST day', '2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00', '2026-03-10T00:00:00-04:00'],
  ['long DST day', '2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00', '2026-11-03T00:00:00-05:00'],
])('preserves every input millisecond across caller-supplied dates: %s', (_, from, boundary, to) => {
  const firstStart = Date.parse(from), midnight = Date.parse(boundary), secondEnd = Date.parse(to)
  const input = speech([[29000, 32000], [29000, 32000], [40000, 50000]])
  const data = {
    session_ls: [{ ...session, start_at: midnight - 30000, end_at: midnight + 30000 }],
    child_ls: [{ ...child, start_at: midnight - 30000, asr_input_metrics: input }],
  }
  const first = projectRecordingAsrInputMetrics(data, 42, firstStart, midnight)
  const second = projectRecordingAsrInputMetrics(data, 42, midnight, secondEnd)
  expect(first).toMatchObject({ asrInputState: 'ready', asrInputDurationMillis: 2000 })
  expect(second).toMatchObject({ asrInputState: 'ready', asrInputDurationMillis: 14000 })
  expect(first.asrInputDurationMillis + second.asrInputDurationMillis).toBe(input.duration_ms)
})
