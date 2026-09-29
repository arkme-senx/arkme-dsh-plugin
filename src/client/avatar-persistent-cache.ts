import { isImmutableAvatarRef, type ArkmeAvatarImagePayload, type ArkmeAvatarPersistentCache } from './avatar-image-store.js'

const CACHE_NAME = 'arkme-immutable-avatars-v1'
const MAX_ENTRIES = 64
const MAX_BYTES = 64 * 1024 * 1024
const MAX_BASE64_LENGTH = Math.ceil(8 * 1024 * 1024 / 3) * 4

function validPayload(value: unknown): value is ArkmeAvatarImagePayload {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as Partial<ArkmeAvatarImagePayload>
  return typeof payload.mediaType === 'string' && /^image\/(png|jpeg|webp|gif|avif)$/.test(payload.mediaType)
    && typeof payload.dataBase64 === 'string' && payload.dataBase64.length > 0
    && payload.dataBase64.length <= MAX_BASE64_LENGTH && payload.dataBase64.length % 4 === 0
    && !/[^A-Za-z0-9+/]/.test(payload.dataBase64.replace(/={1,2}$/, ''))
}

/** Browser bytes survive reloads. Host remains the authenticated source on misses.
 * No TTL for immutable refs; quota eviction and clearing site data are cache misses.
 * Synthetic keys are never fetched and include the environment/account scope.
 */
export class BrowserAvatarPersistentCache implements ArkmeAvatarPersistentCache {
  private writes: Promise<void> = Promise.resolve()

  private key(scope: string, ref: string): string | undefined {
    if (!scope.trim() || !isImmutableAvatarRef(ref) || typeof globalThis.caches === 'undefined'
      || typeof globalThis.location === 'undefined') return undefined
    return new URL(`/arkme-self/avatar-cache/v1/${encodeURIComponent(scope)}/${encodeURIComponent(ref)}`, globalThis.location.origin).href
  }

  async read(scope: string, ref: string): Promise<ArkmeAvatarImagePayload | undefined> {
    const key = this.key(scope, ref)
    if (key === undefined) return undefined
    try {
      const cache = await caches.open(CACHE_NAME)
      const response = await cache.match(key)
      if (response === undefined) return undefined
      const payload: unknown = await response.json().catch(() => undefined)
      if (validPayload(payload)) return payload
      await cache.delete(key)
    } catch { /* Restricted storage falls back to the Host. */ }
    return undefined
  }

  write(scope: string, ref: string, payload: ArkmeAvatarImagePayload): Promise<void> {
    const key = this.key(scope, ref)
    if (key === undefined || !validPayload(payload)) return Promise.resolve()
    const operation = this.writes.then(async () => {
      const cache = await caches.open(CACHE_NAME)
      const body = JSON.stringify(payload)
      // Evict before writing so a full cache can still accept a new avatar.
      const keys = (await cache.keys()).filter(request => request.url !== key)
      const sizes = await Promise.all(keys.map(async request => Number((await cache.match(request))?.headers.get('Content-Length')) || 0))
      let bytes = sizes.reduce((sum, size) => sum + size, 0) + body.length
      let count = keys.length + 1
      for (let index = 0; index < keys.length && (count > MAX_ENTRIES || bytes > MAX_BYTES); index++) {
        await cache.delete(keys[index]!)
        bytes -= sizes[index]!
        count -= 1
      }
      await cache.put(key, new Response(body, { headers: {
        'Content-Type': 'application/json', 'Content-Length': String(body.length),
      } }))
    })
    this.writes = operation.catch(() => undefined)
    return this.writes
  }
}
