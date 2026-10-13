import type { ArkmeArrangementRecordingSource } from './types.js'

const DAY = 86_400_000

/** Backend offsets are signed milliseconds east of UTC, as in recording APIs. */
export function validRecordingSourceDay(dateStamp: unknown, tzOffsetMillis: unknown): boolean {
  return Number.isSafeInteger(dateStamp) && (dateStamp as number) > 0 && (dateStamp as number) < 8.64e15
    && Number.isSafeInteger(tzOffsetMillis) && Math.abs(tzOffsetMillis as number) <= 14 * 3_600_000
    && (tzOffsetMillis as number) % 60_000 === 0 && ((dateStamp as number) + (tzOffsetMillis as number)) % DAY === 0
}

export function projectArrangementRecordingSource(item: Record<string, unknown>): ArkmeArrangementRecordingSource | undefined {
  if (item.source_type !== 5) return undefined
  const value = item.recording_source
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'daily-summary', state: 'unavailable' }
  const source = value as Record<string, unknown>
  if (source.kind !== 'daily-summary' || !validRecordingSourceDay(source.date_stamp, source.tz_offset)
    || (source.summary_id !== undefined && (typeof source.summary_id !== 'string' || !source.summary_id.trim() || source.summary_id.length > 512))) {
    return { kind: 'daily-summary', state: 'unavailable' }
  }
  return { kind: 'daily-summary', state: 'ready', dateStamp: source.date_stamp as number, tzOffsetMillis: source.tz_offset as number,
    ...(typeof source.summary_id === 'string' ? { summaryVersionId: source.summary_id } : {}) }
}

/** Retain the source's calendar date even if the viewer has changed time zones. */
export function recordingSourceLocalDate(source: Extract<ArkmeArrangementRecordingSource, { state: 'ready' }>): Date {
  const wallTime = new Date(source.dateStamp + source.tzOffsetMillis)
  return new Date(wallTime.getUTCFullYear(), wallTime.getUTCMonth(), wallTime.getUTCDate())
}
