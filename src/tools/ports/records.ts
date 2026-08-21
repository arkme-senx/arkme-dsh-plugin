import type {
  ArkmeCachedQueryResult, ArkmeConversationWriteResult, ArkmeImageSearchResult, ArkmeRecordSearchResult,
  ArkmeRecordingSearchResult, ArkmeSearchSceneKind,
} from '../../types.js'

export interface ArkmeRecordToolPort {
  refreshLatest(): Promise<void>
  syncHistory(maxPages?: number, signal?: AbortSignal): Promise<{ pages: number; complete: boolean }>
  queryCached(options: {
    query?: string
    limit: number
    beforeMillis?: number
  }): Promise<ArkmeCachedQueryResult>
  searchRemote(options: {
    query: string
    limit: number
    cursor?: string
    signal?: AbortSignal
  }): Promise<ArkmeRecordSearchResult>
  searchScene(options: {
    scene: ArkmeSearchSceneKind
    limit: number
    cursor?: string
    signal?: AbortSignal
  }): Promise<ArkmeRecordSearchResult>
  searchImages(options: {
    limit: number
    cursor?: string
    signal?: AbortSignal
  }): Promise<ArkmeImageSearchResult>
  searchRecordings(options: {
    query: string
    limit: number
    cursor?: string
    signal?: AbortSignal
  }): Promise<ArkmeRecordingSearchResult>
  createTextForConversation(recordUid: string, textContent: string): Promise<ArkmeConversationWriteResult>
}
