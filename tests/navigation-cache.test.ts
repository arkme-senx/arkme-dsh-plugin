import { describe, expect, it } from 'vitest'
import {
  cachedSelectedSource, clearLastNavigationCache, readLastNavigationCache,
  readNavigationCache, reconcileSelectedSource, writeNavigationCache, type ArkmeNavigationCache,
} from '../src/client/navigation-cache.js'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('Arkme navigation cache', () => {
  it('persists account-scoped directories and the last selected source', () => {
    const storage = new MemoryStorage()
    const source = {
      sourceRef: 'source-private', kind: 'private_chat' as const, displayName: '联系人',
      activeAtMillis: 1, unreadCount: 2, latestPreview: '你好', avatarRef: 'avatar-ref', isMuted: true,
    }
    const cache: ArkmeNavigationCache = {
      version: 1, userId: 10001, directory: 'root', selectedSourceRef: source.sourceRef,
      sources: { root: [source] }, updatedAtMillis: 2,
    }

    writeNavigationCache(cache, storage)
    expect(readNavigationCache(10001, storage)).toEqual(cache)
    expect(readLastNavigationCache(storage)).toEqual(cache)
    expect(cachedSelectedSource(cache)).toEqual(source)
    expect(readNavigationCache(10002, storage)).toBeUndefined()

    clearLastNavigationCache(storage)
    expect(readLastNavigationCache(storage)).toBeUndefined()
    expect(readNavigationCache(10001, storage)).toEqual(cache)
  })

  it('preserves opaque topic parent references', () => {
    const storage = new MemoryStorage()
    const parent = {
      sourceRef: 'topic-parent', kind: 'topic' as const, displayName: '父主题',
      activeAtMillis: 1, unreadCount: 0,
    }
    const child = {
      sourceRef: 'topic-child', parentSourceRef: parent.sourceRef, kind: 'topic' as const,
      displayName: '子主题', activeAtMillis: 1, unreadCount: 0,
    }
    writeNavigationCache({
      version: 1, userId: 10001, directory: 'send_to_self',
      sources: { send_to_self: [parent, child] }, updatedAtMillis: 2,
    }, storage)

    expect(readNavigationCache(10001, storage)?.sources.send_to_self?.[1]).toMatchObject({
      sourceRef: child.sourceRef,
      parentSourceRef: parent.sourceRef,
    })
  })

  it('ignores malformed persisted source data', () => {
    const storage = new MemoryStorage()
    storage.setItem('dsh-arkme:navigation:v1:last-user', '10001')
    storage.setItem('dsh-arkme:navigation:v1:user:10001', JSON.stringify({
      version: 1, userId: 10001, directory: 'root', sources: { root: [{ displayName: 'bad' }] },
    }))
    expect(readLastNavigationCache(storage)?.sources.root).toEqual([])
  })

  it('rebinds a cached selection to the current Provider source reference', () => {
    const cached = {
      sourceRef: 'old-signed-ref', kind: 'default_category' as const, displayName: '默认分类',
      activeAtMillis: 1, unreadCount: 0,
    }
    const current = { ...cached, sourceRef: 'new-signed-ref' }

    expect(reconcileSelectedSource(cached, [current])).toEqual(current)
    expect(reconcileSelectedSource(cached, [
      { ...current, sourceRef: 'new-ref-1' },
      { ...current, sourceRef: 'new-ref-2' },
    ])).toBeUndefined()
  })
})
