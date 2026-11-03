import { expect, it, vi } from 'vitest'
import { emptyRecordingMonthCache, recordingMonthDays, readRecordingMonthCache, scanRecordingMonth } from '../src/client/recordings/recording-month-totals.js'
import type { RecordingTotalsBucket } from '../src/recording-total-metrics.js'

const month = new Date(2026, 9, 1).getTime(), now = new Date(2026, 10, 3, 12).getTime()
const bucket = (bytes = 10, duration = 1000): RecordingTotalsBucket => ({ sessionCount: 0, metrics: { asOfMillis: now,
  storage: { state: 'ready', bytes, archiveBytes: bytes, clipBytes: 0 }, asrInput: { state: 'ready', durationMillis: duration, estimated: false } } })

it('limits work to the visible local month, includes leap days and excludes future days', () => {
  expect(recordingMonthDays(month, now)).toHaveLength(31)
  expect(recordingMonthDays(new Date(2028, 1, 1).getTime(), new Date(2028, 2, 1).getTime())).toHaveLength(29)
  expect(recordingMonthDays(new Date(2026, 10, 1).getTime(), now)).toHaveLength(3)
  expect(() => recordingMonthDays(new Date(2026, 11, 1).getTime(), now)).toThrow()
  expect(() => recordingMonthDays(month + 1, now)).toThrow()
})

it('sums exact day values with two workers, caches the month and performs no work on immediate return', async () => {
  const cache = emptyRecordingMonthCache(month), states: number[] = []
  let active = 0, peak = 0
  const load = vi.fn(async () => { peak = Math.max(peak, ++active); await new Promise(r => setTimeout(r, 1)); active--; return bucket() })
  const run = (force = false) => scanRecordingMonth({ cache, signal: new AbortController().signal, now: () => now, force,
    bucket: load, publish: value => states.push(value.completedDays) })
  await run()
  expect(load).toHaveBeenCalledTimes(31); expect(peak).toBe(2)
  expect(cache.snapshot).toMatchObject({ phase: 'complete', totalDays: 31, metrics: { storage: { state: 'ready', bytes: 310 }, asrInput: { durationMillis: 31000 } } })
  expect(states).toContain(1)
  load.mockClear(); await run(); expect(load).not.toHaveBeenCalled()
  await run(true); expect(load).toHaveBeenCalledTimes(31)
})

it('keeps failures partial and retries only failed days without substituting zero', async () => {
  const cache = emptyRecordingMonthCache(month), day = month
  await scanRecordingMonth({ cache, signal: new AbortController().signal, now: () => now,
    bucket: async d => { if (d === day) throw Error('offline'); return bucket() }, publish: () => {} })
  expect(cache.snapshot).toMatchObject({ phase: 'error', failedDays: 1, metrics: { storage: { state: 'partial', bytes: 300 } } })
  const load = vi.fn(async () => bucket(50))
  await scanRecordingMonth({ cache, signal: new AbortController().signal, now: () => now, bucket: load, publish: () => {} })
  expect(load.mock.calls).toHaveLength(1)
  expect(cache.snapshot?.metrics?.storage).toMatchObject({ state: 'ready', bytes: 350 })
})

it('discards late reads on cancellation and never overwrites a newer selected-day result', async () => {
  const cache = emptyRecordingMonthCache(month), abort = new AbortController()
  let resolve!: (value: RecordingTotalsBucket) => void
  const work = scanRecordingMonth({ cache, signal: abort.signal, now: () => now,
    bucket: () => new Promise(r => { resolve = r }), publish: () => {} })
  abort.abort(); resolve(bucket(999))
  await expect(work).rejects.toThrow(); expect(cache.entries).toEqual({})
  const next = emptyRecordingMonthCache(month)
  await scanRecordingMonth({ cache: next, signal: new AbortController().signal, now: () => now,
    bucket: async day => { next.entries[day] = { checkedAt: now + 1, bucket: bucket(20) }; return bucket(999) }, publish: () => {} })
  expect(next.snapshot?.metrics?.storage.bytes).toBe(620)
})

it('rejects mismatched months and malformed persisted amounts; an empty verified day remains zero', async () => {
  const cache = emptyRecordingMonthCache(month)
  cache.entries[month] = { checkedAt: now, bucket: bucket(0, 0) }
  expect(readRecordingMonthCache(JSON.stringify(cache), month, now).entries[month]?.bucket.metrics.storage.bytes).toBe(0)
  expect(readRecordingMonthCache(JSON.stringify(cache), new Date(2026, 8, 1).getTime(), now).entries).toEqual({})
  cache.entries[month]!.bucket.metrics.storage.bytes = -1
  expect(readRecordingMonthCache(JSON.stringify(cache), month, now).entries).toEqual({})
})

it('retries a failed forced refresh even while the retained previous value is within its cache lifetime', async () => {
  const cache = emptyRecordingMonthCache(month)
  const run = (load: (day: number) => Promise<RecordingTotalsBucket>, force = false) => scanRecordingMonth({ cache, signal: new AbortController().signal, now: () => now, force, bucket: load, publish: () => {} })
  await run(async () => bucket(10))
  await run(async day => { if (day === month) throw Error('offline after deletion'); return bucket(20) }, true)
  expect(cache.snapshot).toMatchObject({ phase: 'error', failedDays: 1 })
  const retry = vi.fn(async () => bucket(0, 0))
  await run(retry)
  expect(retry).toHaveBeenCalledTimes(1)
  expect(cache.snapshot?.metrics?.storage.bytes).toBe(600)
})

it('keeps stable historical values for a day and refreshes processing dates independently', async () => {
  const cache = emptyRecordingMonthCache(month)
  await scanRecordingMonth({ cache, signal: new AbortController().signal, now: () => now, bucket: async () => bucket(), publish: () => {} })
  const read = vi.fn(async () => bucket())
  await scanRecordingMonth({ cache, signal: new AbortController().signal, now: () => now + 3600_000, bucket: read, publish: () => {} })
  expect(read).not.toHaveBeenCalled()
  cache.entries[month]!.bucket.metrics.asrInput.state = 'processing'
  await scanRecordingMonth({ cache, signal: new AbortController().signal, now: () => now + 3600_000, bucket: read, publish: () => {} })
  expect(read).toHaveBeenCalledTimes(1)
})

it('persists unfinished forced-refresh invalidations and resumes only those dates after reload', async () => {
  const cache = emptyRecordingMonthCache(month)
  await scanRecordingMonth({ cache, signal: new AbortController().signal, now: () => now, bucket: async () => bucket(10), publish: () => {} })
  const abort = new AbortController(), pending: Array<(value: RecordingTotalsBucket) => void> = []
  const work = scanRecordingMonth({ cache, signal: abort.signal, now: () => now, force: true,
    bucket: async day => day === month ? bucket(20) : await new Promise(resolve => pending.push(resolve)), publish: () => {} })
  await vi.waitFor(() => expect(pending).toHaveLength(2))
  abort.abort(); for (const resolve of pending) resolve(bucket(9999))
  await expect(work).rejects.toThrow()
  const restored = readRecordingMonthCache(JSON.stringify(cache), month, now)
  expect(restored.entries[month]!.needsRefresh).toBeUndefined()
  expect(Object.values(restored.entries).filter(entry => entry.needsRefresh)).toHaveLength(30)
  const read = vi.fn(async () => bucket(0, 0))
  await scanRecordingMonth({ cache: restored, signal: new AbortController().signal, now: () => now, bucket: read, publish: () => {} })
  expect(read).toHaveBeenCalledTimes(30)
  expect(restored.snapshot).toMatchObject({ phase: 'complete', failedDays: 0, metrics: { storage: { state: 'ready', bytes: 20 } } })
})
