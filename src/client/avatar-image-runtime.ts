import type { ArkmeImagePayload } from '../types.js'
import { callArkme } from './api.js'
import { InMemoryArkmeAvatarImageStore, type ArkmeAvatarImagePort } from './avatar-image-store.js'

export const arkmeAvatarImages: ArkmeAvatarImagePort = new InMemoryArkmeAvatarImageStore({
  reader: async imageRef => await callArkme<ArkmeImagePayload>('image.read', { imageRef }),
})
