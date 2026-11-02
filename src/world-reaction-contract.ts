import type { ReactionTargetRef } from './reaction-contract.js'
import type { ReactionRequest, ReactionResponse, ReactionHistoryEvent, ReactionState, ReactionNotification } from './reaction-contract.js'

export type WorldReactionRequest = Extract<ReactionRequest, { action: 'query' | 'set' | 'actors' | 'groups' | 'history' | 'received' | 'notifications' | 'notifications-read' }>
export type WorldReactionArchiveRequest = Extract<ReactionRequest, { action: 'query' | 'actors' | 'groups' }>
export interface WorldReactionHistoryEvent extends ReactionHistoryEvent { target: ReactionTargetRef; state?: ReactionState; actor_user_id?: number; private?: boolean }
export interface WorldReactionHistoryPage { items: WorldReactionHistoryEvent[]; has_more: boolean; before_at?: number; before_id?: string }
export interface WorldReactionNotificationPage { items: (Pick<ReactionNotification, 'id' | 'revision' | 'actorUserId' | 'selections' | 'unread'> & { target: ReactionTargetRef })[]; has_more: boolean; after_id: string }
export type WorldReactionResponse<R extends WorldReactionRequest> = R extends { action: 'history' | 'received' } ? WorldReactionHistoryPage : R extends { action: 'notifications' } ? WorldReactionNotificationPage : ReactionResponse<R>

/** A distinct owner contract: legacy record reactions aggregate chat origins. */
export const WORLD_REACTION_CONTRACT = 'world-reactions-v1'
export const WORLD_REACTION_PREFIX = '/api/v1/reactions/world/'
export const WORLD_REACTION_PENDING = '世界表态服务暂不可用，请稍后重试。'
export interface WorldReactionContext {
  recordRef: string
  target: ReactionTargetRef
  visibility: 'published' | 'unpublished'
}
export interface WorldReactionContextPage {
  items: WorldReactionContext[]
  unavailableRecordRefs: string[]
}
