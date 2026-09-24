import type { ArkmeBackgroundSoundPreference, ArkmeIdMutationResult, ArkmeProviderCapabilities, ArkmeUserProfileSnapshot } from '../../types.js'

export interface ArkmeProfileToolPort {
  providerCapabilities(): ArkmeProviderCapabilities
  cachedProfile(): Promise<ArkmeUserProfileSnapshot>
  refreshProfile(): Promise<ArkmeUserProfileSnapshot>
  setArkmeIdOnce(name: string): Promise<ArkmeIdMutationResult>
  backgroundSoundPreference(signal?: AbortSignal): Promise<ArkmeBackgroundSoundPreference>
  updateBackgroundSoundPreference(enabled: boolean, signal?: AbortSignal, expectedUserId?: number): Promise<ArkmeBackgroundSoundPreference>
}
