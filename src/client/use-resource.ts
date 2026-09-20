import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { ResourceStore } from './resource-store.js'

/** Subscribe to one owner snapshot. Refresh errors retain its last value and are rendered by the business UI. */
export function useResource<T, B>(store: ResourceStore<T, B>, key: string | undefined, binding: B, enabled = true) {
  const subscribe = useCallback((listener: () => void) => key === undefined || !enabled ? () => undefined : store.subscribe(key, binding, listener), [store, key, binding, enabled])
  const snapshot = useSyncExternalStore(subscribe, () => key === undefined ? store.empty : store.get(key, enabled ? binding : undefined), () => store.empty)
  const refresh = useCallback(() => {
    if (enabled && key !== undefined) void store.refresh(key, binding).catch(() => undefined)
  }, [store, key, binding, enabled])
  useEffect(refresh, [refresh])
  useEffect(() => {
    if (!enabled) return
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    if (typeof window !== 'undefined') window.addEventListener('focus', refresh)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visible)
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('focus', refresh)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visible)
    }
  }, [enabled, refresh])
  return { snapshot, refresh }
}
