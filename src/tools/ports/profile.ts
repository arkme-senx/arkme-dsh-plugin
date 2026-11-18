import type { ArkmeCapabilitySettings, ArkmeCapabilityUpdate } from '../../capabilities.js'
import type { ArkmeAiPointsAccount, ArkmeAiPointsPage, ArkmeAiPointsQuery } from '../../ai-points.js'
import type { ArkmeBackgroundSoundPreference, ArkmeIdMutationResult, ArkmeProviderCapabilities, ArkmeUserProfileSnapshot } from '../../types.js'

export interface ArkmeProfileToolPort {
  automaticCapabilities(expectedScope?: string, signal?: AbortSignal): Promise<ArkmeCapabilitySettings>
  updateAutomaticCapability(input: ArkmeCapabilityUpdate, expectedScope: string, signal?: AbortSignal): Promise<ArkmeCapabilitySettings>
  aiPointsAccount(expectedScope?: string, signal?: AbortSignal): Promise<ArkmeAiPointsAccount>
  aiPointsConsumption(query: ArkmeAiPointsQuery, expectedScope?: string, signal?: AbortSignal): Promise<ArkmeAiPointsPage>
  accountModels(scope?:string,signal?:AbortSignal):Promise<import('../../account-models.js').AccountModelSettings>
  accountModelUsage(scope:string,query:import('../../account-models.js').ModelUsageQuery,signal?:AbortSignal):Promise<import('../../account-models.js').ModelUsagePage>
  accountModelPreferences(scope:string,revision:number,preferences:import('../../account-models.js').AccountModelPreferences,signal?:AbortSignal):Promise<import('../../account-models.js').AccountModelSettings>
  disableAccountModel(scope:string,revision:number,uid:string,disabled:boolean,signal?:AbortSignal):Promise<import('../../account-models.js').AccountModelSettings>
  aiPointsStatistics(query:import('../../ai-points-statistics.js').ArkmeAiPointsStatisticsQuery,scope?:string,signal?:AbortSignal):Promise<import('../../ai-points-statistics.js').ArkmeAiPointsStatistics>
  aiPointsConsumptionRange(query:import('../../ai-points-statistics.js').ArkmeAiPointsRangeQuery,scope?:string,signal?:AbortSignal):Promise<import('../../ai-points-statistics.js').ArkmeAiPointsRangePage>
  providerCapabilities(): ArkmeProviderCapabilities
  cachedProfile(): Promise<ArkmeUserProfileSnapshot>
  refreshProfile(): Promise<ArkmeUserProfileSnapshot>
  setArkmeIdOnce(name: string): Promise<ArkmeIdMutationResult>
  backgroundSoundPreference(signal?: AbortSignal): Promise<ArkmeBackgroundSoundPreference>
  updateBackgroundSoundPreference(enabled: boolean, signal?: AbortSignal, expectedUserId?: number): Promise<ArkmeBackgroundSoundPreference>
}
