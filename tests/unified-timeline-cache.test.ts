import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { TIMELINE_CACHE_FILE, UnifiedTimelineCache } from '../src/unified-timeline-cache.js'
import { TimelineTokenCodec } from '../src/services/timeline-token.js'
import { CHAT_TIMELINE_SOURCES } from '../src/unified-chat-timeline.js'
import type { ArkmeTimelinePage } from '../src/types.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
const page = (text = 'body'): ArkmeTimelinePage => ({ source: { sourceRef: 'opaque', kind: 'private_chat', displayName: 'Peer' } as never, items: [], hasMore: false,
  unified: { protocolVersion: 2, events: [{ eventId: 'event', source: 'interwoven', occurredAtMillis: 10, orderTie: 'tie', contentStatus: 'available', kind: 'notice', text }],
    sources: CHAT_TIMELINE_SOURCES.map(source => ({ source, status: 'ready', itemCount: 0 })), complete: true, windowTokens: ['opaque'], olderHasMore: false, newerHasMore: false, hasMore: false } })

describe('timeline cache and tokens', () => {
  it.each(['原消息未找到', '此消息受隐私保护', '关联内容未找到', '关联内容受隐私保护', '内容已不可用', '此消息已无法查看'])(
    'hides legacy %s notices while preserving authority and recall rows across restart', text => {
      const path = mkdtempSync(join(tmpdir(), 'arkme hidden status ')); directories.push(path)
      const store = new UnifiedTimelineCache(path)
      const legacy = page(text)
      legacy.unified!.events[0]!.contentStatus = 'unavailable'
      legacy.unified!.events.push({ ...legacy.unified!.events[0]!, source: 'messages', eventId: 'recall', kind: 'notice', text: '对方撤回了一条消息' })
      store.write('scope', 'old', legacy)
      store.close()
      const restored = new UnifiedTimelineCache(path)
      try {
        const events = restored.read('scope', 'old')!.unified!.events
        expect(events).toHaveLength(2)
        expect(events[0]).toMatchObject({ contentStatus: 'unavailable', hidden: true })
        expect(events[1]).toMatchObject({ text: '对方撤回了一条消息' })
        expect(events[1]).not.toHaveProperty('hidden')
      } finally { restored.close() }
    })
  it('fences an older high-version response behind a newer canonical access restriction', () => {
    const path = mkdtempSync(join(tmpdir(), 'arkme restricted body order ')); directories.push(path)
    const store = new UnifiedTimelineCache(path)
    const message = (version: number, restricted = false): ArkmeTimelinePage => {
      const value = page()
      value.unified!.events = [{ ...value.unified!.events[0]!, source: 'messages', kind: 'message',
        contentStatus: restricted ? 'unavailable' : 'available', item: { itemUid: 'record', timelineItemKey: 'relation',
          recordVersion: version, status: restricted ? 0 : 1, textContent: restricted ? '此消息受隐私保护' : 'private body' } as never }]
      return value
    }
    try {
      store.write('scope', 'first', message(9))
      const stale = store.reserve()
      store.write('scope', 'restricted', message(0, true))
      store.write('scope', 'late', message(10), { ticket: stale })
      expect(store.read('scope', 'late')?.items[0]).toMatchObject({ status: 0, textContent: '此消息受隐私保护' })
      store.write('scope', 'fresh', message(10))
      expect(store.read('scope', 'fresh')?.items[0]).toMatchObject({ status: 1, textContent: 'private body' })
    } finally { store.close() }
  })
  it('keeps a retryable linked-content notice partial and stale without losing readable content', () => {
    const path = mkdtempSync(join(tmpdir(), 'arkme partial read state ')); directories.push(path)
    const store = new UnifiedTimelineCache(path)
    try {
      const partial = page('readable')
      partial.unified!.events.push({ eventId: 'pending', kind: 'notice', source: 'wechat_import', occurredAtMillis: 20,
        orderTie: 'pending', contentStatus: 'unavailable', text: '关联内容加载失败', retryable: true })
      store.write('scope', 'partial', partial)
      const restored = store.read('scope', 'partial')!
      expect(restored.unified?.events).toHaveLength(2)
      expect(restored.unified?.events[0]).toMatchObject({ text: 'readable' })
      expect(restored.unified?.events[1]).toMatchObject({ text: '关联内容加载失败', retryable: true })
      expect(restored.unified?.complete).toBe(false)
      expect(restored.cache?.stale).toBe(true)
    } finally { store.close() }
  })
  it.each(['message', 'notice'] as const)('revalidates legacy generic %s placeholders while retaining readable cached content', kind => {
    const path = mkdtempSync(join(tmpdir(), 'arkme legacy read state ')); directories.push(path)
    const store = new UnifiedTimelineCache(path)
    try {
      const legacy = page('readable')
      legacy.unified!.events.push({ eventId: 'legacy', source: 'messages', occurredAtMillis: 20, orderTie: 'legacy', contentStatus: 'unavailable',
        ...(kind === 'message' ? { kind, item: { itemUid: 'legacy', status: 0, textContent: '内容暂时不可用' } as never }
          : { kind, text: '内容暂时不可用' }) })
      store.write('scope', 'old', legacy, { latest: true })
      const restored = store.read('scope', 'old')!
      expect(restored.unified?.events).toHaveLength(1)
      expect(restored.unified?.events[0]).toMatchObject({ text: 'readable' })
      expect(restored.unified?.sources.find(source => source.source === 'messages')?.status).toBe('gap')
      expect(restored.unified?.complete).toBe(false)
      expect(restored.cache?.stale).toBe(true)
      store.write('empty', 'old', { ...legacy, unified: { ...legacy.unified!, events: legacy.unified!.events.slice(1) } })
      expect(store.read('empty', 'old')).toBeUndefined()
    } finally { store.close() }
  })
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
      expect(store.read('scope', 'initial')?.unified?.events[0]).toMatchObject({ contentStatus: 'unavailable', text: '此消息已无法查看', hidden: true })
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

it('persists arrival freshness separately from revocation fences across restart', () => {
  const path = mkdtempSync(join(tmpdir(), 'arkme arrival cache ')); directories.push(path)
  let store = new UnifiedTimelineCache(path)
  store.write('scope','initial',page())
  const ticket = store.reserve()
  store.invalidate('scope',undefined,false,true)
  expect(store.write('scope','initial',page('progress'),{ticket})).toBe(true)
  store.close(); store = new UnifiedTimelineCache(path)
  expect(store.read('scope','initial')).toMatchObject({cache:{stale:true},unified:{events:[{text:'progress'}]}})
  const late = store.reserve()
  store.invalidate('scope')
  expect(store.write('scope','initial',page('revoked'),{ticket:late})).toBe(false)
  expect(store.write('scope','initial',page('current'))).toBe(true)
  expect(store.read('scope','initial')?.cache?.stale).toBe(false)
  store.close()
})

it('bounds SQLite pages including coverage indexes before continuous writes exhaust the file', () => {
  const path = mkdtempSync(join(tmpdir(), 'arkme coverage capacity ')); directories.push(path)
  let store = new UnifiedTimelineCache(path)
  const window = page()
  const token = 'coverage-'.repeat(100)
  window.unified!.windowTokens = [token]
  window.unified!.events = Array.from({ length: 400 }, (_, i) => ({
    ...window.unified!.events[0]!, eventId: `event-${i}`, windowToken: token,
  }))
  try {
    for (let i = 0; i < 180; i++) {
      window.unified!.events[0]!.eventId = `anchor-${i}`
      expect(store.write('scope', `window-${i}`, window, { latest: true })).toBe(true)
    }
    expect(store.read('scope', 'window-0')).toBeUndefined()
    expect(store.read('scope', '', 'anchor-179')?.unified?.events).toHaveLength(400)
    store.close(); store = new UnifiedTimelineCache(path)
    expect(store.read('scope', '', undefined, true)?.unified?.events[0]?.eventId).toBe('anchor-179')
    const db = new DatabaseSync(join(path, TIMELINE_CACHE_FILE), { readOnly: true })
    try {
      const pages = Number(db.prepare('PRAGMA page_count').get()!.page_count)
      const free = Number(db.prepare('PRAGMA freelist_count').get()!.freelist_count)
      const size = Number(db.prepare('PRAGMA page_size').get()!.page_size)
      expect((pages - free) * size).toBeLessThanOrEqual(96 * 1024 * 1024)
      expect(db.prepare('PRAGMA quick_check').get()!.quick_check).toBe('ok')
    } finally { db.close() }
  } finally { store.close() }
}, 30_000)

it('reclaims an existing oversized coverage cache on open and keeps its recent anchor', () => {
  const path = mkdtempSync(join(tmpdir(), 'arkme legacy capacity ')); directories.push(path)
  const window = page()
  const token = 'coverage-'.repeat(100)
  window.unified!.windowTokens = [token]
  window.unified!.events = Array.from({ length: 400 }, (_, i) => ({
    ...window.unified!.events[0]!, eventId: `event-${i}`, windowToken: token,
  }))
  const original = new UnifiedTimelineCache(path)
  original.write('scope', 'seed', window, { latest: true }); original.close()
  // Valid old-format windows: before physical accounting these repeated indexed
  // coverage tokens were invisible to the payload-byte budget.
  const db = new DatabaseSync(join(path, TIMELINE_CACHE_FILE))
  try {
    db.exec('PRAGMA max_page_count=32768; BEGIN')
    for (let i = 0; i < 140; i++) {
      db.prepare("INSERT INTO pages SELECT scope,?,metadata,?,?,1 FROM pages WHERE request='seed'").run(`legacy-${i}`, i + 2, i + 2)
      db.prepare("INSERT INTO entries SELECT scope,?,ordinal,event_id,token FROM entries WHERE request='seed'").run(`legacy-${i}`)
    }
    db.exec('UPDATE clock SET ticket=200; COMMIT')
    expect(Number(db.prepare('PRAGMA page_count').get()!.page_count) * 4096).toBeGreaterThan(96 * 1024 * 1024)
  } finally { db.close() }
  const store = new UnifiedTimelineCache(path)
  try {
    expect(store.read('scope', 'seed')).toBeUndefined()
    expect(store.read('scope', 'legacy-139')?.unified?.events).toHaveLength(400)
    expect(store.read('scope', '', 'event-0')?.unified?.events).toHaveLength(400)
    expect(store.write('scope', 'latest', page('new arrival'), { latest: true })).toBe(true)
    expect(store.read('scope', '', undefined, true)?.unified?.events[0]).toMatchObject({ text: 'new arrival' })
  } finally { store.close() }
}, 30_000)
