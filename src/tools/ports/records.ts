import type {
  ArkmeCachedQueryResult, ArkmeConversationWriteResult,
} from '../../types.js'

export interface ArkmeRecordToolPort {
  refreshLatest(): Promise<void>
  syncHistory(maxPages?: number, signal?: AbortSignal): Promise<{ pages: number; complete: boolean }>
  queryCached(options: {
    query?: string
    limit: number
    beforeMillis?: number
  }): Promise<ArkmeCachedQueryResult>
  createTextForConversation(recordUid: string, textContent: string): Promise<ArkmeConversationWriteResult>
}
