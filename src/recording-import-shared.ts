export const MAX_RECORDING_IMPORT_BYTES = 1024 * 1024 * 1024
export const MAX_RECORDING_IMPORT_DURATION_MILLIS = 10 * 60 * 60 * 1000

export function recordingImportFileNameKey(fileName: string): string {
  return fileName.trim().toLowerCase()
}

export type RecordingImportPhase =
  | 'prepared'
  | 'uploading'
  | 'finalizing'
  | 'accepted'
  | 'failed'
  | 'cancelled'

export type RecordingImportDisplayStatus =
  | 'preparing'
  | 'uploading'
  | 'accepted'
  | 'processing'
  | 'waiting'
  | 'speaker-waiting'
  | 'speaker-recognizing'
  | 'transcript-waiting'
  | 'transcribing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'unavailable'

export type RecordingImportProgressStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'unavailable'

export type RecordingImportProgressCode =
  | 'upload'
  | 'import'
  | 'voice_recognition'
  | 'primary_transcript'
  | 'enhancement_transcript'

export interface PublicRecordingImportProgressRow {
  code: RecordingImportProgressCode
  status: RecordingImportProgressStatus
  startedAtMillis: number
  endedAtMillis: number
  durationMillis: number
  provider: string
  model: string
  modelVersion: string
  modelDurationMillis: number
  nextRelation: string
  relationDurationMillis: number
}

export interface PublicRecordingImportProgress {
  status: RecordingImportProgressStatus
  totalDurationMillis: number
  serverNowMillis: number
  observedAtMillis: number
  rows: PublicRecordingImportProgressRow[]
}

export interface PublicRecordingImportJob {
  kind: 'local'
  importRef: string
  revision: number
  phase: RecordingImportPhase
  ownership: 'self' | 'other'
  fileName: string
  fileSize: number
  durationMillis: number
  startAtMillis: number
  endAtMillis: number
  progress: number
  status: RecordingImportDisplayStatus
  statusDetail: string
  createdAtMillis: number
  updatedAtMillis: number
  errorCode?: string
  errorMessage?: string
  retryable?: boolean
}

export interface PublicRecordingImportOwnerTask {
  kind: 'owner'
  taskKey: string
  sessionRef: string
  ownership: 'self' | 'other'
  fileName: string
  fileSize: number
  parsedSize: number
  durationMillis: number
  startAtMillis: number
  endAtMillis: number
  progress: number
  status: RecordingImportDisplayStatus
  statusDetail: string
  createdAtMillis: number
  updatedAtMillis: number
  localImportTiming?: {
    startedAtMillis: number
    acceptedAtMillis: number
  }
  importProgress?: PublicRecordingImportProgress
}

export type PublicRecordingImportCurrentItem = PublicRecordingImportJob | PublicRecordingImportOwnerTask

export interface PublicRecordingImportCurrentSnapshot {
  items: PublicRecordingImportCurrentItem[]
  owner:
    | { state: 'available' }
    | { state: 'unavailable'; message: string }
}

export interface PublicRecordingImportHistoryItem {
  taskKey: string
  sessionRef: string
  ownership: 'self' | 'other'
  fileName: string
  fileSize: number
  parsedSize: number
  durationMillis: number
  startAtMillis: number
  endAtMillis: number
  progress: number
  status: RecordingImportDisplayStatus
  statusDetail: string
  createdAtMillis: number
  updatedAtMillis: number
  importProgress?: PublicRecordingImportProgress
}

export interface PublicRecordingImportHistoryPage {
  items: PublicRecordingImportHistoryItem[]
  total?: number
  offset: number
  hasMore: boolean
}
