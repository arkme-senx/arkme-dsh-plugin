import type { TeamCodexTask } from '../../../team-codex-contract.js'
import type { ArkmeTeam } from '../../../types.js'

/** A viewing intent only. It never changes the collector or cloud upload binding. */
export interface CodexConversationTarget {
  accountKey: string
  team: Pick<ArkmeTeam, 'teamRef' | 'name' | 'jotmoId'>
  task?: TeamCodexTask
  page?: number
  member?: string
  memberName?: string
  project?: string
  fromTeam?: boolean
  returnView?: 'members' | 'activity'
}

export const codexTargetScopeKey = (target: CodexConversationTarget): string =>
  JSON.stringify([target.accountKey, target.team.teamRef, target.member ?? ''])
