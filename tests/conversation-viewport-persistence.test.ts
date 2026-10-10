// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationViewportPersistence } from '../src/client/conversation-viewport-persistence.js'
import { ArkmeConversationMemoryCache } from '../src/client/conversation-memory-cache.js'
afterEach(() => { localStorage.clear(); vi.useRealTimers() })
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
  const viewport = { scrollTop: 800, stickToBottom: false, anchorId: 'message:opaque', anchorOffset: -12 }
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
