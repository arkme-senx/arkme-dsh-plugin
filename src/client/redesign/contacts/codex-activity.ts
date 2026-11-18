import type { TeamCodexState, TeamCodexTask, CodexTaskPosition } from '../../../team-codex-contract.js'
import { codexTaskStatus, mergeCodexActivityTasks, type CodexTaskStatus } from './codex-task-status.js'
import { conversationActivityAtMillis } from '../../conversation-directory-order.js'

export interface CodexActivitySnapshot {
  tasks: TeamCodexTask[]
  complete: boolean
  checkedAt: number
}

/** All own visible conversations, independent of the selected task or its execution phase. */
export function codexActivityAtMillis(snapshot: CodexActivitySnapshot | undefined): number {
  return snapshot?.tasks.reduce((at, task) => task.eventCount > 0 && !task.excluded && !task.projectExcluded && task.classification?.kind !== 'background'
    ? Math.max(at, conversationActivityAtMillis(task.updatedAt)) : at, 0) ?? 0
}

/** Bounded metadata-only scan; no message bodies and no dependence on the picker page. */
export async function readCodexActivity(
  member: string,
  read: (teamRef: string, page: number,position?:CodexTaskPosition) => Promise<TeamCodexState>, signal: AbortSignal,
  progress?: (value: CodexActivitySnapshot) => void,
): Promise<CodexActivitySnapshot> {
  const tasks: TeamCodexTask[] = []
  let complete = true
  let position:CodexTaskPosition={}
  for (let page = 1; page <= 100; page++) {
    signal.throwIfAborted()
    try {
      const state = await read('self', page,position)
      signal.throwIfAborted()
      if (state.cloud?.status === 'offline' || state.cloud?.status === 'blocked') { complete = false; break }
      for (const task of state.tasks) {
        const own = task.cloud ? task.cloud.ownerRef === member : !!state.self && task.member.userRef === state.self.userRef
        if (own && !task.excluded && !task.projectExcluded) tasks.push(task)
      }
      if (state.cloud?.reviewingTasks) complete = false
      progress?.({tasks:mergeCodexActivityTasks(tasks),complete:false,checkedAt:Date.now()})
      const paging=state.localTaskPage??(state.localOnly?undefined:state.cloud)
      if (!paging?.hasMore) break
      position={cursor:paging.nextCursor}
      if (page === 100) complete = false
    } catch {
      signal.throwIfAborted()
      complete = false
      break
    }
  }
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
