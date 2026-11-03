import type { ArkmeRecordThought } from './record-thought-contract.js'

export interface ArkmeThoughtContinuation extends ArkmeRecordThought {
  replyRecordUid: string
  createdAtMillis: number
  canRetry: boolean
  failure?: 'reply_failed' | 'insufficient_balance'
}
export interface ArkmeThoughtContinuationPage {
  accountScope: string
  supported: boolean
  items: ArkmeThoughtContinuation[]
  nextCursor?: string
}
