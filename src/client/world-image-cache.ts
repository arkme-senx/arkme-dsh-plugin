import type { ArkmeImagePayload } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'

const WORLD_IMAGE_CACHE_TTL_MILLIS = 10 * 60 * 1000
const MAX_WORLD_IMAGE_CACHE_ENTRIES = 96
const MAX_WORLD_IMAGE_CACHE_BYTES = 32 * 1024 * 1024

interface WorldImageCacheEntry {
  revoked: boolean
  dataUrl: string | undefined
  pending: Promise<string> | undefined
  estimatedBytes: number
  expiresAtMillis: number
}

const worldImageListeners = new Map<string, Set<() => void>>()
const worldImageDataUrlCache = new Map<string, WorldImageCacheEntry>()
let worldImageCacheBytes = 0
let worldImageCacheScope = ''
let stopWorldImageScope: (() => void) | undefined
function worldImageScope(): string {
  const auth = arkmeAuthStore.getSnapshot().auth
  return `${auth?.environment ?? ''}:${auth?.status ?? ''}:${auth?.userId ?? ''}`
}
function checkWorldImageScope(): string {
  const scope = worldImageScope()
  if (worldImageCacheScope !== scope) {
    invalidateWorldImages([...new Set([...worldImageDataUrlCache.keys(), ...worldImageListeners.keys()])])
    worldImageCacheScope = scope
  }
  return scope
}
export function invalidateWorldImages(imageRefs: readonly string[]): void {
  for (const ref of imageRefs) {
    const entry = worldImageDataUrlCache.get(ref)
    if (entry) entry.revoked = true
    deleteWorldImageCacheEntry(ref)
    for (const listener of worldImageListeners.get(ref) ?? []) listener()
  }
}

export function subscribeWorldImageInvalidation(imageRef: string, listener: () => void): () => void {
  checkWorldImageScope()
  const listeners = worldImageListeners.get(imageRef) ?? new Set<() => void>()
  listeners.add(listener); worldImageListeners.set(imageRef, listeners)
  stopWorldImageScope ??= arkmeAuthStore.subscribe(() => { checkWorldImageScope() })
  return () => {
    listeners.delete(listener)
    if (!listeners.size) worldImageListeners.delete(imageRef)
    if (!worldImageDataUrlCache.size && !worldImageListeners.size) { stopWorldImageScope?.(); stopWorldImageScope = undefined }
  }
}

function deleteWorldImageCacheEntry(imageRef: string): void {
  const entry = worldImageDataUrlCache.get(imageRef)
  if (entry === undefined) return
  worldImageCacheBytes = Math.max(0, worldImageCacheBytes - entry.estimatedBytes)
  worldImageDataUrlCache.delete(imageRef)
  if (!worldImageDataUrlCache.size && !worldImageListeners.size) { stopWorldImageScope?.(); stopWorldImageScope = undefined }
}

function pruneWorldImageCache(now = Date.now()): void {
  for (const [imageRef, entry] of worldImageDataUrlCache) {
    if (entry.expiresAtMillis <= now) deleteWorldImageCacheEntry(imageRef)
  }
  while (worldImageDataUrlCache.size > MAX_WORLD_IMAGE_CACHE_ENTRIES || worldImageCacheBytes > MAX_WORLD_IMAGE_CACHE_BYTES) {
    const oldestResolved = [...worldImageDataUrlCache].find(([, entry]) => entry.pending === undefined)?.[0]
    const oldest = oldestResolved ?? worldImageDataUrlCache.keys().next().value as string | undefined
    if (oldest === undefined) break
    deleteWorldImageCacheEntry(oldest)
  }
}

function touchWorldImageCacheEntry(imageRef: string, entry: WorldImageCacheEntry): void {
  worldImageDataUrlCache.delete(imageRef)
  worldImageDataUrlCache.set(imageRef, entry)
}

export function cachedWorldImageDataUrl(imageRef: string): string | undefined {
  checkWorldImageScope()
  const normalized = imageRef.trim()
  if (normalized === '') return undefined
  const entry = worldImageDataUrlCache.get(normalized)
  if (entry === undefined) return undefined
  if (entry.expiresAtMillis <= Date.now()) {
    deleteWorldImageCacheEntry(normalized)
    return undefined
  }
  touchWorldImageCacheEntry(normalized, entry)
  return entry.dataUrl
}

type WorldImageReader = (imageRef: string) => Promise<ArkmeImagePayload>

const readWorldImage: WorldImageReader = async imageRef => await callArkme<ArkmeImagePayload>('world.image.read', { imageRef })

export function loadWorldImageDataUrl(imageRef: string, reader: WorldImageReader = readWorldImage): Promise<string> {
  const scope = checkWorldImageScope()
  const normalized = imageRef.trim()
  if (normalized === '') return Promise.reject(new Error('世界图片引用为空'))
  const cached = worldImageDataUrlCache.get(normalized)
  if (cached !== undefined && cached.expiresAtMillis > Date.now()) {
    touchWorldImageCacheEntry(normalized, cached)
    if (cached.dataUrl !== undefined) return Promise.resolve(cached.dataUrl)
    if (cached.pending !== undefined) return cached.pending
  } else if (cached !== undefined) {
    deleteWorldImageCacheEntry(normalized)
  }

  const entry: WorldImageCacheEntry = {
    revoked: false,
    dataUrl: undefined,
    pending: undefined,
    estimatedBytes: 0,
    expiresAtMillis: Date.now() + WORLD_IMAGE_CACHE_TTL_MILLIS,
  }
  const pending = reader(normalized).then(image => {
    if (scope !== checkWorldImageScope() || entry.revoked) throw new Error('世界图片授权已变化，请重新读取')
    const dataUrl = `data:${image.mediaType};base64,${image.dataBase64}`
    if (worldImageDataUrlCache.get(normalized) === entry) {
      entry.dataUrl = dataUrl
      entry.pending = undefined
      entry.estimatedBytes = Math.ceil(image.dataBase64.length * 0.75)
      entry.expiresAtMillis = Date.now() + WORLD_IMAGE_CACHE_TTL_MILLIS
      worldImageCacheBytes += entry.estimatedBytes
      touchWorldImageCacheEntry(normalized, entry)
      pruneWorldImageCache()
    }
    return dataUrl
  }).catch(error => {
    if (worldImageDataUrlCache.get(normalized) === entry) deleteWorldImageCacheEntry(normalized)
    throw error
  })
  entry.pending = pending
  worldImageDataUrlCache.set(normalized, entry)
  stopWorldImageScope ??= arkmeAuthStore.subscribe(() => { checkWorldImageScope() })
  pruneWorldImageCache()
  return pending
}
