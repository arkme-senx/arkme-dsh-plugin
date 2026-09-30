/** Account-scoped audio directory. Versions and cursors are opaque server values. */
export type SpeakerDirectoryState = 'fresh' | 'stale' | 'building' | 'failed' | 'disabled' | 'snapshot_expired'
export interface SpeakerDirectoryStatus {
  state: SpeakerDirectoryState
  coverage: 'complete' | 'unknown'
  retryAfterMs: number
  processingSessionCount: number
  pendingIdentityAggregationCount: number
  insufficientEvidenceCount: number
  scanTruncated: boolean
}
export interface SpeakerDirectorySummary extends SpeakerDirectoryStatus {
  totalCount: number | null
  markedCount: number | null
  unmarkedCount: number | null
  unseenCount: number | null
  snapshotVersion: string
  seenVersion: number
  updatedAt: number
  notModified: boolean
}
export interface SpeakerDirectoryQuery {
  filter: 'all' | 'marked' | 'unmarked'
  sort: 'frequent' | 'recent'
  query: string
}
export interface SpeakerDirectoryListInput extends SpeakerDirectoryQuery {
  snapshotVersion: string
  cursor: string
  limit: number
}
export interface SpeakerDirectoryPerson {
  personKey: string
  type: 'marked' | 'unmarked'
  displayName: string
  displayNumber: number
  isSelf: boolean
  dayCount: number
  lastSeenAt: number
  /** Host-sealed detail_ref; minted per page, opened only when the user selects a row. */
  detailRef: string
}
/** Optional presentation metadata, resolved separately from directory pagination. */
export interface SpeakerDirectoryAvatar {
  detailRef: string
  avatarRef?: string
}
export interface SpeakerDirectoryPage extends SpeakerDirectoryStatus {
  items: SpeakerDirectoryPerson[]
  hasMore: boolean
  nextCursor: string
  snapshotVersion: string
  throughCursor: string
}
export type SpeakerDirectorySeen = { success: true; seenVersion: number } | { success: false; state: 'disabled' | 'snapshot_expired'; retryAfterMs: number }
export type SpeakerDirectoryDetail = { type: 'candidate'; candidateRef: string } | { type: 'speaker'; speakerRef: string; expectedVersion?: string }
