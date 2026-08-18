import type { ArkmeImageBytes } from '../../types.js'

export interface ArkmeMediaToolPort {
  readImage(
    imageRef: string,
    options?: { maxBytes?: number; signal?: AbortSignal },
  ): Promise<ArkmeImageBytes>
}
