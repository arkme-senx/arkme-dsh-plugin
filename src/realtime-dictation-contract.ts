export const REALTIME_DICTATION_VERSION = 1 as const
export const DICTATION_MAX_FRAME_BYTES = 3200
export const DICTATION_MAX_BUFFER_BYTES = 64 * 1024
export const DICTATION_MAX_TEXT_LENGTH = 20_000
export const DICTATION_MAX_MILLIS = 120_000
export interface RealtimeDictationSnapshot {
  version: typeof REALTIME_DICTATION_VERSION
  streamRef: string
  phase: 'listening' | 'finishing' | 'finished' | 'failed'
  /** Full hypothesis for this stream, including revisions; never append it as a delta. */
  text: string
  revision: number
  error?: { code: string; message: string; retryable: boolean }
}
export type RealtimeDictationRequest =
  | { action: 'start'; expectedUserId: number }
  | { action: 'audio'; streamRef: string; pcm: string }
  | { action: 'status' | 'finish' | 'cancel'; streamRef: string }
export interface RealtimeDictationHandle {
  send(pcm: ArrayBuffer): void
  finish(): void
  dispose(): void
}
