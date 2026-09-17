import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { securePrivateDirectorySync, securePrivateFileSync } from './private-filesystem.js'
import type { ArkmeTimelinePage } from './types.js'

/** Disposable page directory; page metadata references versioned, account-scoped event payloads. */
export class UnifiedTimelineCache {
  private readonly db: DatabaseSync
  // Optimization only: after restart/eviction a source is conservatively retired
  // again. Remember only successful transactions, never an uncommitted response.
  private readonly retiredSources = new Map<string, Set<string>>()
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    securePrivateDirectorySync(directory)
    const path = join(directory, 'chat-timeline.sqlite3')
    this.db = new DatabaseSync(path)
    securePrivateFileSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS pages (scope TEXT NOT NULL, request TEXT NOT NULL, metadata TEXT NOT NULL, touched INTEGER NOT NULL, PRIMARY KEY(scope,request));
      CREATE TABLE IF NOT EXISTS contents (scope TEXT NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scope,hash));
      CREATE TABLE IF NOT EXISTS entries (scope TEXT NOT NULL, request TEXT NOT NULL, ordinal INTEGER NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(scope,request,ordinal));
      CREATE INDEX IF NOT EXISTS entries_content ON entries(scope,hash);
      CREATE INDEX IF NOT EXISTS pages_recency ON pages(touched);
      CREATE TABLE IF NOT EXISTS cache_stats (id INTEGER PRIMARY KEY, bytes INTEGER NOT NULL);
      INSERT OR IGNORE INTO cache_stats SELECT 1,COALESCE(sum(length(CAST(payload AS BLOB))),0) FROM contents;
      CREATE TRIGGER IF NOT EXISTS content_added AFTER INSERT ON contents BEGIN UPDATE cache_stats SET bytes=bytes+length(CAST(NEW.payload AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS content_removed AFTER DELETE ON contents BEGIN UPDATE cache_stats SET bytes=bytes-length(CAST(OLD.payload AS BLOB)) WHERE id=1; END;`)
  }
  read(scope: string, request: string): ArkmeTimelinePage | undefined {
    const row = this.db.prepare('SELECT metadata FROM pages WHERE scope=? AND request=?').get(scope, request) as { metadata: string } | undefined
    if (!row) return undefined
    const metadata = JSON.parse(row.metadata) as ArkmeTimelinePage
    const rows = this.db.prepare('SELECT c.payload FROM entries e JOIN contents c ON c.scope=e.scope AND c.hash=e.hash WHERE e.scope=? AND e.request=? ORDER BY e.ordinal LIMIT 100').all(scope, request) as unknown as Array<{ payload: string }>
    if (!metadata.unified) return undefined
    metadata.unified.events = rows.map(row => JSON.parse(row.payload))
    metadata.items = metadata.unified.events.flatMap(event => event.kind === 'message' ? [event.item] : [])
    return metadata
  }
  write(scope: string, request: string, page: ArkmeTimelinePage): void {
    if (!page.unified || page.unified.events.length > 100) throw new Error('Invalid timeline cache page')
    const metadata = JSON.stringify({ ...page, items: [], unified: { ...page.unified, events: [] } })
    const payloads = page.unified.events.map(event => JSON.stringify(event))
    if (Buffer.byteLength(metadata) + payloads.reduce((n, value) => n + Buffer.byteLength(value), 0) > 4 * 1024 * 1024) throw new Error('Timeline cache page exceeds capacity')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      // Revocation applies to every stored page in this conversation, including older windows.
      const retired = page.unified.sources.filter(source => source.status === 'not_applicable'
        && !this.retiredSources.get(scope)?.has(source.source)).map(source => source.source)
      if (retired.length) {
        for (const source of retired) {
          this.db.prepare("DELETE FROM entries WHERE scope=? AND hash IN (SELECT hash FROM contents WHERE scope=? AND json_extract(payload,'$.source')=?)").run(scope, scope, source)
        }
        const stored = this.db.prepare('SELECT request,metadata FROM pages WHERE scope=?').all(scope) as unknown as Array<{ request: string; metadata: string }>
        for (const row of stored) {
          const old = JSON.parse(row.metadata) as ArkmeTimelinePage
          if (!old.unified) continue
          old.unified.sources = old.unified.sources.map(source => retired.includes(source.source) ? { ...source, status: 'not_applicable', itemCount: 0 } : source)
          this.db.prepare('UPDATE pages SET metadata=? WHERE scope=? AND request=?').run(JSON.stringify(old), scope, row.request)
        }
        this.db.prepare('DELETE FROM contents WHERE scope=? AND NOT EXISTS (SELECT 1 FROM entries WHERE entries.scope=contents.scope AND entries.hash=contents.hash)').run(scope)
      }
      this.remove(scope, request)
      this.db.prepare('INSERT INTO pages VALUES (?,?,?,?)').run(scope, request, metadata, Date.now())
      const content = this.db.prepare('INSERT OR IGNORE INTO contents VALUES (?,?,?)')
      const entry = this.db.prepare('INSERT INTO entries VALUES (?,?,?,?)')
      payloads.forEach((payload, ordinal) => {
        const hash = createHash('sha256').update(payload).digest('hex')
        content.run(scope, hash, payload)
        entry.run(scope, request, ordinal, hash)
      })
      const oldest = this.db.prepare('SELECT scope,request FROM pages ORDER BY touched DESC LIMIT -1 OFFSET 256').all() as unknown as Array<{ scope: string; request: string }>
      for (const page of oldest) this.remove(page.scope, page.request)
      let bytes = Number((this.db.prepare('SELECT bytes FROM cache_stats WHERE id=1').get() as { bytes: number }).bytes)
      while (bytes > 64 * 1024 * 1024) {
        const page = this.db.prepare('SELECT scope,request FROM pages ORDER BY touched LIMIT 1').get() as { scope: string; request: string }
        this.remove(page.scope, page.request)
        bytes = Number((this.db.prepare('SELECT bytes FROM cache_stats WHERE id=1').get() as { bytes: number }).bytes)
      }
      this.db.exec('COMMIT')
      this.retiredSources.delete(scope)
      this.retiredSources.set(scope, new Set(page.unified.sources.filter(source => source.status === 'not_applicable').map(source => source.source)))
      while (this.retiredSources.size > 256) this.retiredSources.delete(this.retiredSources.keys().next().value!)
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private remove(scope: string, request: string): void {
    const hashes = this.db.prepare('SELECT hash FROM entries WHERE scope=? AND request=?').all(scope, request) as unknown as Array<{ hash: string }>
    this.db.prepare('DELETE FROM entries WHERE scope=? AND request=?').run(scope, request)
    this.db.prepare('DELETE FROM pages WHERE scope=? AND request=?').run(scope, request)
    for (const { hash } of hashes) this.db.prepare('DELETE FROM contents WHERE scope=? AND hash=? AND NOT EXISTS (SELECT 1 FROM entries WHERE scope=? AND hash=?)').run(scope, hash, scope, hash)
  }
  close(): void { this.retiredSources.clear(); this.db.close() }
}
