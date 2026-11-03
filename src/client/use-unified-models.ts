import { useEffect, useSyncExternalStore } from 'react'
import { arkmeAuthStore } from './auth-store.js'
import { callArkme } from './api.js'
import { UnifiedModelStore, type ModelAccountSnapshot } from './unified-model-store.js'

export const unifiedModelStore = new UnifiedModelStore((operation, scope, signal) => callArkme(operation, { expectedAccountScope: scope }, signal))
const empty: ModelAccountSnapshot = { loading: false }
export function useUnifiedModels() {
  const authSnapshot = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const auth = authSnapshot.auth
  const scope = auth?.status === 'authenticated' && auth.userId ? `${auth.environment}:${auth.userId}` : undefined
  const snapshot = useSyncExternalStore(unifiedModelStore.subscribe, unifiedModelStore.getSnapshot, unifiedModelStore.getSnapshot)
  useEffect(() => { if (!authSnapshot.checked) void arkmeAuthStore.refresh().catch(() => {}) }, [authSnapshot.checked])
  useEffect(() => {
    unifiedModelStore.activate(scope)
    if (scope) void unifiedModelStore.refresh(scope)
    const focus = () => { if (scope) void unifiedModelStore.refresh(scope) }
    if (typeof window === 'undefined') return
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [scope])
  return { ...(snapshot.scope === scope ? snapshot : empty), scope,
    refresh: () => scope ? unifiedModelStore.refresh(scope, true) : Promise.resolve() }
}
