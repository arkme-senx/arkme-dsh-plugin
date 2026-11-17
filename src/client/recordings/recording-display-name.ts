import { arkmeIntlLocale, tr } from '../locale.js'

/** One lazy date formatter per render; no retained recording cache or stale locale/timezone. */
export function createRecordingDisplayNameFormatter() {
  let formatter: Intl.DateTimeFormat | undefined
  return (recording: { fileName: string; startAtMillis: number }): string => {
    // A UI label is not an original filename or an import deduplication key.
    if (recording.fileName.trim() !== '') return recording.fileName
    const start = new Date(recording.startAtMillis)
    if (recording.startAtMillis < 0 || !Number.isFinite(start.getTime())) return tr('未命名录音')
    formatter ??= new Intl.DateTimeFormat(arkmeIntlLocale(), {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
    return tr('录音 {startTime}', { startTime: formatter.format(start) })
  }
}
