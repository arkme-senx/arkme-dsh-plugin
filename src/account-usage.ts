/** Account quota units are deliberately distinct from managed-AI currency balance. */
export interface ArkmeAccountTokenUsage {
  accountScope: string
  used: number
  remaining: number
}

export interface ArkmeAccountStorageUsage {
  accountScope: string
  usedBytes: number
  totalBytes: number
  /** Absent means the breakdown is unavailable/inconsistent, not zero usage. */
  breakdown?: ArkmeStorageBreakdown[]
}

export type ArkmeStorageCategory = 'image' | 'video' | 'file' | 'backgroundVoice' | 'callRecording' | 'other'
export interface ArkmeStorageBreakdown {
  category: ArkmeStorageCategory
  bytes: number
  fileCount: number
}

/** Monthly voice input / record transcription benefit, not long-recording uploads. */
export interface ArkmeAccountVoiceUsage {
  accountScope: string
  usedSeconds: number
  remainingSeconds: number
}

export type ArkmeRecordingKind = 1 | 2 | 3

export interface ArkmeRecordingUsageBreakdown {
  /** null means historical media duration is unavailable. */
  recordingDurationMillis: number | null
  recordingKind: ArkmeRecordingKind
  speechDurationMillis: number
  requestedSeconds: number
  deductedSeconds: number
  waivedSeconds: number
}

/** Monthly long-recording transcription benefit. It is independent from VOP voice input. */
export interface ArkmeAccountRecordingUsage {
  accountScope: string
  month: string
  /** Historical months deliberately have no current membership quota projection. */
  totalSeconds: number | null
  usedSeconds: number
  remainingSeconds: number | null
  breakdown: ArkmeRecordingUsageBreakdown[]
  statisticsStartedAtMicros: number
  /** Accepted Audio children which have not reached billing settlement yet. */
  pendingChildCount: number
}
