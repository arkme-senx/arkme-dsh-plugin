import type { ReactionTargetRef } from './reaction-contract.js'

/** A distinct owner contract: legacy record reactions aggregate chat origins. */
export const WORLD_REACTION_CONTRACT = 'world-reactions-v1'
export const WORLD_REACTION_PREFIX = '/api/v1/reactions/world/'
export const WORLD_REACTION_PENDING = '后端接口开发中，开发完成后此功能完整可用。'
export interface WorldReactionContext {
  recordRef: string
  target: ReactionTargetRef
  visibility: 'published' | 'unpublished'
}
export interface WorldReactionContextPage {
  items: WorldReactionContext[]
  unavailableRecordRefs: string[]
}
