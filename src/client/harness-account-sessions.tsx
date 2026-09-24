import type { HarnessNativeWindow } from '../harness-native-transport-script.js'
import { installSessionOriginHover, sessionOrigin } from './harness-session-origin.js'
import { createElement, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { Modal, Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { callArkme } from '../sdk/index.js'
import type { DshAccountSession, DshAccountSessionPage } from '../dsh-remote/account-session-types.js'
import { openNativeAccountSession } from './harness-native-navigation.js'
import { HARNESS_MENU_OPEN } from './harness-session-menu-bridge.js'

type SessionsState = ReturnType<ISessions['list']['getSnapshot']>
type Workspace = { workspaceId: string; title: string; path: string; createdAt?: number; sessionIds: string[] }
type WorkspacesState = { items: readonly Workspace[]; archivedSessionIds: readonly string[]; phase: string; state: string; error: unknown }
type Hook<S> = <T>(select: (state: S) => T) => T
type BrowserView = Record<string, unknown> & { orderBy: 'manual' | 'updated'; sessionOrderByAccount: Record<string, readonly string[]> }
// The only version-specific UI face. Everything below is composed through the
// public Slot ledger; no imports of native implementation modules or store writes.
type BrowserProps = Record<string, unknown> & {
  useSessions: Hook<SessionsState>; useWorkspaces: Hook<WorkspacesState>
  useStore: Hook<BrowserView>
  open(id: string): void; startSession(id?: string): void
  renameSession(id: string, title: string): Promise<void>; archiveSession(id: string): Promise<void>
  forkSession(id: string): void; renderSlot(name: string, owner: object): ReactNode
}
const SLOT = 'sidebar.workspaces'
const FLOW = 'sidebar.workspaces.directoryFlow'
const OWN_FLOW = 'arkme.accountSessions.directoryFlow'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.workspaces.directoryFlow': { kind: 'single'; scope: 'root'; owner: object }
    'arkme.accountSessions.directoryFlow': { kind: 'single'; scope: 'root'; owner: object }
  }
}
export const accountSessionKey = (row: Pick<DshAccountSession, 'runtimeRef' | 'sessionRef'>): string => `arkme:${encodeURIComponent(row.runtimeRef)}:${encodeURIComponent(row.sessionRef)}`

/** The native updated mode promotes newly discovered rows, even old remote
 * history. Project its display orders by actual activity time, not arrival. */
export function projectAccountSessionOrder(view: BrowserView, sessions: SessionsState): BrowserView {
  if (view.orderBy !== 'updated') return view
  return { ...view, sessionOrderByAccount: Object.fromEntries(Object.entries(view.sessionOrderByAccount).map(([key, ids]) => [key,
    [...ids].sort((a, b) => {
      const aTime = sessions.byId[a as SessionId]?.updatedAt ?? -Infinity
      const bTime = sessions.byId[b as SessionId]?.updatedAt ?? -Infinity
      return aTime === bTime ? (a < b ? -1 : a > b ? 1 : 0) : bTime - aTime
    }),
  ])) }
}

/** Local rows keep native identity, blank/activity state and all native actions. */
export function projectAccountSessions(local: SessionsState, rows: readonly DshAccountSession[], selected?: DshAccountSession): SessionsState {
  const byId = { ...local.byId }, ids = [...local.ids]
  for (const row of selected && !rows.some(row => accountSessionKey(row) === accountSessionKey(selected)) ? [...rows, selected] : rows) {
    if (row.archived || row.origin === 'subagent') continue
    const id = (row.local ? row.sessionRef : accountSessionKey(row)) as SessionId
    if (byId[id]) continue
    // A row is selectable only after its native added event has landed.
    if (!row.local && (window as HarnessNativeWindow).__ARKME_NATIVE_DIRECTORY__) continue
    byId[id] = { id, title: row.title, displayTitle: row.title, updatedAt: row.updatedAt, running: row.running, blank: row.blank }
    ids.push(id)
  }
  return { ...local, byId, ids: [...new Set(ids)], current: selected ? accountSessionKey(selected) as SessionId : local.current }
}

export function projectAccountWorkspaces(local: WorkspacesState, rows: readonly DshAccountSession[]): WorkspacesState {
  const groups = new Map<string, Workspace>()
  const names = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!row.workspaceRef || row.archived) continue
    const id = `${row.runtimeRef}:${row.workspaceRef}`
    const owners = names.get(row.workspaceName) ?? new Set<string>()
    owners.add(id); names.set(row.workspaceName, owners)
    const workspaceId = row.local ? row.workspaceRef : `arkme:${id}`
    const group = groups.get(id) ?? { workspaceId, title: row.workspaceName, path: row.workspaceName, sessionIds: [] }
    group.sessionIds.push(row.local ? row.sessionRef : accountSessionKey(row)); groups.set(id, group)
  }
  const items = [...local.items.map(item => {
    const row = rows.find(row => row.local && row.workspaceRef === item.workspaceId)
    const extra = [...groups.values()].find(group => group.workspaceId === item.workspaceId)
    const merged = extra ? { ...item, sessionIds: [...new Set([...item.sessionIds, ...extra.sessionIds])] } : item
    return row && (names.get(row.workspaceName)?.size ?? 0) > 1 ? { ...merged, title: `${row.desktopName} · ${item.title}` } : merged
  }), ...[...groups.values()].filter(group => !local.items.some(item => item.workspaceId === group.workspaceId))].map(item => {
    if (!item.workspaceId.startsWith('arkme:')) return item
    const row = rows.find(row => `arkme:${row.runtimeRef}:${row.workspaceRef}` === item.workspaceId)!
    return (names.get(row.workspaceName)?.size ?? 0) > 1 ? { ...item, title: `${row.desktopName} · ${item.title}` } : item
  })
  return { ...local, items }
}

const catalogKey = Symbol.for('arkme.account-session-catalog')

/** Apply a complete authoritative catalog as add/update/delete; unchanged rows retain identity. */
export function reconcileAccountSessions(previous: DshAccountSession[], incoming: DshAccountSession[]): DshAccountSession[] {
  const known = new Map(previous.map(row => [accountSessionKey(row), row]))
  const next = [...new Map(incoming.map(row => [accountSessionKey(row), row])).values()].map(row => {
    const old = known.get(accountSessionKey(row))
    return old && (Object.keys(row) as Array<keyof DshAccountSession>).every(key =>
      key === 'capabilities' ? row.capabilities.join('\0') === old.capabilities.join('\0') : row[key] === old[key]) ? old : row
  })
  return next.length === previous.length && next.every((row, i) => row === previous[i]) ? previous : next
}

function createCatalog(surface: Element, remove: () => void) {
    const owner = surface.ownerDocument
    let rows: DshAccountSession[] = [], localRuntimeRef: string | undefined, localDesktopName: string | undefined, users = 0
    let snapshot = { rows, localRuntimeRef, localDesktopName }, active = true, busy = false
    const listeners = new Set<() => void>()
    let controller = new AbortController()
    let stopRefresh: (() => void) | undefined
    const publish = () => { snapshot = { rows, localRuntimeRef, localDesktopName }; listeners.forEach(listener => listener()) }
    const refresh = async () => {
      if (!active || busy || owner.hidden) return
      busy = true
      const signal = controller.signal
      try {
        const next: DshAccountSession[] = [], seen = new Set<string>()
        let cursor: DshAccountSessionPage['nextCursor']
        do {
          const page = await callArkme<DshAccountSessionPage>('remote.sessions.list', { limit: 100, ...(cursor ? { cursor } : {}) }, signal)
          if (page.contractVersion !== 1 || !Array.isArray(page.items)) throw new Error('会话目录不可用')
          localRuntimeRef = page.localRuntimeRef
          localDesktopName = page.localRuntime?.desktopName
          next.push(...page.items.map(row => {
            const previous = rows.find(old => accountSessionKey(old) === accountSessionKey(row))
            return page.warning && previous && row.workspaceName === '工作区信息暂不可用' ? { ...row, workspaceName: previous.workspaceName } : row
          }))
          cursor = page.nextCursor
          if (cursor) {
            const key = JSON.stringify(cursor)
            if (seen.has(key)) throw new Error('会话目录游标重复')
            seen.add(key)
          }
          // Native browser renders its loaded rows. Bound a single refresh;
          // retain the last complete catalog instead of publishing a partial list.
          if (next.length > 10_000) throw new Error('会话目录过大')
        } while (cursor && active)
        if (!active || signal.aborted) return
        const merged = reconcileAccountSessions(rows, next)
        if (merged !== rows || snapshot.localRuntimeRef !== localRuntimeRef) { rows = merged; (window as HarnessNativeWindow).__ARKME_NATIVE_DIRECTORY__?.publish(rows) }
        if (snapshot.rows !== rows || snapshot.localRuntimeRef !== localRuntimeRef || snapshot.localDesktopName !== localDesktopName) publish()
      } catch { /* Keep the last complete same-account catalog. Native local data stays live. */ }
      finally { if (signal === controller.signal) busy = false }
    }
    return {
      get signal() { return controller.signal },
      start: () => {
        if (users++ !== 0) return
        active = true; busy = false; controller = new AbortController()
        // Discovery belongs to the surface, including when its menu is unmounted.
        const resume = () => { if (surface.getAttribute('data-arkme-visible') !== 'false') void refresh() }
        const timer = setInterval(resume, 5_000)
        const observer = new MutationObserver(resume)
        observer.observe(surface, { attributes: true, attributeFilter: ['data-arkme-visible'] })
        document.addEventListener(HARNESS_MENU_OPEN, resume)
        owner.addEventListener('visibilitychange', resume)
        owner.defaultView?.addEventListener('focus', resume)
        stopRefresh = () => {
          clearInterval(timer); observer.disconnect()
          document.removeEventListener(HARNESS_MENU_OPEN, resume)
          owner.removeEventListener('visibilitychange', resume)
          owner.defaultView?.removeEventListener('focus', resume)
        }
      },
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      refresh,
      dispose: () => { if (--users === 0) { active = false; controller.abort(); stopRefresh?.(); remove() } },
    }
}

function accountSessionCatalog(surface: Element) {
  const doc = surface.ownerDocument as Document & { [catalogKey]?: Map<string, ReturnType<typeof createCatalog>> }
  const catalogs = doc[catalogKey] ??= new Map()
  const account = `${surface.getAttribute('data-arkme-account-id')}:${surface.getAttribute('data-arkme-account-scope')}`
  let entry = catalogs.get(account)
  if (!entry) { entry = createCatalog(surface, () => catalogs.delete(account)); catalogs.set(account, entry) }
  return entry
}

/** Header and browser consume the same account-scoped discovery owner. */
export function useAccountSessionCatalog(surface: Element) {
  const account = useSurfaceAccount(surface)
  const catalog = useMemo(() => accountSessionCatalog(surface), [surface, account])
  const snapshot = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
  useEffect(() => {
    catalog.start()
    void catalog.refresh()
    return () => catalog.dispose()
  }, [catalog])
  return snapshot
}

function useSurfaceAccount(surface: Element): string {
  return useSyncExternalStore(listener => {
    const observer = new MutationObserver(listener)
    observer.observe(surface, { attributes: true, attributeFilter: ['data-arkme-account-id', 'data-arkme-account-scope'] })
    return () => observer.disconnect()
  }, () => `${surface.getAttribute('data-arkme-account-id')}:${surface.getAttribute('data-arkme-account-scope')}`)
}

/** All native sources share one account-scoped catalog. */
export function AccountSessionBrowser({ Native, surface, ...props }: BrowserProps & { Native: ComponentType<BrowserProps>; surface: Element }) {
  const account = useSurfaceAccount(surface)
  return <AccountBrowser key={account} Native={Native} surface={surface} {...props} />
}

function AccountBrowser({ Native, surface, ...props }: BrowserProps & { Native: ComponentType<BrowserProps>; surface: Element }) {
  const sourceRuntime: string | null = null
  const creating = useRef(false)
  const [operationError, setOperationError] = useState('')
  const local = props.useSessions(state => state)
  const workspaces = props.useWorkspaces(state => state)
  const catalog = useMemo(() => accountSessionCatalog(surface), [])

  const snapshot = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
  const rows = useMemo(() => sourceRuntime ? snapshot.rows.map(row => ({ ...row, local: row.runtimeRef === sourceRuntime })) : snapshot.rows, [snapshot.rows, sourceRuntime])
  useEffect(() => {
    catalog.start()
    void catalog.refresh()
    return () => catalog.dispose()
  }, [catalog])
  useEffect(() => { void catalog.refresh() }, [local.current, catalog])
  const sessionState = useMemo(() => projectAccountSessions(local, rows), [local, rows])
  const workspaceState = useMemo(() => projectAccountWorkspaces(workspaces, rows), [workspaces, rows])
  const view = props.useStore(state => state)
  const viewState = useMemo(() => projectAccountSessionOrder(view, sessionState), [view, sessionState])
  const originResolver = useRef<(element: HTMLElement) => { title: string; lines: string[] } | undefined>(() => undefined)
  originResolver.current = element => {
    const tree = element.closest('[role="tree"]')
    if (!tree) return undefined
    let candidates = sessionState.ids.filter(id => {
      const row = sessionState.byId[id]
      return row && row.origin !== 'subagent' && !workspaceState.archivedSessionIds.includes(id) && (!row.blank || id === sessionState.current)
    })
    let orderKey = '__flat_session_order__'
    if (viewState.groupBy === 'workspace') {
      const group = element.parentElement?.parentElement
      const heading = group?.querySelector('[role="treeitem"][aria-expanded]')
      const title = heading?.textContent
      const matching = workspaceState.items.filter(item => item.title === title)
      const headings = [...tree.querySelectorAll('[role="treeitem"][aria-expanded]')].filter(node => node.textContent === title)
      const workspace = matching[headings.indexOf(heading!)]
      orderKey = workspace?.workspaceId ?? ''
      candidates = candidates.filter(id => workspace ? workspace.sessionIds.includes(id) : !workspaceState.items.some(item => item.sessionIds.includes(id)))
    }
    const stored = viewState.sessionOrderByAccount[orderKey] ?? []
    const ordered = [...stored.filter(id => candidates.includes(id as SessionId)), ...candidates.filter(id => !stored.includes(id)).sort((a, b) => sessionState.byId[b]!.updatedAt - sessionState.byId[a]!.updatedAt || (a < b ? -1 : a > b ? 1 : 0))]
    const peers = [...element.parentElement!.parentElement!.querySelectorAll<HTMLElement>(':scope > span > [role="treeitem"][aria-selected]')]
    const index = peers.indexOf(element)
    const matches = ordered.filter(id => [...element.children].some(node => node.textContent === sessionState.byId[id as SessionId]?.displayTitle))
    const id = matches.includes(ordered[index]!) ? ordered[index] : matches.length === 1 ? matches[0] : undefined
    if (!id) return undefined
    const native = sessionState.byId[id as SessionId]
    // Verify the positional binding before decorating; never infer source from title alone.
    if (!native || ![...element.children].some(node => node.textContent === native.displayTitle)) return undefined
    const row = snapshot.rows.find(row => (row.runtimeRef === (sourceRuntime ?? snapshot.localRuntimeRef) ? row.sessionRef : accountSessionKey(row)) === id)
    return row ? { title: native.displayTitle, lines: sessionOrigin(row, snapshot.localDesktopName) } : undefined
  }
  useEffect(() => installSessionOriginHover(document, element => originResolver.current(element)), [])
  const useSessions: Hook<SessionsState> = select => select(sessionState)
  const useWorkspaces: Hook<WorkspacesState> = select => select(workspaceState)
  const useStore: Hook<BrowserView> = select => select(viewState)
  const remote = (id: string) => rows.find(row => row.local
    ? row.sessionRef === id && !local.byId[id as SessionId]
    : accountSessionKey(row) === id)
  const navigate = (target: DshAccountSession) => Promise.resolve(openNativeAccountSession(target, snapshot.localRuntimeRef))
    .catch(error => {
      if (!catalog.signal.aborted && error?.name !== 'AbortError') setOperationError(error instanceof Error ? error.message : '打开会话失败')
    })
  const command = async (id: string, operation: string, body = {}) => {
    const target = remote(id)
    if (!target) throw new Error('会话不存在')
    const value = await callArkme('remote.session.command', { runtimeRef: target.runtimeRef, sessionRef: target.sessionRef, operation, body, requestRef: crypto.randomUUID() }, catalog.signal)
    await catalog.refresh()
    return value
  }
  const open = (id: string) => {
    const target = remote(id)
    if (local.byId[id as SessionId]) props.open(id)
    else if (target) void navigate(target)
  }
  return <>
    <Native {...props} useSessions={useSessions} useWorkspaces={useWorkspaces} useStore={useStore} open={open}
      renameSession={(id, title) => remote(id) ? command(id, 'session.rename', { title }).then(() => undefined) : props.renameSession(id, title)}
      archiveSession={async id => { if (!remote(id)) return props.archiveSession(id); await command(id, 'session.archive') }}
      forkSession={id => { if (!remote(id)) props.forkSession(id); else setOperationError('此操作需要在对话所属电脑上执行。') }}
      startSession={id => {
        if (!id?.startsWith('arkme:')) { props.startSession(id); return }
        const source = rows.find(row => `arkme:${row.runtimeRef}:${row.workspaceRef}` === id)
        if (!source || creating.current) return
        const blank = rows.find(row => row.runtimeRef === source.runtimeRef && row.workspaceRef === source.workspaceRef && row.blank && !row.archived)
        if (blank) { void navigate(blank); return }
        creating.current = true
        void callArkme<{ sessionId: string }>('remote.session.command', { runtimeRef: source.runtimeRef, operation: 'session.create', requestRef: crypto.randomUUID(), body: { workspace_ref: source.workspaceRef } }, catalog.signal)
          .then(value => { if (!catalog.signal.aborted) return navigate({ ...source, sessionRef: value.sessionId }) })
          .catch(error => { if (!catalog.signal.aborted) setOperationError(error instanceof Error ? error.message : '新建会话失败') })
          .finally(() => { creating.current = false })
      }} />
    {operationError && <Modal open onClose={() => setOperationError('')} title="无法执行操作"><p>{operationError}</p><Button onClick={() => setOperationError('')}>知道了</Button></Modal>}
  </>
}

/** Shadow the native entry using its public component/store/inject seats. The
 * directory picker gets its own declared slot; never borrow another entry's
 * render authorization or mutate the original registration. */
export function installHarnessAccountSessions(ctx: ClientContext, surface: Element): () => void {
  const slots = ctx.slots
  if (typeof slots.entries !== 'function' || typeof slots.subscribe !== 'function') return () => {}
  // Keep discovery alive with the native surface, not the collapsible menu.
  const catalog = accountSessionCatalog(surface)
  catalog.start()
  void catalog.refresh()
  let native: StoredEntry | undefined, remove: (() => void) | undefined, updating = false
  const sync = () => {
    if (updating) return
    const next = slots.entries(SLOT).find(entry => (entry.options.priority ?? 0) >= 0)
    if (next === native) return
    updating = true
    remove?.(); remove = undefined; native = next
    try {
      if (!next || typeof next.component !== 'function' || typeof next.inject !== 'function'
        || !next.store || !next.children?.[FLOW] || Object.keys(next.children).length !== 1) return
      const Native = next.component as ComponentType<BrowserProps>
      const Wrapped = (props: BrowserProps) => <AccountSessionBrowser {...props} Native={Native} surface={surface}
        renderSlot={(name, owner) => name === FLOW
          ? <div data-slot={FLOW} style={{ display: 'contents' }}>{props.renderSlot(OWN_FLOW, owner)}</div> : null} />
      // Dynamic Slot ledger composition is intentionally type-erased at this
      // boundary; the source entry already proved its store/inject contract.
      const register = slots.register.bind(slots) as unknown as (options: object, component: unknown) => () => void
      const restoreBrowser = register({ name: SLOT, priority: -100, store: next.store, inject: next.inject, locale: next.locale,
        children: { [OWN_FLOW]: next.children[FLOW] } }, Wrapped)
      let picker: StoredEntry | undefined, restorePicker: (() => void) | undefined
      const syncPicker = () => {
        const current = slots.entriesOfSlot(FLOW)[0]
        if (current === picker) return
        restorePicker?.(); restorePicker = undefined; picker = current
        if (current && !current.children) restorePicker = register({ name: OWN_FLOW, ...current.options, store: current.store, inject: current.inject, locale: current.locale }, current.component)
      }
      const unsubscribe = slots.subscribe(FLOW, syncPicker)
      syncPicker()
      remove = () => { unsubscribe(); restorePicker?.(); restoreBrowser() }
    } finally { updating = false }
  }
  const unsubscribe = slots.subscribe(SLOT, sync)
  sync()
  return () => { unsubscribe(); updating = true; remove?.(); catalog.dispose() }
}
