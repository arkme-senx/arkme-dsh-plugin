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
export interface TeamMemberAddResult { state: 'backend_pending' }
