import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { ArkmeEnvironment, ArkmeSourceItem } from '../types.js'

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>
type ExpansionUpdate = (current: ReadonlySet<string>) => ReadonlySet<string>
const EMPTY: ReadonlySet<string> = new Set()

function browserStorage(): PreferenceStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage }
  catch { return undefined }
}

export function selfTopicExpansionKey(userId: number | undefined, environment: ArkmeEnvironment): string | undefined {
  return Number.isSafeInteger(userId) && (userId ?? 0) > 0
    ? `dsh-arkme:self-topic-expansion:v1:${environment}:user:${String(userId)}` : undefined
}

export function selfTopicExpansionIdentity(source: ArkmeSourceItem): string {
  // sourceRef includes displayName; the server-issued hierarchy key survives renames and moves.
  return source.topicHierarchyKey ?? source.sourceRef
}

/** Synchronous writes survive menu unmounts. All entry points share one account store. */
export class SelfTopicExpansionStore {
  private value: ReadonlySet<string>
  private readonly listeners = new Set<() => void>()

  constructor(private readonly key?: string, private readonly storage = browserStorage()) {
    this.value = this.read()
  }

  private read(): ReadonlySet<string> {
    if (!this.key) return EMPTY
    try {
      const parsed: unknown = JSON.parse(this.storage?.getItem(this.key) ?? '[]')
      return Array.isArray(parsed) && parsed.every(key => typeof key === 'string' && key.length > 0)
        ? new Set(parsed as string[]) : EMPTY
    } catch { return EMPTY }
  }

  readonly getSnapshot = (): ReadonlySet<string> => this.value
  readonly getServerSnapshot = (): ReadonlySet<string> => EMPTY
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  update(update: ExpansionUpdate): void {
    const next = update(this.value)
    if (next.size === this.value.size && [...next].every(key => this.value.has(key))) return
    this.value = new Set(next)
    try { if (this.key) this.storage?.setItem(this.key, JSON.stringify([...next])) }
    catch { /* Keep in-session preferences if local storage is unavailable. */ }
    for (const listener of this.listeners) listener()
  }
}

const accountStores = new Map<string, SelfTopicExpansionStore>()

export function sourceRefsFromExpansionKeys(keys: ReadonlySet<string>, sources: readonly ArkmeSourceItem[]): Set<string> {
  return new Set(sources.filter(source => keys.has(selfTopicExpansionIdentity(source))).map(source => source.sourceRef))
}

export function updateExpansionKeys(
  keys: ReadonlySet<string>, sources: readonly ArkmeSourceItem[], update: ExpansionUpdate,
): ReadonlySet<string> {
  const nextRefs = update(sourceRefsFromExpansionKeys(keys, sources))
  const next = new Set(keys)
  // Never prune unloaded descendants: paged loading and a collapsed parent are not deletions.
  for (const source of sources) {
    const key = selfTopicExpansionIdentity(source)
    if (nextRefs.has(source.sourceRef)) next.add(key)
    else next.delete(key)
  }
  return next
}

export function useSelfTopicExpansion(
  userId: number | undefined, environment: ArkmeEnvironment, sources: readonly ArkmeSourceItem[],
) {
  const key = selfTopicExpansionKey(userId, environment)
  const store = useMemo(() => {
    if (!key || typeof window === 'undefined') return new SelfTopicExpansionStore()
    let existing = accountStores.get(key)
    if (!existing) { existing = new SelfTopicExpansionStore(key); accountStores.set(key, existing) }
    return existing
  }, [key])
  const keys = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
  const collapsed = useMemo(() => sourceRefsFromExpansionKeys(keys, sources), [keys, sources])
  const update = useCallback((change: ExpansionUpdate, currentSources = sources) => {
    store.update(current => updateExpansionKeys(current, currentSources, change))
  }, [store, sources])
  return [collapsed, update] as const
}
