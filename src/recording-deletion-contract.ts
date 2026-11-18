export interface RecordingDeletionPermission {
  generation: string
  timeZone: string
}

export interface RecordingDeletionRequest {
  dates: unknown
  aboveBytes: unknown
}

export interface RecordingDeletionFile {
  sessionId: string
  ownerVersion: number
  startAt: number
  endAt: number
  bytes: number
  fileName: string
}

export interface RecordingDeletionSelection {
  timeZone: string
  days: { date: string; bytes: number | null; selected: boolean }[]
  files: RecordingDeletionFile[]
}

export const RECORDING_DELETION_LIMIT = 100
export const RECORDING_DELETION_DAYS_LIMIT = 31
export const RECORDING_DELETION_SETTINGS_QUERY = 'arkmeRecordingDeletionSettings'
export const RECORDING_DELETION_CONFIRMATION_QUERY = 'recordingDeletionConfirmation'
