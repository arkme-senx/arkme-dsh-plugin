// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationViewportPersistence } from '../src/client/conversation-viewport-persistence.js'
import { ArkmeConversationMemoryCache } from '../src/client/conversation-memory-cache.js'
afterEach(() => { localStorage.clear(); vi.useRealTimers() })
it('keeps a shared hydration alive across conversation cancellation and retries a failed write', async () => {
  let read!: (value: unknown) => void
  const durable = { read: vi.fn((_account, _surface, signal: AbortSignal) => new Promise(resolve => {
    read = resolve; signal.addEventListener('abort', () => resolve([]), { once: true })
  })), write: vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(undefined) }
  const storage = new ConversationViewportPersistence(() => undefined, durable); storage.setScope('test:1')
  const outgoing = new AbortController(), pending = storage.hydrate(outgoing.signal)
  outgoing.abort()
  const incoming = storage.hydrate(new AbortController().signal)
  expect(durable.read.mock.calls[0][2].aborted).toBe(false)
  read([['B', { scrollTop: 50, stickToBottom: false }]])
  await Promise.all([pending, incoming])
  expect(durable.read).toHaveBeenCalledTimes(1)
  expect(storage.getViewport('B')?.scrollTop).toBe(50)
  storage.storeViewport('B', { scrollTop: 100, stickToBottom: false }); storage.flush(); await storage.settle()
  storage.flush(); await storage.settle()
  expect(durable.write).toHaveBeenCalledTimes(2)
  storage.setScope(undefined)
})
it('retries failed hydration on a later conversation without a retry loop', async () => {
  const durable = { read: vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue([['A', { scrollTop: 80, stickToBottom: false }]]), write: vi.fn() }
  const storage = new ConversationViewportPersistence(() => undefined, durable); storage.setScope('test:1')
  await storage.hydrate(); expect(durable.read).toHaveBeenCalledTimes(1)
  await storage.hydrate(); expect(storage.getViewport('A')?.scrollTop).toBe(80)
})
it('restores across different origins and does not persist each bottom-follow frame', async () => {
  let saved: unknown = []
  const durable = { read: vi.fn(async () => saved), write: vi.fn(async (_account, _surface, entries) => { saved = entries }) }
  const first = new ConversationViewportPersistence(() => undefined, durable); first.setScope('test:1')
  await first.hydrate()
  const anchor = { scrollTop: 800, stickToBottom: false, anchorId: 'message:opaque', anchorOffset: -12, messageAnchor: { itemUid: 'old-history', recordOwnerUserId: 3020 } }
  first.storeViewport('A', anchor); first.flush(); await first.settle()
  const newOrigin = new ConversationViewportPersistence(() => undefined, durable); newOrigin.setScope('test:1')
  await newOrigin.hydrate(); expect(newOrigin.getViewport('A')).toEqual(anchor)
  for (let i = 0; i < 100; i++) { newOrigin.storeViewport('A', { scrollTop: 1000 + i, stickToBottom: true }); newOrigin.flush(); await newOrigin.settle() }
  expect(durable.write).toHaveBeenCalledTimes(2)
})
it('fences old-account hydration and retains a newer local scroll while one write is blocked', async () => {
  let read!: (value: unknown) => void, release!: () => void
  const durable = { read: vi.fn(() => new Promise(resolve => { read = resolve })),
    write: vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve })).mockResolvedValue(undefined) }
  const storage = new ConversationViewportPersistence(() => undefined, durable); storage.setScope('test:1')
  const hydration = storage.hydrate(); storage.setScope('test:2')
  read([['A', { scrollTop: 999, stickToBottom: false }]]); await hydration
  expect(storage.getViewport('A')).toBeUndefined()
  const nextHydration = storage.hydrate()
  storage.storeViewport('A', { scrollTop: 50, stickToBottom: false }); storage.flush()
  for (let i = 51; i <= 100; i++) { storage.storeViewport('A', { scrollTop: i, stickToBottom: false }); storage.flush() }
  read([['A', { scrollTop: 1, stickToBottom: false }]]); await nextHydration
  expect(storage.getViewport('A')?.scrollTop).toBe(100)
  expect(durable.write).toHaveBeenCalledTimes(1)
  release(); await storage.settle()
  expect(durable.write).toHaveBeenCalledTimes(2)
  expect(durable.write).toHaveBeenLastCalledWith('test:2', 'main', [['A', { scrollTop: 100, stickToBottom: false }]])
})
it('keeps maximum length UTF-8 anchors within the persisted byte budget and restores the newest', () => {
  const storage = new ConversationViewportPersistence(); storage.setScope('test:1')
  for (let i = 0; i < 40; i++) storage.storeViewport(`${i}:${'源'.repeat(2000)}`, { scrollTop: i, stickToBottom: false, anchorId: '锚'.repeat(1000) })
  storage.flush()
  const raw = localStorage.getItem('arkme:reading:v1:main')!
  expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(65536)
  const restarted = new ConversationViewportPersistence(); restarted.setScope('test:1')
  expect(restarted.getViewport(`39:${'源'.repeat(2000)}`)?.scrollTop).toBe(39)
})
it('restores anchors after memory eviction/restart and separates account and native window', () => {
  const storage = new ConversationViewportPersistence()
  storage.setScope('test:1')
  const cache = new ArkmeConversationMemoryCache(1, storage)
  const viewport = { scrollTop: 800, stickToBottom: false, anchorId: 'message:opaque', anchorOffset: -12, messageAnchor: { itemUid: 'old-history', recordOwnerUserId: 3020 } }
  cache.storeViewport('A', viewport); cache.storeViewport('B', { scrollTop: 0, stickToBottom: true })
  expect(cache.getViewport('A')).toEqual(viewport)
  storage.flush()
  const restarted = new ConversationViewportPersistence(); restarted.setScope('test:1')
  expect(restarted.getViewport('A')).toEqual(viewport)
  const child = new ConversationViewportPersistence(); child.setScope('test:1', 'conversation:A')
  expect(child.getViewport('A')).toBeUndefined()
  child.storeViewport('A', { scrollTop: 100, stickToBottom: false }); child.flush()
  expect(restarted.getViewport('A')).toEqual(viewport)
  restarted.setScope('prod:1'); expect(restarted.getViewport('A')).toBeUndefined()
  restarted.setScope('test:2'); expect(restarted.getViewport('A')).toBeUndefined()
  child.flush(); restarted.flush()
})
it('coalesces scroll writes, caps saved sources and tolerates corrupt or unavailable storage', () => {
  vi.useFakeTimers()
  const set = vi.spyOn(Storage.prototype, 'setItem')
  const storage = new ConversationViewportPersistence(); storage.setScope('test:1')
  for (let i = 0; i < 200; i++) storage.storeViewport(`source-${i}`, { scrollTop: i, stickToBottom: false })
  expect(set).not.toHaveBeenCalled()
  vi.advanceTimersByTime(250)
  expect(set).toHaveBeenCalledTimes(1)
  const saved = JSON.parse(localStorage.getItem('arkme:reading:v1:main')!)
  expect(saved.entries).toHaveLength(40)
  localStorage.setItem('arkme:reading:v1:main', 'broken')
  expect(() => new ConversationViewportPersistence().setScope('test:1')).not.toThrow()
  const blocked = new ConversationViewportPersistence(() => { throw new Error('denied') })
  blocked.setScope('test:1'); blocked.storeViewport('A', { scrollTop: 0, stickToBottom: true }); blocked.flush()
  expect(blocked.getViewport('A')?.stickToBottom).toBe(true)
  vi.restoreAllMocks()
})
