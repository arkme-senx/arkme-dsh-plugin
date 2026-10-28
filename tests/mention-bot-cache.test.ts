import { describe, expect, it, vi } from 'vitest'
import { MentionBotCache, mentionBotCacheKey, type MentionBotData } from '../src/client/mention-bot-cache.js'
const data: MentionBotData = { group: [{ botRef: 'a', name: '助手', description: '', installed: true }], private: [] }
describe('mention bot cache', () => {
  it('deduplicates prefetch/open requests and reuses fresh candidates', async () => {
    const cache = new MentionBotCache()
    let resolve!: (value: MentionBotData) => void
    const fetch = vi.fn(() => new Promise<MentionBotData>(done => { resolve = done }))
    const a = cache.load('a', fetch); const b = cache.load('a', fetch)
    await Promise.resolve(); expect(fetch).toHaveBeenCalledTimes(1)
    resolve(data); await Promise.all([a, b])
    await cache.load('a', fetch); expect(fetch).toHaveBeenCalledTimes(1)
    expect(cache.get('a').group).toEqual(data.group)
  })
  it('retains usable data on a failed refresh and permits explicit retry', async () => {
    let now = 0
    const cache = new MentionBotCache(() => now)
    await cache.load('a', async () => data)
    now = 300_001
    await cache.load('a', async () => { throw new Error('offline') })
    expect(cache.get('a')).toMatchObject({ ready: true, error: true, loading: false, group: data.group })
    await cache.load('a', async () => ({ group: [], private: [] }), true)
    expect(cache.get('a')).toMatchObject({ error: false, group: [] })
  })
  it('isolates environment, account and group and ignores invalidated pending responses', async () => {
    const a = mentionBotCacheKey('prod:1', 'group_chat', 'one')!
    expect(a).not.toBe(mentionBotCacheKey('test:1', 'group_chat', 'one'))
    expect(a).not.toBe(mentionBotCacheKey('prod:2', 'group_chat', 'one'))
    expect(a).not.toBe(mentionBotCacheKey('prod:1', 'group_chat', 'two'))
    expect(mentionBotCacheKey(undefined, 'group_chat', 'one')).toBeUndefined()
    const cache = new MentionBotCache()
    let resolve!: (value: MentionBotData) => void
    const pending = cache.load(a, () => new Promise(done => { resolve = done }))
    await Promise.resolve(); cache.clear(); resolve(data); await pending
    expect(cache.get(a).ready).toBe(false)
  })
  it('removes a confirmed uninstalled bot immediately and does not restore it from an older request', async () => {
    const cache = new MentionBotCache()
    await cache.load('a', async () => data)
    let resolve!: (value: MentionBotData) => void
    const pending = cache.load('a', () => new Promise(done => { resolve = done }), true)
    await Promise.resolve(); cache.invalidate('a', 'a')
    resolve(data); await pending
    expect(cache.get('a').group).toEqual([])
  })
})
