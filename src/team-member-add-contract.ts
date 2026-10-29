import type { ArkmeGroupAvatarFallback, ArkmeSourceItem } from './types.js'

export type TeamMemberCandidateSource = 'contacts' | 'conversations' | 'group'
export interface TeamMemberCandidateIdentity {
  displayName: string
  nickname?: string
  accountName?: string
  avatarRef?: string
  avatarFallback?: ArkmeGroupAvatarFallback
}
export interface TeamMemberCandidate extends TeamMemberCandidateIdentity {
  key: string
  candidateRef: string
  alreadyMember: boolean
  isSelf: boolean
}
export interface TeamMemberCandidatePage {
  items: TeamMemberCandidate[]
  groups: ArkmeSourceItem[]
  hasMore: boolean
  nextCursor?: string
  coverage?: 'complete' | 'partial'
}
/** Host-only identities; raw user IDs must not cross the App bridge. */
export interface TeamMemberCandidateSourcePage {
  items: Array<TeamMemberCandidateIdentity & { userId: number }>
  groups?: ArkmeSourceItem[]
  hasMore: boolean
  nextCursor?: string
  coverage?: 'complete' | 'partial'
}
export interface TeamMemberCandidatePort {
  list(source: TeamMemberCandidateSource, options: { sourceRef?: string; cursor?: string; refresh?: boolean; signal?: AbortSignal }): Promise<TeamMemberCandidateSourcePage>
}
export interface TeamMemberAddResult {
  state: 'completed'
  requestUid: string
  memberCount: number
  membershipRevision: number
  items: Array<{key: string; displayName?: string; status: 'added' | 'already_member' | 'rejected'; reason?: string}>
}
export interface TeamMemberAdditionAttempt { requestUid: string; userIds: string[]; labels?: Record<string, string> }
export type TeamMemberAdditionRecovery = TeamMemberAddResult | {state: 'none'} | {state: 'unresolved'; requestUid: string}
export type TeamMemberManagementRequest = {teamRef: string} & (
  {action: 'candidates'; source: TeamMemberCandidateSource; sourceRef?: string; cursor?: string; refresh?: boolean} |
  {action: 'add'; candidateRefs: string[]; requestUid: string} |
  {action: 'recover' | 'retry'} | {action: 'ack'; requestUid: string})
export type TeamMemberManagementResult = TeamMemberCandidatePage | TeamMemberAddResult | TeamMemberAdditionRecovery | {state: 'acknowledged'}
export interface TeamMemberManagementPort {
  teamMemberManagement(request: TeamMemberManagementRequest, signal?: AbortSignal): Promise<TeamMemberManagementResult>
}
