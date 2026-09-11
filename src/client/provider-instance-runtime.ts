import { callArkme } from './api.js'
import { homeTourDiagnostic } from './home-tour-diagnostics.js'
import { arkmeAvatarImages } from './avatar-image-runtime.js'
import type { ArkmeAvatarImagePort } from './avatar-image-store.js'
import type { ArkmeClientAccountScope } from './chat-directory-store.js'
import { reconcileNavigationProviderInstance } from './navigation-cache.js'
import { privateChatActions } from './private-chat-actions-store.js'

interface ArkmeProviderInstanceGuardOptions {
  loadInstance(): Promise<string>
  onInvalidate(): void
  storage?: Storage
}

interface ArkmeProviderInstanceDirectoryRecoveryOptions {
  accountScope: Exclude<ArkmeClientAccountScope, undefined>
  activateAccount(scope: ArkmeClientAccountScope): void
  refreshRoot(force: boolean): Promise<void>
  onRefreshed(): void
  retryDelaysMillis?: readonly number[]
  wait?(delayMillis: number): Promise<void>
}

/** Coalesce SSE reconnect checks and invalidate projections when the local Provider process changes. */
export function createArkmeProviderInstanceGuard(options: ArkmeProviderInstanceGuardOptions): () => Promise<boolean> {
  let observedInstanceId: string | undefined
  let pending: Promise<boolean> | undefined
  return async () => {
    if (pending !== undefined) return await pending
    const check = (async () => {
      homeTourDiagnostic('provider-check-start', { hadObservedInstance: observedInstanceId !== undefined })
      const instanceId = (await options.loadInstance()).trim()
      if (instanceId === '') throw new Error('Provider instance ID is empty')
      const liveInstanceChanged = observedInstanceId !== undefined && observedInstanceId !== instanceId
      const persistedInstanceChanged = reconcileNavigationProviderInstance(instanceId, options.storage)
      observedInstanceId = instanceId
      const changed = liveInstanceChanged || persistedInstanceChanged
      homeTourDiagnostic('provider-check-result', { liveInstanceChanged, persistedInstanceChanged, changed })
      if (changed) options.onInvalidate()
      return changed
    })()
    pending = check
    try {
      return await check
    } catch (error) {
      homeTourDiagnostic('provider-check-failed')
      throw error
    } finally {
      if (pending === check) pending = undefined
    }
  }
}

export function revalidateArkmeProviderAvatarImages(
  images: Pick<ArkmeAvatarImagePort, 'revalidateActive'>,
): void {
  void images.revalidateActive()
}

export const reconcileArkmeProviderInstance = createArkmeProviderInstanceGuard({
  loadInstance: async () => {
    const instance = await callArkme<{ instanceId: string }>('provider.instance')
    return instance.instanceId
  },
  onInvalidate: () => {
    privateChatActions.reset()
    revalidateArkmeProviderAvatarImages(arkmeAvatarImages)
  },
})

/** Drop stale Browser projections, preferring a fresh Host read with its current-instance snapshot as fallback. */
export async function recoverArkmeProviderInstanceDirectory(
  options: ArkmeProviderInstanceDirectoryRecoveryOptions,
): Promise<void> {
  homeTourDiagnostic('provider-directory-recovery-start', { accountKey: options.accountScope })
  options.activateAccount(undefined)
  options.activateAccount(options.accountScope)
  const wait = options.wait ?? (async (delayMillis: number) => {
    await new Promise<void>(resolve => { window.setTimeout(resolve, delayMillis) })
  })
  const retryDelaysMillis = options.retryDelaysMillis ?? [250, 750, 1_500]
  try {
    await options.refreshRoot(true)
  } catch {
    homeTourDiagnostic('provider-directory-recovery-fallback', { accountKey: options.accountScope })
    try {
      await options.refreshRoot(false)
    } catch (initialError) {
      let lastError: unknown = initialError
      for (const delayMillis of retryDelaysMillis) {
        homeTourDiagnostic('provider-directory-recovery-retry', { accountKey: options.accountScope, delayMillis })
        if (delayMillis > 0) await wait(delayMillis)
        try {
          await options.refreshRoot(true)
          lastError = undefined
          break
        } catch (error) {
          lastError = error
        }
      }
      if (lastError !== undefined) {
        homeTourDiagnostic('provider-directory-recovery-failed', { accountKey: options.accountScope })
        throw lastError
      }
    }
  }
  options.onRefreshed()
  homeTourDiagnostic('provider-directory-recovery-complete', { accountKey: options.accountScope })
}
