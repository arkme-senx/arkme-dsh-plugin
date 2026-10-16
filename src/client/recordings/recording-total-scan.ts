import { parseRecordingTotalMetrics, type RecordingMetricState, type RecordingTotalMetrics, type RecordingTotalsBucket, type RecordingTotalsIndexItem, type RecordingTotalsIndexPage } from '../../recording-total-metrics.js'

export interface RecordingTotalsProgress {
  phase: 'discovering' | 'calculating' | 'complete' | 'error'
  metrics?: RecordingTotalMetrics | undefined
  completedDays: number
  totalDays: number
  failedDays: number
  error?: string | undefined
}
interface Entry { revision: string; checkedAt: number; bucket: RecordingTotalsBucket }
export interface RecordingTotalsCache { version: 2; entries: Record<string, Entry>; snapshot?: RecordingTotalsProgress | undefined }
export const emptyRecordingTotalsCache = (): RecordingTotalsCache => ({ version: 2, entries: {} })

function validMetrics(value: unknown): value is RecordingTotalMetrics {
  const m = value as RecordingTotalMetrics | undefined
  if (!m?.storage || !m.asrInput) return false
  const parsed = parseRecordingTotalMetrics({ version: 2, scope: 'all_uploaded_recordings', as_of_ms: m.asOfMillis,
    storage: { ...m.storage, archive_bytes: m.storage.archiveBytes, clip_bytes: m.storage.clipBytes }, asr_input: { state: m.asrInput.state, duration_ms: m.asrInput.durationMillis, basis: m.asrInput.estimated ? 'mixed' : 'observed' } })
  return !!parsed && parsed.storage.state === m.storage.state && parsed.storage.bytes === m.storage.bytes
    && parsed.storage.archiveBytes === m.storage.archiveBytes && parsed.storage.clipBytes === m.storage.clipBytes
    && (m.asrInput.missingHistoryCount === undefined || Number.isSafeInteger(m.asrInput.missingHistoryCount) && m.asrInput.missingHistoryCount >= 0)
    && parsed.asrInput.state === m.asrInput.state && parsed.asrInput.durationMillis === m.asrInput.durationMillis && typeof m.asrInput.estimated === 'boolean'
}
function validBucket(value: unknown): value is RecordingTotalsBucket {
  const b = value as RecordingTotalsBucket | undefined
  return !!b && Number.isSafeInteger(b.sessionCount) && b.sessionCount >= 0 && validMetrics(b.metrics)
}
export function readRecordingTotalsCache(raw: string | null): RecordingTotalsCache {
  try {
    const cache = JSON.parse(raw ?? 'null') as RecordingTotalsCache
    if (cache?.version !== 2 || !cache.entries || Object.keys(cache.entries).length > 25_000) return emptyRecordingTotalsCache()
    for (const [key, entry] of Object.entries(cache.entries)) {
      if (!Number.isSafeInteger(Number(key)) || typeof entry.revision !== 'string' || !Number.isSafeInteger(entry.checkedAt)
        || entry.checkedAt <= 0 || !validBucket(entry.bucket)) return emptyRecordingTotalsCache()
    }
    const s = cache.snapshot
    if (s && (!['discovering', 'calculating', 'complete', 'error'].includes(s.phase)
      || (s.metrics !== undefined && !validMetrics(s.metrics)) || ![s.completedDays, s.totalDays, s.failedDays].every(n => Number.isSafeInteger(n) && n >= 0))) delete cache.snapshot
    return cache
  } catch { return emptyRecordingTotalsCache() }
}

function aggregate(buckets: RecordingTotalsBucket[], incomplete: boolean, now: number): RecordingTotalMetrics {
  function metric(select: (m: RecordingTotalMetrics) => { state: RecordingMetricState; value: number | null }) {
    let value = 0, known = 0, missing = incomplete, pending = false
    for (const { metrics } of buckets) {
      const item = select(metrics)
      if (item.value !== null) { value += item.value; known++ }
      if (item.state === 'partial' || item.state === 'unavailable') missing = true
      if (item.state === 'processing') pending = true
    }
    if (!Number.isSafeInteger(value)) return { state: 'unavailable' as const, value: null }
    const state: RecordingMetricState = missing ? (known > 0 ? 'partial' : 'unavailable') : pending ? 'processing' : 'ready'
    return { state, value: known === 0 && state !== 'ready' ? null : value }
  }
  const a = metric(m => ({ state: m.storage.state, value: m.storage.bytes }))
  const t = metric(m => ({ state: m.asrInput.state, value: m.asrInput.durationMillis }))
  const sumArchive = buckets.reduce((sum, b) => sum + b.metrics.storage.archiveBytes, 0)
  const sumClips = buckets.reduce((sum, b) => sum + b.metrics.storage.clipBytes, 0)
  if (!Number.isSafeInteger(sumArchive + sumClips)) return { asOfMillis: now, storage: { state: 'unavailable', bytes: null, archiveBytes: 0, clipBytes: 0 }, asrInput: { state: t.state, durationMillis: t.value, estimated: buckets.some(b => b.metrics.asrInput.estimated), missingHistoryCount: buckets.reduce((sum, b) => sum + (b.metrics.asrInput.missingHistoryCount ?? 0), 0) } }
  return { asOfMillis: now, storage: { state: a.state, bytes: a.value, archiveBytes: sumArchive, clipBytes: sumClips }, asrInput: { state: t.state, durationMillis: t.value,
    estimated: buckets.some(b => b.metrics.asrInput.estimated), missingHistoryCount: buckets.reduce((sum, b) => sum + (b.metrics.asrInput.missingHistoryCount ?? 0), 0) } }
}

/** A bounded two-worker scan. No writes, speaker lookups or generated content.
 * A complete index is required before pruning stale/deleted cached buckets. */
export async function scanRecordingTotals(input: {
  cache: RecordingTotalsCache; signal: AbortSignal; force?: boolean; now?: () => number
  index: (toMillis: number, offset: number) => Promise<RecordingTotalsIndexPage>
  bucket: (dateStamp: number) => Promise<RecordingTotalsBucket>
  publish: (snapshot: RecordingTotalsProgress) => void
}): Promise<void> {
  const { cache, signal } = input, now = input.now ?? Date.now
  const publish = (snapshot: RecordingTotalsProgress) => {
    signal.throwIfAborted(); cache.snapshot = snapshot; input.publish(snapshot)
  }
  publish({ ...cache.snapshot, phase: 'discovering', completedDays: 0, totalDays: 0, failedDays: 0 })
  try {
    const sessions = new Map<string, RecordingTotalsIndexItem>(), toMillis = now() + 1
    let offset = 0
    while (true) {
      signal.throwIfAborted()
      const page = await input.index(toMillis, offset)
      signal.throwIfAborted()
      if (!page || !Array.isArray(page.items) || page.items.length > 50) throw new Error('录音索引响应无效')
      for (const row of page.items) {
        if (typeof row.key !== 'string' || !row.key || typeof row.revision !== 'string' || !row.revision
          || !Number.isSafeInteger(row.dateStamp) || typeof row.pending !== 'boolean') throw new Error('录音索引响应无效')
        const previous = sessions.get(row.key)
        // Moving pages are not an authoritative snapshot. Retry instead of
        // silently hiding a skipped or duplicated recording as a full total.
        if (previous) throw new Error('录音列表已变化，正在重新核对')
        sessions.set(row.key, row)
      }
      publish({ ...cache.snapshot!, totalDays: new Set([...sessions.values()].map(s => s.dateStamp)).size })
      if (page.nextOffset === null) break
      if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset || page.nextOffset > 500_000) throw new Error('录音分页未推进')
      offset = page.nextOffset
    }
    const groups = new Map<number, RecordingTotalsIndexItem[]>()
    for (const s of sessions.values()) groups.set(s.dateStamp, [...(groups.get(s.dateStamp) ?? []), s])
    const days = [...groups.keys()].sort((a, b) => b - a)
    const buckets = new Map<number, RecordingTotalsBucket>(), failed = new Set<number>(), queue: number[] = []
    const revisions = new Map<number, string>()
    for (const day of days) {
      const group = groups.get(day)!
      const revision = group.map(s => `${s.key}:${s.revision}`).sort().join('|')
      revisions.set(day, revision)
      const old = cache.entries[day], age = old ? now() - old.checkedAt : Infinity
      const pending = group.some(s => s.pending) || old?.bucket.metrics.storage.state === 'processing' || old?.bucket.metrics.asrInput.state === 'processing'
      const ttl = pending || now() - day < 2 * 86_400_000 ? 60_000 : 86_400_000
      if (old && !input.force && old.revision === revision && age >= 0 && age < ttl && old.bucket.sessionCount === group.length) buckets.set(day, old.bucket)
      else {
        queue.push(day)
        if (old && old.revision === revision && old.bucket.sessionCount === group.length) buckets.set(day, old.bucket)
      }
    }
    // The complete index is authoritative for deletion and ownership changes.
    for (const key of Object.keys(cache.entries)) if (!groups.has(Number(key))) delete cache.entries[key]
    let completed = days.length - queue.length, lastError = ''
    const emit = (phase: RecordingTotalsProgress['phase']) => publish({ phase, completedDays: completed, totalDays: days.length, failedDays: failed.size, error: lastError || undefined,
      metrics: aggregate([...buckets.values()], completed < days.length || failed.size > 0, now()) })
    emit('calculating')
    let cursor = 0
    const worker = async () => {
      while (cursor < queue.length) {
        signal.throwIfAborted()
        const day = queue[cursor++]!
        try {
          const bucket = await input.bucket(day)
          signal.throwIfAborted()
          if (!validBucket(bucket) || bucket.sessionCount !== groups.get(day)!.length) throw new Error('录音统计范围已变化')
          buckets.set(day, bucket)
          cache.entries[day] = { revision: revisions.get(day)!, checkedAt: now(), bucket }
          completed++
        } catch (error) {
          signal.throwIfAborted(); failed.add(day)
          lastError = error instanceof Error ? error.message : '统计读取失败'
          // Retain a prior subtotal only if its indexed membership is unchanged.
          const old = cache.entries[day]
          if (old && old.revision === revisions.get(day)) buckets.set(day, old.bucket)
        }
        emit('calculating')
      }
    }
    await Promise.all([worker(), worker()])
    emit(failed.size ? 'error' : 'complete')
  } catch (error) {
    signal.throwIfAborted()
    publish({ ...cache.snapshot!, phase: 'error', error: error instanceof Error ? error.message : '统计读取失败' })
  }
}
