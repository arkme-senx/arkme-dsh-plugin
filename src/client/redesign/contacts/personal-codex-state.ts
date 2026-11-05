import type { TeamCodexState, TeamCodexTask } from '../../../team-codex-contract.js'
import type { ArkmeTeam } from '../../../types.js'

export type CodexTeamScope = Pick<ArkmeTeam, 'teamRef' | 'name' | 'jotmoId'>
/** Client-only routing metadata. Never changes the task id or the upload destination. */
export type CodexViewTask = TeamCodexTask & { viewTeam?: CodexTeamScope }
export type CodexViewState = Omit<TeamCodexState, 'tasks'> & { tasks: CodexViewTask[] }
export const codexTaskViewKey = (task: CodexViewTask): string => task.viewTeam ? JSON.stringify([task.viewTeam.teamRef,task.id]) : task.id

/** The account owner can read their history independently of current team membership. */
export async function readPersonalCodexState(
  memberRef: string,
  read: (teamRef: string) => Promise<TeamCodexState>, signal: AbortSignal,
): Promise<{ state: CodexViewState; unavailable: string[] }> {
  signal.throwIfAborted()
  const state=await read('self')
  signal.throwIfAborted()
  const blocked = state.cloud?.status === 'blocked'
  return {
    state: {...state, tasks: state.tasks.filter(t =>
      t.cloud ? !blocked && t.cloud.ownerRef === memberRef : !!state.self && t.member.userRef === state.self.userRef,
    ).map(t => ({...t, viewTeam: {teamRef:'self', name:'我的 Codex', jotmoId:''}}))},
    unavailable: state.cloud?.status === 'offline' || blocked ? ['云端暂不可用'] : [],
  }
}
