export const MAX_RECORDING_IMPORT_BYTES = 1024 * 1024 * 1024
export const MAX_RECORDING_IMPORT_DURATION_MILLIS = 10 * 60 * 60 * 1000

export type RecordingImportPhase =
  | 'prepared'
  | 'uploading'
  | 'finalizing'
  | 'accepted'
  | 'failed'
  | 'cancelled'

export interface PublicRecordingImportJob {
  importRef: string
  revision: number
  phase: RecordingImportPhase
  ownership: 'self' | 'other'
  fileName: string
  fileSize: number
  durationMillis: number
  progress: number
  createdAtMillis: number
  updatedAtMillis: number
  errorCode?: string
  errorMessage?: string
  retryable?: boolean
}
