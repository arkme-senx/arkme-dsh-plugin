export type RecordingMetricState = 'ready' | 'partial' | 'processing' | 'unavailable'

/** Account-wide snapshot, from a complete index or an explicitly partial scan. */
export interface RecordingTotalMetrics {
  asOfMillis: number
  storage: { state: RecordingMetricState; bytes: number | null; archiveBytes: number; clipBytes: number }
  asrInput: { state: RecordingMetricState; durationMillis: number | null; estimated: boolean; missingHistoryCount?: number }
}

/** Only anonymized index facts and numbers cross the UI bridge. */
export interface RecordingTotalsIndexItem {
  key: string
  dateStamp: number
  revision: string
  pending: boolean
}
export interface RecordingTotalsIndexPage {
  items: RecordingTotalsIndexItem[]
  nextOffset: number | null
}
export interface RecordingTotalsBucket {
  metrics: RecordingTotalMetrics
  sessionCount: number
}

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const state = (value: unknown): RecordingMetricState => value === 'ready' || value === 'partial' || value === 'processing' ? value : 'unavailable'

/** Proposed v2 contract: old archive-only / memory-owned totals are incompatible. */
export function parseRecordingTotalMetrics(value: unknown): RecordingTotalMetrics | undefined {
  const data = object(value)
  if (data.version !== 2 || data.scope !== 'all_uploaded_recordings' || !amount(data.as_of_ms) || data.as_of_ms === 0 || data.as_of_ms > 8_640_000_000_000_000) return undefined
  const storage = object(data.storage), input = object(data.asr_input)
  const storageState = state(storage.state), inputState = state(input.state)
  const breakdownValid = amount(storage.archive_bytes) && amount(storage.clip_bytes) && Number.isSafeInteger(storage.archive_bytes + storage.clip_bytes)
  const bytes = storageState !== 'unavailable' && amount(storage.bytes) && breakdownValid
    && storage.bytes === (storage.archive_bytes as number) + (storage.clip_bytes as number) ? storage.bytes : null
  const duration = inputState !== 'unavailable' && amount(input.duration_ms)
    && ['observed', 'estimated', 'mixed'].includes(String(input.basis)) ? input.duration_ms : null
  return {
    asOfMillis: data.as_of_ms,
    storage: { state: bytes === null && storageState !== 'processing' ? 'unavailable' : storageState, bytes,
      archiveBytes: breakdownValid ? storage.archive_bytes as number : 0, clipBytes: breakdownValid ? storage.clip_bytes as number : 0 },
    asrInput: { state: duration === null && inputState !== 'processing' ? 'unavailable' : inputState,
      durationMillis: duration, estimated: duration !== null && input.basis !== 'observed',
      missingHistoryCount: amount(input.missing_history_count) ? input.missing_history_count : 0 },
  }
}
