import type { ArkmeTeam } from './types.js'

/** Team membership supplies identity candidates. It does not grant teammates group access. */
export interface TeamGroupContext {
  state: 'backend_pending'
  teams: ArkmeTeam[]
  /** Unknown on current backend; a future roster binding suppresses identity choice. */
  membershipPolicy?: 'independent' | 'team_roster' | 'unknown'
}
export interface TeamGroupPending { state: 'backend_pending' }
export const TEAM_GROUP_PENDING_TEXT = '后端接口开发中，开发完成后此功能完整可用。'

export function canChooseTeamGroupIdentity(value?: TeamGroupContext): boolean {
  return value !== undefined && value.membershipPolicy !== 'team_roster'
    && value.teams.some(team => !!team.jotmoId && !!team.teamRef)
}

/** Only public presentation. Never includes a team's private member list or settings. */
export interface TeamPublicCard {
  name: string
  jotmoId: string
  avatar?: ArkmeTeam['avatar']
  contact: { state: 'available'; publicRef: string } | { state: 'disabled' } | { state: 'backend_pending' }
}
