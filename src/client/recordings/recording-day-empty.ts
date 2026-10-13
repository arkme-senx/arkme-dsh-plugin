import type { ArkmeRecordingCoverageInterval, ArkmeRecordingDay } from '../../types.js'

/** Missing speech alone does not mean there is no audio (silence, pending ASR, shared recordings). */
export function recordingDayIsEmpty(day: ArkmeRecordingDay | undefined, dateStamp: number, coverage: readonly ArkmeRecordingCoverageInterval[]): boolean {
  if (!day || day.dateStamp !== dateStamp || day.coverage?.state !== 'ready' || coverage.length > 0) return false
  if (day.transcript.state !== 'empty' || day.transcript.items.length > 0 || day.transcript.processingCount > 0
    || day.totalDurationMillis > 0 || day.transcript.totalDurationMillis > 0) return false
  if (day.summary.state !== 'empty' || day.timeline.state !== 'empty'
    || day.summary.items.length > 0 || day.timeline.items.length > 0) return false
  const metrics = day.transcript.dailyMetrics
  return !metrics || (metrics.archiveState === 'ready' && metrics.asrInputState === 'ready'
    && ![metrics.archiveBytes, metrics.textCount, metrics.asrInputDurationMillis,
      metrics.confirmedCount, metrics.pendingCount, metrics.unknownCount,
      metrics.asrInputConfirmedCount, metrics.asrInputEstimatedCount, metrics.asrInputPendingCount, metrics.asrInputUnknownCount].some(value => value > 0))
}
