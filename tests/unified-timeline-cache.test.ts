import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { UnifiedTimelineCache } from '../src/unified-timeline-cache.js'
import { TimelineTokenCodec } from '../src/services/timeline-token.js'
import { CHAT_TIMELINE_SOURCES } from '../src/unified-chat-timeline.js'
import type { ArkmeTimelinePage } from '../src/types.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
const page = (text = 'body'): ArkmeTimelinePage => ({ source: { sourceRef: 'opaque', kind: 'private_chat', displayName: 'Peer' } as never, items: [], hasMore: false,
  unified: { protocolVersion: 1, events: [{ eventId: 'event', source: 'interwoven', occurredAtMillis: 10, orderTie: 'tie', contentStatus: 'available', kind: 'notice', text }],
    sources: CHAT_TIMELINE_SOURCES.map(source => ({ source, status: 'ready', itemCount: 0 })), complete: true, windowTokens: ['opaque'], olderHasMore: false, newerHasMore: false, hasMore: false } })

describe('timeline cache and tokens', () => {
  it('keeps tokens confidential, stable and bound to environment/account/session/purpose', () => {
    const codec = new TimelineTokenCodec('secret', 'test/account/session')
    const token = codec.seal('upstream-private-cursor', 'older')
    expect(token).toBe(codec.seal('upstream-private-cursor', 'older'))
    expect(token).not.toContain('upstream-private-cursor')
    expect(codec.open(token, 'older')).toBe('upstream-private-cursor')
    expect(() => codec.open(token, 'newer')).toThrow()
    expect(() => new TimelineTokenCodec('secret', 'prod/account/session').open(token, 'older')).toThrow()
    expect(() => new TimelineTokenCodec('other', 'test/account/session').open(token, 'older')).toThrow()
  })
  it('restores bounded pages across restart in a path with spaces, isolated by scope', () => {
    const path = mkdtempSync(join(tmpdir(), 'arkme timeline cache ')); directories.push(path)
    let store = new UnifiedTimelineCache(path)
    store.write('test/account/chat', 'initial', page())
    expect(store.read('prod/account/chat', 'initial')).toBeUndefined()
    expect(store.read('test/other/chat', 'initial')).toBeUndefined()
    store.close(); store = new UnifiedTimelineCache(path)
    expect(store.read('test/account/chat', 'initial')).toMatchObject(page())
    store.write('test/account/chat', 'initial', page('updated'))
    expect(store.read('test/account/chat', 'initial')?.unified?.events[0]).toMatchObject({ text: 'updated' })
    store.close()
  })
  it('retires a source from every cached window and persists that retirement across restart', () => {
    const path = mkdtempSync(join(tmpdir(), 'arkme retired cache ')); directories.push(path)
    let store = new UnifiedTimelineCache(path)
    store.write('scope', 'initial', page()); store.write('scope', 'older', page())
    const next = page(); next.unified!.events = []; next.unified!.sources.find(s => s.source === 'interwoven')!.status = 'not_applicable'
    store.write('scope', 'refresh', next); store.close(); store = new UnifiedTimelineCache(path)
    for (const request of ['initial', 'older', 'refresh']) {
      expect(store.read('scope', request)?.unified?.events).toEqual([])
      expect(store.read('scope', request)?.unified?.sources.find(s => s.source === 'interwoven')?.status).toBe('not_applicable')
    }
    store.close()
  })
  it('does not lose the last committed page on capacity rejection', () => {
    const path = mkdtempSync(join(tmpdir(), 'arkme timeline cache ')); directories.push(path)
    const store = new UnifiedTimelineCache(path)
    store.write('scope', 'initial', page('good'))
    expect(() => store.write('scope', 'initial', page('x'.repeat(5 * 1024 * 1024)))).toThrow()
    expect(store.read('scope', 'initial')?.unified?.events[0]).toMatchObject({ text: 'good' })
    store.close()
  })
})

describe('canonical events and commit fences', () => {
  const setup = () => {
    const path = mkdtempSync(join(tmpdir(), 'arkme canonical timeline ')); directories.push(path)
    return { path, store: new UnifiedTimelineCache(path) }
  }
  it('hydrates every old page from the latest event without rewriting its metadata', () => {
    const { store } = setup()
    try {
      store.write('scope', 'older', page('old'))
      store.write('scope', 'newer', page('edited'))
      expect(store.read('scope', 'older')?.unified?.events[0]).toMatchObject({ text: 'edited' })
      const oldTicket = store.reserve(), newTicket = store.reserve()
      store.write('scope', 'newer', page('newest'), { ticket: newTicket })
      store.write('scope', 'late', page('stale'), { ticket: oldTicket })
      expect(store.read('scope', 'late')?.unified?.events[0]).toMatchObject({ text: 'newest' })
    } finally { store.close() }
  })
  it('never regresses body versions and keeps terminal fences across restart', () => {
    let { path, store } = setup()
    const message = (version: number, textContent: string): ArkmeTimelinePage => {
      const value = page(); value.unified!.events = [{ ...value.unified!.events[0]!, source: 'messages', kind: 'message',
        item: { itemUid: 'record', timelineItemKey: 'relation', recordVersion: version, textContent } as never }]; return value
    }
    try {
      store.write('scope', 'initial', message(3, 'new'))
      store.write('scope', 'old-response', message(2, 'old'))
      expect(store.read('scope', 'old-response')?.items[0]?.textContent).toBe('new')
      const late = store.reserve()
      store.invalidate('scope', 'relation', true)
      expect(store.write('scope', 'initial', message(4, 'late secret'), { ticket: late })).toBe(false)
      store.close(); store = new UnifiedTimelineCache(path)
      expect(store.read('scope', 'initial')?.items).toEqual([])
      expect(store.read('scope', 'initial')?.unified?.events[0]).toMatchObject({ contentStatus: 'unavailable' })
      expect(store.read('scope', 'initial')?.cache?.stale).toBe(true)
    } finally { store.close() }
  })
  it('keeps coverage tokens window-local while hydrating shared updated bodies and gaps', () => {
    const { store } = setup()
    try {
      const original = page('old'); original.unified!.events[0]!.windowToken = 'old-token'
      original.unified!.windowTokens = ['old-token']
      store.write('scope', 'old', original)
      const updated = page('edited'); updated.unified!.events[0]!.windowToken = 'new-token'
      updated.unified!.windowTokens = ['new-token']
      store.write('scope', 'new', updated)
      expect(store.read('scope', 'old')?.unified?.events[0]).toMatchObject({ text: 'edited', windowToken: 'old-token' })
      const gap = page(); gap.unified!.events = []; gap.unified!.complete = false
      gap.unified!.sources.find(source => source.source === 'interwoven')!.status = 'gap'
      store.write('scope', 'gap', gap, { refreshTokens: ['old-token'] })
      expect(store.read('scope', 'gap')?.unified?.events[0]).toMatchObject({ text: 'edited', windowToken: 'old-token' })
    } finally { store.close() }
  })
  it('only removes absent events inside completed ready coverage and retains gap bodies durably', () => {
    let { path, store } = setup()
    try {
      const first = page('covered'); first.unified!.events[0]!.windowToken = 'old-window'
      store.write('scope', 'initial', first)
      const refresh = page(); refresh.unified!.events = []; refresh.unified!.windowTokens = ['new-window']
      refresh.unified!.sources.find(source => source.source === 'interwoven')!.status = 'gap'; refresh.unified!.complete = false
      store.write('scope', 'refresh', refresh, { refreshTokens: ['old-window'], latest: true })
      store.close(); store = new UnifiedTimelineCache(path)
      expect(store.read('scope', '', undefined, true)?.unified?.events[0]).toMatchObject({ text: 'covered' })
      refresh.unified!.sources.find(source => source.source === 'interwoven')!.status = 'ready'; refresh.unified!.complete = true
      store.write('scope', 'complete', refresh, { refreshTokens: ['old-window'] })
      expect(store.read('scope', 'initial')?.unified?.events).toEqual([])
      expect(store.read('scope', 'refresh')?.unified?.events).toEqual([])
    } finally { store.close() }
  })
  it('restores the actual anchor window, never joins unrelated pages or accounts', () => {
    const { store } = setup()
    try {
      store.write('scope', 'around', page('history'))
      const latest = page('latest'); latest.unified!.events[0]!.eventId = 'tail'
      store.write('scope', 'initial', latest, { latest: true })
      expect(store.read('scope', '', 'event')?.unified?.events).toHaveLength(1)
      expect(store.read('scope', '', 'event')?.unified?.events[0]).toMatchObject({ text: 'history' })
      expect(store.read('scope', '', undefined, true)?.unified?.events[0]).toMatchObject({ eventId: 'tail' })
      expect(store.read('other-account', '', 'event')).toBeUndefined()
    } finally { store.close() }
  })
  it('rejects a late page after a completed refresh removed its event, including after restart', () => {
    let { path, store } = setup()
    try {
      const original = page(); original.unified!.events[0]!.windowToken = 'covered'
      store.write('scope', 'initial', original)
      const late = store.reserve()
      const refreshed = page(); refreshed.unified!.events = []
      store.write('scope', 'refresh', refreshed, { refreshTokens: ['covered'] })
      store.close(); store = new UnifiedTimelineCache(path)
      expect(store.write('scope', 'late-page', original, { ticket: late })).toBe(false)
      expect(store.read('scope', 'initial')?.unified?.events).toEqual([])
      expect(store.read('scope', 'late-page')).toBeUndefined()
    } finally { store.close() }
  })
})
