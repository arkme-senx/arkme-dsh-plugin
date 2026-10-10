import { useArkmeDeliveryTasks } from './file-send-tasks.js'
import { callArkme } from './api.js'
import { teamTaskActive, type TeamSendTask } from '../team-send-contract.js'

// Initial delivery is represented by the message, including local attachments.
// Recovery keeps its status so hiding routine work never disguises a failure.
export function teamTaskShowsInlineStatus(task: TeamSendTask): boolean {
  return task.attempts > 0 || !!task.reason || !!task.error
    || !!task.cancelRequested || !['queued', 'uploading', 'sending'].includes(task.state)
}

const adapter = {
  read: (conversationRef: string, signal: AbortSignal) => callArkme<TeamSendTask[]>('team.app.send.tasks', { conversationRef }, signal),
  active: (tasks: readonly TeamSendTask[]) => tasks.some(teamTaskActive),
  belongs: (task: TeamSendTask, scope: string) => task.conversationRef === scope,
  key: (task: TeamSendTask) => task.taskRef,
}
export function useTeamSendTasks(conversationRef: string, accountKey: string) {
  return useArkmeDeliveryTasks(conversationRef, accountKey, adapter)
}
