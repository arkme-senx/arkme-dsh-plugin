import type { ArkmeRecordingDailyMetrics } from './types.js'
import { projectSemanticAsrInputMetrics, type RecordingAsrInputMetrics } from './recording-asr-input-metrics.js'

export interface RecordingStorageMetrics {
  bytes: number
  confirmed_count: number
  pending_count: number
  unknown_count: number
}

/** Count Unicode code points, excluding whitespace and generated labels. */
export function recordingTextCount(text: string): number {
  return Array.from(text.replace(/[\p{White_Space}\uFEFF]/gu, '')).length
}

export function parseRecordingStorageMetrics(value: unknown): RecordingStorageMetrics {
  const unknown = { bytes: 0, confirmed_count: 0, pending_count: 0, unknown_count: 1 }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unknown
  const row = value as Record<string, unknown>
  if (!['bytes', 'confirmed_count', 'pending_count', 'unknown_count'].every(key => typeof row[key] === 'number' && Number.isSafeInteger(row[key]) && row[key] >= 0)) return unknown
  return { bytes: row.bytes as number, confirmed_count: row.confirmed_count as number, pending_count: row.pending_count as number, unknown_count: row.unknown_count as number }
}

export function addRecordingStorageMetrics(total: RecordingStorageMetrics, next: RecordingStorageMetrics): void {
  if (!Number.isSafeInteger(total.bytes + next.bytes)) { total.unknown_count++; return }
  total.bytes += next.bytes
  total.confirmed_count += next.confirmed_count
  total.pending_count += next.pending_count
  total.unknown_count += next.unknown_count
}

/** Storage is authoritative for the whole window; text is exactly this page's
 * payload. Full-content consumers combine text, never sum repeated storage. */
export function projectRecordingDailyMetrics(storage: RecordingStorageMetrics, items: readonly { text: string }[], input?: RecordingAsrInputMetrics): ArkmeRecordingDailyMetrics {
  return {
    ...projectSemanticAsrInputMetrics(input),
    archiveBytes: storage.bytes, confirmedCount: storage.confirmed_count, pendingCount: storage.pending_count, unknownCount: storage.unknown_count,
    archiveState: storage.unknown_count > 0 ? storage.confirmed_count > 0 ? 'partial' : 'unavailable' : storage.pending_count > 0 ? 'processing' : 'ready',
    textCount: items.reduce((sum, item) => sum + recordingTextCount(item.text), 0),
  }
}
