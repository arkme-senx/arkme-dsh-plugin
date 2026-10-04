import type { ArkmeFileSendTask, ArkmeLocalFile } from './file-transfer-contract.js'
import type { TeamContent, TeamMessage } from './team-app-contract.js'

/** Internal App delivery receipt. A Team destination is never a Chat source. */
export interface TeamSendInput {
  conversationRef: string
  clientUid: string
  expectedReplySeq: number
  content: TeamContent
  fileRefs: string[]
}
export interface TeamSendTask extends TeamSendInput {
  taskRef: string
  conversationKey: string
  createdAtMillis: number
  completedAtMillis?: number
  state: 'queued' | 'uploading' | 'sending' | 'retrying' | 'sent' | 'failed' | 'cancelled'
  files: ArkmeFileSendTask['files']
  attempts: number
  nextAttemptAt: number
  sendContent?: TeamContent
  confirmReplySeq?: number
  message?: TeamMessage
  reason?: string
  error?: string
}
export const teamTaskActive = (task: TeamSendTask): boolean => ['queued', 'uploading', 'sending', 'retrying'].includes(task.state)
export const teamTaskFiles = (files: readonly ArkmeLocalFile[]): TeamSendTask['files'] => files.map(file => ({ ...file, progress: { phase: 'preparing', sentBytes: 0, totalBytes: file.size } }))
