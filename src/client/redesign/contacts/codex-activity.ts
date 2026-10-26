import type { TeamCodexState, TeamCodexTask } from '../../../team-codex-contract.js'
import type { CodexTeamScope } from './personal-codex-state.js'
import { codexTaskStatus, mergeCodexActivityTasks, type CodexTaskStatus } from './codex-task-status.js'

export interface CodexActivitySnapshot {
  tasks: TeamCodexTask[]
  complete: boolean
  checkedAt: number
}

/** Bounded metadata-only scan; no message bodies and no dependence on the picker page. */
export async function readCodexActivity(
  teams: readonly CodexTeamScope[], member: string,
  read: (teamRef: string, page: number) => Promise<TeamCodexState>, signal: AbortSignal,
  progress?: (value: CodexActivitySnapshot) => void,
): Promise<CodexActivitySnapshot> {
  const tasks: TeamCodexTask[] = []
  let index = 0, complete = true
  await Promise.all(Array.from({length:Math.min(3,teams.length)}, async () => {
    while (index < teams.length) {
      const team = teams[index++]!
      for (let page = 1; page <= 100; page++) {
        signal.throwIfAborted()
        try {
          const state = await read(team.teamRef,page)
          signal.throwIfAborted()
          if (state.cloud?.status === 'offline' || state.cloud?.status === 'blocked') { complete = false; break }
          for (const task of state.tasks) {
            const own = task.cloud ? task.cloud.ownerRef === member : !!state.self && task.member.userRef === state.self.userRef
            if (own && !task.excluded && !task.projectExcluded) tasks.push(task)
          }
          if (state.cloud?.reviewingTasks) complete = false
          progress?.({tasks:mergeCodexActivityTasks(tasks),complete:false,checkedAt:Date.now()})
          if (state.localOnly || !state.cloud?.hasMore || state.cloud.status === 'unsupported') break
          if (page === 100) complete = false
        } catch {
          signal.throwIfAborted()
          complete = false
          break
        }
      }
    }
  }))
  signal.throwIfAborted()
  return {tasks:mergeCodexActivityTasks(tasks),complete,checkedAt:Date.now()}
}

export function codexActivityPresentation(snapshot: CodexActivitySnapshot | undefined, now = Date.now()): {
  kind: 'updating' | 'running' | 'finished' | 'unknown' | 'idle'
  status?: CodexTaskStatus
  task?: TeamCodexTask
  count?: number
} {
  if (!snapshot || !snapshot.complete || now - snapshot.checkedAt >= 30_000) return {kind:'updating'}
  const running = snapshot.tasks.filter(task=>codexTaskStatus(task,now)==='running')
  const unknown = snapshot.tasks.some(task=>codexTaskStatus(task,now)==='unknown')
  // An unknown working task prevents an exact total, even if other sources are healthy.
  if (unknown) return {kind:'unknown',status:'unknown'}
  if (running.length) return {kind:'running',status:'running',count:running.length,...(running.length===1?{task:running[0]!}:{})}
  const finished = snapshot.tasks.find(task=>codexTaskStatus(task,now)==='finished')
  if (finished) return {kind:'finished',status:'finished',task:finished}
  return {kind:'idle'}
}
