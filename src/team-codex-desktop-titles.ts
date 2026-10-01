import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const validId = (value: string) => /^[A-Za-z0-9_-]{8,160}$/.test(value)
const MAX_TITLE_BYTES = 16_384
const MAX_INDEX_BYTES = 8 * 1024 * 1024
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const title = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
  && Buffer.byteLength(value) <= MAX_TITLE_BYTES && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)

/** Read-only desktop compatibility, not a public Codex API. Never reads rollout/first-message text.
 * `threads.name` is the display name; `threads.title` may still contain the first prompt.
 * Undefined homeKey is reserved for an already-bound legacy single-session connection.
 */
export class TeamCodexDesktopTitleReader {
  private sawDatabase = false
  constructor(private readonly home = process.env.CODEX_HOME || join(homedir(), '.codex')) {}

  read(homeKey: string | undefined, sessions: readonly string[]): Map<string, string> {
    const wanted = new Set(sessions.filter(validId))
    if (!wanted.size) return new Map()
    try {
      if (lstatSync(this.home).isSymbolicLink()) return new Map()
      const home = realpathSync(this.home)
      if (homeKey !== undefined && createHash('sha256').update(home).digest('hex') !== homeKey) return new Map()
      const names = this.databaseNames(home, wanted)
      // An unreadable/live database must not be replaced with a potentially stale index name.
      if (names === null) return new Map()
      const remaining = new Set([...wanted].filter(id => !names.has(id)))
      if (remaining.size) for (const [id, name] of this.indexNames(home, remaining)) names.set(id, name)
      return names
    } catch { return new Map() }
  }

  private databaseNames(home: string, sessions: ReadonlySet<string>): Map<string, string> | null {
    const path = join(home, 'state_5.sqlite')
    let stat: ReturnType<typeof lstatSync>
    try { stat = lstatSync(path); this.sawDatabase = true }
    catch (error) { return missing(error) && !this.sawDatabase ? new Map() : null }
    if (!stat.isFile() || stat.isSymbolicLink()) return null
    let db: DatabaseSync | undefined
    try {
      let wal = false, shm = false
      for (const suffix of ['-wal', '-shm']) {
        try {
          const sidecar = lstatSync(path + suffix)
          if (!sidecar.isFile() || sidecar.isSymbolicLink()) return null
          if (suffix === '-wal') wal = true
          else shm = true
        } catch (error) { if (!missing(error)) throw error }
      }
      if (wal && !shm) return null
      db = new DatabaseSync(path, { readOnly: true, enableDoubleQuotedStringLiterals: false })
      db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=50; BEGIN')
      if (db.prepare("SELECT type FROM sqlite_master WHERE name='threads'").get()?.type !== 'table') return null
      const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(row => row.name))
      if (!columns.has('id')) return null
      if (!columns.has('name')) return new Map() // Older versions use the name-only session index.
      const query = db.prepare('SELECT CASE WHEN length(CAST(name AS BLOB))<=? THEN name ELSE NULL END AS name FROM threads WHERE id=?')
      const names = new Map<string, string>()
      for (const id of sessions) {
        const name = query.get(MAX_TITLE_BYTES, id)?.name
        if (title(name)) names.set(id, name)
      }
      const after = lstatSync(path)
      if (after.isSymbolicLink() || after.ino !== stat.ino || after.dev !== stat.dev) return null
      return names
    } catch { return null }
    finally { db?.close() }
  }

  private indexNames(home: string, sessions: ReadonlySet<string>): Map<string, string> {
    let fd: number | undefined
    try {
      fd = openSync(join(home, 'session_index.jsonl'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > MAX_INDEX_BYTES) return new Map()
      const buffer = Buffer.alloc(stat.size + 1)
      let length = 0, bytes = 0
      while (length < buffer.length && (bytes = readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += bytes
      const after = fstatSync(fd)
      if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) return new Map()
      const names = new Map<string, { name: string; at: number }>()
      for (const line of buffer.subarray(0, length).toString('utf8').split('\n')) {
        if (!line.trim()) continue
        let row: { id?: unknown; thread_name?: unknown; updated_at?: unknown }
        try { row = JSON.parse(line) } catch { return new Map() } // An incomplete append is retried next tick.
        if (!row || typeof row.id !== 'string' || !sessions.has(row.id)) continue
        const at = typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : NaN
        if (!title(row.thread_name) || !Number.isFinite(at)) continue
        if (at >= (names.get(row.id)?.at ?? -Infinity)) names.set(row.id, { name: row.thread_name, at })
      }
      return new Map([...names].map(([id, value]) => [id, value.name]))
    } catch { return new Map() }
    finally { if (fd !== undefined) closeSync(fd) }
  }
}
