import type { ArkmeTopicBatchCreateResult } from '../../types.js'

export interface ArkmeTopicToolPort {
  createTopicsBatch(
    titles: readonly string[],
    clientMutationId: string,
    parentSourceRef?: string,
    signal?: AbortSignal,
  ): Promise<ArkmeTopicBatchCreateResult>
}
