// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { AccountSessionBrowser, accountSessionKey, installHarnessAccountSessions, projectAccountSessionOrder, projectAccountSessions, projectAccountWorkspaces } from '../src/client/harness-account-sessions.js'
import type { DshAccountSession } from '../src/dsh-remote/account-session-types.js'
import { openNativeAccountSession } from '../src/client/harness-native-navigation.js'
import { callArkme } from '../src/sdk/index.js'
import { HARNESS_MENU_OPEN } from '../src/client/harness-session-menu-bridge.js'
vi.mock('../src/sdk/index.js', () => ({ callArkme: vi.fn() }))
vi.mock('../src/client/harness-native-navigation.js', () => ({ openNativeAccountSession: vi.fn() }))
const row = (overrides: Partial<DshAccountSession> = {}): DshAccountSession => ({ runtimeRef: 'windows', sessionRef: 'same', workspaceRef: 'workspace', workspaceName: 'repo', title: 'Windows 对话', updatedAt: 20, capabilities: [], running: false, blank: false, archived: false, origin: '', desktopName: 'Windows', sameDesktop: false, runtimeName: 'web', presence: 'online', local: false, ...overrides })
const local = { current: 'same', ids: ['same'], byId: { same: { id: 'same', displayTitle: '本机', title: '本机', blank: false, running: true, updatedAt: 10 } }, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }
const ws = { items: [{ workspaceId: 'workspace', path: '/repo', title: 'repo', sessionIds: ['same'], createdAt: 1 }], archivedSessionIds: [], phase: 'ready', state: 'idle', error: null }
const cleanups: Array<() => void> = []
it('refreshes the surface catalog without a mounted menu, single-flights pulls, and stops when hidden or disposed', async () => {
  vi.useFakeTimers()
  const surface = document.createElement('section'); surface.dataset.arkmeVisible = 'true'; document.body.append(surface)
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, items: [row()] })
  const stop = installHarnessAccountSessions({ slots: { entries: () => [], subscribe: () => () => {} } } as never, surface)
  cleanups.push(stop)
  await vi.advanceTimersByTimeAsync(5_000)
  expect(callArkme).toHaveBeenCalledTimes(2)
  let finish!: (value: unknown) => void
  vi.mocked(callArkme).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  document.dispatchEvent(new Event(HARNESS_MENU_OPEN))
  window.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(10_000)
  expect(callArkme).toHaveBeenCalledTimes(3)
  finish({ contractVersion: 1, items: [row({ sessionRef: 'new-instance' })] })
  await vi.advanceTimersByTimeAsync(0)
  surface.dataset.arkmeVisible = 'false'
  await vi.advanceTimersByTimeAsync(10_000)
  expect(callArkme).toHaveBeenCalledTimes(3)
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, items: [] })
  surface.dataset.arkmeVisible = 'true'
  await vi.advanceTimersByTimeAsync(0)
  expect(callArkme).toHaveBeenCalledTimes(4)
  cleanups.pop()!()
  window.dispatchEvent(new Event('focus'))
  document.dispatchEvent(new Event(HARNESS_MENU_OPEN))
  await vi.advanceTimersByTimeAsync(10_000)
  expect(callArkme).toHaveBeenCalledTimes(4)
})
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); document.body.replaceChildren(); vi.clearAllMocks(); vi.useRealTimers() })
it('uses the embedding window focus and visibility to resume discovery', async () => {
  const frame = document.createElement('iframe'); document.body.append(frame)
  const owner = frame.contentDocument!, surface = owner.body
  const hidden = vi.spyOn(owner, 'hidden', 'get').mockReturnValue(false)
  cleanups.push(() => hidden.mockRestore())
  vi.mocked(callArkme).mockResolvedValue({ contractVersion: 1, items: [row()] })
  const stop = installHarnessAccountSessions({ slots: { entries: () => [], subscribe: () => () => {} } } as never, surface)
  cleanups.push(stop)
  await Promise.resolve(); await Promise.resolve()
  hidden.mockReturnValue(true)
  owner.defaultView!.dispatchEvent(new frame.contentWindow!.Event('focus'))
  expect(callArkme).toHaveBeenCalledTimes(1)
  hidden.mockReturnValue(false)
  owner.dispatchEvent(new frame.contentWindow!.Event('visibilitychange'))
  await Promise.resolve(); await Promise.resolve()
  expect(callArkme).toHaveBeenCalledTimes(2)
  owner.defaultView!.dispatchEvent(new frame.contentWindow!.Event('focus'))
  expect(callArkme).toHaveBeenCalledTimes(3)
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
