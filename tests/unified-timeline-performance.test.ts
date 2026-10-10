import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { UnifiedTimelineCache } from '../src/unified-timeline-cache.js'
import { CHAT_TIMELINE_SOURCES } from '../src/unified-chat-timeline.js'
import type { ArkmeTimelinePage } from '../src/types.js'

const page = (index: number, retired = false): ArkmeTimelinePage => ({
  source: { sourceRef: 'opaque', kind: 'private_chat', displayName: 'Peer' }, items: [], hasMore: false,
  unified: { protocolVersion: 1, events: Array.from({ length: 40 }, (_, n) => ({
    eventId: `${index}:${n}`, source: 'interwoven', occurredAtMillis: 10, orderTie: `${n}`,
    contentStatus: 'available', kind: 'notice', text: `${index}:${n}:${'x'.repeat(1000)}`,
  })), sources: CHAT_TIMELINE_SOURCES.map(source => ({ source,
    status: retired && source !== 'interwoven' ? 'not_applicable' : 'ready', itemCount: 0 })),
  complete: true, windowTokens: ['opaque'], olderHasMore: false, newerHasMore: false, hasMore: false },
})

describe('unified timeline cache hot path', () => {
  it('does not rewrite all cached windows for an unchanged inapplicable source', () => {
    const path = mkdtempSync(join(tmpdir(), 'arkme timeline performance '))
    const cache = new UnifiedTimelineCache(path)
    const db = new DatabaseSync(join(path, 'chat-timeline.sqlite3'))
    try {
      for (let i = 0; i < 256; i++) cache.write('scope', `${i}`, page(i))
      cache.write('scope', '0', page(0, true))
      db.exec('CREATE TABLE audit (updates INTEGER); INSERT INTO audit VALUES (0); CREATE TRIGGER audit_updates AFTER UPDATE ON pages BEGIN UPDATE audit SET updates=updates+1; END;')
      const start = performance.now()
      for (let i = 0; i < 10; i++) cache.write('scope', '0', page(0, true))
      const updates = Number(db.prepare('SELECT updates FROM audit').get()!.updates)
      process.stdout.write(`UNIFIED_CACHE_PROFILE ${JSON.stringify({ pages: 256, eventsPerPage: 40, writes: 10, milliseconds: performance.now() - start, metadataRewrites: updates })}\n`)
      expect(updates).toBe(0)
      expect(cache.read('scope', '255')?.unified?.events).toHaveLength(40)
      // Becoming applicable invalidates the optimization, and the next revocation
      // still updates every historical window, including after a restart.
      cache.write('scope', '0', page(0))
      cache.write('scope', '1', page(1, true))
      expect(cache.read('scope', '0')?.unified?.sources.find(s => s.source === 'messages')?.status).toBe('not_applicable')
      for (let i = 256; i < 276; i++) cache.write(`scope-${i}`, 'initial', page(i))
      expect(Number(db.prepare('SELECT count(*) AS n FROM pages').get()!.n)).toBe(256)
    } finally { db.close(); cache.close(); rmSync(path, { recursive: true, force: true }) }
  }, 30000)
})
