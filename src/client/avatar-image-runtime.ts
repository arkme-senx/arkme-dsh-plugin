import { ArkmeClientError } from '../sdk/index.js'
import { BrowserAvatarPersistentCache } from './avatar-persistent-cache.js'
import type { ArkmeImagePayload } from '../types.js'
import { avatarReferenceDiagnostic, avatarScopeDiagnostic, logArkmeAvatarDiagnostic } from '../avatar-diagnostics.js'
import { callArkme } from './api.js'
import { InMemoryArkmeAvatarImageStore, isImmutableAvatarRef, type ArkmeAvatarImagePort } from './avatar-image-store.js'

export const arkmeAvatarImages: ArkmeAvatarImagePort = new InMemoryArkmeAvatarImageStore({
  persistentCache: new BrowserAvatarPersistentCache(),
  canProbeCache: imageRef => isImmutableAvatarRef(imageRef) || imageRef.startsWith('arkme-profile-image-v1.'),
  cachedReader: async imageRef => {
    try { return await callArkme<ArkmeImagePayload>('image.read', { imageRef, cacheOnly: true }) }
    catch (error) {
      if (error instanceof ArkmeClientError && error.body.code === 'image-cache-miss') return undefined
      throw error
    }
  },
  reader: async (imageRef, refresh) => await callArkme<ArkmeImagePayload>('image.read', { imageRef, ...(refresh ? { refresh } : {}) }, undefined, { priority: 'background', avatarDownload: true }),
  invalidateOnError: error => error instanceof ArkmeClientError && [
    'image-ref-unavailable', 'image-ref-invalid', 'image-account-changed',
  ].includes(error.body.code),
  onLoadFailure: ({ imageRef, scopeKey, error, ...context }) => {
    logArkmeAvatarDiagnostic('image_load_failed', {
      ...avatarScopeDiagnostic(scopeKey), ...avatarReferenceDiagnostic(imageRef), ...context,
    }, error)
  },
})
