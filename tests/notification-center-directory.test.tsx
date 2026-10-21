import { useSyncExternalStore } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeArrangementReminderEvent, ArkmeSourceItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme, ArkmeClientError: class extends Error {} }))
vi.mock('../src/client/ArkmeNotificationPermissionBanner.js', () => ({ ArkmeNotificationPermissionBanner: () => null }))
vi.mock('../src/client/ArkmeDSHBetaCommunityEntry.js', () => ({
  ArkmeDSHBetaCommunityEntry: () => null, ArkmeDSHBetaCommunityEntryContent: () => null,
}))
vi.mock('../src/client/arko-conversation-preview-sync.js', () => ({
  ArkmeArkoConversationPreviewSync: class { start() { return () => undefined } },
}))

import { ArkmeNavigation, ArkmeNotificationsRow } from '../src/client/ArkmeVirtualWorkspace.js'
import { ArkmeNotificationCenter, arkmeNotificationStore } from '../src/client/ArkmeNotificationCenter.js'
import { ArkmeProductNavigation } from '../src/client/ArkmeProductNavigation.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory } from '../src/client/chat-directory-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { socialAccessStore } from '../src/client/social-access-store.js'
import { startOfficialTeamMembership, refreshOfficialTeamMembership } from '../src/client/official-team-membership.js'
import { startTeamDirectory, refreshTeamDirectory } from '../src/client/team-conversation-directory.js'
import type { TeamConversation } from '../src/team-app-contract.js'
import { builtinDirectoryPreferences } from '../src/client/builtin-directory-preferences.js'
import { notificationDirectoryPreferences } from '../src/client/notification-directory-preferences.js'
import { localDirectoryPreferences } from '../src/client/local-directory-preferences.js'
import type { LocalDirectoryPreferences } from '../src/local-directory-preferences.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const timestamp = 1_790_000_000_000
const notice = {
  eventRef: 'notice-1', title: '已加载的通知', description: '通知摘要', read: false,
  eventAtMillis: timestamp + 200, createdAtMillis: timestamp + 200,
} as ArkmeArrangementReminderEvent
const sources: ArkmeSourceItem[] = [
  { sourceRef: 'pinned', sourceKey: 'pinned', displayName: '置顶对话', isPinned: true, activeAtMillis: timestamp + 1 },
  { sourceRef: 'newer', sourceKey: 'newer', displayName: '较新对话', activeAtMillis: timestamp + 300 },
  { sourceRef: 'older', sourceKey: 'older', displayName: '较早对话', activeAtMillis: timestamp + 100 },
].map(source => ({ ...source, kind: 'private_chat', unreadCount: 0 }))

let renderer: ReactTestRenderer | undefined
let notices: ArkmeArrangementReminderEvent[]
let stopTeamDirectory: (() => void) | undefined
let stopOfficialMembership: (() => void) | undefined

function Workspace({ showHarnessEntry = false }: { showHarnessEntry?: boolean } = {}) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getViewSnapshot, arkmeUi.getViewSnapshot)
  return <><ArkmeNavigation embeddedProductShell showHarnessEntry={showHarnessEntry} />{ui.mode === 'notifications' && <ArkmeNotificationCenter />}</>
}

function notificationRows() {
  return renderer!.root.findAll(node => node.props?.role === 'treeitem'
    && typeof node.props['aria-label'] === 'string' && /^通知(?:，|$)/.test(node.props['aria-label']))
}

function conversationOrder() {
  return renderer!.root.findAll(node => node.props?.role === 'treeitem')
    .map(node => String(node.props['aria-label'] ?? ''))
    .map(label => label.startsWith('通知') ? '通知' : label)
    .filter(label => ['通知', '置顶对话', '较新对话', '较早对话'].includes(label))
}

function holdArrangements() {
  const pending = deferred<{ items: ArkmeArrangementReminderEvent[] }>()
  const original = mocks.callArkme.getMockImplementation()!
  mocks.callArkme.mockImplementation((operation: string, ...args: unknown[]) => operation === 'arrangements.reminders.list'
    ? pending.promise : original(operation, ...args))
  return pending
}

beforeEach(async () => {
  vi.stubGlobal('window', {
    location: { search: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn(), setTimeout, clearTimeout,
  })
  notices = [notice]
  const directoryPreferences = new Map<string, LocalDirectoryPreferences>()
  mocks.callArkme.mockReset()
  mocks.callArkme.mockImplementation(async (operation: string, params?: { accountKey?: string; entries?: LocalDirectoryPreferences }) => {
    if (operation.startsWith('directory.preferences.')) {
      const account = params?.accountKey ?? ''
      const saved = directoryPreferences.get(account) ?? {}
      if (operation === 'directory.preferences.set') directoryPreferences.set(account, { ...saved, ...params?.entries })
      if (operation === 'directory.preferences.migrate') directoryPreferences.set(account, { ...params?.entries, ...saved })
      return { ...directoryPreferences.get(account) }
    }
    if (operation === 'provider.instance') return { instanceId: 'notification-directory-test' }
    if (operation === 'sources.list') return { directory: 'root', items: sources, hasMore: false }
    if (operation === 'arrangements.reminders.list') return { items: notices }
    if (operation === 'world.notification-sources' || operation === 'ai-letter.list' || operation === 'bots.private-chat.directory') return { items: [] }
    if (operation === 'world.interactions.summary' || operation === 'ai-letter.unread') return { unreadCount: 0, seenThroughSequence: 0 }
    if (operation === 'chat.official-author.profile' || operation === 'arko.profile') throw new Error('not used')
    return {}
  })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7001 })
  await localDirectoryPreferences.hydrate('test:7001', true)
  arkmeChatDirectory.activateAccount('test:7001')
  arkmeChatDirectory.publish(sources)
  arkmeUi.selectSource(sources[1]!)
})

afterEach(async () => {
  await act(async () => { renderer?.unmount() })
  renderer = undefined
  stopTeamDirectory?.(); stopTeamDirectory = undefined
  stopOfficialMembership?.(); stopOfficialMembership = undefined
  arkmeChatDirectory.activateAccount(undefined)
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  socialAccessStore.activate(undefined)
  await arkmeNotificationStore.refresh()
  arkmeUi.showLogin()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('notification directory stability', () => {
  it('offers preview and pin only, reorders immediately, and restores the saved pin after remount', async () => {
    const data = new Map<string, string>()
    Object.assign(window, { localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } } })
    await act(async () => { renderer = create(<Workspace />) })
    const context = () => notificationRows()[0]!.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 40, clientY: 60,
      currentTarget: { focus() {}, getBoundingClientRect: () => ({ left: 20, top: 40 }) } })
    await act(async () => context())
    const menu = () => renderer!.root.findByProps({ role: 'menu', 'aria-label': '通知的会话操作' })
    expect(menu().findAllByProps({ role: 'menuitem' }).map(node => node.props['aria-label'])).toEqual(['预览', '置顶对话'])
    expect(menu().findAllByProps({ role: 'separator' })).toHaveLength(0)
    await act(async () => menu().findByProps({ 'aria-label': '置顶对话' }).props.onClick())
    expect(notificationDirectoryPreferences.read('test:7001')).toBe(true)
    expect(mocks.callArkme).toHaveBeenCalledWith('directory.preferences.set', {
      accountKey: 'test:7001', entries: { notification: { pinned: true, pinnedAt: expect.any(Number) } },
    }, expect.any(AbortSignal))
    expect(conversationOrder()).toEqual(['通知', '置顶对话', '较新对话', '较早对话'])
    await act(async () => { renderer!.unmount(); renderer = create(<Workspace />) })
    expect(conversationOrder()).toEqual(['通知', '置顶对话', '较新对话', '较早对话'])
    await act(async () => context())
    await act(async () => menu().findByProps({ 'aria-label': '取消置顶' }).props.onClick())
    expect(conversationOrder()).toEqual(['置顶对话', '较新对话', '通知', '较早对话'])
    expect(arkmeUi.getViewSnapshot().mode).toBe('source')
  })

  it.each(['self', 'arko', 'harness'] as const)('offers builtin %s preview and pin without removal, restores pin and isolates accounts', async entry => {
    const data = new Map<string, string>()
    Object.assign(window, { localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } } })
    await act(async () => { renderer = create(<Workspace showHarnessEntry />) })
    const row = () => renderer!.root.findByProps({ 'data-arkme-builtin-entry': entry })
    const context = () => row().props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 40, clientY: 60,
      currentTarget: { focus() {}, getBoundingClientRect: () => ({ left: 20, top: 40 }) } })
    const before = arkmeUi.getViewSnapshot()
    await act(async () => context())
    const menu = () => renderer!.root.findByProps({ role: 'menu' })
    expect(menu().findAllByProps({ role: 'menuitem' }).map(node => node.props['aria-label'])).toEqual(['预览', '置顶对话'])
    expect(menu().findAllByProps({ role: 'separator' })).toHaveLength(0)
    await act(async () => menu().findByProps({ 'aria-label': '置顶对话' }).props.onClick())
    expect(builtinDirectoryPreferences.read('test:7001')[entry]).toBeGreaterThan(0)
    expect(mocks.callArkme).toHaveBeenCalledWith('directory.preferences.set', {
      accountKey: 'test:7001', entries: { [`builtin:${entry}`]: { pinned: true, pinnedAt: expect.any(Number) } },
    }, expect.any(AbortSignal))
    expect(renderer!.root.findAllByProps({ role: 'treeitem' })[0]!.props['data-arkme-builtin-entry']).toBe(entry)
    expect(arkmeUi.getViewSnapshot()).toBe(before)
    await act(async () => { renderer!.unmount(); renderer = create(<Workspace showHarnessEntry />) })
    expect(renderer!.root.findAllByProps({ role: 'treeitem' })[0]!.props['data-arkme-builtin-entry']).toBe(entry)
    await act(async () => context())
    await act(async () => menu().findByProps({ 'aria-label': '取消置顶' }).props.onClick())
    expect(builtinDirectoryPreferences.read('test:7001')[entry]).toBeUndefined()
    expect(builtinDirectoryPreferences.read('test:7002')[entry]).toBeUndefined()
    expect(mocks.callArkme.mock.calls.some(([op]) => String(op).includes('bot-pin') || String(op).includes('policy.set'))).toBe(false)
  })

  it('keeps Team entries available without phone binding and avoids duplicate official entries', async () => {
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() })
    let phoneMasked: string | undefined
    const conversation: TeamConversation = {
      key: 'official-team', ref: 'official-team-ref', side: 'external',
      channel: { teamRef: 'team-ref', name: '即我', jotmoId: 'arkme_cn', publicRef: '', link: '', enabled: true, revision: 1, canManage: false },
      lastSeq: 1, latestTeamReplySeq: 1, myReadSeq: 0, unread: 1, needsReply: false,
      blocked: false, revision: 1, updatedAt: timestamp + 250,
    }
    let conversations = [conversation]
    const original = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: { side?: string }, ...args: unknown[]) => {
      if (operation === 'user.profile' || operation === 'user.profile.refresh') return { profile: { userId: 7001, contact: { phoneMasked } } }
      if (operation === 'team.app.official.membership') return { jotmoId: 'arkme_cn', isMember: false }
      if (operation === 'team.app.conversations') return { items: params?.side === 'external' ? conversations : [], hasMore: conversations.length > 0, nextCursor: 'next' }
      return original(operation, params, ...args)
    })
    await act(async () => {
      stopOfficialMembership = startOfficialTeamMembership('test:7001')
      await refreshOfficialTeamMembership('test:7001')
      stopTeamDirectory = startTeamDirectory('test:7001')
      await refreshTeamDirectory('test:7001')
      renderer = create(<Workspace />)
    })
    const teamRows = () => renderer!.root.findAll(node => node.type === 'button' && node.props['data-team-side'] === 'external')
    const shortcut = () => renderer!.root.findAll(node => node.type === 'button' && node.props['data-arkme-home-tour-target'] === 'official-author')
    const loadMore = () => renderer!.root.findAll(node => node.type === 'button' && node.children.includes('加载更多团队对话'))
    expect(teamRows()).toHaveLength(1); expect(shortcut()).toHaveLength(0); expect(loadMore()).toHaveLength(1)
    const notification = notificationRows()[0]!
    phoneMasked = '138****0000'
    await act(async () => { await socialAccessStore.refresh() })
    expect(teamRows()).toHaveLength(1); expect(shortcut()).toHaveLength(0); expect(loadMore()).toHaveLength(1)
    expect(notificationRows()[0]).toBe(notification)
    phoneMasked = undefined
    await act(async () => { await socialAccessStore.refresh() })
    expect(teamRows()).toHaveLength(1); expect(loadMore()).toHaveLength(1)
    expect(notificationRows()[0]).toBe(notification)
    conversations = []
    await act(async () => { await refreshTeamDirectory('test:7001') })
    expect(shortcut()).toHaveLength(1)
    phoneMasked = '138****0000'
    await act(async () => { await socialAccessStore.refresh() })
    expect(shortcut()).toHaveLength(1)
    expect(mocks.callArkme.mock.calls.some(([operation]) => operation === 'chat.official-author.profile' || operation === 'chat.official-author.private.open')).toBe(false)
  })

  it('preserves every conversation and the selected notification across binding changes', async () => {
    let phoneMasked: string | undefined
    const original = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, ...args: unknown[]) => {
      if (operation === 'user.profile' || operation === 'user.profile.refresh') {
        return { profile: { userId: 7001, contact: { phoneMasked } } }
      }
      if (operation === 'team.codex.entry-availability') return { userId: 7001, visible: true, checked: true }
      return original(operation, ...args)
    })
    await act(async () => { renderer = create(<Workspace showHarnessEntry />) })
    expect(conversationOrder()).toEqual(['置顶对话', '较新对话', '通知', '较早对话'])
    expect(renderer!.root.findAllByProps({ role: 'treeitem', 'aria-label': 'Codex' })).toHaveLength(1)
    const before = notificationRows()[0]!
    await act(async () => { before.props.onClick() })
    expect(renderer!.root.findAllByProps({ role: 'listitem' })).toHaveLength(1)

    phoneMasked = '138****0000'
    await act(async () => { await socialAccessStore.refresh() })
    expect(conversationOrder()).toEqual(['置顶对话', '较新对话', '通知', '较早对话'])
    expect(notificationRows()[0]).toBe(before)
    expect(notificationRows()[0]!.props['aria-selected']).toBe(true)
    expect(renderer!.root.findAllByProps({ role: 'treeitem', 'aria-label': 'Codex' })).toHaveLength(1)
    expect(renderer!.root.findAllByProps({ role: 'listitem' })).toHaveLength(1)
  })

  it('restores the selected notification row and center after opening World from a notification', async () => {
    const original = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, ...args: unknown[]) => {
      if (operation === 'world.notification-sources') return { items: [{ recordRef: 'world-post' }] }
      if (operation === 'world.interactions.list') return { items: [{ interactionRef: 'world-reply', authorName: '回复者', textContent: '世界回复', createdAtMillis: timestamp + 500 }] }
      return original(operation, ...args)
    })
    await act(async () => { renderer = create(<><ArkmeProductNavigation compact /><Workspace /></>) })
    await act(async () => { notificationRows()[0]!.props.onClick() })
    const before = notificationRows()[0]!
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '世界：回复者 回复了你的世界' }).findByType('button').props.onClick() })
    expect(arkmeUi.getSnapshot().mode).toBe('world')
    expect(arkmeUi.getSnapshot().worldInteractionRef).toBe('world-reply')
    expect(mocks.callArkme.mock.calls.some(call => call[0] === 'world.interactions.mark-viewed')).toBe(false)
    expect(renderer!.root.findAllByType(ArkmeNotificationCenter)).toHaveLength(0)
    await act(async () => { renderer!.root.findByProps({ 'data-arkme-home-tour-target': 'conversations' }).props.onClick() })
    expect(notificationRows()[0]).toBe(before)
    expect(notificationRows()[0]!.props['aria-selected']).toBe(true)
    expect(renderer!.root.findAllByType(ArkmeNotificationCenter)).toHaveLength(1)
    expect(renderer!.root.findAllByProps({ role: 'listitem' })).toHaveLength(2)
  })

  it('keeps the same selected row and cached content while opening the center refreshes', async () => {
    await act(async () => { renderer = create(<Workspace />) })
    const before = notificationRows()[0]!
    expect(before).toBeDefined()
    const pending = holdArrangements()
    await act(async () => { before.props.onClick() })
    expect(notificationRows()[0]).toBe(before)
    expect(notificationRows()[0]!.props['aria-selected']).toBe(true)
    expect(renderer!.root.findAllByProps({ role: 'listitem' })).toHaveLength(1)
    await act(async () => { pending.resolve({ items: notices }) })
    expect(notificationRows()[0]).toBe(before)
  })

  it('preserves existing notifications and their time when a refresh fails', async () => {
    await act(async () => { renderer = create(<Workspace />) })
    const before = notificationRows()[0]!
    const pending = holdArrangements()
    await act(async () => { before.props.onClick() })
    await act(async () => { pending.reject(new Error('offline')) })
    expect(notificationRows()[0]).toBe(before)
    expect(arkmeNotificationStore.getSnapshot().arrangementItems).toEqual([notice])
    expect(renderer!.root.findAllByProps({ role: 'listitem' })).toHaveLength(1)
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toEqual(['offline'])
  })

  it('orders notifications with conversations, keeps pins first, and moves only for new events', async () => {
    await act(async () => { renderer = create(<Workspace />) })
    expect(conversationOrder()).toEqual(['置顶对话', '较新对话', '通知', '较早对话'])
    await act(async () => { await arkmeNotificationStore.markArrangementRead(notice.eventRef) })
    expect(conversationOrder()).toEqual(['置顶对话', '较新对话', '通知', '较早对话'])
    const pending = holdArrangements()
    let refresh!: Promise<void>
    await act(async () => { refresh = arkmeNotificationStore.refresh() })
    expect(conversationOrder()).toEqual(['置顶对话', '较新对话', '通知', '较早对话'])
    await act(async () => {
      pending.resolve({ items: [{ ...notice, eventAtMillis: timestamp + 400 }] })
      await refresh
    })
    expect(conversationOrder()).toEqual(['置顶对话', '通知', '较新对话', '较早对话'])
  })

  it('hides a genuinely empty entry on cold load and after a successful empty response', async () => {
    notices = []
    await act(async () => { renderer = create(<Workspace />) })
    expect(notificationRows()).toHaveLength(0)
    notices = [notice]
    await act(async () => { await arkmeNotificationStore.refresh() })
    expect(notificationRows()).toHaveLength(1)
    notices = []
    await act(async () => { await arkmeNotificationStore.refresh() })
    expect(notificationRows()).toHaveLength(0)
  })

  it('keeps the cached world and AI pages and unread counts when their refresh fails', async () => {
    notices = []
    const original = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, ...args: unknown[]) => {
      if (operation === 'world.notification-sources') return { items: [{ recordRef: 'world-post' }] }
      if (operation === 'world.interactions.list') return { items: [{ interactionRef: 'world-reply', authorName: '回复者', textContent: '世界回复', createdAtMillis: timestamp + 500 }] }
      if (operation === 'world.interactions.summary') return { unreadCount: 2, seenThroughSequence: 9 }
      if (operation === 'ai-letter.list') return { items: [{ letterId: 'ai-letter', title: 'AI 通知', summary: '来信摘要', createdAtMillis: timestamp + 600 }] }
      if (operation === 'ai-letter.unread') return { unreadCount: 1 }
      return original(operation, ...args)
    })
    await act(async () => { renderer = create(<Workspace />) })
    const before = arkmeNotificationStore.getSnapshot()
    expect(notificationRows()[0]!.props['aria-label']).toBe('通知，3 条未读')
    mocks.callArkme.mockRejectedValue(new Error('offline'))
    await act(async () => { await arkmeNotificationStore.refresh() })
    const after = arkmeNotificationStore.getSnapshot()
    expect(after.worldItems).toEqual(before.worldItems)
    expect(after.aiItems).toEqual(before.aiItems)
    expect(after.worldUnreadCount).toBe(2)
    expect(after.aiUnreadCount).toBe(1)
    expect(notificationRows()).toHaveLength(1)
  })

  it('keeps a complete world page on partial interaction failure without accumulating old pages', async () => {
    const original = mocks.callArkme.getMockImplementation()!
    let partial = false
    mocks.callArkme.mockImplementation(async (operation: string, params: { recordRef?: string }, ...args: unknown[]) => {
      if (operation === 'world.notification-sources') return { items: [{ recordRef: 'first' }, { recordRef: 'second' }] }
      if (operation === 'world.interactions.list') {
        if (partial && params.recordRef === 'second') throw new Error('partial failure')
        return { items: [{ interactionRef: `${params.recordRef}-${partial ? 'new' : 'old'}`, authorName: '回复者', createdAtMillis: timestamp + 500 }] }
      }
      return original(operation, params, ...args)
    })
    await act(async () => { renderer = create(<Workspace />) })
    const before = arkmeNotificationStore.getSnapshot().worldItems
    partial = true
    await act(async () => { await arkmeNotificationStore.refresh() })
    expect(arkmeNotificationStore.getSnapshot().worldItems).toEqual(before)
    expect(arkmeNotificationStore.getSnapshot().worldItems).toHaveLength(2)
  })

  it('does not expose the previous account while a new account is loading or an old request settles', async () => {
    await act(async () => { renderer = create(<ArkmeNotificationsRow selected={false} onClick={() => {}} />) })
    const oldRequest = holdArrangements()
    let oldRefresh!: Promise<void>
    await act(async () => { oldRefresh = arkmeNotificationStore.refresh() })
    const newRequest = holdArrangements()
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 8002 }) })
    expect(notificationRows()).toHaveLength(0)
    expect(arkmeNotificationStore.getSnapshot().arrangementItems).toEqual([])
    await act(async () => { newRequest.resolve({ items: [] }) })
    await act(async () => { oldRequest.resolve({ items: [notice] }); await oldRefresh })
    expect(notificationRows()).toHaveLength(0)
    expect(arkmeNotificationStore.getSnapshot().scope).toBe('test:8002')
  })

  it('joins concurrent refreshes without adding requests', async () => {
    await act(async () => { renderer = create(<Workspace />) })
    const pending = holdArrangements()
    mocks.callArkme.mockClear()
    let first!: Promise<void>, second!: Promise<void>
    await act(async () => { first = arkmeNotificationStore.refresh(); second = arkmeNotificationStore.refresh() })
    expect(mocks.callArkme.mock.calls.filter(([name]) => name === 'arrangements.reminders.list')).toHaveLength(1)
    await act(async () => { pending.resolve({ items: notices }); await Promise.all([first, second]) })
    expect(notificationRows()).toHaveLength(1)
  })

  it('does not refetch notification data when sorting moves its row across a directory window', async () => {
    await act(async () => { renderer = create(<Workspace />) })
    mocks.callArkme.mockClear()
    await act(async () => {
      arkmeChatDirectory.publish([
        ...sources,
        ...Array.from({ length: 40 }, (_, index) => ({
          sourceRef: `chat-${index}`, sourceKey: `chat-${index}`, kind: 'private_chat' as const,
          displayName: `对话 ${index}`, activeAtMillis: timestamp + 400 + index, unreadCount: 0,
        })),
      ])
    })
    expect(notificationRows()).toHaveLength(1)
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'arrangements.reminders.list')).toHaveLength(0)
  })
})

it.each(['missing conversation', 'missing message', 'network error', 'success', 'unloaded conversation'])(
 'reaction notification: %s preserves history and validates the navigation target independently of reading', async outcome => {
  const success = outcome === 'success' || outcome === 'unloaded conversation'
  const reaction = { id: 'a'.repeat(64), revision: 1, actorUserId: 2, sourceKey: outcome === 'missing conversation' || outcome === 'unloaded conversation' ? 'missing' : sources[0]!.sourceKey,
    ...(outcome === 'unloaded conversation' ? { source: { ...sources[0]!, sourceKey: 'missing', sourceRef: 'resolved-old-source', displayName: '旧会话' }, actorName: '备注名' } : {}),
    itemUid: 'target-message', recordOwnerUserId: 7001, sendAtMillis: timestamp, text: 'original message',
    selections: [{ key: 'b'.repeat(64), expression: { text: '赞' }, at: timestamp }], unread: true }
  const original = mocks.callArkme.getMockImplementation()!
  mocks.callArkme.mockImplementation(async (operation: string, input: any, ...rest: unknown[]) => {
    if (operation === 'reactions') {
      if (input.action === 'notifications') return { items: input.include_read || reaction.unread ? [{ ...reaction }] : [], has_more: false, after_id: '' }
      if (input.action === 'notifications-read') { reaction.unread = false; return { ok: true } }
    }
    if (operation === 'source.timeline-around') {
      if (outcome === 'network error') throw Error('offline')
      return { items: success ? [{ itemUid: reaction.itemUid }] : [] }
    }
    return original(operation, input, ...rest)
  })
  const open = vi.spyOn(arkmeUi, 'showConversationTarget').mockImplementation(() => undefined)
  await act(async () => { renderer = create(<ArkmeNotificationCenter />) })
  const row = () => renderer!.root.findAll(node => node.props.role === 'listitem' && String(node.props['aria-label']).startsWith('表态：'))[0]!
  expect(row()).toBeDefined()
  await act(async () => { row().findByType('button').props.onClick(); await new Promise(resolve => setTimeout(resolve, 0)) })
  const acks = mocks.callArkme.mock.calls.filter(([operation, input]) => operation === 'reactions' && input.action === 'notifications-read')
  expect(acks).toHaveLength(0)
  expect(open).toHaveBeenCalledTimes(success ? 1 : 0)
  if (outcome === 'unloaded conversation') expect(open).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: 'resolved-old-source' }), reaction.itemUid, reaction.sendAtMillis, reaction.recordOwnerUserId, undefined, true)
  expect(row()).toBeDefined()
  expect(row().findAll(node => node.props['aria-label'] === '未读')).toHaveLength(0)
  if (!success) expect(renderer!.root.findAll(node => node.props.role === 'alert').length).toBeGreaterThan(0)
  await act(async () => { renderer!.unmount(); renderer = undefined })
  await act(async () => { renderer = create(<ArkmeNotificationCenter />) })
  expect(row()).toBeDefined()
  expect(row().findAll(node => node.props['aria-label'] === '未读')).toHaveLength(0)
 })

it('keeps reaction history without a manual all-read action or background acknowledgements', async () => {
 const rows = Array.from({ length: 101 }, (_, i) => ({ id: i.toString(16).padStart(64, '0'), revision: 1,
  actorUserId: 2, sourceKey: sources[0]!.sourceKey, itemUid: `message-${i}`, recordOwnerUserId: 7001,
  sendAtMillis: timestamp, text: 'original', selections: [{ key: 'b'.repeat(64), expression: { text: '赞' }, at: timestamp }], unread: true }))
 const original = mocks.callArkme.getMockImplementation()!
 mocks.callArkme.mockImplementation(async (operation: string, input: any, ...rest: unknown[]) => {
  if (operation === 'reactions' && input.action === 'notifications') {
   const offset = input.after_id ? rows.findIndex(row => row.id === input.after_id) + 1 : 0
   const page = rows.slice(offset, offset + 50)
   return { items: page, after_id: offset + 50 < rows.length ? page.at(-1)!.id : '', has_more: offset + 50 < rows.length }
  }
  if (operation === 'reactions' && input.action === 'notifications-read') return { ok: true }
  return original(operation, input, ...rest)
 })
 await act(async () => { renderer = create(<ArkmeNotificationCenter />) })
 const reactionRows = () => renderer!.root.findAll(node => node.props.role === 'listitem' && String(node.props['aria-label']).startsWith('表态：'))
 expect(reactionRows()).toHaveLength(101)
 expect(renderer!.root.findAllByType('button').some(button => button.children.includes('全部已读'))).toBe(false)
 const batches = mocks.callArkme.mock.calls.filter(([operation, input]) => operation === 'reactions' && input.action === 'notifications-read')
 expect(batches).toHaveLength(0)
 expect(reactionRows()).toHaveLength(101)
 expect(reactionRows().every(row => row.findAll(node => node.props['aria-label'] === '未读').length === 0)).toBe(true)
})
