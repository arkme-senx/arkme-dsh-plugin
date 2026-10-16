import { recordingUploadedByViewer } from './recording-coverage.js'
import type { ArkmeRecordingStorageMetrics } from './types.js'

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const id = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

/** Recorded output sizes, not an OSS inventory. No source-size fallback: source
 * metadata survives deletion. Cross-day files remain explicitly unallocated. */
export function projectRecordingStorageMetrics(response: unknown, viewerUserId: number, from: number, to: number): ArkmeRecordingStorageMetrics {
  let archiveBytes = 0, clipBytes = 0, confirmedCount = 0, pendingCount = 0, unknownCount = 0
  const result = (): ArkmeRecordingStorageMetrics => ({ bytes: archiveBytes + clipBytes, archiveBytes, clipBytes, confirmedCount, pendingCount, unknownCount,
    state: unknownCount > 0 ? confirmedCount > 0 ? 'partial' : 'unavailable' : pendingCount > 0 ? 'processing' : 'ready' })
  const data = object(response)
  if (!Array.isArray(data.session_ls) || !Array.isArray(data.child_ls) || !amount(viewerUserId) || viewerUserId === 0 || !amount(from) || !amount(to) || to <= from) {
    unknownCount++; return result()
  }
  const sessions = new Map(data.session_ls.map(raw => { const s = object(raw); return [id(s.id ?? s.session_id), s] as const }))
  const children = new Map<string, Record<string, unknown>>(), represented = new Set<string>()
  for (const raw of data.child_ls) {
    const c = object(raw), key = id(c.id ?? c.child_id)
    if (!key) { unknownCount++; continue }
    const previous = children.get(key)
    if (!previous || (amount(c.upload_at) ? c.upload_at : -1) > (amount(previous.upload_at) ? previous.upload_at : -1)) children.set(key, c)
  }
  for (const c of children.values()) {
    const sessionId = id(c.session_id), s = sessions.get(sessionId)
    if (!s || !amount(s.user_id) || s.user_id === 0) { unknownCount++; continue }
    if (!recordingUploadedByViewer(s, viewerUserId)) continue
    represented.add(sessionId)
    const start = amount(c.start_at) ? c.start_at >= 100_000_000_000 ? c.start_at : amount(s.start_at) ? s.start_at + c.start_at : NaN : NaN
    if (!amount(start) || !amount(c.duration) || c.duration === 0 || !amount(start + c.duration)) { unknownCount++; continue }
    const end = start + c.duration
    if (end <= from || start >= to) continue
    if (c.has_asr === false) { pendingCount++; continue }
    if (start < from || end > to || c.has_asr !== true) { unknownCount++; continue }
    const archive = amount(c.archive_size) ? c.archive_size : undefined, clips = amount(c.size) ? c.size : undefined
    const bytes = (archive ?? 0) + (clips ?? 0)
    const hasText = [c.asr, c.doubao_asr].some(rows => Array.isArray(rows) && rows.some(raw => {
      const row = object(raw); return String(row.t ?? row.text ?? '').trim().length > 0
    }))
    if ((archive === undefined && clips === undefined) || (bytes === 0 && hasText) || !amount(archiveBytes + clipBytes + bytes)) { unknownCount++; continue }
    archiveBytes += archive ?? 0; clipBytes += clips ?? 0; confirmedCount++
    if (archive === undefined || clips === undefined) unknownCount++
  }
  for (const [sessionId, s] of sessions) {
    if (!amount(s.user_id) || s.user_id === 0) { unknownCount++; continue }
    if (!recordingUploadedByViewer(s, viewerUserId) || represented.has(sessionId)) continue
    const end = amount(s.end_at) ? s.end_at : amount(s.start_at) && amount(s.duration) ? s.start_at + s.duration : NaN
    if (!amount(s.start_at) || !amount(end) || (s.start_at < to && end > from)) unknownCount++
  }
  return result()
}
