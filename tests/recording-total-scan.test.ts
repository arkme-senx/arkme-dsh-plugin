import { expect, it, vi } from 'vitest'
import { projectRecordingTotalsBucket } from '../src/recording-total-projection.js'
import { emptyRecordingTotalsCache, readRecordingTotalsCache, scanRecordingTotals, type RecordingTotalsProgress } from '../src/client/recordings/recording-total-scan.js'
import type { RecordingTotalsBucket, RecordingTotalsIndexItem } from '../src/recording-total-metrics.js'

const day = new Date(2026, 9, 10).getTime(), next = day + 86_400_000, now = next + 86_400_000
const row = (dateStamp: number, key = String(dateStamp)): RecordingTotalsIndexItem => ({ key, dateStamp, revision: '1', pending: false })
const bucket = (bytes = 100, durationMillis = 1000): RecordingTotalsBucket => ({ sessionCount: 1, metrics: { asOfMillis: now,
  storage: { state: 'ready', bytes, archiveBytes: bytes, clipBytes: 0 }, asrInput: { state: 'ready', durationMillis, estimated: false } } })
const controller = () => new AbortController()

it('projects authoritative owner totals without reconstructing transcript/storage internals', () => {
  const result = projectRecordingTotalsBucket({ sessionCount: 1,
    storage: { bytes: 421, archive_bytes: 321, clip_bytes: 100, confirmed_count: 1, pending_count: 0, unknown_count: 0 },
    asrInput: { duration_ms: 3000, confirmed_count: 1, pending_count: 0, unknown_count: 0, estimated_count: 0 } })
  expect(result).toMatchObject({ sessionCount: 1, metrics: { storage: { state: 'ready', bytes: 421 }, asrInput: { durationMillis: 3000 } } })
})

it('keeps unavailable/pending metrics distinct from zero', () => {
  const result = projectRecordingTotalsBucket({ sessionCount: 1,
    storage: { bytes: 0, archive_bytes: 0, clip_bytes: 0, confirmed_count: 0, pending_count: 1, unknown_count: 0 },
    asrInput: { duration_ms: 0, confirmed_count: 0, pending_count: 1, unknown_count: 0, estimated_count: 0 } })
  expect(result.metrics).toMatchObject({ storage: { state: 'processing', bytes: null }, asrInput: { state: 'processing', durationMillis: null } })
})

it('paginates through empty owned pages, limits concurrency to two, publishes partial progress and caches every day', async () => {
  const cache = emptyRecordingTotalsCache(), snapshots: RecordingTotalsProgress[] = []
  const index = vi.fn(async (_: number, offset: number) => offset === 0 ? { items: [], nextOffset: 50 } : { items: [row(day), row(next), row(day - 86_400_000)], nextOffset: null })
  let active = 0, peak = 0
  const load = vi.fn(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return bucket() })
  await scanRecordingTotals({ cache, signal: controller().signal, now: () => now, index, bucket: load, publish: s => snapshots.push(s) })
  expect(index.mock.calls.map(c => c[1])).toEqual([0, 50]); expect(peak).toBe(2)
  expect(snapshots.some(s => s.metrics?.storage.state === 'partial' && s.completedDays === 1)).toBe(true)
  expect(cache.snapshot).toMatchObject({ phase: 'complete', completedDays: 3, totalDays: 3, metrics: { storage: { bytes: 300, state: 'ready' }, asrInput: { durationMillis: 3000 } } })
  const restored = readRecordingTotalsCache(JSON.stringify(cache))
  load.mockClear()
  await scanRecordingTotals({ cache: restored, signal: controller().signal, now: () => now + 1, index, bucket: load, publish: () => {} })
  expect(load).not.toHaveBeenCalled()
})

it('subtracts deleted days and reloads changed membership, not the cached old amount', async () => {
  const cache = emptyRecordingTotalsCache()
  let items = [row(day), row(next)], bytes = 100
  const run = () => scanRecordingTotals({ cache, signal: controller().signal, now: () => now,
    index: async () => ({ items, nextOffset: null }), bucket: async () => bucket(bytes), publish: () => {} })
  await run(); expect(cache.snapshot?.metrics?.storage.bytes).toBe(200)
  items = [{ ...row(next), revision: '2' }]; bytes = 70
  await run(); expect(cache.snapshot?.metrics?.storage.bytes).toBe(70)
  expect(Object.keys(cache.entries)).toEqual([String(next)])
})

it('retains known values on failure, retries failed buckets and never promotes incomplete sums to complete', async () => {
  const cache = emptyRecordingTotalsCache(), index = async () => ({ items: [row(day), row(next)], nextOffset: null })
  const run = (fail: boolean) => scanRecordingTotals({ cache, signal: controller().signal, now: () => now, index,
    bucket: async d => { if (fail && d === day) throw Error('offline'); return bucket() }, publish: () => {} })
  await run(true)
  expect(cache.snapshot).toMatchObject({ phase: 'error', failedDays: 1, metrics: { storage: { state: 'partial', bytes: 100 } } })
  await run(false)
  expect(cache.snapshot).toMatchObject({ phase: 'complete', failedDays: 0, metrics: { storage: { state: 'ready', bytes: 200 } } })
  await scanRecordingTotals({ cache, signal: controller().signal, now: () => now, index: async () => { throw Error('offline') }, bucket: async () => bucket(), publish: () => {} })
  expect(cache.snapshot).toMatchObject({ phase: 'error', metrics: { storage: { bytes: 200 } } })
})

it('aborts old-account reads without storing their late result', async () => {
  const cache = emptyRecordingTotalsCache(), abort = controller()
  let resolve!: (b: RecordingTotalsBucket) => void
  const pending = scanRecordingTotals({ cache, signal: abort.signal, index: async () => ({ items: [row(day)], nextOffset: null }),
    bucket: () => new Promise(r => { resolve = r }), publish: () => {} })
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  abort.abort(); resolve(bucket(999))
  await expect(pending).rejects.toThrow()
  expect(cache.entries).toEqual({})
})

it('rejects duplicate/moving pagination and bucket membership mismatches rather than reporting zero', async () => {
  const cache = emptyRecordingTotalsCache()
  await scanRecordingTotals({ cache, signal: controller().signal, index: async (_, offset) => ({ items: [row(day)], nextOffset: offset ? null : 50 }),
    bucket: async () => bucket(), publish: () => {} })
  expect(cache.snapshot?.phase).toBe('error'); expect(cache.snapshot?.metrics).toBeUndefined()
  await scanRecordingTotals({ cache, signal: controller().signal, index: async () => ({ items: [row(day)], nextOffset: null }),
    bucket: async () => ({ ...bucket(), sessionCount: 0 }), publish: () => {} })
  expect(cache.snapshot?.metrics?.storage).toMatchObject({ state: 'unavailable', bytes: null })
})

it('accepts a verified empty history as zero and discards corrupt persisted metrics', async () => {
  const cache = emptyRecordingTotalsCache()
  await scanRecordingTotals({ cache, signal: controller().signal, index: async () => ({ items: [], nextOffset: null }), bucket: async () => bucket(), publish: () => {} })
  expect(cache.snapshot).toMatchObject({ phase: 'complete', metrics: { storage: { state: 'ready', bytes: 0 } } })
  expect(readRecordingTotalsCache('{broken')).toEqual(emptyRecordingTotalsCache())
  expect(readRecordingTotalsCache(JSON.stringify({ version: 2, entries: { [day]: { revision: 'v', checkedAt: now, bucket: bucket(-10) } } }))).toEqual(emptyRecordingTotalsCache())
})

it('keeps cached numbers visible during a forced refresh and preserves processing/estimated states', async () => {
  const cache = emptyRecordingTotalsCache(), index = async () => ({ items: [row(day)], nextOffset: null })
  await scanRecordingTotals({ cache, signal: controller().signal, index, bucket: async () => bucket(500), publish: () => {} })
  const snapshots: RecordingTotalsProgress[] = []
  await scanRecordingTotals({ cache, signal: controller().signal, force: true, index, bucket: async () => ({ ...bucket(700), metrics: {
    ...bucket(700).metrics, asrInput: { state: 'processing', durationMillis: 4000, estimated: true },
  } }), publish: s => snapshots.push(s) })
  expect(snapshots.find(s => s.phase === 'calculating' && s.completedDays === 0)?.metrics?.storage.bytes).toBe(500)
  expect(cache.snapshot?.metrics).toMatchObject({ storage: { bytes: 700, state: 'ready' }, asrInput: { state: 'processing', durationMillis: 4000, estimated: true } })
})
