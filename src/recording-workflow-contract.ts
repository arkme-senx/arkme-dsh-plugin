/** Audio recording-import contract. Enable only after the server advertises support. */
export interface RecordingImportBatch {
  batchId: string
  itemIndex: number
  itemCount: number
  timeZone: string
}

export function validRecordingImportBatch(value: unknown): value is RecordingImportBatch {
  if (!value || typeof value !== 'object') return false
  const batch = value as RecordingImportBatch
  try { if (typeof batch.timeZone !== 'string' || !batch.timeZone || batch.timeZone.length > 80) return false; new Intl.DateTimeFormat('en', { timeZone: batch.timeZone }) } catch { return false }
  return typeof batch.batchId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(batch.batchId)
    && Number.isSafeInteger(batch.itemCount) && batch.itemCount > 0 && batch.itemCount <= 10_000
    && Number.isSafeInteger(batch.itemIndex) && batch.itemIndex >= 0 && batch.itemIndex < batch.itemCount
}

export type RecordingWorkflowState = 'completed' | 'partial' | 'failed' | 'skipped'
export interface RecordingWorkflowDay {
  /** Calendar date in the recording's timezone, not the notification timestamp. */
  date: string
  dateStamp: number
  endStamp: number
  summary: { state: RecordingWorkflowState | 'pending'; versionId?: string }
  timeline: { state: RecordingWorkflowState | 'pending'; versionId?: string }
}
export interface RecordingWorkflowNotice {
  id: string
  /** Persisted notification revision, encoded without JS integer precision loss. */
  sequence: string
  batchId: string
  timeZone: string
  stage: 'processing' | 'analysis'
  state: RecordingWorkflowState
  fileCount: number
  completedCount: number
  failedCount: number
  atMillis: number
  readAtMillis: number
  message: string
  days: RecordingWorkflowDay[]
}
export interface RecordingWorkflowPage {
  accountKey?: string
  supported: boolean
  items: RecordingWorkflowNotice[]
  total: number
  unreadCount: number
  nextCursor: string
  throughSequence: string
  latest?: RecordingWorkflowNotice
}
export const EMPTY_RECORDING_WORKFLOW: RecordingWorkflowPage = {
  supported: false, items: [], total: 0, unreadCount: 0, nextCursor: '', throughSequence: '',
}
