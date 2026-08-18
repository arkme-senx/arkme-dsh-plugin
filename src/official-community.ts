import type { ArkmeSourceItem } from './types.js'

export type ArkmeOfficialCommunityStatus = 'ready' | 'already_member' | 'joined'

/** Internal projection used only by the built-in community entry UI. */
export interface ArkmeOfficialCommunityEntryState {
  status: ArkmeOfficialCommunityStatus
  visible: boolean
  groupTitle: string
  memberCount: number
  avatarRefs: string[]
}

/** Internal join result; the raw Chat session id never crosses the Provider boundary. */
export interface ArkmeOfficialCommunityJoinResult {
  status: 'already_member' | 'joined'
  source: ArkmeSourceItem
}
