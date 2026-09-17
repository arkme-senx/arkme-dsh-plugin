import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { securePrivateDirectorySync, securePrivateFileSync } from '../private-filesystem.js'
import { fiveTurnPage, type NativeHistoryPage, type NativeHistoryRecord } from './native-history.js'

/** Rebuildable native history, separate from business records and write ledgers. */
export class DshNativeHistoryCache {
  private readonly db: DatabaseSync
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 }); securePrivateDirectorySync(directory)
    const path = join(directory, 'native-history.sqlite3')
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sessions (
        key TEXT PRIMARY KEY, snapshot TEXT NOT NULL, touched INTEGER NOT NULL, bytes INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS events (
        session TEXT NOT NULL REFERENCES sessions(key) ON DELETE CASCADE,
        seq INTEGER NOT NULL, turn_start INTEGER NOT NULL, payload TEXT NOT NULL, bytes INTEGER NOT NULL,
        PRIMARY KEY(session, seq)
      );
    `)
    securePrivateFileSync(path)
  }
  close(): void { this.db.close() }
  static key(account: string, runtime: string, address: unknown): string {
    return JSON.stringify([account, runtime, address])
  }
  snapshot(key: string): Record<string, unknown> | undefined {
    const row = this.db.prepare('SELECT snapshot FROM sessions WHERE key=?').get(key)
    return row ? JSON.parse(String(row.snapshot)) as Record<string, unknown> : undefined
  }
  page(key: string, through: number, before = through + 1): NativeHistoryPage | undefined {
    if (!Number.isSafeInteger(through) || through < -1 || !Number.isSafeInteger(before) || before < 0) throw new Error('历史分页序号无效')
    if (!this.snapshot(key)) return
    const end = Math.min(before, through + 1)
    const cut = this.db.prepare('SELECT seq FROM events WHERE session=? AND seq<? AND turn_start=1 ORDER BY seq DESC LIMIT 1 OFFSET 4').get(key, end)
    const start = Number(cut?.seq ?? 0)
    const rows = this.db.prepare('SELECT seq,payload FROM events WHERE session=? AND seq>=? AND seq<? ORDER BY seq LIMIT 50001').all(key, start, end)
    if (rows.length !== end - start || rows.some((row, i) => Number(row.seq) !== start + i)) return
    const page = fiveTurnPage({ records: rows.map(row => JSON.parse(String(row.payload)) as NativeHistoryRecord), hasMore: start > 0 })
    if (page) this.db.prepare('UPDATE sessions SET touched=? WHERE key=?').run(Date.now(), key)
    return page
  }
  write(key: string, records: NativeHistoryRecord[], snapshot?: Record<string, unknown>): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const old = this.snapshot(key)
      if (snapshot) {
        if (old && Number(snapshot.cursor) < Number(old.cursor)) { this.db.prepare('DELETE FROM events WHERE session=?').run(key); this.db.prepare('UPDATE sessions SET bytes=length(CAST(snapshot AS BLOB)) WHERE key=?').run(key) }
        const { records: _records, ...metadata } = snapshot
        this.db.prepare('INSERT INTO sessions(key,snapshot,touched,bytes) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET bytes=sessions.bytes+excluded.bytes-length(CAST(sessions.snapshot AS BLOB)),snapshot=excluded.snapshot,touched=excluded.touched').run(key, JSON.stringify(metadata), Date.now(), Buffer.byteLength(JSON.stringify(metadata)))
      } else if (!old) { this.db.exec('COMMIT'); return }
      const insert = this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?) ON CONFLICT(session,seq) DO UPDATE SET turn_start=excluded.turn_start,payload=excluded.payload,bytes=excluded.bytes')
      let delta = 0
      for (const record of records) {
        if (!Number.isSafeInteger(record.event.seq) || record.event.seq < 0) throw new Error('原生历史序号无效')
        const payload = JSON.stringify(record), bytes = Buffer.byteLength(payload)
        delta += bytes - Number(this.db.prepare('SELECT bytes FROM events WHERE session=? AND seq=?').get(key, record.event.seq)?.bytes ?? 0)
        insert.run(key, record.event.seq, Number(record.event.type === 'turn/start'), payload, bytes)
      }
      this.db.prepare('UPDATE sessions SET bytes=bytes+? WHERE key=?').run(delta, key)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    // Whole-session LRU eviction keeps every retained page's continuity verifiable.
    this.db.exec('DELETE FROM sessions WHERE key NOT IN (SELECT key FROM sessions ORDER BY touched DESC LIMIT 256)')
    while (Number(this.db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM sessions').get()?.bytes) > 128 * 1024 * 1024) {
      this.db.exec('DELETE FROM sessions WHERE key=(SELECT key FROM sessions ORDER BY touched LIMIT 1)')
    }
  }
}
