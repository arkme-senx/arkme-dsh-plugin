// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'

const state = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: state.callArkme, ArkmeClientError: class extends Error {} }))
vi.mock('../src/client/ArkmeNotificationPermissionBanner.js', () => ({ ArkmeNotificationPermissionBanner: () => null }))
vi.mock('../src/client/ArkmeDSHBetaCommunityEntry.js', () => ({ ArkmeDSHBetaCommunityEntry: () => null, ArkmeDSHBetaCommunityEntryContent: () => null }))
vi.mock('../src/client/arko-conversation-preview-sync.js', () => ({ ArkmeArkoConversationPreviewSync: class { start() { return () => undefined } } }))

import { ArkmeNavigation } from '../src/client/ArkmeVirtualWorkspace.js'
import { ArkmeProductNavigation } from '../src/client/ArkmeProductNavigation.js'
import { startArkmeDirectoryBadge } from '../src/client/directory-badge-runtime.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory } from '../src/client/chat-directory-store.js'
import { arkmeVisibleReadIntentAllowed } from '../src/client/read-intent-visibility.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const source: ArkmeSourceItem = { sourceRef: 'preview-ref', sourceKey: 'preview-key', kind: 'group_chat', displayName: '未读群聊', activeAtMillis: 100, unreadCount: 5, latestSequence: 10 }
const other: ArkmeSourceItem = { ...source, sourceRef: 'other', sourceKey: 'other', displayName: '当前会话', unreadCount: 0 }
let root: Root, host: HTMLDivElement
const onActivateSurface = vi.fn()
const row = () => document.querySelector<HTMLButtonElement>('button[aria-label="未读群聊，5 条未读"]')!
const menuItem = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent === text)
const dialog = () => document.querySelector('[aria-label="未读群聊的聊天预览"]')

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  state.callArkme.mockReset(); onActivateSurface.mockReset(); localStorage.clear()
  state.callArkme.mockImplementation(async (operation: string) => {
    if (operation === 'provider.instance') return { instanceId: 'preview-navigation' }
    if (operation === 'sources.list') return { directory: 'root', items: [source, other], hasMore: false }
    if (operation === 'bots.private-chat.directory') return { items: [] }
    if (operation === 'source.timeline') return { source, items: [], hasMore: false }
    if (operation === 'chat.official-author.profile' || operation === 'arko.profile') throw new Error('unused')
    return {}
  })
  arkmeChatDirectory.activateAccount('test:7001')
  arkmeChatDirectory.publish([source, other])
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7001 })
  arkmeUi.selectSource(other)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<ArkmeNavigation onActivateSurface={onActivateSurface} />))
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  arkmeChatDirectory.activateAccount(undefined)
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  arkmeUi.showLogin(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
async function preview() {
  expect(row()).not.toBeNull()
  row().focus()
  await act(async () => row().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 })))
  expect(menuItem('预览')).toBeDefined()
  menuItem('预览')!.focus()
  await act(async () => menuItem('预览')!.click())
}

it('opens preview from the actual menu without optimistic read or navigation; a normal click still marks read', async () => {
  const mark = vi.spyOn(arkmeChatDirectory, 'markReadOptimistic')
  const before = arkmeUi.getSnapshot().selectedSource
  const activations = onActivateSurface.mock.calls.length
  await preview()
  expect(dialog()).not.toBeNull()
  expect(mark).not.toHaveBeenCalled()
  expect(arkmeUi.getSnapshot().selectedSource).toEqual(before)
  expect(onActivateSurface).toHaveBeenCalledTimes(activations)
  expect(row()).not.toBeNull()
  expect(state.callArkme.mock.calls.some(([operation]) => operation === 'source.mark-read')).toBe(false)
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭聊天预览"]')!.click())
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(row())
  await act(async () => row().click())
  expect(mark).toHaveBeenCalledOnce()
  expect(arkmeUi.getSnapshot().selectedSource?.sourceRef).toBe(source.sourceRef)
})

it('keeps the actual navigation badge and native count equal to the row after a click and delayed Host replay', async () => {
  await act(async () => root.render(<><ArkmeProductNavigation compact={false} /><ArkmeNavigation /></>))
  const apply = vi.fn(async () => true)
  const stop = startArkmeDirectoryBadge(apply, 'test:7001')
  try {
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[data-arkme-unread-count="5"]')).not.toBeNull()
    expect(row()).not.toBeNull()
    expect(apply).toHaveBeenLastCalledWith(5)
    await act(async () => row().click())
    expect(document.querySelector('[data-arkme-unread-count]')).toBeNull()
    expect(row()).toBeNull()
    expect(apply).toHaveBeenLastCalledWith(0)
    await act(async () => arkmeChatDirectory.upsert(source))
    expect(document.querySelector('[data-arkme-unread-count]')).toBeNull()
    expect(row()).toBeNull()
    expect(apply).toHaveBeenLastCalledWith(0)
  } finally { stop() }
})


it.each(['account', 'environment', 'logout', 'inactive'] as const)('discards the preview and cancels its pending read on %s change', async change => {
  let resolve!: (value: unknown) => void
  const original = state.callArkme.getMockImplementation()!
  state.callArkme.mockImplementation((operation: string) => operation === 'source.timeline'
    ? new Promise(finish => { resolve = finish }) : original(operation))
  await preview()
  const signal = state.callArkme.mock.calls.find(([operation]) => operation === 'source.timeline')![2] as AbortSignal
  await act(async () => {
    if (change === 'inactive') root.render(<ArkmeNavigation active={false} />)
    else arkmeAuthStore.setAuth(change === 'logout' ? { status: 'logged-out', environment: 'test' }
      : { status: 'authenticated', environment: change === 'environment' ? 'production' : 'test', userId: change === 'account' ? 7002 : 7001 })
  })
  expect(dialog()).toBeNull()
  expect(signal.aborted).toBe(true)
  expect(arkmeVisibleReadIntentAllowed({ visibilityState: 'visible', hasFocus: () => true })).toBe(true)
  await act(async () => resolve({ source, items: [], hasMore: false }))
  expect(dialog()).toBeNull()
})

it('uses a rotated signed ref for the same stable conversation and closes when the source disappears', async () => {
  await preview()
  const node = dialog()
  await act(async () => arkmeChatDirectory.publish([{ ...source, sourceRef: 'rotated-reference' }, other]))
  expect(dialog()).toBe(node)
  const reads = state.callArkme.mock.calls.filter(([operation]) => operation === 'source.timeline')
  expect(reads.at(-1)?.[1]).toMatchObject({ sourceRef: 'rotated-reference' })
  expect(arkmeUi.getSnapshot().selectedSource?.sourceRef).toBe(other.sourceRef)
  await act(async () => arkmeChatDirectory.publish([other]))
  expect(dialog()).toBeNull()
  await act(async () => arkmeChatDirectory.publish([source, other]))
  expect(dialog()).toBeNull()
})
