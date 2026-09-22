import type { ArkmeBackgroundSoundPreference, ArkmeIdMutationResult, ArkmeProviderCapabilities, ArkmeUserProfileSnapshot } from '../../types.js'

export interface ArkmeProfileToolPort {
  socialAccessStatus(): Promise<import('../../types.js').ArkmeSocialAccessSnapshot>
  providerCapabilities(): ArkmeProviderCapabilities
  cachedProfile(): Promise<ArkmeUserProfileSnapshot>
  refreshProfile(): Promise<ArkmeUserProfileSnapshot>
  setArkmeIdOnce(name: string): Promise<ArkmeIdMutationResult>
  backgroundSoundPreference(signal?: AbortSignal): Promise<ArkmeBackgroundSoundPreference>
  updateBackgroundSoundPreference(enabled: boolean, signal?: AbortSignal, expectedUserId?: number): Promise<ArkmeBackgroundSoundPreference>
}
