import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: api.read, ArkmeClientError: class extends Error {} }))
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { socialAccessStore } from '../src/client/social-access-store.js'

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => { renderer?.unmount() }); renderer = undefined
  socialAccessStore.activate(undefined); arkmeUi.showLogin(); api.read.mockReset()
})

it.each(['world', 'private_chat', 'group_chat'] as const)('retains the selected %s while startup eligibility is unresolved', async target => {
  let finish!: (value: unknown) => void
  const pending = new Promise(resolve => { finish = resolve })
  api.read.mockImplementation(async (operation: string) => {
    if (operation === 'social.access') return pending
    if (operation.startsWith('user.profile')) return { profile: null }
    return {}
  })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  if (target === 'world') arkmeUi.showWorld()
  else arkmeUi.selectSource({ sourceRef: 'selected', sourceKey: 'chat:selected', kind: target,
    displayName: '原会话', activeAtMillis: 1, unreadCount: 0, latestSequence: 1 })
  await act(async () => { renderer = create(<ArkmeSurface productChrome={false} active={false} />) })
  const selected = arkmeUi.getSnapshot()
  expect(selected.mode).toBe(target === 'world' ? 'world' : 'source')
  if (target !== 'world') expect(selected.selectedSource?.sourceRef).toBe('selected')
  await act(async () => { finish({ userId: 42, allowed: true }); await pending })
  expect(arkmeUi.getSnapshot().mode).toBe(selected.mode)
  expect(arkmeUi.getSnapshot().selectedSource).toBe(selected.selectedSource)
  api.read.mockResolvedValueOnce({ userId: 42, allowed: false })
  await act(async () => { await socialAccessStore.refresh() })
  expect(arkmeUi.getSnapshot().mode).not.toBe('world')
  expect(arkmeUi.getSnapshot().selectedSource?.sourceRef).not.toBe('selected')
})
