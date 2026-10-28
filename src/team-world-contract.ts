import type { ArkmeTeam } from './types.js'

export const TEAM_WORLD_PENDING_TEXT = '后端接口开发中，开发完成后此功能完整可用。'

/** A public team identity is separate from both a person and a publishing grant. */
export interface TeamWorldTarget {
  jotmoId: string
  name: string
  avatar?: ArkmeTeam['avatar']
  returnTeamRef?: string
}

/** Local Host boundary until the server supplies a team-owned public feed. */
export interface TeamWorldView {
  state: 'backend_pending'
  team: TeamWorldTarget
  memberTeam?: ArkmeTeam
}

export interface TeamWorldPrepareResult { state: 'backend_pending' }
