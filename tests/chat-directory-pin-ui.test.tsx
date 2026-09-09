import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme, ArkmeClientError: class extends Error {} }))
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }))
vi.mock('../src/client/ArkmeNotificationPermissionBanner.js', () => ({ ArkmeNotificationPermissionBanner: () => null }))
vi.mock('../src/client/ArkmeDSHBetaCommunityEntry.js', () => ({
  ArkmeDSHBetaCommunityEntry: () => null, ArkmeDSHBetaCommunityEntryContent: () => null,
}))
vi.mock('../src/client/arko-conversation-preview-sync.js', () => ({
  ArkmeArkoConversationPreviewSync: class { start() { return () => undefined } },
}))

import { ArkmeArkoRow, ArkmeNavigation, DeepSeekHarnessRow } from '../src/client/ArkmeVirtualWorkspace.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory } from '../src/client/chat-directory-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const source: ArkmeSourceItem = {
  sourceRef: 'chat-ref', sourceKey: 'chat-key', kind: 'private_chat', displayName: '置顶目标',
  isPinned: false, unreadCount: 0, activeAtMillis: 100,
}
let renderer: ReactTestRenderer | undefined
let resolvePin: (value: unknown) => void
let rejectPin: (reason: unknown) => void

function row() {
  return renderer!.root.findAllByProps({ role: 'treeitem' }).find(node => node.props['aria-label'] === source.displayName)!
}
function menu() { return renderer!.root.findAllByProps({ role: 'menuitem' })[0]! }
function pinCalls() { return mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.directory.policy.set') }
async function openMenu() {
  await act(async () => { row().props.onContextMenu({ preventDefault() {}, clientX: 20, clientY: 20 }) })
}
async function startPin() {
  await openMenu()
  await act(async () => { menu().props.onClick() })
}

beforeEach(async () => {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(), removeEventListener: vi.fn(), innerWidth: 1200, innerHeight: 800,
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn(), setTimeout, clearTimeout,
  })
  vi.stubGlobal('document', {
    body: {}, visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })
  mocks.callArkme.mockReset()
  mocks.callArkme.mockImplementation(async (operation: string) => {
    if (operation === 'sources.list') return { directory: 'root', items: [source], hasMore: false }
    if (operation === 'bots.private-chat.directory') return { items: [] }
    if (operation === 'source.directory.policy.set') {
      return await new Promise((resolve, reject) => { resolvePin = resolve; rejectPin = reject })
    }
    if (operation === 'chat.official-author.profile' || operation === 'arko.profile') throw new Error('not needed')
    return {}
  })
  arkmeChatDirectory.activateAccount('test:pin-ui')
  arkmeChatDirectory.publish([source])
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7001 })
  arkmeUi.selectSource(source)
  await act(async () => { renderer = create(<ArkmeNavigation />) })
})
afterEach(async () => {
  await act(async () => { renderer?.unmount() })
  renderer = undefined
  arkmeChatDirectory.activateAccount(undefined)
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  arkmeUi.showLogin()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('conversation pin interaction', () => {
  it.each([false, true])('keeps special entry destinations distinct in compact=%s', async compactDirectory => {
    await act(async () => { renderer!.update(<ArkmeNavigation compactDirectory={compactDirectory} showHarnessEntry embeddedProductShell />) })
    await act(async () => { renderer!.root.findByType(DeepSeekHarnessRow).props.onClick() })
    expect(arkmeUi.getSnapshot().mode).toBe('harness')
    await act(async () => { renderer!.root.findByType(ArkmeArkoRow).props.onClick() })
    expect(arkmeUi.getSnapshot().mode).toBe('arko')
    await act(async () => { row().props.onClick() })
    expect(arkmeUi.getSnapshot().mode).toBe('source')
    expect(arkmeUi.getSnapshot().selectedSource?.sourceKey).toBe(source.sourceKey)
    const self = renderer!.root.findAllByProps({ role: 'treeitem' }).find(node => node.type === 'button'
      && node.findAllByType('span').some(span => span.children.length === 1 && span.children[0] === '发给自己'))!
    await act(async () => { self.props.onClick() })
    expect(arkmeUi.getSnapshot().mode).toBe('source')
    expect(arkmeUi.getSnapshot().selectedSource).toBeUndefined()
    expect(pinCalls()).toHaveLength(0)
  })

  it('preserves a pending pin and its reentry guard while the directory narrows and expands', async () => {
    await startPin()
    for (const compactDirectory of [true, false]) {
      await act(async () => { renderer!.update(<ArkmeNavigation compactDirectory={compactDirectory} />) })
      expect(row().props['aria-busy']).toBe(true)
      expect(row().props.disabled).toBe(false)
      await openMenu()
      expect(renderer!.root.findAllByProps({ role: 'menuitem' })).toHaveLength(0)
      expect(pinCalls()).toHaveLength(1)
    }
    await act(async () => { resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 }) })
    expect(arkmeChatDirectory.getSnapshot().sources[0]?.isPinned).toBe(true)
    await openMenu()
    expect(menu().children).toEqual(['取消置顶'])
  })

  it('pins a group through the same Chat operation and current directory projection', async () => {
    await act(async () => { arkmeChatDirectory.publish([{ ...source, kind: 'group_chat' }]) })
    await startPin()
    expect(pinCalls()[0]?.[1]).toEqual({ sourceRef: source.sourceRef, pinned: true })
    await act(async () => { resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 }) })
    expect(arkmeChatDirectory.getSnapshot().sources[0]).toMatchObject({ kind: 'group_chat', isPinned: true })
    await openMenu()
    expect(menu().children).toEqual(['取消置顶'])
  })

  it('keeps Bot local pin preferences separate from a Chat with the same directory key', async () => {
    await act(async () => { renderer!.unmount() })
    const bot = { botRef: 'bot-ref', directoryKey: source.sourceKey, name: 'Bot 目标', provider: 'openclaw',
      description: '', status: 'offline', directChatAvailable: true, createdAtMillis: 100 }
    const fallback = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (...args) => args[0] === 'bots.private-chat.directory'
      ? { items: [bot] } : fallback(...args))
    await act(async () => { renderer = create(<ArkmeNavigation />) })
    const botRow = () => renderer!.root.findAllByProps({ role: 'treeitem' }).find(node => node.props['aria-label'] === bot.name)!
    await act(async () => { botRow().props.onContextMenu({ preventDefault() {}, clientX: 20, clientY: 20 }) })
    await act(async () => { menu().props.onClick() })
    expect(pinCalls()).toHaveLength(0)
    expect(arkmeChatDirectory.getSnapshot().sources[0]?.isPinned).toBe(false)
    await act(async () => { botRow().props.onContextMenu({ preventDefault() {}, clientX: 20, clientY: 20 }) })
    expect(menu().children).toEqual(['取消置顶'])
    await openMenu()
    expect(menu().children).toEqual(['置顶对话'])
  })

  it('keeps an open menu bound to the current pin and current capability for the same conversation', async () => {
    await openMenu()
    await act(async () => { arkmeChatDirectory.publish([{ ...source, sourceRef: 'current-ref', isPinned: true, chatPolicyUpdatedAtMillis: 3000 }]) })
    expect(menu().children).toEqual(['取消置顶'])
    await act(async () => { menu().props.onClick() })
    expect(pinCalls()[0]?.[1]).toEqual({ sourceRef: 'current-ref', pinned: false })
    await act(async () => { resolvePin({ sourceRef: 'current-ref', pinned: false, policyUpdatedAtMillis: 4000 }) })
  })

  it('does not offer actions for a conversation removed while its menu is open', async () => {
    await openMenu()
    await act(async () => { arkmeChatDirectory.publish([]) })
    expect(renderer!.root.findAllByProps({ role: 'menuitem' })).toHaveLength(0)
    expect(pinCalls()).toHaveLength(0)
  })

  it.each(['account', 'environment', 'logout-return'] as const)('allows a fresh pin after %s changes while the old request is pending', async change => {
    await startPin()
    const oldResolve = resolvePin
    const nextAuth = { status: 'authenticated' as const, environment: change === 'environment' ? 'prod' as const : 'test' as const,
      userId: change === 'account' ? 7002 : 7001 }
    await act(async () => { arkmeAuthStore.setAuth(change === 'logout-return'
      ? { status: 'logged-out', environment: 'test' } : nextAuth) })
    if (change === 'logout-return') await act(async () => { arkmeAuthStore.setAuth(nextAuth) })
    await act(async () => { arkmeChatDirectory.publish([source]) })
    await startPin()
    expect(pinCalls()).toHaveLength(2)
    await act(async () => { oldResolve({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 9000 }) })
    expect(arkmeChatDirectory.getSnapshot().sources[0]?.isPinned).toBe(false)
    expect(row().props['aria-busy']).toBe(true)
    await act(async () => { resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 }) })
    expect(arkmeChatDirectory.getSnapshot().sources[0]?.chatPolicyUpdatedAtMillis).toBe(2000)
  })

  it('keeps a pending pin across a credential refresh for the same account', async () => {
    await startPin()
    const signal = pinCalls()[0]?.[2] as AbortSignal
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7001, expiresAtMillis: 9000 }) })
    expect(signal.aborted).toBe(false)
    expect(row().props['aria-busy']).toBe(true)
    await act(async () => { resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 }) })
    expect(arkmeChatDirectory.getSnapshot().sources[0]?.isPinned).toBe(true)
  })

  it('cancels local handling when unmounted even if the owner later returns success', async () => {
    await startPin()
    const signal = pinCalls()[0]?.[2] as AbortSignal
    await act(async () => { renderer!.unmount(); renderer = undefined })
    expect(signal.aborted).toBe(true)
    await act(async () => { resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 }) })
    expect(arkmeChatDirectory.getSnapshot().sources[0]?.isPinned).toBe(false)
  })

  it('keeps a rotated capability busy without preventing navigation', async () => {
    await startPin()
    await act(async () => { arkmeChatDirectory.publish([{ ...source, sourceRef: 'rotated-ref' }]) })
    expect(row().props['aria-busy']).toBe(true)
    expect(row().props.disabled).toBe(false)
    await openMenu()
    expect(renderer!.root.findAllByProps({ role: 'menuitem' })).toHaveLength(0)
    await act(async () => { resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 }) })
  })

  it.each(['success', 'failure'] as const)('preserves the distinct remove interaction on %s', async outcome => {
    let resolveRemove!: () => void
    let rejectRemove!: (reason: unknown) => void
    const fallback = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (...args) => args[0] === 'conversation.directory.visibility.set'
      ? await new Promise<void>((resolve, reject) => { resolveRemove = resolve; rejectRemove = reject }) : fallback(...args))
    await openMenu()
    await act(async () => { renderer!.root.findAllByProps({ role: 'menuitem' })[1]!.props.onClick() })
    expect(row().props.disabled).toBe(true)
    expect(pinCalls()).toHaveLength(0)
    await act(async () => {
      if (outcome === 'success') resolveRemove()
      else rejectRemove(new Error('移除失败'))
    })
    if (outcome === 'success') expect(row()).toBeUndefined()
    else {
      expect(row().props.disabled).toBe(false)
      expect(renderer!.root.findByProps({ role: 'status' }).children).toEqual(['移除失败'])
    }
  })

  it('keeps the new lifecycle pending when an old failure arrives after logout and login', async () => {
    await startPin()
    const oldReject = rejectPin
    const signal = pinCalls()[0]?.[2] as AbortSignal
    await act(async () => { arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }) })
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7001 }) })
    await act(async () => { arkmeChatDirectory.publish([source]) })
    await startPin()
    expect(signal.aborted).toBe(true)
    await act(async () => { oldReject(new Error('旧账号失败')) })
    expect(row().props['aria-busy']).toBe(true)
    expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(0)
    await act(async () => { resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 }) })
  })

  it('shows pending feedback, prevents reentry, then offers unpin after success', async () => {
    await startPin()
    expect(pinCalls()).toHaveLength(1)
    expect(pinCalls()[0]?.[1]).toEqual({ sourceRef: 'chat-ref', pinned: true })
    expect(row().props.disabled).toBe(false)
    expect(row().props['aria-busy']).toBe(true)
    await act(async () => { row().props.onClick() })
    expect(arkmeUi.getSnapshot().selectedSource?.sourceKey).toBe(source.sourceKey)
    await openMenu()
    expect(renderer!.root.findAllByProps({ role: 'menuitem' })).toHaveLength(0)
    expect(pinCalls()).toHaveLength(1)
    await act(async () => { resolvePin({ sourceRef: 'chat-ref', pinned: true, policyUpdatedAtMillis: 2000 }) })
    expect(row().props.disabled).toBe(false)
    expect(renderer!.root.findByProps({ role: 'status' }).children).toEqual(['已置顶对话'])
    await openMenu()
    expect(menu().children).toEqual(['取消置顶'])
    await act(async () => { menu().props.onClick() })
    expect(pinCalls()[1]?.[1]).toEqual({ sourceRef: 'chat-ref', pinned: false })
    await act(async () => { resolvePin({ sourceRef: 'chat-ref', pinned: false, policyUpdatedAtMillis: 3000 }) })
    await openMenu()
    expect(menu().children).toEqual(['置顶对话'])
  })

  it('restores the original state and allows retry after an owner rejection', async () => {
    await startPin()
    await act(async () => { rejectPin(new Error('没有会话权限')) })
    expect(row().props.disabled).toBe(false)
    expect(renderer!.root.findByProps({ role: 'status' }).children).toEqual(['没有会话权限'])
    await openMenu()
    expect(menu().children).toEqual(['置顶对话'])
    await act(async () => { menu().props.onClick() })
    expect(pinCalls()).toHaveLength(2)
    await act(async () => { resolvePin({ sourceRef: 'chat-ref', pinned: true, policyUpdatedAtMillis: 2000 }) })
  })

  it.each(['success', 'failure'] as const)('preserves new messages and rotated refs during pin %s', async outcome => {
    await startPin()
    expect(arkmeChatDirectory.getSnapshot().sources.find(item => item.sourceKey === source.sourceKey)?.isPinned).toBe(false)
    const latest = { ...source, sourceRef: 'rotated-chat-ref', unreadCount: 8, latestPreview: '刚收到的新消息' }
    const other = { ...source, sourceKey: 'other-key', sourceRef: 'other-ref', displayName: '新会话' }
    await act(async () => { arkmeChatDirectory.publish([latest, other]) })
    await act(async () => {
      if (outcome === 'success') resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 })
      else rejectPin(new Error('置顶失败'))
    })
    expect(arkmeChatDirectory.getSnapshot().sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKey: source.sourceKey, sourceRef: 'rotated-chat-ref', unreadCount: 8, latestPreview: '刚收到的新消息', isPinned: outcome === 'success' }),
      expect.objectContaining({ sourceKey: 'other-key', displayName: '新会话' }),
    ]))
  })

  it.each(['success', 'failure'] as const)('keeps the self workspace usable while pin finishes with %s', async outcome => {
    await startPin()
    const selfRow = renderer!.root.findAllByProps({ role: 'treeitem' }).find(node =>
      node.findAll(child => child.type === 'span' && child.children.includes('发给自己')).length > 0,
    )!
    expect(selfRow.props.disabled).not.toBe(true)
    await act(async () => { selfRow.props.onClick() })
    expect(arkmeUi.getSnapshot()).toMatchObject({ mode: 'source' })
    expect(arkmeUi.getSnapshot().selectedSource).toBeUndefined()
    await act(async () => {
      if (outcome === 'success') resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 })
      else rejectPin(new Error('置顶失败'))
    })
    expect(arkmeUi.getSnapshot().selectedSource).toBeUndefined()
    expect(row().props.disabled).toBe(false)
    expect(arkmeChatDirectory.getSnapshot().sources).toEqual([
      expect.objectContaining({ sourceKey: source.sourceKey, isPinned: outcome === 'success' }),
    ])
  })

  it('does not let an older directory refresh undo a confirmed pin', async () => {
    let releasePage!: (value: unknown) => void
    mocks.callArkme.mockImplementationOnce(async () => await new Promise(resolve => { releasePage = resolve }))
    let refresh!: Promise<ArkmeSourceItem[]>
    await act(async () => { refresh = arkmeChatDirectory.refreshRoot({ force: true }) })
    await startPin()
    await act(async () => { resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 }) })
    expect(arkmeChatDirectory.getSnapshot().sources[0]?.isPinned).toBe(true)
    await act(async () => {
      releasePage({ directory: 'root', items: [source], hasMore: false })
      await refresh
    })
    expect(arkmeChatDirectory.getSnapshot().sources[0]?.isPinned).toBe(true)
    await openMenu()
    expect(menu().children).toEqual(['取消置顶'])
  })

  it('does not resurrect a removed conversation when pin finishes', async () => {
    await startPin()
    await act(async () => { arkmeChatDirectory.publish([]) })
    await act(async () => { resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 }) })
    expect(arkmeChatDirectory.getSnapshot().sources).toEqual([])
  })

  it('keeps a newer cross-device unpin when the local pin acknowledgement arrives later', async () => {
    await startPin()
    await act(async () => { arkmeChatDirectory.publish([{ ...source, isPinned: false, chatPolicyUpdatedAtMillis: 3000 }]) })
    await act(async () => { resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 }) })
    expect(row().props.disabled).toBe(false)
    await openMenu()
    expect(menu().children).toEqual(['置顶对话'])
    expect(pinCalls()).toHaveLength(1)
  })

  it('keeps another conversation navigable while pinning', async () => {
    const other = { ...source, sourceKey: 'other-key', sourceRef: 'other-ref', displayName: '其他会话' }
    await act(async () => { arkmeChatDirectory.publish([source, other]) })
    await startPin()
    const otherRow = renderer!.root.findAllByProps({ role: 'treeitem' }).find(node => node.props['aria-label'] === other.displayName)!
    expect(otherRow.props.disabled).not.toBe(true)
    await act(async () => { otherRow.props.onClick() })
    expect(arkmeUi.getSnapshot().selectedSource?.sourceKey).toBe(other.sourceKey)
    await act(async () => { resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 }) })
    expect(arkmeUi.getSnapshot().selectedSource?.sourceKey).toBe(other.sourceKey)
  })

  it.each(['success', 'failure'] as const)('does not apply the old account %s after switching accounts', async outcome => {
    await startPin()
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7002 }) })
    const before = arkmeChatDirectory.getSnapshot().sources
    await act(async () => {
      if (outcome === 'success') resolvePin({ sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: 2000 })
      else rejectPin(new Error('旧账号的错误'))
    })
    expect(arkmeChatDirectory.getSnapshot().sources).toEqual(before)
    const statuses = renderer!.root.findAllByProps({ role: 'status' }).flatMap(node => node.children)
    expect(statuses).not.toContain('旧账号的错误')
    expect(statuses).not.toContain('已置顶对话')
  })
})


it('hydrates visibility for a newly opened Bot that is not yet in the Host snapshot', async () => {
  mocks.callArkme.mockImplementation(async (operation: string, params: { botRefs?: string[] }) => {
    if (operation === 'conversation.directory.visibility.query') return { items: (params.botRefs ?? []).map(entryRef => ({ entryKind: 'bot', entryRef, hidden: false })) }
    return {}
  })
  await act(async () => {
    arkmeChatDirectory.applyHostPage({ directory: 'root', items: [source], hasMore: false, projection: { revision: 1, phase: 'complete', cachedAtMillis: 1, bots: [], visibility: [{ entryKind: 'source', entryRef: source.sourceRef, hidden: false }] } })
    arkmeUi.openBotConversation({ botRef: 'new-bot', name: 'New Bot', provider: 'openclaw', description: '', status: 'offline', directChatAvailable: true })
  })
  expect(renderer!.root.findAllByProps({ role: 'treeitem' }).some(node => node.props['aria-label'] === 'New Bot')).toBe(true)
  expect(mocks.callArkme.mock.calls.some(([operation, params]) => operation === 'conversation.directory.visibility.query' && params.botRefs?.includes('new-bot'))).toBe(true)
})

it('keeps a hidden conversation directory updated without taking over Contacts or reloading on return', async () => {
  const readsBefore = mocks.callArkme.mock.calls.filter(([op]) => op === 'sources.list').length
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000)
  await act(async () => {
    arkmeUi.showContacts()
    renderer!.update(<ArkmeNavigation active={false} />)
  })
  await act(async () => { arkmeChatDirectory.upsert({ ...source, latestSequence: 2, latestPreview: 'background message' }) })
  expect(arkmeUi.getSnapshot().productMode).toBe('contacts')
  await act(async () => {
    arkmeUi.showConversations()
    renderer!.update(<ArkmeNavigation active />)
  })
  expect(mocks.callArkme.mock.calls.filter(([op]) => op === 'sources.list')).toHaveLength(readsBefore)
  expect(arkmeChatDirectory.getSnapshot().sources[0]?.latestPreview).toBe('background message')
})

it('restores cached Bots on the first mount instead of clearing them in the account initialization effect', async () => {
  const bot = { botRef: 'cached-bot', directoryKey: 'cached-key', name: 'Cached Bot', provider: 'openclaw' as const, description: '', status: 'offline' as const, directChatAvailable: true }
  await act(async () => {
    arkmeChatDirectory.applyHostPage({ directory: 'root', items: [source], hasMore: false, projection: {
      revision: 100, phase: 'complete', cachedAtMillis: 1, bots: [bot], botPinnedKeys: ['cached-key'],
      visibility: [{ entryKind: 'source', entryRef: source.sourceRef, hidden: false }, { entryKind: 'bot', entryRef: bot.botRef, hidden: false }],
    } })
    renderer?.unmount()
  })
  await act(async () => { renderer = create(<ArkmeNavigation />) })
  expect(renderer!.root.findAllByProps({ role: 'treeitem' }).some(node => node.props['aria-label'] === 'Cached Bot')).toBe(true)
})

it('shows a blocking directory error only when there is no usable cached or remote content', async () => {
  const failed = { revision: 101, phase: 'failed' as const, cachedAtMillis: 1, bots: [], visibility: [], error: 'offline' }
  await act(async () => { arkmeChatDirectory.applyHostPage({ directory: 'root', items: [source], hasMore: true, projection: failed }) })
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('会话加载失败，请重试')
  await act(async () => {
    arkmeChatDirectory.clear()
    arkmeChatDirectory.applyHostPage({ directory: 'root', items: [], hasMore: true, projection: failed })
  })
  expect(JSON.stringify(renderer!.toJSON())).toContain('会话加载失败，请重试')
  await act(async () => { renderer!.update(<ArkmeNavigation sendToSelfSource={{ ...source, kind: 'send_to_self', latestPreview: 'cached personal record' }} />) })
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('会话加载失败，请重试')
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('重新加载')
})

it('restores the scroll position before showing a retained conversation list', async () => {
  const scrollElement = { scrollTop: 0, getClientRects: () => [{}] }
  await act(async () => { renderer?.unmount() })
  await act(async () => { renderer = create(<ArkmeNavigation />, { createNodeMock: node => node.props['aria-label'] === 'Arkme 会话' ? scrollElement : null }) })
  const tree = renderer!.root.findByProps({ role: 'tree', 'aria-label': 'Arkme 会话' })
  scrollElement.scrollTop = 630
  act(() => { tree.props.onScroll({ currentTarget: scrollElement }) })
  await act(async () => { renderer!.update(<ArkmeNavigation active={false} />) })
  scrollElement.scrollTop = 0
  act(() => { tree.props.onScroll({ currentTarget: scrollElement }) })
  await act(async () => { renderer!.update(<ArkmeNavigation active />) })
  expect(scrollElement.scrollTop).toBe(630)
})


it('jumps immediately through unread rows and does not open or acknowledge the target', async () => {
  await act(async () => { renderer?.unmount() })
  const scrollTo = vi.fn()
  const list = { scrollTop: 0, scrollTo, getBoundingClientRect: () => ({ top: 100 }), getClientRects: () => [{}] }
  await act(async () => { renderer = create(<ArkmeNavigation />, { createNodeMock: node => {
    if (node.props['aria-label'] === 'Arkme 会话') return list
    if (node.props['data-arkme-directory-row'] === 'source') return { getBoundingClientRect: () => ({ top: node.props['aria-label'].startsWith('First') ? 400 : 700 }), closest: () => null }
    return null
  } }) })
  await act(async () => { arkmeChatDirectory.applyHostPage({ directory: 'root', items: [
    { ...source, sourceRef: 'first', sourceKey: 'first', displayName: 'First', unreadCount: 3, activeAtMillis: 20 },
    { ...source, sourceRef: 'second', sourceKey: 'second', displayName: 'Second', unreadCount: 2, activeAtMillis: 10 },
  ], hasMore: false, projection: { revision: 1, phase: 'complete', cachedAtMillis: 1, bots: [], visibility: [
    { entryKind: 'source', entryRef: 'first', hidden: false }, { entryKind: 'source', entryRef: 'second', hidden: false },
  ] } }) })
  const selected = arkmeUi.getSnapshot().selectedSource
  mocks.callArkme.mockClear()
  await act(async () => { arkmeUi.locateNextUnreadConversation() })
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 300, behavior: 'instant' })
  await act(async () => { arkmeUi.locateNextUnreadConversation() })
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 600, behavior: 'instant' })
  await act(async () => { arkmeUi.locateNextUnreadConversation() })
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' })
  await act(async () => { arkmeUi.locateNextUnreadConversation() })
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 300, behavior: 'instant' })
  expect(arkmeUi.getSnapshot().selectedSource).toEqual(selected)
  expect(mocks.callArkme.mock.calls.some(([operation]) => operation === 'source.mark-read')).toBe(false)
})


it('does not unmount a row between a new-message sourceRef and its visibility receipt', async () => {
  const original = { ...source, latestSequence: 10, unreadCount: 0, avatarRef: 'same-avatar' }
  await act(async () => { arkmeChatDirectory.applyHostPage({ directory: 'root', items: [original], hasMore: false,
    projection: { revision: 1, phase: 'complete', cachedAtMillis: 1, bots: [], visibility: [
      { entryKind: 'source', entryRef: original.sourceRef, hidden: false },
    ] } }) })
  const firstRow = renderer!.root.findByProps({ 'data-arkme-directory-row': 'source' })
  mocks.callArkme.mockClear()
  const received = { ...original, sourceRef: 'new-message-capability', latestSequence: 11, unreadCount: 1, activeAtMillis: 101 }
  await act(async () => { arkmeChatDirectory.upsert(received) })
  expect(renderer!.root.findByProps({ 'data-arkme-directory-row': 'source' })).toBe(firstRow)
  expect(arkmeChatDirectory.totalBadgeUnreadCount()).toBe(1)
  expect(mocks.callArkme.mock.calls.some(([operation]) => operation === 'conversation.directory.visibility.query')).toBe(false)
  await act(async () => { arkmeChatDirectory.applyHostPage({ directory: 'root', items: [received], hasMore: false,
    projection: { revision: 2, phase: 'complete', cachedAtMillis: 2, bots: [], visibility: [
      { entryKind: 'source', entryRef: received.sourceRef, hidden: false },
    ] } }) })
  expect(renderer!.root.findByProps({ 'data-arkme-directory-row': 'source' })).toBe(firstRow)
})

it('keeps a Bot opened before the Host directory snapshot in the same row-and-total owner', async () => {
  mocks.callArkme.mockImplementation(async (operation: string, params: { botRefs?: string[]; sourceRefs?: string[] }) => {
    if (operation === 'conversation.directory.visibility.query') return { items: [
      ...(params.sourceRefs ?? []).map(entryRef => ({ entryKind: 'source', entryRef, hidden: false })),
      ...(params.botRefs ?? []).map(entryRef => ({ entryKind: 'bot', entryRef, hidden: false })),
    ] }
    return {}
  })
  await act(async () => { arkmeUi.openBotConversation({ botRef: 'early-bot', directoryKey: 'stable-early-bot', name: 'Early Bot', provider: 'openclaw', description: '', status: 'offline', directChatAvailable: true, unreadCount: 2 }) })
  expect(renderer!.root.findAllByProps({ role: 'treeitem' }).some(node => node.props['aria-label'] === 'Early Bot，2 条未读')).toBe(true)
  expect(arkmeChatDirectory.totalBadgeUnreadCount()).toBe(2)
})
