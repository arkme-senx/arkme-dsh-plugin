import {BrowserAvatarPersistentCache} from './avatar-persistent-cache.js'
import { InMemoryArkmeAvatarImageStore } from './avatar-image-store.js'
import { callArkme } from './api.js'

/** Team authorization adapts to the existing account-scoped avatar cache. */
export const teamAvatarImages = new InMemoryArkmeAvatarImageStore({
  persistentCache:new BrowserAvatarPersistentCache(),
  reader: async imageRef => {
    const image = await callArkme<{base64: string; mimeType: string}>('team.app.image', {imageRef}, undefined, { priority: 'background' })
    return {dataBase64: image.base64, mediaType: image.mimeType}
  },
})
