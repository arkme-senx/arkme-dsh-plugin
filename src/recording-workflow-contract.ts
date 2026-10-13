export const RECORDING_IMPORT_CONTRACT_VERSION = 2

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
  return recordingImportDeadline(batch.batchId) !== undefined
    && Number.isSafeInteger(batch.itemCount) && batch.itemCount > 0 && batch.itemCount <= 10_000
    && Number.isSafeInteger(batch.itemIndex) && batch.itemIndex >= 0 && batch.itemIndex < batch.itemCount
}

export type RecordingWorkflowState = 'completed' | 'partial' | 'failed' | 'skipped' | 'expired'
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
  readThrough: string
  latest?: RecordingWorkflowNotice
}
export const EMPTY_RECORDING_WORKFLOW: RecordingWorkflowPage = {
  supported: false, items: [], total: 0, unreadCount: 0, nextCursor: '', readThrough: '',
}

/** The fixed submission identity makes expired batches non-recreatable after cleanup. */
export const RECORDING_IMPORT_RECOVERY_MILLIS = 30 * 24 * 3600_000
export function recordingImportBatchID(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now <= 0 || now >= 2 ** 48) throw new RangeError('Invalid submission time')
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let time = now
  for (let i = 5; i >= 0; i--) { bytes[i] = time % 256; time = Math.floor(time / 256) }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export function recordingImportDeadline(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) return undefined
  const submitted = Number.parseInt(value.slice(0, 8) + value.slice(9, 13), 16)
  return submitted > 0 ? submitted + RECORDING_IMPORT_RECOVERY_MILLIS : undefined
}
