import type { TeamCodexTask, TeamCodexTaskSummary } from '../../../team-codex-contract.js'

export type CodexTaskStatus = 'running' | 'finished' | 'interrupted' | 'unknown' | 'paused' | 'waiting'

/** Last reported task phase; collector connectivity is a separate fact. */
export function codexTaskPhase(task: TeamCodexTask): CodexTaskStatus {
  if (task.excluded || task.projectExcluded || task.status === 'paused' || task.status === 'disconnected') return 'paused'
  if (task.state === 'finished') return 'finished'
  if (task.state === 'interrupted') return 'interrupted'
  if (task.state !== 'working' || task.status !== 'active') return 'waiting'
  return 'running'
}

/** A saved working event on an unverified/offline source is not live execution. */
export function codexTaskStatus(task: TeamCodexTask, now = Date.now()): CodexTaskStatus {
  const phase = codexTaskPhase(task)
  if (phase !== 'running') return phase
  if (task.captureHealth) {
    const age = now - task.captureHealth.checkedAt
    return task.captureHealth.status === 'online' && age >= 0 && age < 30_000 ? 'running' : 'unknown'
  }
  return task.cloud?.remote ? 'unknown' : 'running'
}

/** Deduplicate verified ids only. Same titles on different sources are different tasks. */
export const codexActivityKey = (task: TeamCodexTask): string => task.cloud
  ? JSON.stringify(['cloud', task.cloud.ownerRef, task.cloud.sourceId, task.cloud.taskId])
  : JSON.stringify(['local', task.installationId ?? '', task.id])

export function mergeCodexActivityTasks(tasks: readonly TeamCodexTask[]): TeamCodexTask[] {
  const unique = new Map<string, TeamCodexTask>()
  for (const task of tasks) {
    const key = codexActivityKey(task), previous = unique.get(key)
    if (!previous || task.updatedAt > previous.updatedAt || task.updatedAt === previous.updatedAt
      && (task.captureHealth?.checkedAt ?? 0) > (previous.captureHealth?.checkedAt ?? 0)) unique.set(key, task)
  }
  return [...unique.values()].sort((a,b)=>b.updatedAt-a.updatedAt)
}

/** Metadata and activity have independent source versions; a late page must not undo either. */
export function mergeCodexTaskSummary<T extends TeamCodexTask>(task:T,summary:TeamCodexTaskSummary):T {
  if(!task.cloud?.remote)return summary.updatedAt>=task.updatedAt?{...task,...summary}:task
  const result={...task}
  if(Number.isSafeInteger(summary.metadataVersion) && summary.metadataVersion! >= (task.metadataVersion??0)) {
    result.title=summary.title;result.projectKey=summary.projectKey??'';result.projectName=summary.projectName??'';result.branch=summary.branch??'';result.metadataVersion=summary.metadataVersion!
  }
  if(Number.isSafeInteger(summary.summaryVersion) && summary.summaryVersion! >= (task.summaryVersion??0)) {
    result.state=summary.state;result.updatedAt=summary.updatedAt;result.eventCount=summary.eventCount;result.summaryVersion=summary.summaryVersion!
  }
  return result
}
