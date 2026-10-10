import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsStore, StoreHandle } from '@deepseek-ai/dsh-client-ui-slots'
import { useLayoutEffect } from 'react'

// Only an adoption marker. DSH remains the sole owner of view preferences,
// including their existing browser-local persistence and future schema changes.
export const SESSION_LIST_DEFAULT_MARKER = 'arkme.harness.session-list-default.v1'
type ViewState = { groupBy?: unknown }
type ViewActions = { setGroupBy: (draft: ViewState, mode: 'flat' | 'workspace') => void }
type ViewHandle = StoreHandle<ViewState, ViewActions>

export function adoptFlatSessionDefault(groupBy: unknown, setGroupBy: (mode: 'flat') => void, storage: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  if (groupBy !== 'workspace' && groupBy !== 'flat') return false
  try { if (storage.getItem(SESSION_LIST_DEFAULT_MARKER) === '1') return true } catch { /* Storage may be disabled. Apply once in this mounted page. */ }
  if (groupBy !== 'flat') setGroupBy('flat')
  try { storage.setItem(SESSION_LIST_DEFAULT_MARKER, '1') } catch { /* Native persistence is also unavailable; do not break navigation. */ }
  return true
}

/**
 * Share the native root-scoped store through the public slot/store contract.
 * A renderless footer contribution receives its real actions and useStore.
 * Do not replace the browser, copy its state, call private store resolvers,
 * or rewrite the native persistence key/schema. Only grouping gets a one-time
 * initial choice; ordering (including an existing manual choice) stays native.
 */
export function installHarnessSessionListDefault(ctx: ClientContext): () => void {
  const slots = ctx.slots
  if (typeof slots.entriesOfSlot !== 'function' || typeof slots.subscribe !== 'function' || typeof slots.spec !== 'function') return () => {}
  let initialized = false
  function Defaults({ actions, useStore }: PropsStore<ViewHandle>) {
    const groupBy = useStore(state => state.groupBy)
    useLayoutEffect(() => {
      if (initialized) return
      // Defer access to localStorage itself: its getter can throw in restricted contexts.
      const storage = { getItem: (key: string) => window.localStorage.getItem(key), setItem: (key: string, value: string) => window.localStorage.setItem(key, value) }
      initialized = adoptFlatSessionDefault(groupBy, actions.setGroupBy, storage)
    }, [actions, groupBy])
    return null
  }
  return slots.inject('sidebar.footer.action', () => {
    let mounted: ViewHandle | undefined
    let dispose: (() => void) | undefined
    const sync = () => {
      const store = slots.entriesOfSlot('sidebar.workspaces')[0]?.store
      const supported = slots.spec('sidebar.workspaces')?.scope === 'root'
        && slots.spec('sidebar.footer.action')?.scope === 'root' && store !== undefined && typeof store !== 'function'
        && typeof store.create === 'function' && typeof store.spec?.actions?.setGroupBy === 'function'
      const next = supported ? store as ViewHandle : undefined
      if (next === mounted) return
      dispose?.()
      dispose = undefined
      mounted = next
      if (next) dispose = slots.register({
        name: 'sidebar.footer.action', id: 'arkme-session-list-default', store: next,
      }, Defaults)
    }
    const unsubscribe = slots.subscribe('sidebar.workspaces', sync)
    sync()
    return () => { unsubscribe(); dispose?.() }
  })
}
