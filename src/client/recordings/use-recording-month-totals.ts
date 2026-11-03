import { useEffect, useState } from 'react'
import type { ArkmeRecordingDailyMetrics } from '../../types.js'
import type { RecordingTotalMetrics } from '../../recording-total-metrics.js'
import { recordingTotalsFromDaily } from '../../recording-total-projection.js'
import { callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
import { readRecordingMonthCache, recordingMonthDays, recordingMonthSnapshot, scanRecordingMonth, type RecordingMonthCache } from './recording-month-totals.js'
import { validBucket, type RecordingTotalsProgress } from './recording-total-scan.js'

interface Stored { cache: RecordingMonthCache; revision: string; listeners: Set<() => void> }
const months = new Map<string, Stored>()
const scopeKey = (account: string, monthStamp: number) => `arkme.recording-month-totals.v1:${account}:${Intl.DateTimeFormat().resolvedOptions().timeZone}:${monthStamp}`
function load(key: string, monthStamp: number): Stored {
  let value = months.get(key)
  if (!value) {
    let raw: string | null = null
    try { raw = localStorage.getItem(key) } catch {}
    value = { cache: readRecordingMonthCache(raw, monthStamp), revision: '', listeners: new Set() }
  }
  months.delete(key); months.set(key, value)
  for (const [old, entry] of months) { if (months.size <= 48) break; if (!entry.listeners.size) months.delete(old) }
  return value
}
function persist(key: string, value: Stored) {
  try { localStorage.setItem(key, JSON.stringify({ version: 1, monthStamp: value.cache.monthStamp, entries: value.cache.entries })) } catch {}
}

/** Publish already-readable day metrics without another network read. */
export function cacheRecordingDayTotals(account: string, dateStamp: number, metrics: ArkmeRecordingDailyMetrics) {
  // Missing legacy storage fields are not an authoritative day measurement.
  // Let the independent bounded read fill the month instead of caching a hole.
  if (!account || !metrics.storage) return
  const date = new Date(dateStamp), monthStamp = new Date(date.getFullYear(), date.getMonth(), 1).getTime()
  if (!recordingMonthDays(monthStamp).includes(dateStamp)) return
  const key = scopeKey(account, monthStamp), value = load(key, monthStamp)
  const bucket = { metrics: recordingTotalsFromDaily(metrics), sessionCount: 0 }
  if (!validBucket(bucket)) return
  value.cache.entries[dateStamp] = { checkedAt: Date.now(), bucket }
  if (value.cache.snapshot) value.cache.snapshot = recordingMonthSnapshot(value.cache, recordingMonthDays(monthStamp), value.cache.snapshot.phase,
    value.cache.snapshot.completedDays, value.cache.snapshot.failedDays, value.cache.snapshot.error)
  persist(key, value); for (const notify of value.listeners) notify()
}

export function useRecordingMonthTotals(account: string, monthStamp: number, active: boolean, refreshRevision: string) {
  const key = scopeKey(account, monthStamp), stored = load(key, monthStamp)
  const [state, setState] = useState<{ key: string; value: RecordingTotalsProgress }>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!account || !active) return
    const controller = new AbortController(), value = load(key, monthStamp)
    const force = value.revision !== '' && value.revision !== refreshRevision
    value.revision = refreshRevision
    const update = () => { if (!controller.signal.aborted && value.cache.snapshot) setState({ key, value: value.cache.snapshot }) }
    value.listeners.add(update)
    let timer: ReturnType<typeof setTimeout> | undefined, running = true, lastSaved = 0
    const recover = () => { if (!document.hidden && !running) setRetry(number => number + 1) }
    window.addEventListener('online', recover); document.addEventListener('visibilitychange', recover)
    void scanRecordingMonth({ cache: value.cache, signal: controller.signal, force,
      bucket: async dateStamp => ({ sessionCount: 0, metrics: await withArkmeReadDeadline(signal => callArkme<RecordingTotalMetrics>('recordings.totals.day', { account, dateStamp }, signal, { priority: 'background' }), controller.signal) }),
      publish: () => { update(); if (Date.now() - lastSaved > 1000) { persist(key, value); lastSaved = Date.now() } },
    }).then(() => { if (!controller.signal.aborted) { running = false; persist(key, value); timer = setTimeout(recover, value.cache.snapshot?.phase === 'error' ? 30_000 : 120_000) } }).catch(() => {})
    return () => { controller.abort(); clearTimeout(timer); value.listeners.delete(update); window.removeEventListener('online', recover); document.removeEventListener('visibilitychange', recover); persist(key, value) }
  }, [key, monthStamp, account, active, refreshRevision, retry])
  const saved = stored.cache.snapshot ?? (Object.keys(stored.cache.entries).length ? recordingMonthSnapshot(stored.cache, recordingMonthDays(monthStamp), 'calculating', 0) : undefined)
  return { progress: state?.key === key ? state.value : saved, retry: () => setRetry(number => number + 1) }
}
