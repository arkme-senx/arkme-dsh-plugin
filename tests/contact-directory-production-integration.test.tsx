import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType, ReactElement } from 'react'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeContactsTab } from '../src/client/redesign/contacts/contacts-tab-store.js'

const testState = vi.hoisted(() => ({ callArkme: vi.fn() }))
const mountedRenderers = new Set<ReactTestRenderer>()
vi.mock('../src/client/api.js', () => ({ callArkme: testState.callArkme, ArkmeClientError: class extends Error {} }))
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
    if (operation === 'calls.outgoing.intent.claim') return null
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

afterEach(async () => {
  await act(async () => { for (const renderer of mountedRenderers) renderer.unmount() })
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


it('saves a remark through real sibling seats and immediately updates the selected directory row and cached round trip', async () => {
  const original = testState.callArkme.getMockImplementation()!
  testState.callArkme.mockImplementation(async (operation, params) => operation === 'directory.contact.remark.update'
    ? { contactRef: params.contactRef, remark: params.remark, displayName: params.remark, nickname: '选择联系人' }
    : original(operation, params))
  const seats = applyProductionSeats()
  const Sidebar = seats.get('sidebar')!
  const Workspace = seats.get('conversation')!
  const sessions = { current: 'session-1', ids: [], byId: {} }
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = mount(<><Sidebar collapsed={false} useSessions={(select: (s: typeof sessions) => unknown) => select(sessions)} renderSlot={() => null} collapseSidebar={vi.fn()} closeDetails={vi.fn()} /><Workspace sessionId="session-1" closeDetails={vi.fn()} /></>)
  })
  await act(async () => { button(renderer, '联系人').props.onClick() })
  await act(async () => { button(renderer, '选择联系人').props.onClick() })
  await act(async () => { button(renderer, '编辑').props.onClick() })
  await act(async () => { renderer.root.findByProps({ placeholder: '输入备注名' }).props.onChange({ target: { value: '设计同事' } }) })
  await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(text(renderer.root.findByType('h1'))).toBe('设计同事')
  expect(text(renderer.root.findByProps({ 'data-directory-row-ref': 'contact-1' }))).toBe('设计同事')
  expect(arkmeContactsTab.getSnapshot().selection).toEqual({ kind: 'contact', contactRef: 'contact-1' })
  await act(async () => { button(renderer, '对话').props.onClick() })
  await act(async () => { button(renderer, '联系人').props.onClick() })
  expect(text(renderer.root.findByProps({ 'data-directory-row-ref': 'contact-1' }))).toBe('设计同事')
})

it.each(['close', 'escape', 'backdrop'])('keeps the Contacts page, search and selection mounted when dismissing contact add via %s', async dismissal => {
  const Sidebar = applyProductionSeats().get('sidebar')!
  const sessions = { current: 'session-1', ids: [], byId: {} }
  let renderer!: ReactTestRenderer
  await act(async () => {
    arkmeUi.showContacts()
    renderer = mount(<Sidebar collapsed={false} useSessions={(select: (state: typeof sessions) => unknown) => select(sessions)} renderSlot={() => null} collapseSidebar={vi.fn()} closeDetails={vi.fn()} />)
  })
  await act(async () => { button(renderer, '选择联系人').props.onClick() })
  const inputs = renderer.root.findAllByType('input').filter(node => node.props.placeholder === '搜索联系人')
  expect(inputs).toHaveLength(1)
  await act(async () => { inputs[0]!.props.onChange({ currentTarget: { value: '选择' } }) })
  const directory = renderer.root.findByProps({ 'aria-label': '联系人目录' })
  expect(text(directory)).toContain('选择联系人')
  expect(text(directory)).not.toContain('测试群')
  await act(async () => { renderer.root.findByProps({ 'aria-label': '添加联系人、群聊或 Bot' }).props.onClick() })
  const menu = renderer.root.findByProps({ role: 'menu', 'aria-label': '添加' })
  expect(menu.findAllByProps({ role: 'menuitem' }).map(text)).toEqual(['添加联系人', '创建群聊', '添加 Bot'])
  await act(async () => { menu.findAllByProps({ role: 'menuitem' })[0]!.props.onClick() })
  expect(arkmeUi.getSnapshot()).toMatchObject({ mode: 'source', productMode: 'contacts' })
  expect(renderer.root.findByProps({ 'aria-label': '联系人目录' })).toBe(directory)
  expect(inputs[0]!.props.value).toBe('选择')
  expect(arkmeContactsTab.getDirectoryCache('test:101')).toBeDefined()
  const loads = testState.callArkme.mock.calls.filter(([op]) => op === 'directory.list').length
  await act(async () => {
    const dialog = renderer.root.findByProps({ role: 'dialog' })
    if (dismissal === 'close') renderer.root.findByProps({ 'aria-label': '关闭添加联系人' }).props.onClick()
    else if (dismissal === 'escape') dialog.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
    else { const target = {}; dialog.parent!.props.onMouseDown({ target, currentTarget: target }) }
  })
  expect(arkmeContactsTab.getSnapshot().selection).toEqual({ kind: 'contact', contactRef: 'contact-1' })
  expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  expect(renderer.root.findByProps({ 'aria-label': '联系人目录' })).toBe(directory)
  expect(inputs[0]!.props.value).toBe('选择')
  expect(testState.callArkme.mock.calls.filter(([op]) => op === 'directory.list')).toHaveLength(loads)
})

it('adds through the real Contacts dialog, refreshes matching counts and keeps a selected contact beyond the first page', async () => {
  const original = testState.callArkme.getMockImplementation()!
  let added = false
  let finishRefresh!: (page: unknown) => void
  testState.callArkme.mockImplementation(async (operation, params) => {
    if (operation === 'contacts.search') return {
      contactRef: 'contact-2', displayName: '选择新联系人', identifierKind: 'arkme_id',
      registered: true, canAdd: true, isSelf: false, inviteBySms: false,
    }
    if (operation === 'contacts.add') {
      added = true
      return { state: 'ready', source: { sourceRef: 'new-chat', kind: 'private_chat', displayName: '选择新联系人' } }
    }
    if (added && operation === 'directory.list' && params.section === 'contacts') {
      if (params.cursor === 'next-page') return await new Promise(resolve => { finishRefresh = resolve })
      return { section: 'contacts', items: [{ kind: 'contact', contactRef: 'contact-2', displayName: '选择新联系人', nickname: '选择新联系人', remark: '', letter: 'X' }], total: 2, hasMore: true, nextCursor: 'next-page' }
    }
    return original(operation, params)
  })
  const seats = applyProductionSeats()
  const Sidebar = seats.get('sidebar')!
  const Workspace = seats.get('conversation')!
  const sessions = { current: 'session-1', ids: [], byId: {} }
  let renderer!: ReactTestRenderer
  await act(async () => {
    arkmeUi.showContacts()
    renderer = mount(<><Sidebar collapsed={false} useSessions={(select: (state: typeof sessions) => unknown) => select(sessions)} renderSlot={() => null} collapseSidebar={vi.fn()} closeDetails={vi.fn()} /><Workspace sessionId="session-1" closeDetails={vi.fn()} /></>)
  })
  await act(async () => { button(renderer, '选择联系人').props.onClick() })
  const directory = renderer.root.findByProps({ 'aria-label': '联系人目录' })
  const search = renderer.root.findByProps({ placeholder: '搜索联系人' })
  await act(async () => { search.props.onChange({ currentTarget: { value: '选择' } }) })
  await act(async () => { renderer.root.findByProps({ 'aria-label': '添加联系人、群聊或 Bot' }).props.onClick() })
  await act(async () => { renderer.root.findByProps({ role: 'menu', 'aria-label': '添加' }).findAllByProps({ role: 'menuitem' })[0]!.props.onClick() })
  expect(arkmeContactsTab.getSnapshot().selection).toEqual({ kind: 'contact', contactRef: 'contact-1' })
  const dialog = renderer.root.findByProps({ role: 'dialog' })
  await act(async () => { dialog.findByProps({ placeholder: '输入手机号或即我号' }).props.onChange({ target: { value: 'friend123' } }) })
  await act(async () => { dialog.findByType('form').props.onSubmit({ preventDefault() {} }) })
  await act(async () => { dialog.findAllByType('button').find(node => text(node) === '添加联系人')!.props.onClick() })
  expect(testState.callArkme).toHaveBeenCalledWith('contacts.add', expect.objectContaining({ contactRef: 'contact-2' }))
  expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  expect(arkmeUi.getSnapshot()).toMatchObject({ mode: 'source', productMode: 'contacts' })
  expect(arkmeContactsTab.getSnapshot().selection).toEqual({ kind: 'contact', contactRef: 'contact-1' })
  expect(text(renderer.root.findByType('h1'))).toBe('选择联系人')
  await act(async () => { finishRefresh(await original('directory.list', { section: 'contacts' })) })
  expect(renderer.root.findByProps({ 'aria-label': '联系人目录' })).toBe(directory)
  expect(search.props.value).toBe('选择')
  expect(text(directory)).toContain('联系人2')
  expect(text(directory)).toContain('选择新联系人')
  expect(arkmeContactsTab.getSnapshot().selection).toEqual({ kind: 'contact', contactRef: 'contact-1' })
})


it.each(['reopen', 'account-change', 'tab-change', 'failure'])('handles a pending contact add after %s without changing the Contacts route', async scenario => {
  const original = testState.callArkme.getMockImplementation()!
  let finishAdd!: (result: unknown) => void
  let rejectAdd!: (reason: Error) => void
  testState.callArkme.mockImplementation(async (operation, params) => {
    if (operation === 'contacts.search') return { contactRef: 'contact-2', displayName: '新联系人', registered: true, canAdd: true, isSelf: false }
    if (operation === 'contacts.add') return await new Promise((resolve, reject) => { finishAdd = resolve; rejectAdd = reject })
    return original(operation, params)
  })
  const Sidebar = applyProductionSeats().get('sidebar')!
  const sessions = { current: 'session-1', ids: [], byId: {} }
  let renderer!: ReactTestRenderer
  await act(async () => {
    arkmeUi.showContacts()
    renderer = mount(<Sidebar collapsed={false} useSessions={(select: (state: typeof sessions) => unknown) => select(sessions)} renderSlot={() => null} collapseSidebar={vi.fn()} closeDetails={vi.fn()} />)
  })
  const open = async () => {
    await act(async () => { renderer.root.findByProps({ 'aria-label': '添加联系人、群聊或 Bot' }).props.onClick() })
    await act(async () => { renderer.root.findByProps({ role: 'menu', 'aria-label': '添加' }).findAllByProps({ role: 'menuitem' })[0]!.props.onClick() })
  }
  await open()
  const dialog = renderer.root.findByProps({ role: 'dialog' })
  await act(async () => { dialog.findByProps({ placeholder: '输入手机号或即我号' }).props.onChange({ target: { value: 'friend123' } }) })
  await act(async () => { dialog.findByType('form').props.onSubmit({ preventDefault() {} }) })
  await act(async () => { dialog.findAllByType('button').find(node => text(node) === '添加联系人')!.props.onClick() })
  if (scenario === 'reopen') {
    await act(async () => { renderer.root.findByProps({ 'aria-label': '关闭添加联系人' }).props.onClick() })
    await open()
  } else if (scenario === 'tab-change') {
    await act(async () => { renderer.root.findByProps({ 'aria-label': '关闭添加联系人' }).props.onClick() })
    await act(async () => { button(renderer, '对话').props.onClick() })
  } else if (scenario === 'account-change') {
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 102 }) })
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  }
  const loads = testState.callArkme.mock.calls.filter(([op]) => op === 'directory.list').length
  await act(async () => {
    if (scenario === 'failure') rejectAdd(new Error('添加失败，请重试'))
    else finishAdd({ state: 'ready', source: { sourceRef: 'new-chat', kind: 'private_chat', displayName: '新联系人' } })
  })
  if (scenario !== 'tab-change') expect(arkmeUi.getSnapshot()).toMatchObject({ mode: 'source', productMode: 'contacts' })
  if (scenario === 'tab-change') {
    expect(arkmeContactsTab.getDirectoryCache('test:101')).toBeUndefined()
    expect(arkmeUi.getSnapshot().productMode).not.toBe('contacts')
    await act(async () => { button(renderer, '联系人').props.onClick() })
    expect(testState.callArkme.mock.calls.filter(([op]) => op === 'directory.list').length).toBeGreaterThan(loads)
  } else if (scenario === 'reopen') {
    expect(renderer.root.findByProps({ role: 'dialog' })).not.toBe(dialog)
    expect(testState.callArkme.mock.calls.filter(([op]) => op === 'directory.list')).toHaveLength(loads + 1)
  } else if (scenario === 'failure') {
    expect(renderer.root.findByProps({ role: 'dialog' })).toBe(dialog)
    expect(text(dialog)).toContain('添加失败，请重试')
    expect(testState.callArkme.mock.calls.filter(([op]) => op === 'directory.list')).toHaveLength(loads)
  } else {
    expect(arkmeContactsTab.getSnapshot().accountKey).toBe('test:102')
    expect(testState.callArkme.mock.calls.filter(([op]) => op === 'directory.list')).toHaveLength(loads)
  }
})


it('accepts a later server directory refresh after a local remark save on a stable reference', async () => {
  const original = testState.callArkme.getMockImplementation()!
  let externalUpdate = false
  testState.callArkme.mockImplementation(async (operation, params) => {
    if (operation === 'directory.contact.remark.update') return { contactRef: 'contact-1', nickname: '选择联系人', displayName: params.remark, remark: params.remark }
    if (externalUpdate && operation === 'directory.list' && params.section === 'contacts') return {
      section: 'contacts', items: [{ kind: 'contact', contactRef: 'contact-1', displayName: '别端新备注', nickname: '新昵称', remark: '别端新备注', letter: 'B' }], total: 1, hasMore: false,
    }
    return original(operation, params)
  })
  const seats = applyProductionSeats()
  const Sidebar = seats.get('sidebar')!
  const Workspace = seats.get('conversation')!
  const sessions = { current: 'session-1', ids: [], byId: {} }
  let renderer!: ReactTestRenderer
  await act(async () => {
    arkmeUi.showContacts()
    renderer = mount(<><Sidebar collapsed={false} useSessions={(select: (s: typeof sessions) => unknown) => select(sessions)} renderSlot={() => null} collapseSidebar={vi.fn()} closeDetails={vi.fn()} /><Workspace sessionId="session-1" closeDetails={vi.fn()} /></>)
  })
  await act(async () => { button(renderer, '选择联系人').props.onClick() })
  await act(async () => { button(renderer, '编辑').props.onClick() })
  await act(async () => { renderer.root.findByProps({ placeholder: '输入备注名' }).props.onChange({ target: { value: '本地备注' } }) })
  await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  expect(text(renderer.root.findByProps({ 'data-directory-row-ref': 'contact-1' }))).toBe('本地备注')
  externalUpdate = true
  await act(async () => { button(renderer, '对话').props.onClick() })
  arkmeContactsTab.invalidateDirectoryCache()
  await act(async () => { button(renderer, '联系人').props.onClick() })
  expect(text(renderer.root.findByProps({ 'data-directory-row-ref': 'contact-1' }))).toBe('别端新备注')
  expect(arkmeContactsTab.getSnapshot().contactProfiles).toEqual({})
})
