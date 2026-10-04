import { useArkmeDeliveryTasks } from './file-send-tasks.js'
import { callArkme } from './api.js'
import { teamTaskActive, type TeamSendTask } from '../team-send-contract.js'
const adapter = {
  read: (conversationRef: string, signal: AbortSignal) => callArkme<TeamSendTask[]>('team.app.send.tasks', { conversationRef }, signal),
  active: (tasks: readonly TeamSendTask[]) => tasks.some(teamTaskActive),
  belongs: (task: TeamSendTask, scope: string) => task.conversationRef === scope,
  key: (task: TeamSendTask) => task.taskRef,
}
export function useTeamSendTasks(conversationRef: string, accountKey: string) {
  return useArkmeDeliveryTasks(conversationRef, accountKey, adapter)
}
