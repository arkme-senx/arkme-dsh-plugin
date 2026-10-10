import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { securePrivateDirectorySync, securePrivateFileSync } from './private-filesystem.js'
import type { ArkmeTimelinePage } from './types.js'
import { compareUnifiedTimelineEvents, type ArkmeUnifiedTimelineEvent } from './unified-chat-timeline.js'

export const TIMELINE_CACHE_FILE = 'chat-timeline-v2.sqlite3'
export const MAX_CACHED_WINDOWS = 256
export const MAX_TIMELINE_WINDOW_EVENTS = 2000
export const MAX_TIMELINE_WINDOW_BYTES = 4 * 1024 * 1024
const MAX_CACHE_BYTES = 64 * 1024 * 1024
export interface TimelineCacheCommit { ticket?: number; latest?: boolean; refreshTokens?: string[] }
type PageRow = { request: string; metadata: string; ticket: number }

/** Single-writer store. In production every call runs on the dedicated storage worker. */
export class UnifiedTimelineCache {
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    securePrivateDirectorySync(directory)
    const path = join(directory, TIMELINE_CACHE_FILE)
    this.db = new DatabaseSync(path)
    securePrivateFileSync(path)
    this.db.exec(`PRAGMA auto_vacuum=INCREMENTAL;
      PRAGMA journal_mode=WAL;
      PRAGMA max_page_count=32768;
      PRAGMA busy_timeout=1000;
      PRAGMA journal_size_limit=8388608;
      PRAGMA wal_autocheckpoint=256;
      CREATE TABLE IF NOT EXISTS clock (id INTEGER PRIMARY KEY, ticket INTEGER NOT NULL);
      INSERT OR IGNORE INTO clock VALUES (1,0);
      CREATE TABLE IF NOT EXISTS scopes (scope TEXT PRIMARY KEY, fence INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pages (scope TEXT NOT NULL, request TEXT NOT NULL, metadata TEXT NOT NULL, touched INTEGER NOT NULL, ticket INTEGER NOT NULL, latest INTEGER NOT NULL, PRIMARY KEY(scope,request));
      CREATE INDEX IF NOT EXISTS pages_recency ON pages(touched);
      CREATE INDEX IF NOT EXISTS pages_scope_latest ON pages(scope,latest,ticket DESC);
      CREATE INDEX IF NOT EXISTS pages_source_key ON pages(json_extract(metadata,'$.source.sourceKey'));
      CREATE TABLE IF NOT EXISTS contents (scope TEXT NOT NULL, event_id TEXT NOT NULL, source TEXT NOT NULL, payload TEXT NOT NULL, version INTEGER NOT NULL, ticket INTEGER NOT NULL, refs INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(scope,event_id));
      CREATE INDEX IF NOT EXISTS contents_orphans ON contents(scope) WHERE refs=0;
      CREATE TABLE IF NOT EXISTS entries (scope TEXT NOT NULL, request TEXT NOT NULL, ordinal INTEGER NOT NULL, event_id TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY(scope,request,ordinal));
      CREATE INDEX IF NOT EXISTS entries_content ON entries(scope,event_id);
      CREATE INDEX IF NOT EXISTS entries_token ON entries(scope,token);
      CREATE TRIGGER IF NOT EXISTS entry_added AFTER INSERT ON entries BEGIN UPDATE contents SET refs=refs+1 WHERE scope=NEW.scope AND event_id=NEW.event_id; END;
      CREATE TRIGGER IF NOT EXISTS entry_removed AFTER DELETE ON entries BEGIN UPDATE contents SET refs=refs-1 WHERE scope=OLD.scope AND event_id=OLD.event_id; END;
      CREATE TABLE IF NOT EXISTS sources (scope TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, ticket INTEGER NOT NULL, retired_ticket INTEGER NOT NULL, PRIMARY KEY(scope,source));
      CREATE TABLE IF NOT EXISTS cache_stats (id INTEGER PRIMARY KEY, bytes INTEGER NOT NULL);
      INSERT OR IGNORE INTO cache_stats VALUES (1,0);
      CREATE TRIGGER IF NOT EXISTS content_added AFTER INSERT ON contents BEGIN UPDATE cache_stats SET bytes=bytes+length(CAST(NEW.payload AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS content_changed AFTER UPDATE OF payload ON contents WHEN NEW.payload<>OLD.payload BEGIN UPDATE cache_stats SET bytes=bytes+length(CAST(NEW.payload AS BLOB))-length(CAST(OLD.payload AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS content_removed AFTER DELETE ON contents BEGIN UPDATE cache_stats SET bytes=bytes-length(CAST(OLD.payload AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS page_added AFTER INSERT ON pages BEGIN UPDATE cache_stats SET bytes=bytes+length(CAST(NEW.metadata AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS page_removed AFTER DELETE ON pages BEGIN UPDATE cache_stats SET bytes=bytes-length(CAST(OLD.metadata AS BLOB)) WHERE id=1; END;`)
  }
  private prepare(sql: string): StatementSync {
    let statement = this.statements.get(sql)
    if (!statement) { statement = this.db.prepare(sql); this.statements.set(sql, statement) }
    return statement
  }
  reserve(): number {
    return Number(this.prepare('UPDATE clock SET ticket=ticket+1 WHERE id=1 RETURNING ticket').get()!.ticket)
  }
  read(scope: string, request: string, anchorId?: string, latest = false): ArkmeTimelinePage | undefined {
    // An anchor selects an actual covered window; never fabricate coverage by concatenating disjoint pages.
    const row = (anchorId
      ? this.prepare('SELECT p.request,p.metadata,p.ticket FROM entries e JOIN pages p ON p.scope=e.scope AND p.request=e.request WHERE e.scope=? AND e.event_id=? ORDER BY p.ticket DESC LIMIT 1').get(scope, anchorId)
        // Compatibility identities scan canonical contents once, never once per window.
        ?? this.prepare("SELECT p.request,p.metadata,p.ticket FROM entries e JOIN pages p ON p.scope=e.scope AND p.request=e.request WHERE e.scope=? AND e.event_id IN (SELECT event_id FROM contents WHERE scope=? AND (json_extract(payload,'$.item.timelineItemKey')=? OR json_extract(payload,'$.item.itemUid')=? OR json_extract(payload,'$.item.momentId')=?)) ORDER BY p.ticket DESC LIMIT 1").get(scope, scope, anchorId, anchorId, anchorId)
      : latest ? this.prepare('SELECT request,metadata,ticket FROM pages WHERE scope=? AND latest=1 ORDER BY ticket DESC LIMIT 1').get(scope)
        : this.prepare('SELECT request,metadata,ticket FROM pages WHERE scope=? AND request=?').get(scope, request)) as PageRow | undefined
    if (!row) return undefined
    const page = JSON.parse(row.metadata) as ArkmeTimelinePage
    if (!page.unified) return undefined
    const rows = this.prepare('SELECT c.payload,e.token FROM entries e JOIN contents c ON c.scope=e.scope AND c.event_id=e.event_id WHERE e.scope=? AND e.request=? ORDER BY e.ordinal LIMIT 2000').all(scope, row.request) as unknown as Array<{ payload: string; token: string }>
    // Coverage belongs to the window reference, while the body is shared.
    page.unified.events = rows.map(row => ({ ...JSON.parse(row.payload), ...(row.token ? { windowToken: row.token } : {}) }) as ArkmeUnifiedTimelineEvent)
    const retired = new Set((this.prepare("SELECT source FROM sources WHERE scope=? AND status='not_applicable'").all(scope) as unknown as Array<{ source: string }>).map(row => row.source))
    page.unified.events = page.unified.events.filter(event => !retired.has(event.source))
    page.unified.sources = page.unified.sources.map(source => retired.has(source.source) ? { ...source, status: 'not_applicable', itemCount: 0 } : source)
    if (Buffer.byteLength(JSON.stringify(page)) > MAX_TIMELINE_WINDOW_BYTES) throw new Error('Cached window exceeds capacity')
    page.items = page.unified.events.flatMap(event => event.kind === 'message' ? [event.item] : [])
    const fence = Number(this.prepare('SELECT fence FROM scopes WHERE scope=?').get(scope)?.fence ?? 0)
    page.cache = { origin: 'local', persistence: 'committed', revision: row.ticket, stale: fence > row.ticket }
    this.prepare('UPDATE pages SET touched=? WHERE scope=? AND request=?').run(this.reserve(), scope, row.request)
    return page
  }
  write(scope: string, request: string, page: ArkmeTimelinePage, options: TimelineCacheCommit = {}): boolean {
    if (!page.unified || page.unified.events.length > MAX_TIMELINE_WINDOW_EVENTS || page.unified.windowTokens.length > 500) throw new Error('Invalid timeline cache window')
    if (options.refreshTokens?.length) {
      const gaps = new Set(page.unified.sources.filter(source => source.status === 'gap').map(source => source.source))
      if (gaps.size) {
        const events = new Map(page.unified.events.map(event => [event.eventId, event]))
        const select = this.prepare('SELECT event_id,payload FROM contents WHERE scope=? AND event_id IN (SELECT event_id FROM entries WHERE scope=? AND token=?)')
        for (const token of options.refreshTokens) for (const row of select.all(scope, scope, token)) {
          if (events.has(String(row.event_id))) continue
          const event = { ...JSON.parse(String(row.payload)), windowToken: token } as ArkmeUnifiedTimelineEvent
          if (gaps.has(event.source) && !events.has(event.eventId)) events.set(event.eventId, event)
          if (events.size > MAX_TIMELINE_WINDOW_EVENTS) throw new Error('Timeline gap retention exceeds capacity')
        }
        page = { ...page, unified: { ...page.unified, events: [...events.values()].sort(compareUnifiedTimelineEvents),
          windowTokens: [...new Set([...options.refreshTokens, ...page.unified.windowTokens])] } }
      }
    }
    const window = page.unified!
    if (window.windowTokens.length > 500) throw new Error('Timeline gap coverage exceeds capacity')
    const { cache: _cache, ...value } = page
    const metadata = JSON.stringify({ ...value, items: [], unified: { ...window, events: [] } })
    const payloads = window.events.map(event => JSON.stringify(event))
    if (Buffer.byteLength(metadata) + payloads.reduce((n, value) => n + Buffer.byteLength(value), 0) > MAX_TIMELINE_WINDOW_BYTES) throw new Error('Timeline cache window exceeds capacity')
    const ticket = options.ticket ?? this.reserve()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const fence = Number(this.prepare('SELECT fence FROM scopes WHERE scope=?').get(scope)?.fence ?? 0)
      const existing = Number(this.prepare('SELECT ticket FROM pages WHERE scope=? AND request=?').get(scope, request)?.ticket ?? 0)
      if (ticket < fence || ticket < existing) { this.db.exec('ROLLBACK'); return false }
      let removed = false
      for (const source of window.sources) {
        if (source.status === 'gap') continue
        const old = this.prepare('SELECT ticket,retired_ticket,status FROM sources WHERE scope=? AND source=?').get(scope, source.source)
        if (Number(old?.ticket ?? 0) > ticket) continue
        if (source.status === 'not_applicable' && old?.status !== 'not_applicable') {
          removed = Number(this.prepare('DELETE FROM entries WHERE scope=? AND event_id IN (SELECT event_id FROM contents WHERE scope=? AND source=? AND ticket<=?)').run(scope, scope, source.source, ticket).changes) > 0 || removed
        }
        this.prepare('INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?)').run(scope, source.source, source.status, ticket,
          source.status === 'not_applicable' ? ticket : Number(old?.retired_ticket ?? 0))
      }
      // A completed refresh authoritatively replaces only its covered, ready sources.
      // A missing page or a gap never means deletion.
      if (options.refreshTokens?.length) {
        const incoming = new Set(window.events.map(event => event.eventId))
        const ready = new Set(window.sources.filter(source => source.status !== 'gap').map(source => source.source))
        const select = this.prepare('SELECT DISTINCT c.event_id,c.source,c.ticket FROM entries e JOIN contents c ON c.scope=e.scope AND c.event_id=e.event_id WHERE e.scope=? AND e.token=?')
        const remove = this.prepare('DELETE FROM entries WHERE scope=? AND event_id=?')
        for (const token of options.refreshTokens) for (const row of select.all(scope, token)) {
          if (Number(row.ticket) <= ticket && ready.has(String(row.source) as never) && !incoming.has(String(row.event_id))) {
            removed = Number(remove.run(scope, String(row.event_id)).changes) > 0 || removed
          }
        }
      }
      // Deleted content can be garbage-collected, but its authority must survive.
      // Reject pre-refresh responses even when they target a different cached page.
      if (removed) this.prepare('INSERT OR REPLACE INTO scopes VALUES (?,?)').run(scope, ticket)
      const stored = this.prepare('SELECT metadata FROM pages WHERE scope=? AND request=?').get(scope, request)
      if (stored?.metadata === metadata) {
        const contents = this.prepare('SELECT c.payload FROM entries e JOIN contents c ON c.scope=e.scope AND c.event_id=e.event_id WHERE e.scope=? AND e.request=? ORDER BY e.ordinal').all(scope, request)
        if (contents.length === payloads.length && contents.every((row, index) => row.payload === payloads[index])) {
          this.prepare('UPDATE contents SET ticket=max(ticket,?) WHERE scope=? AND event_id IN (SELECT event_id FROM entries WHERE scope=? AND request=?)').run(ticket, scope, scope, request)
          this.prepare('UPDATE pages SET ticket=?,touched=?,latest=? WHERE scope=? AND request=?').run(ticket, ticket, options.latest ? 1 : 0, scope, request)
          this.collect(scope)
          this.db.exec('COMMIT')
          return true
        }
      }
      this.remove(scope, request)
      this.prepare('INSERT INTO pages VALUES (?,?,?,?,?,?)').run(scope, request, metadata, ticket, ticket, options.latest ? 1 : 0)
      const content = this.prepare(`INSERT INTO contents(scope,event_id,source,payload,version,ticket) VALUES (?,?,?,?,?,?) ON CONFLICT(scope,event_id) DO UPDATE SET payload=excluded.payload,version=excluded.version,ticket=max(contents.ticket,excluded.ticket)
        WHERE excluded.version>contents.version OR excluded.ticket>=contents.ticket AND (excluded.version>=contents.version OR excluded.version=0 AND json_extract(excluded.payload,'$.contentStatus')='unavailable')`)
      const entry = this.prepare('INSERT INTO entries VALUES (?,?,?,?,?)')
      const sourceStates = new Map(this.prepare('SELECT source,retired_ticket,status FROM sources WHERE scope=?').all(scope).map(row => [String(row.source), row]))
      window.events.forEach((event, ordinal) => {
        const retired = sourceStates.get(event.source)
        if (retired?.status === 'not_applicable' || Number(retired?.retired_ticket ?? 0) > ticket) return
        const version = event.kind === 'message' ? event.item.recordVersion ?? event.item.version ?? 0 : 0
        content.run(scope, event.eventId, event.source, payloads[ordinal]!, version, ticket)
        entry.run(scope, request, ordinal, event.eventId, event.windowToken ?? '')
      })
      this.collect(scope)
      const oldest = this.prepare('SELECT scope,request FROM pages ORDER BY touched DESC LIMIT -1 OFFSET 256').all()
      for (const row of oldest) { this.remove(String(row.scope), String(row.request)); this.collect(String(row.scope)) }
      while (Number(this.prepare('SELECT bytes FROM cache_stats WHERE id=1').get()!.bytes) > MAX_CACHE_BYTES) {
        const row = this.prepare('SELECT scope,request FROM pages ORDER BY touched LIMIT 1').get()!
        this.remove(String(row.scope), String(row.request)); this.collect(String(row.scope))
      }
      this.prepare('DELETE FROM sources WHERE NOT EXISTS (SELECT 1 FROM pages WHERE pages.scope=sources.scope)').run()
      this.prepare('DELETE FROM scopes WHERE scope IN (SELECT scope FROM scopes ORDER BY fence DESC LIMIT -1 OFFSET 1024)').run()
      this.db.exec('COMMIT')
      try { this.db.exec('PRAGMA incremental_vacuum(32)') } catch { /* Maintenance cannot roll back an already committed window. */ }
      return true
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  invalidateSource(sourceKey: string, timelineItemKey?: string, terminal = false): void {
    const rows = this.prepare("SELECT DISTINCT scope FROM pages WHERE json_extract(metadata,'$.source.sourceKey')=?").all(sourceKey)
    for (const row of rows) this.invalidate(String(row.scope), timelineItemKey, terminal)
  }
  invalidate(scope: string, timelineItemKey?: string, terminal = false): void {
    const ticket = this.reserve()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.prepare('INSERT OR REPLACE INTO scopes VALUES (?,?)').run(scope, ticket)
      if (terminal && timelineItemKey) {
        // Persist the authority fence even when the new response has not arrived yet.
        const rows = this.prepare("SELECT event_id,payload FROM contents WHERE scope=? AND json_extract(payload,'$.item.timelineItemKey')=?").all(scope, timelineItemKey)
        for (const row of rows) {
          const event = JSON.parse(String(row.payload)) as ArkmeUnifiedTimelineEvent
          const hidden = { eventId: event.eventId, source: event.source, occurredAtMillis: event.occurredAtMillis, orderTie: event.orderTie,
            ...(event.windowToken ? { windowToken: event.windowToken } : {}), contentStatus: 'unavailable', kind: 'notice', text: '内容已不可用' }
          this.prepare('UPDATE contents SET payload=?,ticket=? WHERE scope=? AND event_id=?').run(JSON.stringify(hidden), ticket, scope, String(row.event_id))
        }
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private collect(scope: string): void {
    this.prepare('DELETE FROM contents WHERE scope=? AND refs=0').run(scope)
  }
  private remove(scope: string, request: string): void {
    this.prepare('DELETE FROM entries WHERE scope=? AND request=?').run(scope, request)
    this.prepare('DELETE FROM pages WHERE scope=? AND request=?').run(scope, request)
  }
  close(): void { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); this.statements.clear(); this.db.close() }
}
