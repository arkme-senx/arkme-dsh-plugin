import type { ArkmeRecordingWindow } from '../../types.js'
import type { PublicRecordingImportCurrentItem, PublicRecordingImportHistoryItem, RecordingImportDisplayStatus } from '../../recording-import-shared.js'

export type RecordingFile = PublicRecordingImportCurrentItem | PublicRecordingImportHistoryItem
export type RecordingFileDateBasis = 'recorded' | 'uploaded' | 'all'

export function recordingFileKey(file: RecordingFile): string {
  return 'importRef' in file ? file.importRef : file.taskKey
}

export function recordingFileDayBounds(dateStamp: number, window?: ArkmeRecordingWindow) {
  if (window) return { from: window.dateStamp, to: window.endStamp }
  const start = new Date(dateStamp)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { from: start.getTime(), to: end.getTime() }
}

export function recordingFileMatchesDay(file: RecordingFile, dateStamp: number, basis: RecordingFileDateBasis, window?: ArkmeRecordingWindow): boolean {
  if (basis === 'all') return true
  const { from, to } = recordingFileDayBounds(dateStamp, window)
  // Cloud files use session creation; pending local jobs use job creation. Neither is upload completion.
  if (basis === 'uploaded') return file.createdAtMillis > 0 && file.createdAtMillis >= from && file.createdAtMillis < to
  return file.startAtMillis < to && Math.max(recordingFileDisplayEnd(file) ?? file.endAtMillis, file.startAtMillis + 1) > from
}

export function mergeRecordingFiles(history: readonly RecordingFile[], current: readonly RecordingFile[]): RecordingFile[] {
  const unique = new Map(history.map(file => [recordingFileKey(file), file]))
  for (const file of current) unique.set(recordingFileKey(file), file)
  return [...unique.values()]
}

const labels: Record<RecordingImportDisplayStatus, string> = {
  incomplete: '部分录音未收齐', paused: '已暂停', preparing: '待上传', uploading: '上传中', accepted: '已上传',
  processing: '处理中', waiting: '等待处理', 'speaker-waiting': '等待识别说话人',
  'speaker-recognizing': '识别说话人中', 'transcript-waiting': '等待转写', transcribing: '转写中',
  completed: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消', unavailable: '状态暂不可用',
}
export const recordingFileStatusLabel = (file: RecordingFile) => ('delivery' in file && file.delivery ? file.statusDetail : labels[file.status]) ?? '状态暂不可用'

export const recordingFileDisplayEnd = (file: RecordingFile): number | null =>
  'delivery' in file && file.delivery ? file.delivery.displayEndAt : file.endAtMillis
export const recordingFileExpectedBytes = (file: RecordingFile): number | null =>
  'delivery' in file && file.delivery ? file.delivery.expectedBytes : file.fileSize > 0 ? file.fileSize : null
