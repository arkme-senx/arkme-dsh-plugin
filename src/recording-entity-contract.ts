import type { ArkmeRecordingTranscriptSource } from './types.js'

export interface RecordingEntityQuery {
  dateStamp: number
  transcriptSource?: ArkmeRecordingTranscriptSource
  knownStateRevision?: number
  knownProjectionRevision?: number
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
}
export interface RecordingEntityOccurrences {
  version: string
  items: RecordingEntityOccurrence[]
  total: number
  offset: number
  hasMore: boolean
}
export interface RecordingEntityOccurrenceQuery { entityRef: string; offset?: number; limit?: number }
export interface RecordingEntityPort {
  startRecordingEntities(query: RecordingEntityStartQuery, signal?: AbortSignal): Promise<RecordingEntityStartResult>
  recordingEntities(query: RecordingEntityQuery, signal?: AbortSignal): Promise<RecordingEntityDay>
  recordingEntityOccurrences(query: RecordingEntityOccurrenceQuery, signal?: AbortSignal): Promise<RecordingEntityOccurrences>
}
