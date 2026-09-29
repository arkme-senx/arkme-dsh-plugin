import { ArkmeClientError } from '../sdk/index.js'
import { BrowserAvatarPersistentCache } from './avatar-persistent-cache.js'
import type { ArkmeImagePayload } from '../types.js'
import { avatarReferenceDiagnostic, avatarScopeDiagnostic, logArkmeAvatarDiagnostic } from '../avatar-diagnostics.js'
import { callArkme } from './api.js'
import { InMemoryArkmeAvatarImageStore, type ArkmeAvatarImagePort } from './avatar-image-store.js'

export const arkmeAvatarImages: ArkmeAvatarImagePort = new InMemoryArkmeAvatarImageStore({
  persistentCache: new BrowserAvatarPersistentCache(),
  cachedReader: async imageRef => {
    try { return await callArkme<ArkmeImagePayload>('image.read', { imageRef, cacheOnly: true }) }
    catch (error) {
      if (error instanceof ArkmeClientError && error.body.code === 'image-cache-miss') return undefined
      throw error
    }
  },
  reader: async imageRef => await callArkme<ArkmeImagePayload>('image.read', { imageRef }),
  onLoadFailure: ({ imageRef, scopeKey, error, ...context }) => {
    logArkmeAvatarDiagnostic('image_load_failed', {
      ...avatarScopeDiagnostic(scopeKey), ...avatarReferenceDiagnostic(imageRef), ...context,
    }, error)
  },
})
