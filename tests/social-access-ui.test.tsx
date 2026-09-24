// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeProductNavigation } from '../src/client/ArkmeProductNavigation.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { socialAccessStore, loadSocialAccess } from '../src/client/social-access-store.js'

const api = vi.hoisted(() => ({ phone: '138****0000' as string | undefined, calls: vi.fn(), pending: undefined as Promise<unknown> | undefined, fail: false, stale: false }))
vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(),
  callArkme: async (operation: string) => {
    api.calls(operation)
    if (operation.startsWith('user.profile')) {
      if (api.fail) throw new Error('offline')
      return api.pending ?? { profile: api.stale && operation === 'user.profile' ? null : { userId: 42, displayName: '用户', contact: { phoneMasked: api.phone } }, cachedAtMillis: Date.now() }
    }
    return {}
  },
}))
let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined
  socialAccessStore.activate(undefined)
  localStorage.clear()
  api.calls.mockClear(); api.pending = undefined; api.fail = false; api.stale = false; api.phone = '138****0000'
})
const labels = () => renderer!.root.findAllByType('button').map(button => button.props['data-arkme-home-tour-target']).filter(Boolean)
const expectSocial = (visible: boolean) => {
  for (const name of ['contacts', 'world', 'calls']) expect(labels().includes(name)).toBe(visible)
}
const mount = async () => {
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  await act(async () => { renderer = create(<main><ArkmeProductNavigation compact={false} /><input defaultValue="保留草稿" /></main>) })
}
describe('social UI without service restrictions', () => {
  it('shows complete bound navigation immediately while the profile is pending', async () => {
    let finish!: (value: unknown) => void
    api.pending = new Promise(resolve => { finish = resolve })
    await mount()
    expectSocial(true)
    const input = renderer!.root.findByType('input')
    await act(async () => { finish({ profile: { userId: 42, contact: { phoneMasked: '138****0000' } }, cachedAtMillis: Date.now() }); await api.pending })
    expectSocial(true)
    expect(renderer!.root.findByType('input')).toBe(input)
    expect(api.calls.mock.calls.every(([name]) => name !== 'social.access')).toBe(true)
  })
  it('hides known unbound navigation and restores it after account update without remounting personal UI', async () => {
    api.phone = undefined
    await mount(); expectSocial(false)
    const input = renderer!.root.findByType('input')
    api.phone = '138****0000'
    await act(async () => { await socialAccessStore.refresh() })
    expectSocial(true)
    expect(renderer!.root.findByType('input')).toBe(input)
  })
  it.each([true, false])('failed refresh preserves previously confirmed bound=%s', async bound => {
    api.phone = bound ? '138****0000' : undefined
    await mount(); expectSocial(bound)
    api.fail = true
    await act(async () => { await socialAccessStore.refresh() })
    expectSocial(bound)
  })
  it('first profile failure keeps normal navigation available', async () => {
    api.fail = true
    await mount(); expectSocial(true)
  })
  it('does not reuse another account restriction', async () => {
    api.phone = undefined
    await mount(); expectSocial(false)
    api.fail = true
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 }) })
    expectSocial(true)
  })
  it('uses the existing cache and fetches only when no profile exists', async () => {
    await loadSocialAccess(new AbortController().signal)
    expect(api.calls.mock.calls.map(([name]) => name)).toEqual(['user.profile'])
    api.calls.mockClear(); api.stale = true
    await loadSocialAccess(new AbortController().signal)
    expect(api.calls.mock.calls.map(([name]) => name)).toEqual(['user.profile', 'user.profile.refresh'])
  })
})
