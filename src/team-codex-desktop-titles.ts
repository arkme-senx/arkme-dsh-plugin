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

export type CodexThreadVisibility = 'user' | 'internal' | 'pending'
interface DesktopTasks { names: Map<string, string>; visibility: Map<string, CodexThreadVisibility> }
const snapshot = (): DesktopTasks => ({ names: new Map(), visibility: new Map() })
function threadVisibility(row: Record<string, unknown>): CodexThreadVisibility {
  // Persistent root tasks include user-requested tasks created through the app tools.
  if (typeof row.agent_path === 'string' && !['', '/', '/root', 'root'].includes(row.agent_path)) return 'internal'
  if (typeof row.source === 'string' && (row.source === 'subagent' || row.source.includes('"subagent"'))) return 'internal'
  if (typeof row.thread_source === 'string' && !['', 'user', 'agent_created_thread'].includes(row.thread_source)) return 'pending'
  return 'user'
}

/** Read-only desktop compatibility, not a public Codex API. Never reads rollout/first-message text.
 * `threads.name` is the display name; `threads.title` may still contain the first prompt.
 * Undefined homeKey is reserved for an already-bound legacy single-session connection.
 */
export class TeamCodexDesktopTitleReader {
  private sawDatabase = false
  constructor(private readonly home = process.env.CODEX_HOME || join(homedir(), '.codex')) {}

  read(homeKey: string | undefined, sessions: readonly string[]): Map<string, string> {
    return this.inspect(homeKey, sessions)?.names ?? new Map()
  }

  /** Undefined means unavailable, not an empty directory. Never infer identity from a title. */
  inspect(homeKey: string | undefined, sessions: readonly string[]): DesktopTasks | undefined {
    const wanted = new Set(sessions.filter(validId))
    if (!wanted.size) return snapshot()
    try {
      if (lstatSync(this.home).isSymbolicLink()) return undefined
      const home = realpathSync(this.home)
      if (homeKey !== undefined && createHash('sha256').update(home).digest('hex') !== homeKey) return undefined
      const result = this.databaseNames(home, wanted)
      // An unreadable/live database must not be replaced with a potentially stale index name.
      if (result === null) return undefined
      const remaining = new Set([...wanted].filter(id => !result.names.has(id) && result.visibility.get(id) !== 'internal'))
      if (remaining.size) for (const [id, name] of this.indexNames(home, remaining)) {
        result.names.set(id, name)
        if (!result.visibility.has(id)) result.visibility.set(id, 'user')
      }
      for (const id of wanted) if (!result.visibility.has(id)) result.visibility.set(id, 'pending')
      return result
    } catch { return undefined }
  }

  private databaseNames(home: string, sessions: ReadonlySet<string>): DesktopTasks | null {
    const path = join(home, 'state_5.sqlite')
    let stat: ReturnType<typeof lstatSync>
    try { stat = lstatSync(path); this.sawDatabase = true }
    catch (error) { return missing(error) && !this.sawDatabase ? snapshot() : null }
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
      const fields = ['source', 'thread_source', 'agent_path'].map(key => columns.has(key) ? key : `NULL AS ${key}`)
      const name = columns.has('name') ? `CASE WHEN length(CAST(name AS BLOB))<=${MAX_TITLE_BYTES} THEN name ELSE NULL END` : 'NULL'
      const query = db.prepare(`SELECT ${name} AS name,${fields.join(',')} FROM threads WHERE id=?`)
      const result = snapshot()
      for (const id of sessions) {
        const row = query.get(id)
        if (!row) continue
        const visibility = threadVisibility(row)
        result.visibility.set(id, visibility)
        if (visibility === 'user' && title(row.name)) result.names.set(id, row.name)
      }
      const after = lstatSync(path)
      if (after.isSymbolicLink() || after.ino !== stat.ino || after.dev !== stat.dev) return null
      return result
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
