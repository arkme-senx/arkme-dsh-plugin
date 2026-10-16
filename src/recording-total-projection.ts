import { projectRecordingDailyMetrics } from './recording-daily-metrics.js'
import { recordingUploadedByViewer } from './recording-coverage.js'
import type { RecordingTotalsBucket } from './recording-total-metrics.js'

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}

/** V1 returns all children of each selected session. Assign the whole session
 * to its start day for this account-wide scan, not the visible daily subtotal.
 * Thus a midnight-spanning archive and its ASR attempts are counted once. */
export function projectRecordingTotalsBucket(response: unknown, userId: number, from: number, to: number, now = Date.now()): RecordingTotalsBucket {
  const data = object(response)
  if (!Array.isArray(data.session_ls) || !Array.isArray(data.child_ls)) throw new Error('录音统计响应不完整')
  const sessions = new Map<string, Record<string, unknown>>()
  for (const raw of data.session_ls) {
    const row = object(raw)
    if (typeof row.id !== 'string' || !row.id || !Number.isSafeInteger(row.start_at)
      || !Number.isSafeInteger(row.user_id) || (row.user_id as number) <= 0) throw new Error('录音统计归属不完整')
    if ((row.start_at as number) >= from && (row.start_at as number) < to && recordingUploadedByViewer(row, userId)) sessions.set(row.id, row)
  }
  const children = data.child_ls.filter(raw => sessions.has(String(object(raw).session_id)))
  const metrics = projectRecordingDailyMetrics({ session_ls: [...sessions.values()], child_ls: children }, [], userId, 0, 8_640_000_000_000_000)
  return { sessionCount: sessions.size, metrics: {
    asOfMillis: now,
    storage: { state: metrics.storage!.state, bytes: metrics.storage!.confirmedCount > 0 || metrics.storage!.state === 'ready' ? metrics.storage!.bytes : null,
      archiveBytes: metrics.storage!.archiveBytes, clipBytes: metrics.storage!.clipBytes },
    asrInput: { state: metrics.asrInputState, durationMillis: metrics.asrInputConfirmedCount > 0 || metrics.asrInputState === 'ready' ? metrics.asrInputDurationMillis : null,
      missingHistoryCount: metrics.asrInputMissingHistoryCount ?? 0, estimated: metrics.asrInputEstimatedCount > 0 },
  } }
}
