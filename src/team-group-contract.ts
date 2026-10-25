import type { ArkmeTeam } from './types.js'

/** App-only handoff boundary. Membership in a team is NOT permission to represent it in a group. */
export interface TeamGroupContext {
  state: 'backend_pending'
  teams: ArkmeTeam[]
}
export interface TeamGroupPending { state: 'backend_pending' }
export const TEAM_GROUP_PENDING_TEXT = '后端接口开发中，开发完成后此功能完整可用。'
