import type { TeamCodexState, TeamCodexTask } from '../../../team-codex-contract.js'
import type { ArkmeTeam } from '../../../types.js'

export type CodexTeamScope = Pick<ArkmeTeam, 'teamRef' | 'name' | 'jotmoId'>
/** Client-only routing metadata. Never changes the task id or the upload destination. */
export type CodexViewTask = TeamCodexTask & { viewTeam?: CodexTeamScope }
export type CodexViewState = Omit<TeamCodexState, 'tasks'> & { tasks: CodexViewTask[] }
export const codexTaskViewKey = (task: CodexViewTask): string => task.viewTeam ? JSON.stringify([task.viewTeam.teamRef,task.id]) : task.id

/** Reuse permission-checked team reads, scoped to the signed-in member. No write operations. */
export async function readPersonalCodexState(
  teams: readonly CodexTeamScope[], memberRef: string, page: number,
  read: (teamRef: string) => Promise<TeamCodexState>, signal: AbortSignal,
): Promise<{ state: CodexViewState; unavailable: string[] }> {
  const results = new Map<string, TeamCodexState>()
  const unavailable: string[] = []
  let index = 0
  await Promise.all(Array.from({ length: Math.min(3,teams.length) }, async () => {
    while (index < teams.length) {
      signal.throwIfAborted()
      const team = teams[index++]!
      try { const value = await read(team.teamRef); signal.throwIfAborted(); results.set(team.teamRef,value) }
      catch { signal.throwIfAborted(); unavailable.push(team.name) }
    }
  }))
  signal.throwIfAborted()
  const tasks: CodexViewTask[] = []
  let self: TeamCodexState['self'] = null
  let hasMore = false
  for (const team of teams) {
    const result = results.get(team.teamRef)
    if (!result) continue
    self ??= result.self
    hasMore ||= result.cloud?.hasMore === true
    if (result.cloud?.status === 'offline' || result.cloud?.status === 'blocked') unavailable.push(team.name)
    for (const task of result.tasks) {
      // Cloud rows use canonical owner ids; local rows are account-bound by the host.
      const own = task.cloud ? task.cloud.ownerRef === memberRef : !!result.self && task.member.userRef === result.self.userRef
      if (!own || (task.cloud?.remote && result.cloud?.status !== 'ready')) continue
      if (page > 1 && (result.localOnly || result.cloud?.status === 'unsupported')) continue
      tasks.push({...task,viewTeam:team})
    }
  }
  return {
    // Read-only aggregate for the conversation picker, never used as upload status.
    state: {localOnly:false,self,installations:[],tasks,cloud:{status:'ready',pending:0,blocked:0,page,hasMore}},
    unavailable:[...new Set(unavailable)],
  }
}
