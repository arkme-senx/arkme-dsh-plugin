import type { RecordingTotalsBucket } from '../../recording-total-metrics.js'
import { isRecordingLocalDateOnOrAfterMinimum } from '../../recording-time.js'
import { aggregate, validBucket, type RecordingTotalsProgress } from './recording-total-scan.js'

interface Entry { checkedAt: number; bucket: RecordingTotalsBucket; needsRefresh?: true }
export interface RecordingMonthCache { version: 1; monthStamp: number; entries: Record<string, Entry>; snapshot?: RecordingTotalsProgress }
export const emptyRecordingMonthCache = (monthStamp: number): RecordingMonthCache => ({ version: 1, monthStamp, entries: {} })

export function recordingMonthDays(monthStamp: number, now = Date.now()): number[] {
  const start = new Date(monthStamp), today = new Date(now); today.setHours(0, 0, 0, 0)
  if (!Number.isSafeInteger(monthStamp) || start.getDate() !== 1 || start.getHours() !== 0 || start.getMinutes() !== 0 || start.getSeconds() !== 0 || start.getMilliseconds() !== 0
    || !isRecordingLocalDateOnOrAfterMinimum(monthStamp) || monthStamp > today.getTime()) throw new Error('录音统计月份无效')
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1), days: number[] = []
  for (const day = new Date(start); day < end && day <= today; day.setDate(day.getDate() + 1)) days.push(day.getTime())
  return days
}

export function readRecordingMonthCache(raw: string | null, monthStamp: number, now = Date.now()): RecordingMonthCache {
  try {
    const value = JSON.parse(raw ?? 'null') as RecordingMonthCache
    if (value?.version !== 1 || value.monthStamp !== monthStamp || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries) || Object.keys(value.entries).length > 31) throw Error()
    const allowed = new Set(recordingMonthDays(monthStamp, now))
    for (const [key, entry] of Object.entries(value.entries)) if (!allowed.has(Number(key)) || !entry || !Number.isSafeInteger(entry.checkedAt) || entry.checkedAt <= 0 || entry.checkedAt > now + 60_000 || entry.needsRefresh !== undefined && entry.needsRefresh !== true || !validBucket(entry.bucket)) throw Error()
    // Recompute persisted snapshots from validated day values only.
    delete value.snapshot
    return value
  } catch { return emptyRecordingMonthCache(monthStamp) }
}

export function recordingMonthSnapshot(cache: RecordingMonthCache, days: number[], phase: RecordingTotalsProgress['phase'], completedDays: number, failedDays = 0, error?: string): RecordingTotalsProgress {
  const buckets = days.flatMap(day => cache.entries[day] ? [cache.entries[day]!.bucket] : [])
  return { phase, completedDays, totalDays: days.length, failedDays, ...(error ? { error } : {}),
    metrics: aggregate(buckets, buckets.length !== days.length || failedDays > 0,
      buckets.length ? Math.min(...buckets.map(value => value.metrics.asOfMillis)) : Date.now()) }
}

/** At most 31 local days; never enumerate account history or request media. */
export async function scanRecordingMonth(input: {
  cache: RecordingMonthCache; signal: AbortSignal; force?: boolean; now?: () => number
  bucket: (dateStamp: number) => Promise<RecordingTotalsBucket>; publish: (value: RecordingTotalsProgress) => void
}) {
  const { cache, signal } = input, now = input.now ?? Date.now, started = now()
  signal.throwIfAborted()
  const days = recordingMonthDays(cache.monthStamp, started), done = new Set<number>(), failed = new Set<number>()
  const fresh = (day: number) => {
    const old = cache.entries[day]
    if (!old || old.needsRefresh) return false
    const pending = old.bucket.metrics.storage.state === 'processing' || old.bucket.metrics.asrInput.state === 'processing'
    const current = now(), ttl = pending || current - day < 2 * 86400_000 ? 60_000 : 86400_000
    return current >= old.checkedAt && current - old.checkedAt < ttl
  }
  const queue = days.filter(day => { if (!input.force && fresh(day)) { done.add(day); return false }; return true })
  // A refresh revision invalidates every affected day before work starts.
  // Cancellation can leave old numbers visible, but never make them fresh again.
  if (input.force) for (const day of queue) {
    const old = cache.entries[day]
    if (old) cache.entries[day] = { ...old, needsRefresh: true }
  }
  const queuedEntries = new Map(queue.map(day => [day, cache.entries[day]]))
  let error = ''
  const emit = (phase: RecordingTotalsProgress['phase']) => {
    signal.throwIfAborted()
    const value = recordingMonthSnapshot(cache, days, phase, done.size, failed.size, error)
    cache.snapshot = value; input.publish(value)
  }
  emit('calculating')
  let next = 0
  const worker = async () => {
    for (;;) {
      signal.throwIfAborted()
      const day = queue[next++]
      if (day === undefined) return
      // A selected day can publish newer metrics while this month is loading.
      const before = cache.entries[day]
      if (before && before !== queuedEntries.get(day) && fresh(day)) { done.add(day); emit('calculating'); continue }
      try {
        const value = await input.bucket(day)
        signal.throwIfAborted()
        if (!validBucket(value)) throw new Error('录音统计响应无效')
        if (cache.entries[day] === before) cache.entries[day] = { checkedAt: now(), bucket: value }
        done.add(day)
      } catch (reason) {
        signal.throwIfAborted()
        if (cache.entries[day] !== before && fresh(day)) { done.add(day); emit('calculating'); continue }
        failed.add(day)
        if (cache.entries[day]) cache.entries[day] = { ...cache.entries[day]!, needsRefresh: true }
        error = reason instanceof Error ? reason.message : '录音统计读取失败'
      }
      emit('calculating')
    }
  }
  await Promise.all([worker(), worker()])
  emit(failed.size ? 'error' : 'complete')
}
