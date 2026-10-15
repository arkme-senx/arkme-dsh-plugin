import { afterEach, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseRecordingTotalMetrics } from '../src/recording-total-metrics.js'
import { RecordingTotalMetrics } from '../src/client/recordings/RecordingTotalMetrics.js'
import { connectArkmeLocale, type ArkmeLocale } from '../src/client/locale.js'

const setLocale = (active: ArkmeLocale) => connectArkmeLocale({ getLocale: () => ({ active }), subscribe: () => () => {} })()
afterEach(() => setLocale('zh'))
const snapshot = { version: 2, scope: 'all_uploaded_recordings', as_of_ms: 1_792_051_200_000,
  storage: { state: 'ready', bytes: 2 ** 40, archive_bytes: 2 ** 40, clip_bytes: 0 }, asr_input: { state: 'ready', duration_ms: 3_600_000_000, basis: 'observed' } }

it('accepts only an explicitly account-wide, versioned snapshot, not a month or day total', () => {
  for (const value of [undefined, {}, { ...snapshot, version: 1 }, { ...snapshot, scope: 'month' }, { ...snapshot, as_of_ms: 0 }, { ...snapshot, as_of_ms: Number.MAX_SAFE_INTEGER }]) {
    expect(parseRecordingTotalMetrics(value)).toBeUndefined()
  }
  expect(parseRecordingTotalMetrics(snapshot)).toMatchObject({ storage: { bytes: 2 ** 40, state: 'ready' }, asrInput: { durationMillis: 3_600_000_000 } })
})

it.each([undefined, null, '0', -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])('does not turn invalid storage %s into a real zero or discard valid input totals', bytes => {
  expect(parseRecordingTotalMetrics({ ...snapshot, storage: { state: 'ready', bytes } }))
    .toMatchObject({ storage: { state: 'unavailable', bytes: null }, asrInput: { state: 'ready', durationMillis: 3_600_000_000 } })
})

it('requires an input measurement basis and ignores values advertised as unavailable', () => {
  expect(parseRecordingTotalMetrics({ ...snapshot, asr_input: { state: 'ready', duration_ms: 100 } })?.asrInput)
    .toEqual({ state: 'unavailable', durationMillis: null, estimated: false, missingHistoryCount: 0 })
  expect(parseRecordingTotalMetrics({ ...snapshot, storage: { state: 'unavailable', bytes: 999 }, asr_input: { ...snapshot.asr_input, state: 'future' } }))
    .toMatchObject({ storage: { bytes: null }, asrInput: { durationMillis: null } })
})

it('distinguishes zero, missing metrics, loading and a failed refresh with a retained snapshot', () => {
  const empty = parseRecordingTotalMetrics({ ...snapshot, storage: { state: 'ready', bytes: 0, archive_bytes: 0, clip_bytes: 0 }, asr_input: { ...snapshot.asr_input, duration_ms: 0 } })
  expect(renderToStaticMarkup(<RecordingTotalMetrics metrics={empty} loading={false} />)).toContain('0 B')
  expect(renderToStaticMarkup(<RecordingTotalMetrics metrics={empty} loading={false} />)).toContain('0秒')
  const missing = renderToStaticMarkup(<RecordingTotalMetrics loading={false} />)
  expect(missing).toContain('暂不可用'); expect(missing).not.toContain('0 B')
  const loading = renderToStaticMarkup(<RecordingTotalMetrics loading />)
  expect(loading).toContain('—'); expect(loading).not.toContain('暂不可用</dd>')
  const retained = renderToStaticMarkup(<RecordingTotalMetrics metrics={parseRecordingTotalMetrics(snapshot)} loading={false} error />)
  expect(retained).toContain('1 TiB'); expect(retained).toContain('更新失败，显示上次统计')
})

it('keeps long cumulative durations, partial known values and estimates explicit', () => {
  const partial = parseRecordingTotalMetrics({ ...snapshot, storage: { ...snapshot.storage, state: 'partial' }, asr_input: { ...snapshot.asr_input, state: 'partial', basis: 'mixed' } })
  const html = renderToStaticMarkup(<RecordingTotalMetrics metrics={partial} loading={false} />)
  expect(html).toContain('1 TiB（部分已记录）'); expect(html).toContain('约1000小时0分0秒（部分，含估算）')
  const processing = parseRecordingTotalMetrics({ ...snapshot, storage: { state: 'processing' }, asr_input: { state: 'processing' } })
  expect(renderToStaticMarkup(<RecordingTotalMetrics metrics={processing} loading={false} />)).toContain('统计中')
})

it('localizes cumulative metrics without exposing the proposed contract in the product', () => {
  setLocale('en')
  const html = renderToStaticMarkup(<RecordingTotalMetrics loading={false} />)
  expect(html).toContain('All recordings'); expect(html).toContain('Cloud audio storage'); expect(html).toContain('ASR input duration')
  expect(html).not.toContain('recording_totals')
})

it('shows scan progress alongside numbers, then distinguishes completed reads from incomplete historical measurements', () => {
  const metrics = parseRecordingTotalMetrics(snapshot)!
  expect(renderToStaticMarkup(<RecordingTotalMetrics metrics={metrics} loading progress={{ phase: 'calculating', totalDays: 233, completedDays: 48, failedDays: 0 }} />))
    .toContain('48/233 天')
  const complete = renderToStaticMarkup(<RecordingTotalMetrics metrics={metrics} loading={false} progress={{ phase: 'complete', totalDays: 233, completedDays: 233, failedDays: 0 }} />)
  expect(complete).not.toContain('统计中'); expect(complete).not.toContain('缺少计量记录')
  expect(renderToStaticMarkup(<RecordingTotalMetrics metrics={{ ...metrics, storage: { ...metrics.storage, state: 'partial' } }} loading={false}
    progress={{ phase: 'complete', totalDays: 233, completedDays: 233, failedDays: 0 }} />)).toContain('部分历史数据缺少计量记录')
})
