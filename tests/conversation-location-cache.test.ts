import { describe, expect, it, vi } from 'vitest'
import { ConversationLocationCache } from '../src/client/conversation-location-cache.js'
import type { ConversationLocationPage, ConversationLocationRecord } from '../src/conversation-location.js'
const point = (key: string) => ({ key, record: { recordUid: key } }) as ConversationLocationRecord
describe('scoped history location cache', () => {
  it('publishes progressive pages and reuses a complete account/scope snapshot', async () => {
    let resolve!: (value: ConversationLocationPage) => void
    const read = vi.fn(async (_source: string, cursor: string | undefined) => cursor
      ? await new Promise<ConversationLocationPage>(done => { resolve = done }) : { items: [point('one')], scanned: 20, hasMore: true, nextCursor: 'page-2' })
    const cache = new ConversationLocationCache(read); cache.activate('account')
    const loading = cache.load('account', 'self')
    await vi.waitFor(() => expect(cache.get('account', 'self').items).toHaveLength(1))
    expect(cache.get('account', 'self')).toMatchObject({ loading: true, complete: false, scanned: 20 })
    resolve({ items: [point('one'), point('two')], scanned: 4, hasMore: false }); await loading
    expect(cache.get('account', 'self')).toMatchObject({ complete: true, loading: false, scanned: 24 })
    expect(cache.get('account', 'self').items).toHaveLength(2)
    await cache.load('account', 'self'); expect(read).toHaveBeenCalledTimes(2)
  })
  it('cancels obsolete scope reads and discards late responses on account switch', async () => {
    const pending: Array<{ source: string; signal: AbortSignal; resolve(value: ConversationLocationPage): void }> = []
    const cache = new ConversationLocationCache((source, _cursor, signal) => new Promise(resolve => pending.push({ source, signal, resolve })))
    cache.activate('one'); const first = cache.load('one', 'self'); await Promise.resolve()
    const second = cache.load('one', 'topic'); await Promise.resolve()
    expect(pending[0]!.signal.aborted).toBe(true)
    cache.activate('two'); expect(pending[1]!.signal.aborted).toBe(true)
    for (const task of pending) task.resolve({ items: [point('secret')], scanned: 1, hasMore: false })
    await Promise.all([first, second]); expect(cache.get('two', 'topic').items).toEqual([])
  })
  it('retains a completed snapshot during refresh, and exposes partial failures', async () => {
    const read = vi.fn(async () => ({ items: [point('old')], scanned: 1, hasMore: false }))
    const cache = new ConversationLocationCache(read); cache.activate('a'); await cache.load('a', 'self')
    read.mockRejectedValueOnce(new Error('离线'))
    await cache.load('a', 'self', true)
    expect(cache.get('a', 'self')).toMatchObject({ items: [point('old')], complete: true, loading: false, error: '离线' })
    cache.invalidate(true); expect(cache.get('a', 'self').items).toEqual([])
  })
  it('rejects repeated pagination without treating partial data as complete', async () => {
    const cache = new ConversationLocationCache(async () => ({ items: [point('one')], scanned: 20, hasMore: true, nextCursor: 'same' }))
    cache.activate('a'); await cache.load('a', 'self')
    expect(cache.get('a', 'self')).toMatchObject({ complete: false, loading: false, error: '位置分页未推进，请重试' })
  })
  it('stops after the current page when closed and resumes from the retained cursor', async () => {
    let resolve!: (page: ConversationLocationPage) => void
    const read = vi.fn(async (_source: string, cursor: string | undefined) => cursor
      ? { items: [point('older')], scanned: 3, hasMore: false }
      : await new Promise<ConversationLocationPage>(done => { resolve = done }))
    const cache = new ConversationLocationCache(read); cache.activate('a')
    const first = cache.load('a', 'self'); await Promise.resolve(); cache.pause('a', 'self')
    resolve({ items: [point('newer')], scanned: 20, hasMore: true, nextCursor: 'older-page' }); await first
    expect(read).toHaveBeenCalledTimes(1)
    expect(cache.get('a', 'self')).toMatchObject({ scanned: 20, complete: false, loading: false })
    await cache.load('a', 'self')
    expect(read.mock.calls[1]![1]).toBe('older-page')
    expect(cache.get('a', 'self')).toMatchObject({ scanned: 23, complete: true, loading: false })
    expect(cache.get('a', 'self').items.map(item => item.key)).toEqual(['newer', 'older'])
  })
})
