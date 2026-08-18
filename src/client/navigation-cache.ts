import type { ArkmeSourceDirectory, ArkmeSourceItem, ArkmeSourceKind } from '../types.js'

const POINTER_KEY = 'dsh-arkme:navigation:v1:last-user'
const CACHE_KEY_PREFIX = 'dsh-arkme:navigation:v1:user:'
const MAX_CACHED_SOURCES = 200

export interface ArkmeNavigationCache {
  version: 1
  userId: number
  directory: ArkmeSourceDirectory
  selectedSourceRef?: string
  sources: Partial<Record<ArkmeSourceDirectory, ArkmeSourceItem[]>>
  updatedAtMillis: number
}

function storageOrUndefined(storage?: Storage): Storage | undefined {
  if (storage !== undefined) return storage
  try { return typeof window === 'undefined' ? undefined : window.localStorage }
  catch { return undefined }
}

function isDirectory(value: unknown): value is ArkmeSourceDirectory {
  return value === 'root' || value === 'send_to_self'
}

function isKind(value: unknown): value is ArkmeSourceKind {
  return value === 'default_category' || value === 'topic' || value === 'private_chat' || value === 'group_chat'
}

function sourceItem(value: unknown): ArkmeSourceItem | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (typeof item.sourceRef !== 'string' || item.sourceRef === '' || !isKind(item.kind)
    || typeof item.displayName !== 'string' || item.displayName === ''
    || typeof item.activeAtMillis !== 'number' || !Number.isFinite(item.activeAtMillis)
    || typeof item.unreadCount !== 'number' || !Number.isFinite(item.unreadCount)) return undefined
  return {
    sourceRef: item.sourceRef,
    kind: item.kind,
    displayName: item.displayName,
    ...(typeof item.avatarRef === 'string' && item.avatarRef !== '' ? { avatarRef: item.avatarRef } : {}),
    ...(Array.isArray(item.avatarRefs)
      ? { avatarRefs: item.avatarRefs.filter(value => typeof value === 'string' && value !== '').slice(0, 4) as string[] }
      : {}),
    ...(typeof item.latestPreview === 'string' ? { latestPreview: item.latestPreview } : {}),
    activeAtMillis: item.activeAtMillis,
    unreadCount: Math.max(0, Math.trunc(item.unreadCount)),
    ...(typeof item.recordCount === 'number' && Number.isFinite(item.recordCount)
      ? { recordCount: Math.max(0, Math.trunc(item.recordCount)) }
      : {}),
  }
}

function parseCache(raw: string | null, expectedUserId?: number): ArkmeNavigationCache | undefined {
  if (raw === null || raw.length > 2_000_000) return undefined
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const userId = value.userId
    if (value.version !== 1 || typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0
      || (expectedUserId !== undefined && userId !== expectedUserId) || !isDirectory(value.directory)) return undefined
    const rawSources = value.sources !== null && typeof value.sources === 'object' && !Array.isArray(value.sources)
      ? value.sources as Record<string, unknown>
      : {}
    const sources: ArkmeNavigationCache['sources'] = {}
    for (const directory of ['root', 'send_to_self'] as const) {
      if (!Array.isArray(rawSources[directory])) continue
      sources[directory] = rawSources[directory]
        .map(sourceItem).filter((item): item is ArkmeSourceItem => item !== undefined)
        .slice(0, MAX_CACHED_SOURCES)
    }
    return {
      version: 1,
      userId,
      directory: value.directory,
      ...(typeof value.selectedSourceRef === 'string' && value.selectedSourceRef !== ''
        ? { selectedSourceRef: value.selectedSourceRef }
        : {}),
      sources,
      updatedAtMillis: typeof value.updatedAtMillis === 'number' && Number.isFinite(value.updatedAtMillis)
        ? value.updatedAtMillis
        : 0,
    }
  } catch { return undefined }
}

export function readNavigationCache(userId: number, storage?: Storage): ArkmeNavigationCache | undefined {
  const target = storageOrUndefined(storage)
  if (target === undefined || !Number.isSafeInteger(userId) || userId <= 0) return undefined
  try { return parseCache(target.getItem(`${CACHE_KEY_PREFIX}${String(userId)}`), userId) }
  catch { return undefined }
}

export function readLastNavigationCache(storage?: Storage): ArkmeNavigationCache | undefined {
  const target = storageOrUndefined(storage)
  if (target === undefined) return undefined
  try {
    const userId = Number(target.getItem(POINTER_KEY))
    return readNavigationCache(userId, target)
  } catch { return undefined }
}

export function writeNavigationCache(cache: ArkmeNavigationCache, storage?: Storage): void {
  const target = storageOrUndefined(storage)
  if (target === undefined) return
  try {
    target.setItem(`${CACHE_KEY_PREFIX}${String(cache.userId)}`, JSON.stringify(cache))
    target.setItem(POINTER_KEY, String(cache.userId))
  } catch { /* Browser storage is an optional acceleration layer. */ }
}

export function clearLastNavigationCache(storage?: Storage): void {
  const target = storageOrUndefined(storage)
  if (target === undefined) return
  try { target.removeItem(POINTER_KEY) }
  catch { /* Ignore unavailable browser storage. */ }
}

export function cachedSelectedSource(cache: ArkmeNavigationCache): ArkmeSourceItem | undefined {
  if (cache.selectedSourceRef === undefined) return undefined
  for (const directory of ['root', 'send_to_self'] as const) {
    const source = cache.sources[directory]?.find(item => item.sourceRef === cache.selectedSourceRef)
    if (source !== undefined) return source
  }
  return undefined
}

/** Rebind a cached selection to a source reference issued by the current Provider instance. */
export function reconcileSelectedSource(
  selected: ArkmeSourceItem | undefined,
  loaded: ArkmeSourceItem[],
): ArkmeSourceItem | undefined {
  if (selected === undefined) return undefined
  const exact = loaded.find(item => item.sourceRef === selected.sourceRef)
  if (exact !== undefined) return exact
  const equivalent = loaded.filter(item => item.kind === selected.kind && item.displayName === selected.displayName)
  return equivalent.length === 1 ? equivalent[0] : undefined
}
