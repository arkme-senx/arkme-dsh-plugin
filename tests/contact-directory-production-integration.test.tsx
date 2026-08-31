import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType, ReactElement } from 'react'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeContactsTab } from '../src/client/redesign/contacts/contacts-tab-store.js'

const testState = vi.hoisted(() => ({ callArkme: vi.fn() }))
const mountedRenderers = new Set<ReactTestRenderer>()
vi.mock('../src/client/api.js', () => ({ callArkme: testState.callArkme }))
vi.mock('../src/client/ArkmeSidebar.js', () => ({
  ArkmeSurface: ({ active }: { active?: boolean }) => <div
    data-test-conversation-surface
    data-test-conversation-active={active === false ? 'false' : 'true'}
  >original conversation surface</div>,
}))
vi.mock('../src/client/ArkmeVirtualWorkspace.js', () => ({
  ArkmeNavigation: () => <nav aria-label="Arkme 会话列表" data-test-original-navigation>original navigation tree</nav>,
}))

import { apply } from '../src/client/index.js'
import { createClientLocaleStub } from './client-locale-stub.js'

type Registered = { name: string; component: ComponentType<Record<string, unknown>> }

function text(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : text(child)).join('')
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const result = renderer.root.findAllByType('button').find(node => text(node).includes(label))
  if (result === undefined) throw new Error(`button not found: ${label}`)
  return result
}

function mount(element: ReactElement): ReactTestRenderer {
  const renderer = create(element)
  mountedRenderers.add(renderer)
  return renderer
}

function applyProductionSeats(): Map<string, ComponentType<Record<string, unknown>>> {
  const registered: Registered[] = []
  apply({
    slots: {
      inject: (_key: string, register: () => (() => void)) => register(),
      register: (options: { name: string }, component: ComponentType<Record<string, unknown>>) => {
        registered.push({ name: options.name, component })
        return () => undefined
      },
    },
    layout: { toggleSidebar: vi.fn(), closeDetails: vi.fn() },
    locale: createClientLocaleStub(),
    effect: (factory: () => unknown, label: string) => {
      if (label.includes('official settings sidebar') || label.includes('conversation seats')) factory()
      return () => undefined
    },
  } as never)
  return new Map(registered.map(entry => [entry.name, entry.component]))
}

beforeEach(() => {
  class FakeEventSource { onopen: (() => void) | null = null; onmessage: ((event: MessageEvent) => void) | null = null; close() {} }
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('window', {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    location: { origin: 'http://localhost', search: '', hash: '', pathname: '/' }, history: { replaceState: vi.fn() },
  })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 101 })
  arkmeContactsTab.activateAccount('test:101')
  arkmeContactsTab.clear()
  arkmeUi.showConversations()
  testState.callArkme.mockReset()
  testState.callArkme.mockImplementation(async (operation: string, params?: { section?: string }) => {
    if (operation === 'auth.status') return { status: 'authenticated', environment: 'test', userId: 101 }
    if (operation === 'auth.config') return { environment: 'test' }
    if (operation === 'sources.list') return { items: [], hasMore: false }
    if (operation === 'directory.list' && params?.section === 'groups') return { section: 'groups', items: [{ kind: 'group', sourceRef: 'group-1', displayName: '测试群' }], total: 1, hasMore: false }
    if (operation === 'directory.list' && params?.section === 'contacts') return { section: 'contacts', items: [{ kind: 'contact', contactRef: 'contact-1', displayName: '选择联系人', nickname: '选择联系人', remark: '', letter: 'X' }], total: 1, hasMore: false }
    if (operation === 'directory.list' && params?.section !== undefined) return { section: params.section, items: [], total: 0, hasMore: false }
    if (operation === 'directory.contact.profile') return {
      contactRef: 'contact-1', displayName: '选择联系人', nickname: '选择联系人', remark: '',
    }
    if (operation === 'directory.contact.world') return { items: [], total: 0, hasMore: false }
    if (operation === 'user.profile' || operation === 'user.profile.refresh') return { profile: null }
    return {}
  })
})

afterEach(() => {
  for (const renderer of mountedRenderers) renderer.unmount()
  mountedRenderers.clear()
  vi.unstubAllGlobals()
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  arkmeContactsTab.activateAccount(undefined)
  arkmeUi.showLogin()
  vi.clearAllMocks()
})

describe('production sibling Contacts tab', () => {
  it('uses real apply slots: conversations remain unmodified until the sibling Contacts tab enters contacts mode', async () => {
    const seats = applyProductionSeats()
    const Sidebar = seats.get('sidebar')
    const Workspace = seats.get('conversation')
    if (Sidebar === undefined || Workspace === undefined) throw new Error('apply did not register persistent seats')
    const sessions = { current: 'session-1', ids: [], byId: {} }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = mount(<>
        <Sidebar collapsed={false} useSessions={(select: (state: typeof sessions) => unknown) => select(sessions)} renderSlot={() => null} collapseSidebar={vi.fn()} closeDetails={vi.fn()} />
        <Workspace sessionId="session-1" closeDetails={vi.fn()} />
      </>)
      await Promise.resolve()
    })

    expect(renderer.root.findByProps({ 'aria-label': 'Arkme 会话列表' })).toBeDefined()
    expect(renderer.root.findByProps({ 'data-test-conversation-surface': true })).toBeDefined()
    expect(renderer.root.findAllByProps({ 'aria-label': '联系人目录' })).toHaveLength(0)
    expect(renderer.root.findByProps({ 'data-arkme-owned': 'persistent-sidebar' }).props['data-arkme-contacts-mobile-view']).toBeUndefined()
    expect(renderer.root.findByProps({ 'data-arkme-owned': 'persistent-workspace' }).props['data-arkme-contacts-mobile-view']).toBeUndefined()
    const conversationSurface = renderer.root.findByProps({ 'data-test-conversation-surface': true })
    expect(conversationSurface.props['data-test-conversation-active']).toBe('true')

    const contacts = button(renderer, '联系人')
    await act(async () => { contacts.props.onClick(); await Promise.resolve() })
    expect(contacts.props['aria-current']).toBe('page')
    expect(renderer.root.findByProps({ 'aria-label': '联系人目录' })).toBeDefined()
    const brandImages = renderer.root.findByProps({ 'data-arkme-contacts-workspace': true }).findAllByProps({ alt: 'Arkme' })
    expect(brandImages).toHaveLength(2)
    expect(brandImages.map(image => image.props['data-arkme-theme-image'])).toEqual(['light', 'dark'])
    const hiddenConversationSurface = renderer.root.findByProps({ 'data-test-conversation-surface': true })
    const hiddenConversationLayer = renderer.root.findByProps({ 'data-arkme-owned': 'arkme-conversation-layer' })
    expect(hiddenConversationSurface).toBe(conversationSurface)
    expect(hiddenConversationSurface.props['data-test-conversation-active']).toBe('false')
    expect(hiddenConversationLayer.props).toMatchObject({
      'aria-hidden': true,
      style: expect.objectContaining({ visibility: 'hidden', pointerEvents: 'none', zIndex: 0 }),
    })
    expect(renderer.root.findByProps({ 'data-arkme-contacts-workspace': true }).props.style)
      .toEqual(expect.objectContaining({ position: 'absolute', inset: 0, zIndex: 2 }))

    await act(async () => { button(renderer, '对话').props.onClick(); await Promise.resolve() })
    expect(renderer.root.findByProps({ 'data-test-conversation-surface': true })).toBe(conversationSurface)
    expect(conversationSurface.props['data-test-conversation-active']).toBe('true')
    expect(renderer.root.findAllByProps({ 'data-arkme-contacts-workspace': true })).toHaveLength(0)
  })

  it('uses the AppFrame seats as a single narrow Contacts view and retains section folds across a conversations round trip', async () => {
    const seats = applyProductionSeats()
    const Sidebar = seats.get('sidebar')
    const Workspace = seats.get('conversation')
    if (Sidebar === undefined || Workspace === undefined) throw new Error('apply did not register persistent seats')
    const sessions = { current: 'session-1', ids: [], byId: {} }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = mount(<div style={{ gridTemplateColumns: '56px minmax(0, 1fr) 0px' }}>
        <Sidebar collapsed useSessions={(select: (state: typeof sessions) => unknown) => select(sessions)} renderSlot={() => null} collapseSidebar={vi.fn()} closeDetails={vi.fn()} />
        <Workspace sessionId="session-1" closeDetails={vi.fn()} />
        <div data-shell-overlay />
      </div>)
      await Promise.resolve()
    })
    await act(async () => { button(renderer, '联系人').props.onClick(); await Promise.resolve() })
    expect(renderer.root.findByProps({ 'data-arkme-owned': 'persistent-sidebar' }).props['data-arkme-contacts-mobile-view']).toBe('directory')
    expect(renderer.root.findByProps({ 'data-arkme-owned': 'persistent-workspace' }).props['data-arkme-contacts-mobile-view']).toBe('directory')
    await act(async () => { button(renderer, '选择联系人').props.onClick(); await Promise.resolve() })
    expect(renderer.root.findByProps({ 'data-arkme-owned': 'persistent-sidebar' }).props['data-arkme-contacts-mobile-view']).toBe('content')
    expect(renderer.root.findByProps({ 'data-arkme-owned': 'persistent-workspace' }).props['data-arkme-contacts-mobile-view']).toBe('content')
    await act(async () => { button(renderer, '返回联系人目录').props.onClick(); await Promise.resolve() })
    expect(renderer.root.findByProps({ 'data-arkme-owned': 'persistent-sidebar' }).props['data-arkme-contacts-mobile-view']).toBe('directory')
    expect(renderer.root.findByProps({ 'data-arkme-owned': 'persistent-workspace' }).props['data-arkme-contacts-mobile-view']).toBe('directory')
    arkmeContactsTab.setSectionExpanded('groups', true)
    await act(async () => { button(renderer, '对话').props.onClick(); await Promise.resolve() })
    await act(async () => { button(renderer, '联系人').props.onClick(); await Promise.resolve() })
    expect(arkmeContactsTab.getSnapshot().selection).toEqual({ kind: 'none' })
    expect(arkmeContactsTab.getSnapshot().expandedSections.groups).toBe(true)
  })

  it('restores cached directory rows immediately without reloading the same fresh Contacts page', async () => {
    const seats = applyProductionSeats()
    const Sidebar = seats.get('sidebar')
    const Workspace = seats.get('conversation')
    if (Sidebar === undefined || Workspace === undefined) throw new Error('apply did not register persistent seats')
    const sessions = { current: 'session-1', ids: [], byId: {} }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = mount(<>
        <Sidebar collapsed={false} useSessions={(select: (state: typeof sessions) => unknown) => select(sessions)} renderSlot={() => null} collapseSidebar={vi.fn()} closeDetails={vi.fn()} />
        <Workspace sessionId="session-1" closeDetails={vi.fn()} />
      </>)
      await Promise.resolve()
    })

    await act(async () => { button(renderer, '联系人').props.onClick(); await Promise.resolve() })
    expect(button(renderer, '选择联系人')).toBeDefined()
    const fullDirectoryLoads = () => testState.callArkme.mock.calls.filter(([operation, params]) => {
      const request = params as { section?: string; countOnly?: boolean } | undefined
      return operation === 'directory.list' && request?.countOnly !== true
    }).map(([, params]) => (params as { section: string }).section)
    expect(fullDirectoryLoads()).toEqual(['groups', 'bots', 'unmarked-speakers', 'teams', 'contacts'])

    await act(async () => { button(renderer, '对话').props.onClick() })
    await act(async () => { button(renderer, '联系人').props.onClick() })

    expect(button(renderer, '选择联系人')).toBeDefined()
    expect(fullDirectoryLoads()).toEqual(['groups', 'bots', 'unmarked-speakers', 'teams', 'contacts'])
  })

})
