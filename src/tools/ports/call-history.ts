import type {
  ArkmeCallDetail,
  ArkmeCallHistoryOptions,
  ArkmeCallHistoryPage,
  ArkmeCallSummaryRetryResult,
} from '../../types.js'

export interface ArkmeCallHistoryToolPort {
  listCallHistory(options?: ArkmeCallHistoryOptions, signal?: AbortSignal): Promise<ArkmeCallHistoryPage>
  callDetail(callRef: string, signal?: AbortSignal): Promise<ArkmeCallDetail>
  retryCallSummary(callRef: string, signal?: AbortSignal): Promise<ArkmeCallSummaryRetryResult>
}
