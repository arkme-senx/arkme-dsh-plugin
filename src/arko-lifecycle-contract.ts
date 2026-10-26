import type { ArkmeArkoHistoryItem } from './types.js'

export interface ArkmeArkoLifecycleItem {
  messageRef: string
  messageKey: string
  version: number
  state: 'active' | 'deleted' | 'expired' | 'unavailable'
  deletedAtMillis: number
  purgeAtMillis: number
  lastOperationUid: string
  relatedMessageDeleted?: boolean
  deleteBlockedReason?: string
}
export interface ArkmeArkoLifecycleSnapshot { revision: number; items: ArkmeArkoLifecycleItem[] }
export interface ArkmeArkoLifecycleCommand {
  action: 'delete' | 'restore'
  operationUid: string
  targets: { messageRef: string; expectedVersion: number }[]
}
export interface ArkmeArkoLifecycleResult {
  operationUid: string
  items: (ArkmeArkoLifecycleItem & { result: string })[]
}
export interface ArkmeArkoDeletedPage {
  items: (ArkmeArkoLifecycleItem & { message?: ArkmeArkoHistoryItem })[]
  hasMore: boolean
  nextCursor?: string
}
export interface ArkmeArkoLifecyclePort {
  arkoLifecycle(messageRefs?: readonly string[], signal?: AbortSignal): Promise<ArkmeArkoLifecycleSnapshot>
  arkoChangeLifecycle(command: ArkmeArkoLifecycleCommand, signal?: AbortSignal): Promise<ArkmeArkoLifecycleResult>
  arkoRecentlyDeleted(cursor?: string, signal?: AbortSignal): Promise<ArkmeArkoDeletedPage>
}
