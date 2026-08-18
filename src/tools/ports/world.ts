import type { ArkmeWorldPublishResult, ArkmeWorldRecordList } from '../../types.js'

export interface ArkmeWorldToolPort {
  listWorldRecords(options?: { limit?: number; offset?: number; signal?: AbortSignal }): Promise<ArkmeWorldRecordList>
  publishWorldTextForConversation(recordUid: string, textContent: string, signal?: AbortSignal): Promise<ArkmeWorldPublishResult>
}
