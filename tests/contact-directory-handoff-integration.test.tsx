import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType, ReactElement } from 'react'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeContactsTab } from '../src/client/redesign/contacts/contacts-tab-store.js'
import type { ArkmeSourceItem } from '../src/types.js'

const botSummary = {
  botRef: 'bot-1', name: '测试 Bot', provider: 'webhook', description: '', status: 'online',
  directChatAvailable: true, privateChatOutboundEnabled: true, conversationProjection: 'chat',
} as const

const testState = vi.hoisted(() => ({ callArkme: vi.fn() }))
const mountedRenderers = new Set<ReactTestRenderer>()
vi.mock('../src/client/api.js', () => ({ callArkme: testState.callArkme }))
vi.mock('../src/client/ArkmeSidebar.js', () => ({
  ArkmeSurface: () => <div data-test-conversation-surface>original conversation surface</div>,
}))
vi.mock('../src/client/ArkmeVirtualWorkspace.js', () => ({
  ArkmeNavigation: () => <nav aria-label="Arkme 会话列表">original navigation tree</nav>,
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(fulfill => { resolve = fulfill })
  return { promise, resolve }
}

function productionSeats(): Map<string, ComponentType<Record<string, unknown>>> {
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

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

async function click(renderer: ReactTestRenderer, label: string): Promise<void> {
  await act(async () => { button(renderer, label).props.onClick(); await Promise.resolve() })
  await flush()
}

async function mountProductionContacts(): Promise<ReactTestRenderer> {
  const seats = productionSeats()
  const Sidebar = seats.get('sidebar')
  const Workspace = seats.get('conversation')
  if (Sidebar === undefined || Workspace === undefined) throw new Error('apply did not register persistent seats')
  const sessions = { current: 'session-1', ids: [], byId: {} }
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(<>
      <Sidebar collapsed={false} useSessions={(select: (state: typeof sessions) => unknown) => select(sessions)} renderSlot={() => null} collapseSidebar={vi.fn()} closeDetails={vi.fn()} />
      <Workspace sessionId="session-1" closeDetails={vi.fn()} />
    </>)
    mountedRenderers.add(renderer)
    await Promise.resolve()
  })
  await click(renderer, '联系人')
  return renderer
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

function installDirectoryApi(openGroup: ReturnType<typeof deferred<ArkmeSourceItem>>, openBot: ReturnType<typeof deferred<ArkmeSourceItem>>) {
  const signals: Partial<Record<'group' | 'bot', AbortSignal>> = {}
  testState.callArkme.mockImplementation(async (operation: string, params?: { section?: string; countOnly?: boolean }, signal?: AbortSignal) => {
    if (operation === 'auth.status') return { status: 'authenticated', environment: 'test', userId: 101 }
    if (operation === 'auth.config') return { environment: 'test' }
    if (operation === 'sources.list') return { items: [], hasMore: false }
    if (operation === 'directory.list') {
      const section = params?.section ?? 'contacts'
      const total = section === 'contacts' || section === 'groups' || section === 'bots' ? 1 : 0
      if (params?.countOnly === true) return { section, items: [], total, hasMore: false }
      if (section === 'contacts') return { section, items: [{ kind: 'contact', contactRef: 'contact-1', displayName: '后来选择的联系人', nickname: '后来的昵称', remark: '', letter: 'H' }], total: 1, hasMore: false }
      if (section === 'groups') return { section, items: [{ kind: 'group', sourceRef: 'group-1', displayName: '测试群聊' }], total: 1, hasMore: false }
      if (section === 'bots') return { section, items: [{
        kind: 'bot', bot: botSummary,
      }], total: 1, hasMore: false }
      return { section, items: [], total: 0, hasMore: false }
    }
    if (operation === 'directory.contact.profile') return { profile: { displayName: '后来选择的联系人', fields: [] } }
    if (operation === 'directory.contact.world') return { items: [], total: 0, hasMore: false }
    if (operation === 'directory.group.open-chat') { signals.group = signal; return await openGroup.promise }
    if (operation === 'directory.bot.open-chat') { signals.bot = signal; return await openBot.promise }
    if (operation === 'user.profile' || operation === 'user.profile.refresh') return { profile: null }
    return {}
  })
  return signals
}

describe('production Contacts handoff isolation', () => {
  it('aborts a pending group handoff when a later contact selection replaces the intent', async () => {
    const group = deferred<ArkmeSourceItem>()
    const bot = deferred<ArkmeSourceItem>()
    const signals = installDirectoryApi(group, bot)
    const renderer = await mountProductionContacts()
    await click(renderer, '群聊')
    await click(renderer, '测试群聊')
    expect(signals.group?.aborted).toBe(false)

    await click(renderer, '后来的昵称')
    expect(signals.group?.aborted).toBe(true)
    group.resolve({ sourceRef: 'group-source', kind: 'group_chat', displayName: '测试群聊', activeAtMillis: 1, unreadCount: 0 })
    await flush()

    expect(arkmeUi.getSnapshot()).toMatchObject({ mode: 'source', productMode: 'contacts' })
    expect(arkmeUi.getSnapshot().selectedSource).toBeUndefined()
    expect(arkmeContactsTab.getSnapshot().selection).toEqual({ kind: 'contact', contactRef: 'contact-1' })
  })

  it('opens a Bot directly through the Bot surface and still aborts pending group work on an environment switch', async () => {
    const group = deferred<ArkmeSourceItem>()
    const bot = deferred<ArkmeSourceItem>()
    const signals = installDirectoryApi(group, bot)
    const renderer = await mountProductionContacts()
    await click(renderer, 'Bot')
    await click(renderer, '测试 Bot')
    expect(arkmeUi.getSnapshot()).toMatchObject({ mode: 'bot', selectedBot: botSummary })
    expect(arkmeUi.getSnapshot().selectedSource).toBeUndefined()
    expect(testState.callArkme.mock.calls.some(([operation]) => operation === 'directory.bot.open-chat')).toBe(false)

    await click(renderer, '联系人')
    await click(renderer, '群聊')
    await click(renderer, '测试群聊')
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 101 }); await Promise.resolve() })
    expect(signals.group?.aborted).toBe(true)
    group.resolve({ sourceRef: 'group-source', kind: 'group_chat', displayName: '测试群聊', activeAtMillis: 1, unreadCount: 0 })
    await flush()
    expect(arkmeUi.getSnapshot().selectedSource).toBeUndefined()
    expect(arkmeContactsTab.getSnapshot().accountKey).toBe('prod:101')
  })

  it('opens the current group request exactly once', async () => {
    const group = deferred<ArkmeSourceItem>()
    const bot = deferred<ArkmeSourceItem>()
    installDirectoryApi(group, bot)
    const renderer = await mountProductionContacts()
    await click(renderer, '群聊')
    await click(renderer, '测试群聊')
    group.resolve({ sourceRef: 'group-source', kind: 'group_chat', displayName: '测试群聊', activeAtMillis: 1, unreadCount: 0 })
    await flush()

    expect(arkmeUi.getSnapshot()).toMatchObject({
      mode: 'source', selectedSource: { sourceRef: 'group-source', kind: 'group_chat' },
    })
    expect(arkmeUi.getSnapshot().productMode).toBeUndefined()
    expect(testState.callArkme.mock.calls.filter(([operation]) => operation === 'directory.group.open-chat')).toHaveLength(1)
  })
})
