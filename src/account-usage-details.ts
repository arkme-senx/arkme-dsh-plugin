/** Actual model-call usage, not monthly entitlement deductions or money. */
export interface ArkmeUsageTokens {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens: number
  cacheMissTokens: number
  cacheCreationInputTokens: number
}
export interface ArkmeTokenUsageSummary {
  accountScope: string
  monthKey: string
  timezone: string
  availableMonths: string[]
  windowStartMs: number
  windowEndMs: number
  availableFromMs: number
  callCount: number
  tokens: ArkmeUsageTokens
  partialUsage: boolean
}
export interface ArkmeTokenUsageOperation {
  operationUid: string
  bizCode: number
  displayName: string
  occurredAtMs: number
  callCount: number
  models: string[]
  cacheStatus: number
  tokens: ArkmeUsageTokens
  partialUsage: boolean
}
export interface ArkmeTokenUsageCall {
  occurredAtMs: number
  model: string
  usageStatus: number
  cacheStatus: number
  tokens: ArkmeUsageTokens
}
export interface ArkmeTokenUsagePage<T> {
  accountScope: string
  items: T[]
  nextCursor: string
}
export interface ArkmeTokenUsageQuery {
  monthKey: string
  timezone: string
  cursor?: string
  operationUid?: string
  bizCode?: number
}
