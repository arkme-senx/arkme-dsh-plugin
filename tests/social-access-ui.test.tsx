// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeProductNavigation } from '../src/client/ArkmeProductNavigation.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { socialAccessStore } from '../src/client/social-access-store.js'
import { createRoot, type Root } from 'react-dom/client'
import { act as domAct } from 'react-dom/test-utils'
import { ArkmeOutgoingCallHost } from '../src/client/ArkmeOutgoingCallHost.js'

const api = vi.hoisted(() => ({ allowed: false as boolean | null, calls: vi.fn(), pending: undefined as undefined | Promise<unknown> }))
vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(),
  callArkme: async (operation: string) => {
    api.calls(operation)
    if (operation === 'social.access') return api.pending ?? { userId: 42, allowed: api.allowed }
    if (operation === 'user.profile' || operation === 'user.profile.refresh') return { profile: null }
    if (operation === 'calls.outgoing.intent.claim') return null
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
  vi.useRealTimers()
})
const labels = () => renderer!.root.findAllByType('button').map(button => button.props['data-arkme-home-tour-target']).filter(Boolean)

describe('real social presentation lifecycle', () => {
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
