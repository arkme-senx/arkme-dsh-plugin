import type { ArkmeCapabilitySettings, ArkmeCapabilityUpdate } from '../../capabilities.js'
import type { ArkmeAiPointsAccount, ArkmeAiPointsPage, ArkmeAiPointsQuery } from '../../ai-points.js'
import type { ArkmeBackgroundSoundPreference, ArkmeIdMutationResult, ArkmeProviderCapabilities, ArkmeUserProfileSnapshot } from '../../types.js'

export interface ArkmeProfileToolPort {
  automaticCapabilities(expectedScope?: string, signal?: AbortSignal): Promise<ArkmeCapabilitySettings>
  updateAutomaticCapability(input: ArkmeCapabilityUpdate, expectedScope: string, signal?: AbortSignal): Promise<ArkmeCapabilitySettings>
  aiPointsAccount(expectedScope?: string, signal?: AbortSignal): Promise<ArkmeAiPointsAccount>
  aiPointsConsumption(query: ArkmeAiPointsQuery, expectedScope?: string, signal?: AbortSignal): Promise<ArkmeAiPointsPage>
  providerCapabilities(): ArkmeProviderCapabilities
  cachedProfile(): Promise<ArkmeUserProfileSnapshot>
  refreshProfile(): Promise<ArkmeUserProfileSnapshot>
  setArkmeIdOnce(name: string): Promise<ArkmeIdMutationResult>
  backgroundSoundPreference(signal?: AbortSignal): Promise<ArkmeBackgroundSoundPreference>
  updateBackgroundSoundPreference(enabled: boolean, signal?: AbortSignal, expectedUserId?: number): Promise<ArkmeBackgroundSoundPreference>
}
