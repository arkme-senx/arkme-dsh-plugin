import type { ArkmeFileSendTask, ArkmeLocalFile } from './file-transfer-contract.js'
import type { TeamContent, TeamMessage, TeamReplyTarget } from './team-app-contract.js'

/** Internal App delivery receipt. A Team destination is never a Chat source. */
export interface TeamSendInput {
  /** Account/operation-bound Host-sealed metadata, never raw coordinates. */
  metadataRef?: string
  backgroundSound?: import('./file-transfer-contract.js').ArkmeFileBackgroundSoundInput
  conversationRef: string
  clientUid: string
  expectedReplySeq: number
  content: TeamContent
  fileRefs: string[]
  reply?: TeamReplyTarget
}
export interface TeamSendTask extends TeamSendInput {
  /** Internal normalized business digest, independent of random cipher nonces. */
  metadataDigest?: string
  taskRef: string
  conversationKey: string
  createdAtMillis: number
  completedAtMillis?: number
  state: 'queued' | 'uploading' | 'sending' | 'retrying' | 'cancelling' | 'sent' | 'failed' | 'cancelled'
  files: ArkmeFileSendTask['files']
  attempts: number
  nextAttemptAt: number
  sendContent?: TeamContent
  cancelRequested?: boolean
  message?: TeamMessage
  reason?: string
  error?: string
}
export const teamTaskActive = (task: TeamSendTask): boolean => ['queued', 'uploading', 'sending', 'retrying', 'cancelling'].includes(task.state)
export const teamTaskFiles = (files: readonly ArkmeLocalFile[]): TeamSendTask['files'] => files.map(file => ({ ...file, progress: { phase: 'preparing', sentBytes: 0, totalBytes: file.size } }))
