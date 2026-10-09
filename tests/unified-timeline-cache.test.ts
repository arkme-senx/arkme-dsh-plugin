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
    expect(store.read('test/account/chat', 'initial')).toEqual(page())
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
