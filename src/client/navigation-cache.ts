import type {
  ArkmeGroupAvatarPresentation,
  ArkmeGroupAvatarSlot,
  ArkmeSourceDirectory,
  ArkmeSourceItem,
  ArkmeSourceKind,
} from '../types.js'

const POINTER_KEY = 'dsh-arkme:navigation:v1:last-user'
const CACHE_KEY_PREFIX = 'dsh-arkme:navigation:v1:user:'
const PROVIDER_INSTANCE_KEY = 'dsh-arkme:navigation:v1:provider-instance'
const MAX_CACHED_SOURCES = 2_000

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
  return value === 'send_to_self' || value === 'default_category' || value === 'topic'
    || value === 'private_chat' || value === 'group_chat'
}

function groupAvatarSlot(value: unknown): ArkmeGroupAvatarSlot | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const slot = value as Record<string, unknown>
  if (typeof slot.avatarRef === 'string' && slot.avatarRef !== '') return { avatarRef: slot.avatarRef }
  const fallback = slot.fallback
  if (fallback === null || typeof fallback !== 'object' || Array.isArray(fallback)) return undefined
  const item = fallback as Record<string, unknown>
  if (item.kind === 'default') return { fallback: { kind: 'default' } }
  if (item.kind !== 'phone_default' || typeof item.colorIndex !== 'number' || !Number.isFinite(item.colorIndex)
    || typeof item.label !== 'string') return undefined
  return {
    fallback: {
      kind: 'phone_default',
      colorIndex: Math.abs(Math.trunc(item.colorIndex)) % 12,
      label: [...item.label].slice(0, 4).join('') || '--',
    },
  }
}

function groupAvatarPresentation(value: unknown): ArkmeGroupAvatarPresentation | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (typeof item.memberCount !== 'number' || !Number.isFinite(item.memberCount)
    || typeof item.strategy !== 'string'
    || typeof item.computedAtMillis !== 'number' || !Number.isFinite(item.computedAtMillis)
    || !Array.isArray(item.slots)) return undefined
  const slots = item.slots.slice(0, 5).map(value => groupAvatarSlot(value) ?? { fallback: { kind: 'default' as const } })
  return {
    memberCount: Math.max(0, Math.trunc(item.memberCount)),
    strategy: item.strategy,
    computedAtMillis: Math.max(0, Math.trunc(item.computedAtMillis)),
    slots,
  }
}

function sourceItem(value: unknown): ArkmeSourceItem | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (typeof item.sourceRef !== 'string' || item.sourceRef === '' || !isKind(item.kind)
    || typeof item.displayName !== 'string' || item.displayName === ''
    || typeof item.activeAtMillis !== 'number' || !Number.isFinite(item.activeAtMillis)
    || typeof item.unreadCount !== 'number' || !Number.isFinite(item.unreadCount)) return undefined
  const groupAvatar = groupAvatarPresentation(item.groupAvatar)
  return {
    sourceRef: item.sourceRef,
    ...(typeof item.parentSourceRef === 'string' && item.parentSourceRef !== ''
      ? { parentSourceRef: item.parentSourceRef }
      : {}),
    ...(typeof item.topicHierarchyKey === 'string' && item.topicHierarchyKey !== ''
      ? { topicHierarchyKey: item.topicHierarchyKey }
      : {}),
    ...(typeof item.parentTopicHierarchyKey === 'string' && item.parentTopicHierarchyKey !== ''
      ? { parentTopicHierarchyKey: item.parentTopicHierarchyKey }
      : {}),
    kind: item.kind,
    displayName: item.displayName,
    ...(typeof item.avatarRef === 'string' && item.avatarRef !== '' ? { avatarRef: item.avatarRef } : {}),
    ...(Array.isArray(item.avatarRefs)
      ? { avatarRefs: item.avatarRefs.filter(value => typeof value === 'string' && value !== '').slice(0, 5) as string[] }
      : {}),
    ...(groupAvatar === undefined ? {} : { groupAvatar }),
    ...(typeof item.latestPreview === 'string' ? { latestPreview: item.latestPreview } : {}),
    activeAtMillis: item.activeAtMillis,
    unreadCount: Math.max(0, Math.trunc(item.unreadCount)),
    ...(typeof item.isMuted === 'boolean' ? { isMuted: item.isMuted } : {}),
    ...(typeof item.latestSequence === 'number' && Number.isSafeInteger(item.latestSequence) && item.latestSequence > 0
      ? { latestSequence: item.latestSequence }
      : {}),
    ...(typeof item.recordCount === 'number' && Number.isFinite(item.recordCount)
      ? { recordCount: Math.max(0, Math.trunc(item.recordCount)) }
      : {}),
    ...(item.hasPendingChildren === true ? { hasPendingChildren: true } : {}),
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

/** Signed source/image references are valid only inside the Provider instance that issued them. */
export function reconcileNavigationProviderInstance(instanceId: string, storage?: Storage): boolean {
  const normalized = instanceId.trim()
  const target = storageOrUndefined(storage)
  if (normalized === '' || target === undefined) return false
  try {
    if (target.getItem(PROVIDER_INSTANCE_KEY) === normalized) return false
    const staleKeys: string[] = []
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index)
      if (key === POINTER_KEY || key?.startsWith(CACHE_KEY_PREFIX) === true) staleKeys.push(key)
    }
    for (const key of staleKeys) target.removeItem(key)
    target.setItem(PROVIDER_INSTANCE_KEY, normalized)
    return true
  } catch {
    return false
  }
}

/** Remove the success marker after current-instance projections failed to load so reconnect can retry. */
export function forgetNavigationProviderInstance(storage?: Storage): void {
  const target = storageOrUndefined(storage)
  if (target === undefined) return
  try { target.removeItem(PROVIDER_INSTANCE_KEY) }
  catch { /* Browser storage is an optional acceleration layer. */ }
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
