import type { ArkmeRecordingDailyMetrics } from './types.js'
type AsrInputMetrics = Pick<ArkmeRecordingDailyMetrics, 'asrInputEstimatedCount' | 'asrInputDurationMillis' | 'asrInputState' | 'asrInputConfirmedCount' | 'asrInputPendingCount' | 'asrInputUnknownCount'>
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Aggregate supplied by the recording owner for this exact read window. */
export interface RecordingAsrInputMetrics {
  duration_ms: number; confirmed_count: number; pending_count: number; unknown_count: number; estimated_count: number
}
export function parseRecordingAsrInputMetrics(value: unknown): RecordingAsrInputMetrics {
  const row = object(value)
  if (!['duration_ms','confirmed_count','pending_count','unknown_count','estimated_count'].every(key => validTime(row[key])) || Number(row.estimated_count) > Number(row.confirmed_count) || (Number(row.duration_ms) > 0 && Number(row.confirmed_count) === 0))
    return {duration_ms:0,confirmed_count:0,pending_count:0,unknown_count:1,estimated_count:0}
  return {duration_ms:row.duration_ms as number,confirmed_count:row.confirmed_count as number,pending_count:row.pending_count as number,unknown_count:row.unknown_count as number,estimated_count:row.estimated_count as number}
}
export function addRecordingAsrInputMetrics(total: RecordingAsrInputMetrics, next: RecordingAsrInputMetrics): void {
  if (!(Object.keys(total) as Array<keyof RecordingAsrInputMetrics>).every(key => Number.isSafeInteger(total[key] + next[key]))) { total.unknown_count++; return }
  for (const key of Object.keys(total) as Array<keyof RecordingAsrInputMetrics>) total[key] += next[key]
}
export function projectSemanticAsrInputMetrics(input?: RecordingAsrInputMetrics): AsrInputMetrics {
  const row = input ?? parseRecordingAsrInputMetrics(undefined)
  return {asrInputDurationMillis:row.duration_ms,asrInputConfirmedCount:row.confirmed_count,asrInputPendingCount:row.pending_count,
    asrInputUnknownCount:row.unknown_count,asrInputEstimatedCount:row.estimated_count,
    asrInputState:row.unknown_count > 0 ? row.confirmed_count > 0 ? 'partial' : 'unavailable' : row.pending_count > 0 ? 'processing' : 'ready'}
}
