// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { projectRecordingDailyMetrics } from '../src/recording-daily-metrics.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: mocks.call }))
import { cacheRecordingDayTotals } from '../src/client/recordings/use-recording-month-totals.js'
import { RecordingTotalMetrics, RecordingTotalMetricsLoader } from '../src/client/recordings/RecordingTotalMetrics.js'
const oct = new Date(2026, 9, 1).getTime(), nov = new Date(2026, 10, 1).getTime()
const metric = (bytes: number) => ({ asOfMillis: Date.now(), storage: { state: 'ready', bytes, archiveBytes: bytes, clipBytes: 0 }, asrInput: { state: 'ready', durationMillis: bytes * 1000, estimated: false } })
let renderer: ReactTestRenderer | undefined
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 3, 12)); localStorage.clear(); mocks.call.mockReset() })
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers() })

it('follows the browsed month, reuses a selected day, restores month cache and separates accounts', async () => {
  mocks.call.mockImplementation(async (op, params) => { expect(op).toBe('recordings.totals.day'); return metric(params.account === 'test:monthly-a' ? 10 : 100) })
  const daily = { dateStamp: new Date(2026, 9, 15).getTime(), metrics: projectRecordingDailyMetrics({ bytes: 50, archive_bytes: 50, clip_bytes: 0, confirmed_count: 1, pending_count: 0, unknown_count: 0 }, [],
    { duration_ms: 50000, confirmed_count: 1, pending_count: 0, unknown_count: 0, estimated_count: 0 }) }
  cacheRecordingDayTotals('test:monthly-a', daily.dateStamp, daily.metrics)
  const element = (monthStamp: number, account = 'test:monthly-a') => <RecordingTotalMetricsLoader account={account} active refreshRevision="0" monthStamp={monthStamp} />
  await act(async () => { renderer = create(element(oct)) })
  expect(mocks.call).toHaveBeenCalledTimes(30)
  expect(renderer!.root.findByType(RecordingTotalMetrics).props.metrics.storage.bytes).toBe(350)
  await act(async () => renderer!.update(element(nov)))
  expect(mocks.call).toHaveBeenCalledTimes(33)
  expect(renderer!.root.findByType(RecordingTotalMetrics).props.metrics.storage.bytes).toBe(30)
  await act(async () => renderer!.update(element(oct)))
  expect(mocks.call).toHaveBeenCalledTimes(33)
  expect(renderer!.root.findByType(RecordingTotalMetrics).props.metrics.storage.bytes).toBe(350)
  await act(async () => renderer!.update(element(oct, 'test:monthly-b')))
  expect(renderer!.root.findByType(RecordingTotalMetrics).props.metrics.storage.bytes).toBe(3100)
})

it('cancels the old month and cannot publish its late totals into the new month', async () => {
  const pending: Array<{ resolve: (value: unknown) => void; signal: AbortSignal }> = []
  mocks.call.mockImplementation((op, params, signal) => new Date(params.dateStamp).getMonth() === 9
    ? new Promise(resolve => pending.push({ resolve, signal })) : Promise.resolve(metric(5)))
  const element = (monthStamp: number) => <RecordingTotalMetricsLoader account="test:monthly-late" active refreshRevision="0" monthStamp={monthStamp} />
  await act(async () => { renderer = create(element(oct)) })
  expect(pending).toHaveLength(2)
  await act(async () => renderer!.update(element(nov)))
  expect(pending.every(value => value.signal.aborted)).toBe(true)
  await act(async () => { for (const value of pending) value.resolve(metric(9999)) })
  expect(renderer!.root.findByType(RecordingTotalMetrics).props.metrics.storage.bytes).toBe(15)
  expect(renderer!.root.findByType(RecordingTotalMetrics).props.monthStamp).toBe(nov)
})
