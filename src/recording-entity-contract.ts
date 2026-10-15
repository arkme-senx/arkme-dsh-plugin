import type { ArkmeRecordingTranscriptSource } from './types.js'

export interface RecordingEntityQuery {
  dateStamp: number
  transcriptSource?: ArkmeRecordingTranscriptSource
  knownStateRevision?: number
  knownProjectionRevision?: number
  knownPersonalizationRevision?: number
}
export type RecordingEntityStartQuery = Pick<RecordingEntityQuery, 'dateStamp' | 'transcriptSource'>
export interface RecordingEntityStartResult { status: 'accepted' | 'processing' | 'succeeded' }
export interface RecordingEntityTranscriptHealth {
  pendingUnits: number; processingUnits: number; readyUnits: number; failedUnits: number; unavailableUnits: number
}
export interface RecordingEntityItem {
  key: string
  entityRef: string
  name: string
  type: number
  typeLabel: string
  occurrenceCount: number
  relevance?: RecordingEntityRelevance
  accuracy?: RecordingEntityAccuracy
  /** Complete, versioned aggregation across all mentions, never just a loaded page. */
  participation?: RecordingEntityParticipation
}
export interface RecordingEntityParticipant {
  key: string
  label: string
  isSelf: boolean
  occurrenceCount: number
  playbackCount: number
}
export interface RecordingEntityParticipation {
  participants: RecordingEntityParticipant[]
  unattributedCount: number
  conversationCount: number
  meaningfulCount: number
}
export interface RecordingEntityDay {
  dateStamp: number
  transcriptSource: ArkmeRecordingTranscriptSource
  status: 'not_started' | 'processing' | 'succeeded' | 'failed' | 'source_mismatch'
  viewMode: 'provisional' | 'official'
  version: string
  stateRevision: number
  projectionRevision: number
  pollable: boolean
  canStart?: boolean
  transcriptHealth?: RecordingEntityTranscriptHealth
  stage: string
  completedUnits: number
  totalUnits: number
  /** Omission means unchanged, while [] explicitly invalidates previous results. */
  entities?: RecordingEntityItem[]
  /** Present only when the owner advertises the versioned personalization contract. */
  personalization?: { revision: number; feedbackSupported: boolean }
}
export interface RecordingEntityTarget {
  identityHash: string
  transcriptVersion: string
  transcriptSource: ArkmeRecordingTranscriptSource
  start: number
  length: number
}
export interface RecordingEntityOccurrence {
  key: string
  startAtMillis: number
  text: string
  observedText: string
  target?: RecordingEntityTarget
  context?: RecordingEntityOccurrenceContext
  /** Account- and occurrence-bound Host reference; never a raw owner ID. */
  feedbackRef?: string
}
export type RecordingEntityRelevance = 'self' | 'conversation' | 'concerned' | 'other' | 'background' | 'unknown'
export type RecordingEntityAccuracy = 'unverified' | 'needs_confirmation' | 'confirmed'
export interface RecordingEntityOccurrenceContext {
  relevance: RecordingEntityRelevance
  soundSource: 'unknown' | 'in_person' | 'playback'
  speakerLabel?: string
  participantKey?: string
  accuracy: RecordingEntityAccuracy
}
export type RecordingEntityFeedbackAction = 'relevant' | 'playback' | 'incorrect'
export interface RecordingEntityFeedbackInput { feedbackRef: string; action: RecordingEntityFeedbackAction; requestId: string }
export interface RecordingEntityFeedbackResult { undoRef: string; undoExpiresAt: number }
export interface RecordingEntityFeedbackUndoInput { undoRef: string; requestId: string }
export interface RecordingEntityOccurrences {
  version: string
  items: RecordingEntityOccurrence[]
  total: number
  offset: number
  hasMore: boolean
}
export interface RecordingEntityOccurrenceQuery { entityRef: string; offset?: number; limit?: number; participantKey?: string }
export interface RecordingEntityPort {
  startRecordingEntities(query: RecordingEntityStartQuery, signal?: AbortSignal): Promise<RecordingEntityStartResult>
  recordingEntities(query: RecordingEntityQuery, signal?: AbortSignal): Promise<RecordingEntityDay>
  recordingEntityOccurrences(query: RecordingEntityOccurrenceQuery, signal?: AbortSignal): Promise<RecordingEntityOccurrences>
}
