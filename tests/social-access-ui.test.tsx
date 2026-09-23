// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeProductNavigation } from '../src/client/ArkmeProductNavigation.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { ArkmeAuthStore, arkmeAuthStore } from '../src/client/auth-store.js'
import { socialAccessStore } from '../src/client/social-access-store.js'
import { createRoot, type Root } from 'react-dom/client'
import { act as domAct } from 'react-dom/test-utils'
import { ArkmeOutgoingCallHost } from '../src/client/ArkmeOutgoingCallHost.js'
import { SocialAccessPresentationBoundary } from '../src/client/SocialAccessPresentationBoundary.js'
import { SocialAccessSnapshotStorage } from '../src/client/social-access-snapshot-storage.js'
import { ArkmeNavigation } from '../src/client/ArkmeVirtualWorkspace.js'

const api = vi.hoisted(() => ({ allowed: false as boolean | null, calls: vi.fn(), pending: undefined as undefined | Promise<unknown> }))
vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(),
  callArkme: async (operation: string) => {
    api.calls(operation)
    if (operation === 'social.access') return api.pending ?? { userId: 42, allowed: api.allowed }
    if (operation === 'user.profile' || operation === 'user.profile.refresh') return { profile: null }
    if (operation === 'calls.outgoing.intent.claim') return null
    if (operation === 'arko.profile') return { displayName: 'Arko', version: 1 }
    if (operation === 'arko.history') return { items: [], hasMore: false }
    return {}
  },
}))

let renderer: ReactTestRenderer | undefined
let callRoot: Root | undefined
afterEach(() => {
  domAct(() => callRoot?.unmount())
  callRoot = undefined
  document.body.replaceChildren()
  act(() => renderer?.unmount())
  renderer = undefined
  socialAccessStore.activate(undefined)
  api.calls.mockClear(); api.pending = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
})
const labels = () => renderer!.root.findAllByType('button').map(button => button.props['data-arkme-home-tour-target']).filter(Boolean)

describe('real social presentation lifecycle', () => {
  function mountSurface() {
    const container = document.createElement('div'); document.body.append(container)
    callRoot = createRoot(container)
    callRoot.render(<SocialAccessPresentationBoundary><main data-testid="surface" style={{ display: 'flex' }}>
      <ArkmeProductNavigation compact={false} />
      <input defaultValue="保留草稿" />
    </main></SocialAccessPresentationBoundary>)
  }
  it('waits for the existing account check and first qualification before showing any navigation', async () => {
    const auth = new ArkmeAuthStore()
    vi.spyOn(arkmeAuthStore, 'getSnapshot').mockImplementation(auth.getSnapshot)
    vi.spyOn(arkmeAuthStore, 'subscribe').mockImplementation(auth.subscribe)
    let finish!: (value: unknown) => void
    api.pending = new Promise(resolve => { finish = resolve })
    await domAct(async () => { mountSurface() })
    const surface = document.querySelector('main')!
    const input = document.querySelector('input')!
    expect(surface.style.opacity).toBe('0')
    expect(api.calls.mock.calls.some(([operation]) => operation === 'social.access')).toBe(false)
    await domAct(async () => { auth.setAuth({ status: 'authenticated', environment: 'test', userId: 42 }) })
    expect(surface.style.opacity).toBe('0')
    await domAct(async () => { finish({ userId: 42, allowed: true }); await api.pending })
    expect(surface.style.opacity).toBe('')
    for (const tab of ['contacts', 'world', 'calls']) expect(document.querySelector(`[data-arkme-home-tour-target="${tab}"]`)).not.toBeNull()
    expect(document.querySelector('input')).toBe(input)
  })

  it('releases personal presentation when the existing account check fails', async () => {
    const auth = new ArkmeAuthStore()
    vi.spyOn(arkmeAuthStore, 'getSnapshot').mockImplementation(auth.getSnapshot)
    vi.spyOn(arkmeAuthStore, 'subscribe').mockImplementation(auth.subscribe)
    await domAct(async () => { mountSurface() })
    expect(document.querySelector('main')!.style.opacity).toBe('0')
    await domAct(async () => { auth.setError('account service unavailable') })
    expect(document.querySelector('main')!.style.opacity).toBe('')
    expect(document.querySelector('[data-arkme-home-tour-target="recordings"]')).not.toBeNull()
    expect(api.calls.mock.calls.some(([operation]) => operation === 'social.access')).toBe(false)
  })

  it('restores all social navigation immediately after same-account binding without replacing personal content', async () => {
    api.allowed = false
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    await domAct(async () => { mountSurface() })
    const input = document.querySelector('input')!
    expect(document.querySelector('[data-arkme-home-tour-target="contacts"]')).toBeNull()
    const before = api.calls.mock.calls.filter(([op]) => op === 'social.access').length
    api.allowed = true
    await domAct(async () => {
      arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
      arkmeUi.authChanged(true)
    })
    expect(api.calls.mock.calls.filter(([op]) => op === 'social.access').length).toBe(before + 1)
    for (const tab of ['contacts', 'world', 'calls']) {
      expect(document.querySelector(`[data-arkme-home-tour-target="${tab}"]`)).not.toBeNull()
    }
    expect(document.querySelector('input')).toBe(input)
    expect(input.value).toBe('保留草稿')
    expect(document.querySelector('main')!.style.opacity).toBe('')
  })
  it('reveals the complete first frame together and retains the same editor on background refresh', async () => {
    let finish!: (value: unknown) => void
    api.pending = new Promise(resolve => { finish = resolve })
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    await domAct(async () => { mountSurface() })
    const surface = document.querySelector('main')!
    const input = document.querySelector('input')!
    expect(surface.style.opacity).toBe('0')
    expect(surface.hasAttribute('inert')).toBe(true)
    expect(surface.getAttribute('aria-hidden')).toBe('true')
    await domAct(async () => { finish({ userId: 42, allowed: true }); await api.pending })
    expect(surface.style.opacity).toBe('')
    expect(surface.style.display).toBe('flex')
    expect(surface.hasAttribute('inert')).toBe(false)
    expect(surface.hasAttribute('aria-hidden')).toBe(false)
    for (const tab of ['recordings', 'calendar', 'contacts', 'world', 'calls']) {
      expect(surface.querySelector(`[data-arkme-home-tour-target="${tab}"]`)).not.toBeNull()
    }
    api.pending = undefined; api.allowed = null
    await domAct(async () => { await socialAccessStore.refresh() })
    expect(document.querySelector('input')).toBe(input)
    expect(input.value).toBe('保留草稿')
    expect(surface.style.opacity).toBe('')
  })
  it('restores a qualified account before paint without waiting for the network', async () => {
    new SocialAccessSnapshotStorage().write('test:42', true)
    api.pending = new Promise(() => {})
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    await domAct(async () => { mountSurface() })
    expect(document.querySelector('main')!.style.opacity).toBe('')
    expect(document.querySelector('[data-arkme-home-tour-target="contacts"]')).not.toBeNull()
    expect(document.querySelector('input')!.value).toBe('保留草稿')
  })
  it('releases personal content after first failure without inventing social permission', async () => {
    api.allowed = null
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    await domAct(async () => { mountSurface() })
    expect(document.querySelector('main')!.style.opacity).toBe('')
    expect(document.querySelector('[data-arkme-home-tour-target="recordings"]')).not.toBeNull()
    expect(document.querySelector('[data-arkme-home-tour-target="contacts"]')).toBeNull()
  })
  it('bounds a hung first request and allows a later retry', async () => {
    api.pending = new Promise(() => {})
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    await domAct(async () => { mountSurface() })
    expect(document.querySelector('main')!.style.opacity).toBe('0')
    await domAct(async () => { await socialAccessStore.refresh() })
    expect(document.querySelector('main')!.style.opacity).toBe('')
    expect(document.querySelector('[data-arkme-home-tour-target="contacts"]')).toBeNull()
    api.pending = undefined; api.allowed = true
    await domAct(async () => { await socialAccessStore.refresh() })
    expect(document.querySelector('[data-arkme-home-tour-target="contacts"]')).not.toBeNull()
  })
  it('loads the official contact after eligibility resolves without reauthenticating', async () => {
    api.allowed = false
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    await act(async () => { renderer = create(<ArkmeNavigation active />) })
    expect(api.calls).not.toHaveBeenCalledWith('chat.official-author.profile')
    api.allowed = true
    await act(async () => { await socialAccessStore.refresh() })
    expect(api.calls).toHaveBeenCalledWith('chat.official-author.profile')
    expect(arkmeAuthStore.getSnapshot().auth).toMatchObject({ status: 'authenticated', userId: 42 })
  })
  it('starts receiver and intent polling only while qualified, stops on loss without logging out', async () => {
    vi.useFakeTimers()
    api.allowed = false
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    await domAct(async () => { const container = document.createElement('div'); document.body.append(container); callRoot = createRoot(container); callRoot.render(<ArkmeOutgoingCallHost />) })
    await domAct(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(api.calls.mock.calls.filter(([op]) => op.startsWith('calls.'))).toEqual([])
    api.allowed = true
    await domAct(async () => { await socialAccessStore.refresh() })
    expect(api.calls).toHaveBeenCalledWith('calls.outgoing.intent.claim')
    api.allowed = null
    await domAct(async () => { await socialAccessStore.refresh() })
    api.calls.mockClear()
    await domAct(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(api.calls).toHaveBeenCalledWith('calls.outgoing.intent.claim')
    api.allowed = false
    await domAct(async () => { await socialAccessStore.refresh() })
    api.calls.mockClear()
    await domAct(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(api.calls.mock.calls.filter(([op]) => op.startsWith('calls.'))).toEqual([])
    expect(document.querySelector('iframe')).toBe(null)
    expect(arkmeAuthStore.getSnapshot().auth).toMatchObject({ status: 'authenticated', userId: 42 })
  })
  it('hides before resolution and on denial, retains confirmed navigation on refresh failure', async () => {
    let resolve!: (value: unknown) => void
    api.pending = new Promise(done => { resolve = done })
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    act(() => { renderer = create(<ArkmeProductNavigation compact={false} />) })
    expect(labels()).not.toEqual(expect.arrayContaining(['contacts', 'world', 'calls']))
    await act(async () => { resolve({ userId: 42, allowed: false }); await api.pending })
    expect(labels()).toContain('recordings')
    expect(labels()).toContain('calendar')
    expect(labels()).not.toContain('contacts')
    api.pending = undefined; api.allowed = true
    await act(async () => { window.dispatchEvent(new Event('focus')); await socialAccessStore.refresh() })
    expect(labels()).toEqual(expect.arrayContaining(['contacts', 'world', 'calls']))
    api.allowed = null
    await act(async () => { window.dispatchEvent(new Event('focus')); await socialAccessStore.refresh() })
    expect(labels()).toEqual(expect.arrayContaining(['contacts', 'world', 'calls']))
    api.allowed = false
    await act(async () => { await socialAccessStore.refresh() })
    expect(labels()).not.toContain('world')
    expect(arkmeAuthStore.getSnapshot().auth).toMatchObject({ status: 'authenticated', userId: 42 })
  })

  it('keeps anonymous surfaces without querying phone eligibility', async () => {
    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
    await act(async () => { renderer = create(<ArkmeProductNavigation compact={false} locked />) })
    expect(labels()).toEqual(expect.arrayContaining(['contacts', 'world', 'calls']))
    expect(api.calls.mock.calls.some(([operation]) => operation === 'social.access')).toBe(false)
  })
})
