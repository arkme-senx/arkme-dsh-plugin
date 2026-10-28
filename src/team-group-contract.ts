import type { ArkmeTeam } from './types.js'

/** Team membership supplies identity candidates. It does not grant teammates group access. */
export interface TeamGroupContext {
  state: 'ready' | 'backend_pending'
  teams: Array<ArkmeTeam & { representation?: TeamRepresentationSelection }>
  /** Unknown on current backend; a future roster binding suppresses identity choice. */
  groupJoinAt?: number
  membershipPolicy?: 'independent' | 'team_roster' | 'unknown'
}
export interface TeamGroupPending { state: 'backend_pending' }
export const TEAM_GROUP_PENDING_TEXT = '后端接口开发中，开发完成后此功能完整可用。'

export function canChooseTeamGroupIdentity(value?: TeamGroupContext): boolean {
  return value !== undefined && value.state === 'ready' && value.membershipPolicy !== 'team_roster'
    && value.teams.some(team => !!team.jotmoId && !!team.teamRef)
}

/** Only public presentation. Never includes a team's private member list or settings. */
export interface TeamPublicCard {
  name: string
  jotmoId: string
  avatar?: ArkmeTeam['avatar']
  contact: { state: 'available'; publicRef: string } | { state: 'disabled' } | {state:'unavailable'}
  description?: string
  navigation?: {kind:'contact'|'inbox'|'none';teamRef?:string}
}

export interface TeamRepresentationSelection {teamRef:string;membershipKind:'owner'|'member';membershipRevision:number;groupJoinAt:number}
export interface TeamRepresentationSnapshot extends TeamRepresentationSelection {name:string;jotmoId:string}
export interface TeamGroupIdentity {team:ArkmeTeam;selection:TeamRepresentationSelection}
export interface TeamRepresentationSendOptions {representation?:TeamRepresentationSelection;sendAtMillis?:number}
