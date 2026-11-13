/** Team authority commands share the built-in App owner and opaque member references. */
export interface TeamGovernanceResult { active: boolean; dissolving: boolean; membershipRevision: number }
export type TeamGovernanceRole = 'owner' | 'admin' | 'member'
export interface TeamGovernanceState extends TeamGovernanceResult { actorRole?: TeamGovernanceRole; targetRole?: TeamGovernanceRole }
export interface TeamGovernanceMembers {
  membershipRevision: number; canManageRoles: boolean; canTransferOwnership: boolean; canDissolve: boolean
  items: { userRef: string; displayName: string; role: TeamGovernanceRole }[]
  hasMore: boolean; nextPageCursor?: string
}
export type TeamGovernanceRequest =
  | { action: 'state'; teamRef: string; userRef?: string }
  | { action: 'role'; teamRef: string; userRef: string; expectedMembershipRevision: number; role: 'admin' | 'member' }
  | { action: 'transfer'; teamRef: string; userRef: string; expectedMembershipRevision: number }
  | { action: 'dissolve'; teamRef: string; expectedMembershipRevision: number }
export interface TeamGovernancePort {
  teamGovernanceMembers(teamRef: string, pageCursor?: string, signal?: AbortSignal): Promise<TeamGovernanceMembers>
  teamGovernance(request: TeamGovernanceRequest, signal?: AbortSignal): Promise<TeamGovernanceState>
}
