import { projectRecordingDailyMetrics, type RecordingStorageMetrics } from './recording-daily-metrics.js'
import type { RecordingAsrInputMetrics } from './recording-asr-input-metrics.js'
import type { RecordingTotalsBucket } from './recording-total-metrics.js'

/** The Audio read owner determines attribution and asset lifetime. The host
 * only projects semantic aggregates into the account-wide display contract. */
export function projectRecordingTotalsBucket(data: { storage: RecordingStorageMetrics; asrInput: RecordingAsrInputMetrics; sessionCount: number }, now = Date.now()): RecordingTotalsBucket {
  const metrics = projectRecordingDailyMetrics(data.storage, [], data.asrInput)
  return { sessionCount: data.sessionCount, metrics: {
    asOfMillis: now,
    storage: { state: metrics.storage?.state ?? 'unavailable', bytes: metrics.storage && (metrics.storage.confirmedCount > 0 || metrics.storage.state === 'ready') ? metrics.storage.bytes : null,
      archiveBytes: metrics.storage?.archiveBytes ?? 0, clipBytes: metrics.storage?.clipBytes ?? 0 },
    asrInput: { state: metrics.asrInputState, durationMillis: metrics.asrInputConfirmedCount > 0 || metrics.asrInputState === 'ready' ? metrics.asrInputDurationMillis : null,
      missingHistoryCount: metrics.asrInputMissingHistoryCount ?? 0, estimated: metrics.asrInputEstimatedCount > 0 },
  } }
}
