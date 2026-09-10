import { callArkme } from './api.js'
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
  signal?: AbortSignal
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
      const instanceId = (await options.loadInstance()).trim()
      if (instanceId === '') throw new Error('Provider instance ID is empty')
      const liveInstanceChanged = observedInstanceId !== undefined && observedInstanceId !== instanceId
      const persistedInstanceChanged = reconcileNavigationProviderInstance(instanceId, options.storage)
      observedInstanceId = instanceId
      const changed = liveInstanceChanged || persistedInstanceChanged
      if (changed) options.onInvalidate()
      return changed
    })()
    pending = check
    try {
      return await check
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
  options.signal?.throwIfAborted()
  options.activateAccount(undefined)
  options.activateAccount(options.accountScope)
  const wait = options.wait ?? (async (delayMillis: number) => {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); reject(options.signal?.reason) }
      const timer = setTimeout(() => { options.signal?.removeEventListener('abort', abort); resolve() }, delayMillis)
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) abort()
    })
  })
  const retryDelaysMillis = options.retryDelaysMillis ?? [250, 750, 1_500]
  try {
    await options.refreshRoot(true)
  } catch {
    options.signal?.throwIfAborted()
    try {
      await options.refreshRoot(false)
    } catch (initialError) {
      options.signal?.throwIfAborted()
      let lastError: unknown = initialError
      for (const delayMillis of retryDelaysMillis) {
        if (delayMillis > 0) await wait(delayMillis)
        options.signal?.throwIfAborted()
        try {
          await options.refreshRoot(true)
          lastError = undefined
          break
        } catch (error) {
          options.signal?.throwIfAborted()
          lastError = error
        }
      }
      if (lastError !== undefined) throw lastError
    }
  }
  options.signal?.throwIfAborted()
  options.onRefreshed()
}
