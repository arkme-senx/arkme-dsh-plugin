import { formatArkmeDateTime } from '../display-time-zone.js'
import { arkmeIntlLocale, tr } from '../locale.js'

const nameDateFields = {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
} as const

/** Presentation only. Keep the original name for import deduplication and mutations. */
export function recordingDisplayName(recording: { fileName: string; startAtMillis: number }): string {
  if (recording.fileName.trim() !== '') return recording.fileName
  const start = recording.startAtMillis
  if (start < 0 || !Number.isFinite(new Date(start).getTime())) return tr('未命名录音')
  return tr('录音 {startTime}', { startTime: formatArkmeDateTime(start, arkmeIntlLocale(), nameDateFields) })
}
