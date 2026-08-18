import type {
  ArkmeSourceDirectory, ArkmeSourceList, ArkmeSourceSendResult, ArkmeTimelineCursor, ArkmeTimelinePage,
} from '../../types.js'

export interface ArkmeConversationToolPort {
  listSources(
    directory: ArkmeSourceDirectory,
    options?: { limit?: number; cursor?: string; signal?: AbortSignal },
  ): Promise<ArkmeSourceList>
  readSource(
    sourceRef: string,
    options?: { limit?: number; cursor?: ArkmeTimelineCursor; signal?: AbortSignal },
  ): Promise<ArkmeTimelinePage>
  sendSourceText(
    sourceRef: string,
    textContent: string,
    options?: { recordUid?: string; relationUid?: string },
  ): Promise<ArkmeSourceSendResult>
}
