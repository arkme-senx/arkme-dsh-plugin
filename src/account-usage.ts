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
