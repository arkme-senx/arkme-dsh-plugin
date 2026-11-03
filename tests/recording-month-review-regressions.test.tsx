// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { projectRecordingDailyMetrics } from '../src/recording-daily-metrics.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: mocks.call }))
import { RecordingTotalMetrics, RecordingTotalMetricsLoader } from '../src/client/recordings/RecordingTotalMetrics.js'
import { cacheRecordingDayTotals } from '../src/client/recordings/use-recording-month-totals.js'
const oct = new Date(2026, 9, 1).getTime(), nov = new Date(2026, 10, 1).getTime()
const metric = (bytes: number) => ({ asOfMillis: Date.now(), storage: { state: 'ready', bytes, archiveBytes: bytes, clipBytes: 0 }, asrInput: { state: 'ready', durationMillis: bytes * 1000, estimated: false } })
let renderer: ReactTestRenderer | undefined
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 3, 12)); localStorage.clear(); mocks.call.mockReset() })
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers() })

it('retains invalidation for unfinished dates after a forced refresh is cancelled by switching months', async () => {
  let phase = 'initial'
  const pending: Array<(value: unknown) => void> = []
  mocks.call.mockImplementation((op, params) => {
    if (new Date(params.dateStamp).getMonth() !== 9) return Promise.resolve(metric(1))
    if (phase === 'hold') return new Promise(resolve => pending.push(resolve))
    return Promise.resolve(metric(phase === 'initial' ? 10 : 0))
  })
  const element = (monthStamp: number, refreshRevision: string) => <RecordingTotalMetricsLoader account="test:review-cancelled-refresh" active monthStamp={monthStamp} refreshRevision={refreshRevision} />
  await act(async () => { renderer = create(element(oct, '0')) })
  expect(renderer!.root.findByType(RecordingTotalMetrics).props.metrics.storage.bytes).toBe(310)
  phase = 'hold'
  await act(async () => renderer!.update(element(oct, '1')))
  expect(pending).toHaveLength(2)
  await act(async () => renderer!.update(element(nov, '1')))
  phase = 'after-delete'
  const before = mocks.call.mock.calls.length
  await act(async () => renderer!.update(element(oct, '1')))
  expect(mocks.call.mock.calls.length).toBeGreaterThan(before)
  expect(renderer!.root.findByType(RecordingTotalMetrics).props.metrics.storage.bytes).toBe(0)
  await act(async () => { for (const resolve of pending) resolve(metric(9999)) })
})

it('never turns a future-day cache write into a failure of an otherwise readable day', () => {
  const metrics = projectRecordingDailyMetrics({ bytes: 50, archive_bytes: 50, clip_bytes: 0, confirmed_count: 1, pending_count: 0, unknown_count: 0 }, [],
    { duration_ms: 1000, confirmed_count: 1, pending_count: 0, unknown_count: 0, estimated_count: 0 })
  expect(() => cacheRecordingDayTotals('test:review-future-day', new Date(2026, 11, 1).getTime(), metrics)).not.toThrow()
})

it('shows a terminal error instead of an endless spinner when the month is rejected', async () => {
  await act(async () => { renderer = create(<RecordingTotalMetricsLoader account="test:review-invalid-month" active monthStamp={new Date(2026, 11, 1).getTime()} refreshRevision="0" />) })
  expect(renderer!.root.findByType(RecordingTotalMetrics).props.error).toBe(true)
  expect(renderer!.root.findByProps({ 'aria-label': '当月录音累计' }).props['aria-busy']).toBe(false)
})
