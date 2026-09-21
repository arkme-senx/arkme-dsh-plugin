// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DeepSeekHarnessSurface } from '../src/client/DeepSeekHarnessSurface.js'
import { HARNESS_NATIVE_OPEN, openNativeAccountSession, type NativeSessionRequest } from '../src/client/harness-native-navigation.js'
import { apply } from '../src/client/harness-session-client.js'
vi.mock('../src/client/harness-window-drag.js', () => ({ watchHarnessWindowDrag: () => () => {} }))
vi.mock('../src/client/harness-surface-viewport.js', () => ({ watchHarnessSurfaceViewport: () => () => {} }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const disposers: Array<() => void> = []
afterEach(() => { disposers.splice(0).reverse().forEach(fn => fn()); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.replaceChildren() })
it('activates every selected source immediately without readiness acknowledgements or timeouts', () => {
  vi.useFakeTimers()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); disposers.push(() => act(() => root.unmount()))
  act(() => root.render(<DeepSeekHarnessSurface accountId={3016} accountScope="test:3016" />))
  const request = (sessionRef: string, runtimeRef = 'windows'): NativeSessionRequest => ({ runtimeRef, sessionRef, accountId: '3016', accountScope: 'test:3016' })
  const emit = (event: string, detail: NativeSessionRequest) => act(() => { document.dispatchEvent(new CustomEvent(event, { detail })) })
  const active = () => document.querySelector('[data-arkme-active="true"]')
  const localDocument = document.querySelector('iframe')!.contentDocument
  for (const target of [request('A'), request('B'), request('C', 'offline'), request('local', '')]) {
    emit(HARNESS_NATIVE_OPEN, target)
    expect(active()?.getAttribute('data-arkme-runtime')).toBe('')
    expect(active()?.getAttribute('data-arkme-open-session')).toBe(target.runtimeRef ? `arkme:${target.runtimeRef}:${target.sessionRef}` : target.sessionRef)
  }
  emit(HARNESS_NATIVE_OPEN, { ...request('secret'), accountId: 'foreign' })
  emit('arkme:native-session-ready', request('A'))
  act(() => vi.advanceTimersByTime(30_000))
  expect(active()?.getAttribute('data-arkme-runtime')).toBe('')
  expect(active()?.getAttribute('data-arkme-open-session')).toBe('local')
  expect(document.querySelector('[data-arkme-runtime=""] iframe')!.contentDocument).toBe(localDocument)
  expect(vi.getTimerCount()).toBe(0)
})
it('allows offline and older instances to open through the cloud data owner', async () => {
  const surface = document.createElement('section'), frame = document.createElement('iframe')
  surface.append(frame); document.body.append(surface)
  vi.stubGlobal('window', frame.contentWindow!)
  const event = vi.fn(); document.addEventListener(HARNESS_NATIVE_OPEN, event)
  disposers.push(() => document.removeEventListener(HARNESS_NATIVE_OPEN, event))
  const target = { runtimeRef: 'old', sessionRef: 'A', presence: 'offline' as const, capabilities: [] }
  await expect(openNativeAccountSession(target)).resolves.toBeUndefined()
  await expect(openNativeAccountSession(target, 'old')).resolves.toBeUndefined()
  expect(event).toHaveBeenCalledTimes(2)
})
it('boots one account document once, reuses documents on every selection and clears them only on account change', () => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); disposers.push(() => act(() => root.unmount()))
  const render = (accountId = 3016, visible = true) => act(() => root.render(<DeepSeekHarnessSurface accountId={accountId} accountScope={`test:${accountId}`} visible={visible} />))
  render()
  const local = document.querySelector('iframe')!, localDocument = local.contentDocument
  const open = (runtimeRef: string, sessionRef: string, accountId = '3016') => act(() => {
    document.dispatchEvent(new CustomEvent(HARNESS_NATIVE_OPEN, { detail: { runtimeRef, sessionRef, accountId, accountScope: `test:${accountId}` } }))
  })
  open('windows', 'A')
  const remote = local, remoteDocument = remote.contentDocument, remoteUrl = remote.src
  for (const [runtime, session] of [['', 'local-A'], ['windows', 'B'], ['', 'local-B'], ['windows', 'A']]) open(runtime!, session!)
  expect(document.querySelectorAll('iframe')).toHaveLength(1)
  expect(document.querySelector('[data-arkme-runtime=""] iframe')).toBe(local)
  expect(local.contentDocument).toBe(localDocument)
  expect(remote.contentDocument).toBe(remoteDocument)
  expect(remote.src).toBe(remoteUrl)
  expect(remote.parentElement?.dataset.arkmeOpenSession).toBe('arkme:windows:A')
  const revision = remote.parentElement?.dataset.arkmeOpenRevision
  open('windows', 'A')
  expect(remote.parentElement?.dataset.arkmeOpenRevision).not.toBe(revision)
  render(3016, false); render()
  expect(remote.contentDocument).toBe(remoteDocument)
  open('foreign', 'secret', '42')
  expect(document.querySelectorAll('iframe')).toHaveLength(1)
  render(42)
  expect(local.isConnected).toBe(false); expect(remote.isConnected).toBe(false)
  expect(document.querySelectorAll('iframe')).toHaveLength(1)
})
it('retains selection during discovery, opens incrementally and never lets late data override a newer choice', async () => {
  const surface = document.createElement('section'); surface.dataset.arkmeOwned = 'deepseek-harness-surface'
  const frame = document.createElement('iframe'); surface.append(frame); document.body.append(surface)
  vi.stubGlobal('window', frame.contentWindow!)
  const listeners = new Set<() => void>()
  let current: string | undefined
  const notify = () => listeners.forEach(fn => fn())
  const open = vi.fn((id: string) => { current = id; notify() })
  const clear = vi.fn(() => { current = undefined; notify() })
  const byId: Record<string, object> = { A: {} }
  apply({ effect: (fn: () => () => void) => disposers.push(fn()), sessions: { open, clear, list: {
    subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) },
    getSnapshot: () => ({ byId, current }),
  } } } as never)
  const select = async (id: string, revision: string) => { surface.dataset.arkmeOpenSession = id; surface.dataset.arkmeOpenRevision = revision; await Promise.resolve() }
  await select('A', '1'); expect(current).toBe('A')
  await select('B', '2'); expect(current).toBe('A'); expect(clear).not.toHaveBeenCalled()
  byId.B = {}; notify(); expect(current).toBe('B')
  await select('C', '3'); expect(current).toBe('B')
  await select('A', '4'); byId.C = {}; notify(); expect(current).toBe('A')
  await select('A', '5')
  expect(open.mock.calls.map(([id]) => id)).toEqual(['A', 'B', 'A', 'A'])
  await select('D', '6'); open('B'); byId.D = {}; notify(); expect(current).toBe('B')
})
it('never holds plugin boot on account discovery or conversation history', async () => {
  const surface = document.createElement('section')
  surface.dataset.arkmeOwned = 'deepseek-harness-surface'; surface.dataset.arkmeOpenSession = 'A'
  const frame = document.createElement('iframe'); surface.append(frame); document.body.append(surface)
  vi.stubGlobal('window', frame.contentWindow!)
  const listeners = new Set<() => void>(), byId: Record<string, object> = {}
  let current: string | undefined
  const notify = () => listeners.forEach(fn => fn())
  const refresh = vi.fn()
  const open = vi.fn((id: string) => { current = id; notify() })
  const boot = apply({ effect: (fn: () => () => void) => disposers.push(fn()), sessions: {
    open, clear: () => { current = undefined; notify() }, refresh,
    list: { getSnapshot: () => ({ byId, current }), subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) } },
  } } as never)
  await Promise.resolve()
  expect(boot).toBeUndefined(); expect(open).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
  // A later click during first discovery supersedes the initial target.
  surface.dataset.arkmeOpenSession = 'B'; await Promise.resolve()
  byId.A = {}; byId.B = {}; notify()
  expect(current).toBe('B'); expect(open.mock.calls).toEqual([['B']])
  surface.dataset.arkmeOpenSession = 'A'; await Promise.resolve()
  expect(current).toBe('A'); expect(refresh).not.toHaveBeenCalled()
})
