import type { OfflineContextEntry, OfflineContextEvidence } from './offline-context.js'

export interface OfflineContextPreview {
  previewRef: string
  title: string
  summary: string
  transcript: string[]
  expiresAtMillis: number
}
export type OfflineContextCommand = {
  requestId: string
  entryRef: string
  revision: string
} & (
  | { action: 'confirm' | 'restore' | 'withdraw' | 'retry' }
  | { action: 'dismiss'; reason: 'unrelated' | 'playback' | 'remove' }
  | { action: 'range'; evidenceRefs: string[]; startOffset?: number; endOffset?: number }
  | { action: 'relink'; messageRef: string }
  | { action: 'share'; previewRef: string }
)
export interface OfflineContextCommandResult {
  requestId: string
  entryRef?: string
  outcome: 'applied' | 'not_applied' | 'pending' | 'unknown'
  revision?: string
}
export interface OfflineContextList {
  entries: OfflineContextEntry[]
  hasMore: boolean
  nextCursor?: string
}
export interface OfflineContextRangeOptions { revision: string; evidence: OfflineContextEvidence[]; selectedEvidenceIds: string[] }
export interface OfflineContextCapability { supported: boolean; version: number }
export interface OfflineContextCoverage { observations: { startAtMillis: number; endAtMillis: number; observedAtMillis: number; complete: boolean; evidenceSeen: boolean; messagesSeen: boolean; matches: number; issues: string[] }[] }
export interface OfflineContextPlayback { clips: import('./types.js').ArkmeRecordingPlayback[] }
export interface OfflineContextTranscript { text: string; from: number; to: number; startAtMillis: number; endAtMillis: number }
export type OfflineContextRequest =
  | { operation: 'capability' }
  | { operation: 'coverage'; sourceRef: string }
  | { operation: 'playback'; playbackRef: string }
  | { operation: 'transcript'; transcriptRef: string }
  | { operation: 'list'; sourceRef: string; state?: 'suggested' | 'linked' | 'dismissed'; cursor?: string }
  | { operation: 'read'; entryRef: string }
  | { operation: 'range-options'; entryRef: string; revision: string }
  | { operation: 'preview'; entryRef: string; revision: string; includeTranscript: boolean }
  | { operation: 'command'; command: OfflineContextCommand }
  | { operation: 'result'; entryRef: string; requestId: string }
  | { operation: 'pending' }
export interface OfflineContextPort {
  offlineContext(input: OfflineContextRequest, signal?: AbortSignal): Promise<OfflineContextRangeOptions | OfflineContextCapability | OfflineContextCoverage | OfflineContextPlayback | OfflineContextTranscript | OfflineContextList | OfflineContextEntry | OfflineContextPreview | OfflineContextCommandResult | OfflineContextCommandResult[]>
}

/** Encrypted command payloads only. The key is environment + account scope. */
export interface OfflineContextJournalEntry {
  fingerprint: string
  sealed: string
  expiresAtMillis?: number
}
