import type { ArkmeTeam } from './types.js'

/** App-only handoff boundary. Membership in a team is NOT permission to represent it in a group. */
export interface TeamGroupContext {
  state: 'backend_pending'
  teams: ArkmeTeam[]
}
export interface TeamGroupPending { state: 'backend_pending' }
export const TEAM_GROUP_PENDING_TEXT = '后端接口开发中，开发完成后此功能完整可用。'

/** Proposed capability projection, not returned by the pending Host yet.
 * A team roster and a delegated team identity are separate relationships. */
export interface TeamGroupSpeakingEligibility {
  state: 'ready' | 'backend_pending'
  membershipPolicy: 'independent' | 'team_roster'
  personalCanSend: boolean
  teams: Array<{ jotmoId: string; membershipState: 'active' | 'pending' | 'removed'; canSend: boolean }>
}

export function canChooseTeamGroupIdentity(value?: TeamGroupSpeakingEligibility): boolean {
  if (value?.state !== 'ready' || value.membershipPolicy !== 'independent') return false
  const teams = new Set(value.teams.filter(team => team.membershipState === 'active' && team.canSend && team.jotmoId).map(team => team.jotmoId))
  return Number(value.personalCanSend) + teams.size > 1
}
