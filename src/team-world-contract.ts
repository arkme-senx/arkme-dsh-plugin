import type { ArkmeTeam, ArkmeWorldFeedPage } from './types.js'
import type { WorldPublishOrigin } from './world-publish-source.js'

export interface TeamWorldTarget { jotmoId: string; name: string; avatar?: ArkmeTeam['avatar']; returnTeamRef?: string }
export interface TeamWorldCapabilities { publish: boolean; manage: boolean; feedback: boolean; reply: boolean }
export interface TeamWorldContext { teamRef: string; jotmoId: string; name: string; capabilities: TeamWorldCapabilities }
export interface TeamWorldView { state: 'ready'; team: TeamWorldTarget; context: TeamWorldContext; memberTeam?: ArkmeTeam; feed: ArkmeWorldFeedPage }
export interface TeamWorldAsset { imageRef: string; mimeType: string; size: number }
export interface TeamWorldOriginal {
  contentRef: string; recordRef: string; revision: number; title: string; text: string; format: 'plain' | 'markdown'; sourceKind: string
  assets: TeamWorldAsset[]; deleted: boolean; publicRequested: boolean; pending: boolean; updatedAt: number
}
export interface TeamWorldReceipt {
  requestUid: string; contentRef: string; revision: number; acceptedAt: number; pending: boolean
  result?: { visibility: 'published' | 'pending' | 'rejected' | 'unpublished' | 'deleted'; contentRevision: string; publicationVersion: number }
}
export interface TeamWorldFeedback {
  key: string; sequence: number; contentRef: string; kind: 'reaction' | 'comment'; isMe: boolean; at: number
  eventRef: string
  actorName: string
  preview: TeamWorldPreview
  reaction?: { active: boolean; expression: import('./reaction-contract.js').ReactionExpression }
  /** Current public comment; absent when the comment or any ancestor is inaccessible. */
  comment?: import('./types.js').ArkmeWorldFeedItem
}
/** Current authorized original, not a historical snapshot of the event's body. */
export interface TeamWorldPreview { teamName: string; title: string; text: string; imageCount: number; imageRefs?: string[]; deleted: boolean; publicRequested: boolean }
export type TeamWorldActivity = TeamWorldReceipt & {
  action: 'publish' | 'edit' | 'unpublish' | 'delete' | 'restore'
  preview?: TeamWorldPreview
  /** Public address only; every read still checks current World visibility. */
  recordRef?: string
  publication?: import('./types.js').ArkmeWorldFeedItem
}
export interface TeamWorldFeedbackTarget {
  original: TeamWorldOriginal
  target: import('./reaction-contract.js').ReactionTargetRef
  commentRef?: string
  comment?: import('./types.js').ArkmeWorldFeedItem
}
export type TeamWorldRequest = { accountKey: string } & (
  | { action: 'context'; jotmoId: string }
  | { action: 'feed'; jotmoId: string; cursor?: string; limit?: number }
  | { action: 'source'; origin: WorldPublishOrigin; version: number }
  | { action: 'originals'; teamRef: string; deleted?: boolean; cursor?: string; limit?: number }
  | { action: 'original'; contentRef: string }
  | { action: 'submit'; teamRef: string; contentRef?: string; requestUid: string; expectedRevision: number; change: 'publish' | 'edit' | 'unpublish' | 'delete' | 'restore'; draft?: { title: string; text: string; format: 'plain' | 'markdown'; sourceRef?: string; imageRefs: string[]; sourceAssetUids?: string[]; parentRef?: string } }
  | { action: 'image-upload'; teamRef: string; contentRef?: string; contentUid: string; uploadUid: string; contentBase64: string; mimeType: string }
  | { action: 'status'; requestUid: string }
  | { action: 'activity'; teamRef?: string; cursor?: string; limit?: number }
  | { action: 'feedback'; teamRef: string; afterSequence?: number; limit?: number; includeRead?: boolean }
  | { action: 'feedback-read'; teamRef: string; throughSequence: number }
  | { action: 'feedback-target'; eventRef: string }
)
export type TeamWorldResponse<R extends TeamWorldRequest> =
  R extends { action: 'context' } ? TeamWorldContext :
  R extends { action: 'feed' } ? ArkmeWorldFeedPage :
  R extends { action: 'source' } ? { sourceRef: string } :
  R extends { action: 'original' } ? TeamWorldOriginal :
  R extends { action: 'originals' } ? { items: TeamWorldOriginal[]; hasMore: boolean; nextCursor?: string } :
  R extends { action: 'image-upload' } ? TeamWorldAsset :
  R extends { action: 'submit' } ? TeamWorldReceipt :
  R extends { action: 'status' } ? TeamWorldReceipt | null :
  R extends { action: 'activity' } ? { items: TeamWorldActivity[]; hasMore: boolean; nextCursor?: string } :
  R extends { action: 'feedback-target' } ? TeamWorldFeedbackTarget :
  R extends { action: 'feedback' } ? { items: TeamWorldFeedback[]; hasMore: boolean; afterSequence: number; seenThrough: number; offeredThrough: number } : { ok: boolean }
