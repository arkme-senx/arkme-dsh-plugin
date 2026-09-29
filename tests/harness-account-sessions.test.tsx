// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { AccountSessionBrowser, accountSessionKey, applyAccountSessionDelta, reconcileAccountSessions, installHarnessAccountSessions, projectAccountSessionOrder, projectAccountSessions, projectAccountWorkspaces } from '../src/client/harness-account-sessions.js'
import type { DshDirectoryDelta, DshDirectorySession } from '../src/dsh-remote/account-session-directory.js'
import type { DshAccountSession } from '../src/dsh-remote/account-session-types.js'
import { openNativeAccountSession } from '../src/client/harness-native-navigation.js'
import { callArkme, createArkmeSdk } from '../src/sdk/index.js'
import { HARNESS_MENU_OPEN } from '../src/client/harness-session-menu-bridge.js'
vi.mock('../src/sdk/index.js', () => ({ callArkme: vi.fn(), createArkmeSdk: vi.fn(() => ({ observeDshAccountSessions: vi.fn(() => () => {}) })) }))
vi.mock('../src/client/harness-native-navigation.js', () => ({ openNativeAccountSession: vi.fn() }))
const row = (overrides: Partial<DshAccountSession> = {}): DshAccountSession => ({ runtimeRef: 'windows', sessionRef: 'same', workspaceRef: 'workspace', workspaceName: 'repo', title: 'Windows 对话', updatedAt: 20, capabilities: [], running: false, blank: false, archived: false, origin: '', desktopName: 'Windows', sameDesktop: false, runtimeName: 'web', presence: 'online', local: false, ...overrides })
const local = { current: 'same', ids: ['same'], byId: { same: { id: 'same', displayTitle: '本机', title: '本机', blank: false, running: true, updatedAt: 10 } }, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }
const ws = { items: [{ workspaceId: 'workspace', path: '/repo', title: 'repo', sessionIds: ['same'], createdAt: 1 }], archivedSessionIds: [], phase: 'ready', state: 'idle', error: null }
const cleanups: Array<() => void> = []
const committed = (overrides: Partial<DshDirectorySession> = {}): DshDirectorySession => ({
  runtime_ref: 'windows', session_ref: 'same', workspace_ref: 'workspace', host_generation: 1, projection_at: 2,
  source_updated_at: 30, title: 'Committed', running: false, blank: false, archived: false, projection_as_of_seq: 3, ...overrides,
})
it('applies committed create/update/delete pushes without directory HTTP and keeps tombstone versions', async () => {
  let notify!: (delta?: DshDirectoryDelta) => void
  vi.mocked(createArkmeSdk).mockReturnValueOnce({ observeDshAccountSessions: (changed: typeof notify) => { notify = changed; return () => {} } } as never)
  const surface = document.createElement('section'); surface.dataset.arkmeVisible = 'true'; document.body.append(surface)
  const publish = vi.fn()
  Object.assign(window, { __ARKME_NATIVE_DIRECTORY__: { publish } })
  cleanups.push(() => { delete (window as any).__ARKME_NATIVE_DIRECTORY__ })
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, includesDeleted: true, items: [row({ directoryVersion: [1, 1] })] })
  cleanups.push(installHarnessAccountSessions({ slots: { entries: () => [], subscribe: () => () => {} } } as never, surface))
  await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce())
  notify({ version: 1, sessions: [committed({ session_ref: 'new' })] })
  expect(publish.mock.lastCall?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ sessionRef: 'new', title: 'Committed', workspaceName: 'repo' })]))
  notify({ version: 1, sessions: [committed({ session_ref: 'new', projection_at: 3, title: 'Renamed' })] })
  expect(publish.mock.lastCall?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ sessionRef: 'new', title: 'Renamed' })]))
  notify({ version: 1, sessions: [committed({ session_ref: 'new', projection_at: 4, deleted_at: 100 })] })
  const afterDelete = publish.mock.calls.length
  expect(publish.mock.lastCall?.[0]).toHaveLength(1)
  notify({ version: 1, sessions: [committed({ session_ref: 'new', projection_at: 3 })] })
  expect(publish).toHaveBeenCalledTimes(afterDelete)
  expect(callArkme).toHaveBeenCalledOnce()
  notify({ version: 1, sessions: [committed({ runtime_ref: 'unknown', workspace_ref: 'other' })] })
  await vi.waitFor(() => expect(callArkme).toHaveBeenCalledTimes(2))
})

it('keeps a pushed new row and newer version when an earlier full refresh finishes', async () => {
  let notify!: (delta?: DshDirectoryDelta) => void
  vi.mocked(createArkmeSdk).mockReturnValueOnce({ observeDshAccountSessions: (changed: typeof notify) => { notify = changed; return () => {} } } as never)
  const surface = document.createElement('section'); document.body.append(surface)
  const publish = vi.fn()
  Object.assign(window, { __ARKME_NATIVE_DIRECTORY__: { publish } })
  cleanups.push(() => { delete (window as any).__ARKME_NATIVE_DIRECTORY__ })
  const initial = { contractVersion: 1, includesDeleted: true, items: [row({ directoryVersion: [1, 1] })] }
  vi.mocked(callArkme).mockResolvedValue(initial)
  cleanups.push(installHarnessAccountSessions({ slots: { entries: () => [], subscribe: () => () => {} } } as never, surface))
  await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce())
  const full = Promise.withResolvers<typeof initial>()
  vi.mocked(callArkme).mockReturnValueOnce(full.promise)
  notify(); await vi.waitFor(() => expect(callArkme).toHaveBeenCalledTimes(2))
  notify({ version: 1, sessions: [committed(), committed({ session_ref: 'new' })] })
  full.resolve(initial)
  await vi.waitFor(() => expect(publish.mock.lastCall?.[0]).toHaveLength(2))
  await Promise.resolve(); await Promise.resolve()
  expect(publish.mock.lastCall?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ sessionRef: 'same', title: 'Committed' }), expect.objectContaining({ sessionRef: 'new' })]))
  expect(callArkme).toHaveBeenCalledTimes(2)
})

it('compares canonical row revisions across takeover without runtime generation gates', () => {
  const original = row({ directoryVersion: [10, 100], projectionAsOfSeq: 20 })
  const current = applyAccountSessionDelta([original], { version: 1, sessions: [committed({ host_generation: 11, projection_at: 1 })] })!
  expect(current[0]).toMatchObject({ directoryVersion: [11, 1], title: 'Committed', projectionAsOfSeq: 20 })
  expect(applyAccountSessionDelta(current, { version: 1, sessions: [committed({ host_generation: 10, projection_at: 999 })] })).toBe(current)
  expect(applyAccountSessionDelta(current, { version: 1, sessions: [committed({ host_generation: 11, projection_at: 1, projection_as_of_seq: 21, title: 'do not overwrite' })] })?.[0])
    .toMatchObject({ title: 'Committed', projectionAsOfSeq: 21 })
  expect(reconcileAccountSessions(current, [original])[0]).toBe(current[0])
  expect(applyAccountSessionDelta(current, { version: 99, sessions: [] })).toBeUndefined()
})

it('retains authoritative full-read tombstones against an unseen intermediate update', async () => {
  let notify!: (delta?: DshDirectoryDelta) => void
  vi.mocked(createArkmeSdk).mockReturnValueOnce({ observeDshAccountSessions: (changed: typeof notify) => { notify = changed; return () => {} } } as never)
  const surface = document.createElement('section'); document.body.append(surface)
  const publish = vi.fn()
  Object.assign(window, { __ARKME_NATIVE_DIRECTORY__: { publish } })
  cleanups.push(() => { delete (window as any).__ARKME_NATIVE_DIRECTORY__ })
  const other = row({ sessionRef: 'other', directoryVersion: [1, 1] })
  vi.mocked(callArkme).mockResolvedValueOnce({ contractVersion: 1, includesDeleted: true, items: [row({ directoryVersion: [1, 10] }), other] })
    .mockResolvedValue({ contractVersion: 1, includesDeleted: true, items: [row({ directoryVersion: [1, 20], deleted: true }), other] })
  cleanups.push(installHarnessAccountSessions({ slots: { entries: () => [], subscribe: () => () => {} } } as never, surface))
  await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce())
  notify()
  await vi.waitFor(() => expect(publish.mock.lastCall?.[0]).toHaveLength(1))
  notify({ version: 1, sessions: [committed({ projection_at: 15 })] })
  expect(publish.mock.lastCall?.[0]).toMatchObject([other])
  expect(callArkme).toHaveBeenCalledTimes(2)
})

it('retains full refresh for an older service without complete tombstone support', async () => {
  let notify!: (delta?: DshDirectoryDelta) => void
  vi.mocked(createArkmeSdk).mockReturnValueOnce({ observeDshAccountSessions: (changed: typeof notify) => { notify = changed; return () => {} } } as never)
  const surface = document.createElement('section'); document.body.append(surface)
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, items: [row({ directoryVersion: [1, 1] })] })
  cleanups.push(installHarnessAccountSessions({ slots: { entries: () => [], subscribe: () => () => {} } } as never, surface))
  await vi.waitFor(() => expect(callArkme).toHaveBeenCalledOnce())
  await Promise.resolve(); await Promise.resolve()
  notify({ version: 1, sessions: [committed()] })
  await vi.waitFor(() => expect(callArkme).toHaveBeenCalledTimes(2))
})

it('requires tombstone support on every full-directory page before applying deltas', async () => {
  let notify!: (delta?: DshDirectoryDelta) => void
  vi.mocked(createArkmeSdk).mockReturnValueOnce({ observeDshAccountSessions: (changed: typeof notify) => { notify = changed; return () => {} } } as never)
  const surface = document.createElement('section'); document.body.append(surface)
  const publish = vi.fn()
  Object.assign(window, { __ARKME_NATIVE_DIRECTORY__: { publish } })
  cleanups.push(() => { delete (window as any).__ARKME_NATIVE_DIRECTORY__ })
  vi.mocked(callArkme).mockResolvedValueOnce({ contractVersion: 1, items: [row({ directoryVersion: [1, 1] })], nextCursor: { session_ref: 'same' } })
    .mockResolvedValue({ contractVersion: 1, includesDeleted: true, items: [] })
  cleanups.push(installHarnessAccountSessions({ slots: { entries: () => [], subscribe: () => () => {} } } as never, surface))
  await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce())
  expect(callArkme).toHaveBeenCalledTimes(2)
  expect(vi.mocked(callArkme).mock.calls.every(([, params]) => params?.includeDeleted === true)).toBe(true)
  notify({ version: 1, sessions: [committed()] })
  await vi.waitFor(() => expect(callArkme).toHaveBeenCalledTimes(3))
})

it('refreshes only on directory push or surface entry, never a periodic timer', async () => {
  vi.useFakeTimers()
  let notify!: () => void
  vi.mocked(createArkmeSdk).mockReturnValueOnce({ observeDshAccountSessions: (changed: () => void) => { notify = changed; return () => {} } } as never)
  const surface = document.createElement('section'); surface.dataset.arkmeVisible = 'true'; document.body.append(surface)
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, items: [row()] })
  const stop = installHarnessAccountSessions({ slots: { entries: () => [], subscribe: () => () => {} } } as never, surface)
  cleanups.push(stop)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(callArkme).toHaveBeenCalledTimes(1)
  document.dispatchEvent(new Event(HARNESS_MENU_OPEN)); window.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(0)
  expect(callArkme).toHaveBeenCalledTimes(1)
  notify(); await vi.advanceTimersByTimeAsync(0)
  expect(callArkme).toHaveBeenCalledTimes(2)
  surface.dataset.arkmeVisible = 'false'; await vi.advanceTimersByTimeAsync(10_000)
  expect(callArkme).toHaveBeenCalledTimes(2)
  surface.dataset.arkmeVisible = 'true'; await vi.advanceTimersByTimeAsync(0)
  expect(callArkme).toHaveBeenCalledTimes(3)
  cleanups.pop()!(); notify(); await vi.advanceTimersByTimeAsync(30_000)
  expect(callArkme).toHaveBeenCalledTimes(3)
})
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); document.body.replaceChildren(); vi.clearAllMocks(); vi.useRealTimers() })
it('keeps pushed directory changes while the embedding document is hidden', async () => {
  let notify!: () => void
  vi.mocked(createArkmeSdk).mockReturnValueOnce({ observeDshAccountSessions: (changed: () => void) => { notify = changed; return () => {} } } as never)
  const frame = document.createElement('iframe'); document.body.append(frame)
  const owner = frame.contentDocument!, surface = owner.body
  const hidden = vi.spyOn(owner, 'hidden', 'get').mockReturnValue(true)
  cleanups.push(() => hidden.mockRestore())
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, items: [row()] })
  cleanups.push(installHarnessAccountSessions({ slots: { entries: () => [], subscribe: () => () => {} } } as never, surface))
  await Promise.resolve(); await Promise.resolve()
  notify(); await Promise.resolve(); await Promise.resolve()
  expect(callArkme).toHaveBeenCalledTimes(2)
  hidden.mockReturnValue(false); owner.dispatchEvent(new frame.contentWindow!.Event('visibilitychange'))
  owner.defaultView!.dispatchEvent(new frame.contentWindow!.Event('focus'))
  expect(callArkme).toHaveBeenCalledTimes(2)
})
it('separates identical ids from different hosts without changing the native local snapshot', () => {
  const before = structuredClone(local)
  const value = projectAccountSessions(local as never, [row(), row({ runtimeRef: 'linux' }), row({ local: true }), row({ sessionRef: 'archived', archived: true })], row())
  expect(value.ids).toEqual(['same', accountSessionKey(row()), accountSessionKey(row({ runtimeRef: 'linux' }))])
  expect(value.byId.same).toBe(local.byId.same)
  expect(value.current).toBe(accountSessionKey(row()))
  expect(local).toEqual(before)
})
it('adds computer prefixes only for workspace name collisions and preserves each membership', () => {
  const rows = [row(), row({ local: true, runtimeRef: 'mac', desktopName: 'Mac' })]
  expect(projectAccountWorkspaces(ws, rows).items.map(item => item.title)).toEqual(['Mac · repo', 'Windows · repo'])
  expect(projectAccountWorkspaces(ws, [row({ workspaceName: 'other' })]).items.map(item => item.title)).toEqual(['repo', 'other'])
  expect(projectAccountWorkspaces(ws, rows).items[1]?.sessionIds).toEqual([accountSessionKey(row())])
})
it('interleaves local and remote activity regardless of discovery order and reorders on updates', () => {
  const older = row({ sessionRef: 'older', updatedAt: 5 }), newer = row({ sessionRef: 'newer', updatedAt: 20 })
  const oldId = accountSessionKey(older), newId = accountSessionKey(newer)
  // The native list promotes newly fetched history ahead of already known local rows.
  const view = { orderBy: 'updated' as const, sessionOrderByAccount: { flat: [newId, oldId, 'same'], workspace: [oldId, 'same'] } }
  const sessions = projectAccountSessions(local as never, [newer, older])
  expect(projectAccountSessionOrder(view, sessions).sessionOrderByAccount).toEqual({ flat: [newId, 'same', oldId], workspace: ['same', oldId] })
  const updated = projectAccountSessions(local as never, [newer, { ...older, updatedAt: 30 }])
  expect(projectAccountSessionOrder(view, updated).sessionOrderByAccount.flat).toEqual([oldId, newId, 'same'])
  expect(view.sessionOrderByAccount.flat).toEqual([newId, oldId, 'same'])
  const manual = { ...view, orderBy: 'manual' as const }
  expect(projectAccountSessionOrder(manual, sessions)).toBe(manual)
})
it('reuses the native component, view store and picker through owned child declarations, and disposes only its registrations', () => {
  const component = () => null, picker = () => null, store = {}, inject = () => ({})
  const native = { component, store, inject, locale: 'workspace', options: {}, children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } } }
  const registrations: Array<{ options: Record<string, unknown>; component: unknown; disposed: boolean }> = []
  const listeners = new Map<string, () => void>()
  const slots = { entries: () => [native], entriesOfSlot: () => [{ component: picker, options: {}, inject }],
    subscribe: (name: string, listener: () => void) => { listeners.set(name, listener); return () => { listeners.delete(name) } },
    register: (options: Record<string, unknown>, c: unknown) => { const item = { options, component: c, disposed: false }; registrations.push(item); return () => { item.disposed = true } },
  }
  const stop = installHarnessAccountSessions({ slots } as never, document.body)
  expect(registrations).toHaveLength(2)
  expect(registrations[0]?.options).toMatchObject({ name: 'sidebar.workspaces', priority: -100, store, inject, locale: 'workspace', children: { 'arkme.accountSessions.directoryFlow': { kind: 'single', scope: 'root' } } })
  expect(registrations[1]?.component).toBe(picker)
  expect(native.component).toBe(component)
  stop(); expect(registrations.every(item => item.disposed)).toBe(true); expect(listeners.size).toBe(0)
})
it('falls back to the unchanged native list when the registered UI face is unsupported', () => {
  const register = vi.fn()
  const stop = installHarnessAccountSessions({ slots: { entries: () => [{ component: () => null, options: {} }], subscribe: () => () => {}, register } } as never, document.body)
  expect(register).not.toHaveBeenCalled(); stop()
})
it('keeps remote navigation out of native open, retains last good rows after failure, and clears them on account change', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const surface = document.createElement('section'); surface.dataset.arkmeAccountId = '3016'; surface.dataset.arkmeVisible = 'true'
  document.body.append(surface)
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => act(() => root.unmount()))
  const open = vi.fn()
  let props: Record<string, any> = {}
  const Native = (p: Record<string, any>) => { props = p; const state = p.useSessions((s: unknown) => s); return createElement('div', { 'data-native': '' }, state.ids.map((id: string) => createElement('button', { key: id, onClick: () => p.open(id) }, state.byId[id].displayTitle))) }
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, items: [row()] })
  await act(async () => root.render(createElement(AccountSessionBrowser as ComponentType<any>, { Native, surface, open, useStore: (select: any) => select({ orderBy: 'updated', sessionOrderByAccount: {} }), useSessions: (select: any) => select(local), useWorkspaces: (select: any) => select(ws), startSession: vi.fn() })))
  expect(container.textContent).toContain('Windows 对话')
  act(() => props.open(accountSessionKey(row())))
  expect(open).not.toHaveBeenCalled(); expect(openNativeAccountSession).toHaveBeenCalledWith(row(), undefined)
  act(() => props.open('same')); expect(open).toHaveBeenCalledWith('same')
  vi.mocked(callArkme).mockRejectedValue(new Error('offline'))
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(container.textContent).toContain('Windows 对话')
  await act(async () => { surface.dataset.arkmeAccountId = '42' })
  expect(container.textContent).not.toContain('Windows 对话')
})
it('applies catalog add/update/delete without replacing unchanged rows or an unchanged snapshot', async () => {
  const { reconcileAccountSessions } = await import('../src/client/harness-account-sessions.js')
  const first = row({ sessionRef: 'first' }), second = row({ sessionRef: 'second' })
  const previous = [first, second]
  expect(reconcileAccountSessions(previous, structuredClone(previous))).toBe(previous)
  const next = reconcileAccountSessions(previous, [{ ...first }, { ...second, title: 'renamed', updatedAt: 30 }, row({ sessionRef: 'new' })])
  expect(next[0]).toBe(first); expect(next[1]).not.toBe(second)
  expect(next.map(item => item.sessionRef)).toEqual(['first', 'second', 'new'])
  const removed = reconcileAccountSessions(next, [structuredClone(next[1]!)])
  expect(removed).toEqual([next[1]]); expect(removed[0]).toBe(next[1])
})
it('binds equal-title native rows by order and keeps physical-local origin after opening another source', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const surface = document.createElement('section'); surface.dataset.arkmeAccountId = '3016'; document.body.append(surface)
  const container = document.createElement('div'); container.dataset.slot = 'sidebar.workspaces'; document.body.append(container)
  const root = createRoot(container); cleanups.push(() => act(() => root.unmount()))
  const remoteRow = row({ title: '本机' })
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, localRuntimeRef: 'mac', localRuntime: { desktopName: 'Mac', runtimeName: 'web' }, items: [remoteRow, row({ local: true, runtimeRef: 'mac', title: '本机', sameDesktop: true })] })
  const Native = (p: Record<string, any>) => {
    const state = p.useSessions((s: unknown) => s)
    return createElement('div', { role: 'tree' }, ['same', accountSessionKey(remoteRow)].filter(id => state.byId[id]).map(id => createElement('span', { key: id }, createElement('div', { role: 'treeitem', 'aria-selected': id === state.current, 'data-test-id': id }, createElement('span', null, state.byId[id].displayTitle)))))
  }
  await act(async () => root.render(createElement(AccountSessionBrowser as ComponentType<any>, { Native, surface, open: vi.fn(), useStore: (select: any) => select({ groupBy: 'flat', orderBy: 'manual', sessionOrderByAccount: { __flat_session_order__: ['same', accountSessionKey(remoteRow)] } }), useSessions: (select: any) => select(local), useWorkspaces: (select: any) => select(ws), startSession: vi.fn() })))
  const nativeRows = container.querySelectorAll('[role="treeitem"]')
  const card = document.createElement('div'); card.setAttribute('role', 'button'); card.setAttribute('aria-label', '复制: 本机')
  card.innerHTML = '<div><div>本机</div><div class="native-time">刚刚</div><div><span>空闲</span></div></div>'
  document.body.append(card)
  await act(async () => nativeRows[1]!.dispatchEvent(new Event('pointerover', { bubbles: true })))
  expect(card.querySelector('[data-arkme-session-origin]')?.textContent).toBe('电脑：Windows')
  await act(async () => nativeRows[0]!.dispatchEvent(new Event('pointerover', { bubbles: true })))
  expect(card.querySelector('[data-arkme-session-origin]')).toBeNull()
})

it('keeps source-owned rows and workspaces present until native discovery takes over', () => {
  const pending = row({ local: true, sessionRef: 'pending', workspaceRef: 'pending-workspace' })
  const before = projectAccountSessions(local as never, [pending])
  expect(before.ids).toEqual(['same', 'pending'])
  expect(before.byId.pending?.displayTitle).toBe('Windows 对话')
  const nativeRow = { ...before.byId.pending!, running: true }
  const loaded = { ...before, byId: { ...before.byId, pending: nativeRow } }
  expect(projectAccountSessions(loaded, [pending]).byId.pending).toBe(nativeRow)
  expect(projectAccountSessions(loaded, [pending]).ids).toEqual(['same', 'pending'])
  const workspace = projectAccountWorkspaces(ws, [pending]).items.find(item => item.workspaceId === 'pending-workspace')!
  expect(workspace.sessionIds).toEqual(['pending'])
  const discovered = projectAccountWorkspaces({ ...ws, items: [...ws.items, workspace] }, [pending])
  expect(discovered.items.filter(item => item.workspaceId === 'pending-workspace')).toHaveLength(1)
})

it('preloads the account catalog before the native menu mounts and retains it across menu remounts', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const surface = document.createElement('section'); surface.dataset.arkmeAccountId = '3016'; document.body.append(surface)
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, items: [row()] })
  const stop = installHarnessAccountSessions({ slots: { entries: () => [], subscribe: () => () => {} } } as never, surface)
  cleanups.push(stop)
  await Promise.resolve(); await Promise.resolve()
  expect(callArkme).toHaveBeenCalledTimes(1)
  vi.mocked(callArkme).mockImplementation(() => new Promise(() => {}))
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => act(() => root.unmount()))
  const Native = (p: Record<string, any>) => createElement('div', null, p.useSessions((state: any) => state.ids.map((id: string) => state.byId[id].displayTitle).join(',')))
  const element = createElement(AccountSessionBrowser as ComponentType<any>, { Native, surface, open: vi.fn(), useStore: (s: any) => s({ orderBy: 'updated', sessionOrderByAccount: {} }), useSessions: (s: any) => s(local), useWorkspaces: (s: any) => s(ws) })
  act(() => root.render(element))
  expect(container.textContent).toContain('Windows 对话')
  act(() => root.render(null))
  act(() => root.render(element))
  expect(container.textContent).toContain('Windows 对话')
})

it('refreshes immediately on a committed directory event and retains an event received during an in-flight read', async () => {
  vi.useFakeTimers()
  let notify!: () => void
  const stopObserve = vi.fn()
  vi.mocked(createArkmeSdk).mockReturnValueOnce({ observeDshAccountSessions: (changed: () => void) => { notify = changed; return stopObserve } } as never)
  const surface = document.createElement('section'); surface.dataset.arkmeVisible = 'true'; document.body.append(surface)
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, items: [] })
  const stop = installHarnessAccountSessions({ slots: { entries: () => [], subscribe: () => () => {} } } as never, surface)
  cleanups.push(stop)
  await vi.advanceTimersByTimeAsync(0)
  let finish!: (value: unknown) => void
  vi.mocked(callArkme).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  notify()
  expect(callArkme).toHaveBeenCalledTimes(2)
  notify(); notify()
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, items: [row({ sessionRef: 'new' })] })
  finish({ contractVersion: 1, items: [] })
  await vi.advanceTimersByTimeAsync(0)
  expect(callArkme).toHaveBeenCalledTimes(3) // No timer advanced, and the invalidation wasn't lost.
  cleanups.pop()!()
  expect(stopObserve).toHaveBeenCalledOnce()
  notify()
  expect(callArkme).toHaveBeenCalledTimes(3)
})
