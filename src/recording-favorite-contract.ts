import type { ArkmeForwardTranscriptSegment } from './types.js'

export interface RecordingShareAudio {
  durationMillis: number
  /** One legacy concatenated asset, or one independently authorized clip per segment. */
  clips: Array<{ mediaRef: string; durationMillis: number }>
}
export interface RecordingFavoriteSegment extends ArkmeForwardTranscriptSegment {
  occurredAtMillis: number
  speakerAvatarRef?: string
}
export interface RecordingFavoriteStatus {
  accountKey: string
  saved: boolean
  version: number
  available: boolean
  favoriteRef?: string
}
export interface RecordingFavorite extends RecordingFavoriteStatus {
  favoriteRef: string
  audience: 'collector' | 'sharer'
  createdAtMillis: number
  savedAtMillis: number
  readAtMillis: number
  recordingStartedAtMillis: number
  segmentCount: number
  durationMillis: number
  preview: string
  sharer: { name: string; avatarRef?: string }
  collector?: { name: string; avatarRef?: string }
}
export interface RecordingFavoriteDetail extends RecordingFavorite {
  segments: RecordingFavoriteSegment[]
  audio?: RecordingShareAudio
  sourceRef?: string
  canRevoke: boolean
}
export interface RecordingFavoritePage {
  accountKey: string
  items: RecordingFavorite[]
  nextCursor?: string
  readThrough: string
}
export interface RecordingFavoriteNotificationSummary {
  accountKey: string
  unreadCount: number
  readThrough: string
}
export interface RecordingFavoriteSource { atMillis: number; identityHash: string }
export type RecordingFavoriteRequest =
  | { action: 'status'; sid: string; accountKey?: string }
  | { action: 'page' | 'notifications'; cursor?: string; accountKey?: string }
  | { action: 'summary'; accountKey?: string }
  | { action: 'detail'; favoriteRef: string; accountKey?: string }
  | { action: 'source'; sourceRef: string; accountKey?: string }
  | { action: 'save'; accountKey: string; sid: string; expectedVersion: number }
  | { action: 'remove'; accountKey: string; favoriteRef: string; expectedVersion: number }
  | { action: 'read'; accountKey: string; favoriteRef?: string; readThrough?: string }
  | { action: 'revoke'; accountKey: string; favoriteRef: string }

export type RecordingFavoriteResult<T extends RecordingFavoriteRequest> =
  T extends unknown ? T['action'] extends 'status' | 'remove' ? RecordingFavoriteStatus :
  T['action'] extends 'page' | 'notifications' ? RecordingFavoritePage :
  T['action'] extends 'detail' | 'save' ? RecordingFavoriteDetail :
  T['action'] extends 'summary' ? RecordingFavoriteNotificationSummary :
  T['action'] extends 'source' ? RecordingFavoriteSource : { acknowledged: true } : never

export interface RecordingFavoritePort {
  recordingFavorites<T extends RecordingFavoriteRequest>(input: T, signal?: AbortSignal): Promise<RecordingFavoriteResult<T>>
}
