import type { ArkmeSourceItem } from './types.js'

export type ArkmeDSHBetaCommunityStatus = 'ready' | 'already_member' | 'joined'

/** Internal projection used only by the built-in community entry UI. */
export interface ArkmeDSHBetaCommunityEntryState {
  status: ArkmeDSHBetaCommunityStatus
  visible: boolean
  groupTitle: string
  memberCount: number
  avatarRefs: string[]
}

/** Internal join result; the raw Chat session id never crosses the Provider boundary. */
export interface ArkmeDSHBetaCommunityJoinResult {
  status: 'already_member' | 'joined'
  source: ArkmeSourceItem
}
