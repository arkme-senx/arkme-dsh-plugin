// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

const provider = vi.hoisted(() => vi.fn())
vi.mock('../src/sdk/index.js', async original => ({
  ...await original<typeof import('../src/sdk/index.js')>(), callArkme: provider,
}))

import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { OfficialNotificationStore, officialNotifications } from '../src/client/official-notification-store.js'
import { ArkmeNotificationCenter, arkmeNotificationStore } from '../src/client/ArkmeNotificationCenter.js'

const notice = { id: 'notice-one', title: '公告', summary: '', publishedAtMillis: 100, readAtMillis: 0 }
const page = { items: [notice], nextCursor: 'next-page' }
const summary = { total: 2, unreadCount: 1 }
let store: OfficialNotificationStore
let release: () => void
let renderer: ReactTestRenderer | undefined

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

function calls(operation: string) {
  return provider.mock.calls.filter(args => args[0] === operation)
}

async function ready() {
  await vi.waitFor(() => expect(store.getSnapshot()).toMatchObject({ ready: true, loading: false, nextCursor: 'next-page' }))
}

function abortable(signal?: AbortSignal) {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) reject(signal.reason)
    else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

async function occupyBackground() {
  const controller = new AbortController()
  const completed = Promise.allSettled([1, 2].map(index => callArkme(
    'image.read', { imageRef: String(index) }, controller.signal, { priority: 'background' },
  )))
  try { await vi.waitFor(() => expect(calls('image.read')).toHaveLength(2)) }
  catch (error) { controller.abort(); await completed; throw error }
  return async () => { controller.abort(); await completed }
}

beforeEach(() => {
  provider.mockReset()
  provider.mockImplementation(async (operation: string, params: Record<string, unknown> | undefined, signal?: AbortSignal) => {
    if (operation === 'image.read') return abortable(signal)
    if (operation === 'official-notifications.summary') return summary
    if (operation === 'official-notifications.list') return params?.cursor ? { items: [{ ...notice, id: 'notice-two' }], nextCursor: '' } : page
    if (['arrangements.reminders.list', 'world.mine', 'ai-letter.list'].includes(operation)) return { items: [] }
    if (['world.interactions.summary', 'ai-letter.unread'].includes(operation)) return { unreadCount: 0, seenThroughSequence: 0 }
    return {}
  })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 4 })
  store = new OfficialNotificationStore()
  release = store.acquire('test:4')
})

afterEach(async () => {
  await act(async () => { renderer?.unmount() })
  renderer = undefined
  release()
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  await arkmeNotificationStore.refresh()
  vi.restoreAllMocks()
})

it.each(['more', 'retry'] as const)('dispatches user %s while two unrelated background images are still pending', async action => {
  await ready()
  if (action === 'retry') {
    provider.mockRejectedValueOnce(new Error('offline'))
    await store.refresh()
    expect(store.getSnapshot().error).toBe('offline')
  }
  const releaseImages = await occupyBackground()
  try {
    let done = false
    const refreshing = (action === 'more' ? store.more() : store.refresh()).then(() => { done = true })
    await vi.waitFor(() => expect(done).toBe(true), { timeout: 200 })
    await refreshing
    expect(store.getSnapshot()).toMatchObject({ loading: false, ready: true })
    expect(store.getSnapshot().error).toBeUndefined()
    expect(store.getSnapshot().items).toHaveLength(action === 'more' ? 2 : 1)
  } finally { await releaseImages() }
})

it('cancels queued automatic reads when the user loads more', async () => {
  await ready()
  const releaseImages = await occupyBackground()
  try {
    store.invalidate('test:4')
    await vi.waitFor(() => expect(store.getSnapshot()).toMatchObject({ loading: true, foregroundLoading: false }))
    expect(calls('official-notifications.list')).toHaveLength(1)
    let done = false
    const more = store.more().then(() => { done = true })
    await vi.waitFor(() => expect(done).toBe(true), { timeout: 200 })
    await more
    expect(store.getSnapshot().items).toHaveLength(2)
  } finally { await releaseImages() }
  // Cancelled queued summary/list must not dispatch later when image slots open.
  expect(calls('official-notifications.summary')).toHaveLength(2)
  expect(calls('official-notifications.list')).toHaveLength(3)
})

it('discards active background results and old cleanup while a replacement is still loading', async () => {
  await ready()
  const oldList = deferred<typeof page>()
  const oldSummary = deferred<typeof summary>()
  const foregroundList = deferred<typeof page>()
  provider.mockImplementationOnce(() => oldSummary.promise).mockImplementationOnce(() => oldList.promise)
  const automatic = store.refresh('background')
  await vi.waitFor(() => expect(calls('official-notifications.list')).toHaveLength(2))
  const oldSignals = calls('official-notifications.list').at(-1)![2] as AbortSignal
  provider.mockImplementationOnce(async () => summary).mockImplementationOnce(() => foregroundList.promise)
  const foreground = store.refresh()
  await vi.waitFor(() => expect(calls('official-notifications.list')).toHaveLength(3))
  expect(oldSignals.aborted).toBe(true)
  oldSummary.resolve({ total: 99, unreadCount: 99 })
  oldList.resolve({ items: [{ ...notice, id: 'stale' }], nextCursor: 'stale-next' })
  await automatic
  expect(store.getSnapshot()).toMatchObject({ loading: true, foregroundLoading: true })
  expect(store.getSnapshot().items).toEqual([notice])
  foregroundList.resolve(page)
  await foreground
  expect(store.getSnapshot()).toMatchObject({ loading: false, foregroundLoading: false, summary })
  expect(store.getSnapshot().items).toEqual([notice])
})

it('coalesces repeated user clicks without advancing more than one extra page', async () => {
  await ready()
  const firstPage = deferred<typeof page>()
  provider.mockImplementationOnce(async () => summary).mockImplementationOnce(() => firstPage.promise)
  const more = store.more()
  const duplicateMore = store.more()
  const retry = store.refresh()
  await vi.waitFor(() => expect(calls('official-notifications.list')).toHaveLength(2))
  firstPage.resolve(page)
  await Promise.all([more, duplicateMore, retry])
  expect(calls('official-notifications.list').map(call => call[1].cursor)).toEqual(['', '', 'next-page'])
  expect(calls('official-notifications.summary')).toHaveLength(2)
  expect(store.getSnapshot().items).toHaveLength(2)
})

it('retains foreground priority for an invalidation during a user read without recover adding another run', async () => {
  await ready()
  const releaseImages = await occupyBackground()
  const firstPage = deferred<typeof page>()
  provider.mockImplementationOnce(async () => summary).mockImplementationOnce(() => firstPage.promise)
  try {
    const foreground = store.refresh()
    await vi.waitFor(() => expect(calls('official-notifications.list')).toHaveLength(2))
    const activeSignal = calls('official-notifications.list').at(-1)![2] as AbortSignal
    const recover = store.refresh('background')
    store.invalidate('test:4')
    expect(activeSignal.aborted).toBe(false)
    firstPage.resolve({ items: [{ ...notice, id: 'stale' }], nextCursor: '' })
    await Promise.all([foreground, recover])
    await vi.waitFor(() => expect(store.getSnapshot()).toMatchObject({ loading: false, items: [notice] }), { timeout: 200 })
    expect(calls('official-notifications.list')).toHaveLength(3)
    expect(calls('official-notifications.summary')).toHaveLength(3)
  } finally { firstPage.resolve(page); await releaseImages() }
})

it('keeps a mark-read command alive during read promotion and reconciles its result in the foreground', async () => {
  await ready()
  const oldList = deferred<typeof page>()
  provider.mockImplementationOnce(async () => summary).mockImplementationOnce(() => oldList.promise)
  const automatic = store.refresh('background')
  await vi.waitFor(() => expect(calls('official-notifications.list')).toHaveLength(2))
  const mutation = deferred<typeof summary>()
  provider.mockImplementationOnce(() => mutation.promise)
  const writing = store.read('test:4')
  const writeSignal = calls('official-notifications.read')[0]![2] as AbortSignal
  const foreground = store.more()
  await foreground
  expect(writeSignal.aborted).toBe(false)
  oldList.resolve(page)
  await automatic
  const releaseImages = await occupyBackground()
  try {
    const original = provider.getMockImplementation()!
    provider.mockImplementation(async (operation: string, ...args: unknown[]) => operation === 'official-notifications.summary'
      ? { total: 2, unreadCount: 0 }
      : operation === 'official-notifications.list' ? { items: [{ ...notice, readAtMillis: 101 }], nextCursor: '' }
      : original(operation, ...args))
    mutation.resolve({ total: 2, unreadCount: 0 })
    await writing
    await vi.waitFor(() => expect(store.getSnapshot()).toMatchObject({ loading: false, summary: { unreadCount: 0 } }), { timeout: 200 })
    oldList.resolve(page)
    await automatic
    expect(store.getSnapshot().items[0]?.readAtMillis).toBe(101)
    expect(writeSignal.aborted).toBe(false)
  } finally { mutation.resolve(summary); oldList.resolve(page); await releaseImages() }
})

it('promotes a queued automatic read after marking notifications read', async () => {
  await ready()
  const releaseImages = await occupyBackground()
  try {
    store.invalidate('test:4')
    await vi.waitFor(() => expect(store.getSnapshot()).toMatchObject({ loading: true, foregroundLoading: false }))
    const original = provider.getMockImplementation()!
    provider.mockImplementation(async (operation: string, ...args: unknown[]) => operation === 'official-notifications.summary'
      ? { total: 2, unreadCount: 0 }
      : operation === 'official-notifications.list' ? { items: [{ ...notice, readAtMillis: 101 }], nextCursor: '' }
      : original(operation, ...args))
    await store.read('test:4')
    await vi.waitFor(() => expect(store.getSnapshot()).toMatchObject({ loading: false, summary: { unreadCount: 0 } }), { timeout: 200 })
    expect(store.getSnapshot().items[0]?.readAtMillis).toBe(101)
    expect(calls('official-notifications.read')).toHaveLength(1)
    expect(calls('official-notifications.summary')).toHaveLength(2)
  } finally { await releaseImages() }
})

it('does not reconcile an old-account mark-read command into the replacement account', async () => {
  await ready()
  const mutation = deferred<typeof summary>()
  provider.mockImplementationOnce(() => mutation.promise)
  const writing = store.read('test:4')
  const writeSignal = calls('official-notifications.read')[0]![2] as AbortSignal
  release()
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 99 })
  release = store.acquire('test:99')
  await vi.waitFor(() => expect(store.getSnapshot()).toMatchObject({ scope: 'test:99', loading: false, ready: true }))
  expect(writeSignal.aborted).toBe(true)
  mutation.resolve({ total: 99, unreadCount: 0 })
  await writing
  expect(calls('official-notifications.summary')).toHaveLength(2)
  expect(store.getSnapshot()).toMatchObject({ scope: 'test:99', items: [notice], summary })
})

it.each([4, 99])('discards old foreground reads across logout and login as account %s', async userId => {
  await ready()
  const lateList = deferred<typeof page>()
  provider.mockImplementationOnce(async () => summary).mockImplementationOnce(() => lateList.promise)
  const stale = store.refresh()
  await vi.waitFor(() => expect(calls('official-notifications.list')).toHaveLength(2))
  const oldSignal = calls('official-notifications.list').at(-1)![2] as AbortSignal
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId })
  expect(oldSignal.aborted).toBe(true)
  release()
  release = store.acquire(`test:${userId}`)
  await vi.waitFor(() => expect(store.getSnapshot()).toMatchObject({ scope: `test:${userId}`, loading: false, ready: true }))
  lateList.resolve({ items: [{ ...notice, id: 'stale-account' }], nextCursor: '' })
  await stale
  expect(store.getSnapshot().items).toEqual([notice])
})

it.each(['more', 'retry'] as const)('keeps the real %s button clickable during an automatic background refresh', async action => {
  await ready()
  release()
  release = () => {}
  await act(async () => { renderer = create(<ArkmeNotificationCenter />) })
  await vi.waitFor(() => expect(officialNotifications.getSnapshot()).toMatchObject({ ready: true, loading: false, nextCursor: 'next-page' }))
  if (action === 'retry') {
    provider.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { await officialNotifications.refresh() })
    expect(officialNotifications.getSnapshot().error).toBe('offline')
  }
  const releaseImages = await occupyBackground()
  try {
    await act(async () => { officialNotifications.invalidate('test:4') })
    expect(officialNotifications.getSnapshot()).toMatchObject({ loading: true, foregroundLoading: false })
    const buttons = renderer!.root.findAll(node => node.type === 'button' && node.children.includes(action === 'more' ? '加载更多官方通知' : '重试'))
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.props.disabled).not.toBe(true)
    await act(async () => { buttons[0]!.props.onClick() })
    await vi.waitFor(() => expect(officialNotifications.getSnapshot()).toMatchObject({ loading: false }), { timeout: 200 })
    expect(officialNotifications.getSnapshot().error).toBeUndefined()
    expect(officialNotifications.getSnapshot().items).toHaveLength(action === 'more' ? 2 : 1)
  } finally { await act(async () => { await releaseImages() }) }
})
