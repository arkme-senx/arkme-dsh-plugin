import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { TeamCodexQueuedRequest, TeamCodexQueueSnapshot } from './team-codex-contract.js'

type Json = Record<string, unknown>
export type QueueObservation = Pick<TeamCodexQueueSnapshot, 'availability' | 'reason' | 'sourceAt' | 'items'>
const object = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(v)
const MAX_BYTES = 8 * 1024 * 1024
const MAX_ITEMS = 200
const MAX_PAYLOAD = 262_144
type SourceObservation = QueueObservation & { clientIds?: string[] }
type QueueSource = Map<string, SourceObservation> | null
const unavailable = (sessions: readonly string[], reason: QueueObservation['reason']) => new Map(sessions.map(session => [session,
  { availability: 'unavailable' as const, reason, sourceAt: null, items: [] }]))
const missing = (error: unknown) => object(error) && error.code === 'ENOENT'

interface ServerRow { id: string; payload_json: string | null; created_at_ms: number; updated_at_ms: number }

/** Current app-server queue_1 schema. Do not copy metadata or attachment paths. */
function parseServerItem(row: ServerRow, now: number): { item: TeamCodexQueuedRequest; clientId?: string } | null {
  if (!id(row.id) || typeof row.payload_json !== 'string'
    || !Number.isSafeInteger(row.created_at_ms) || row.created_at_ms < 0 || row.created_at_ms > now + 5000
    || !Number.isSafeInteger(row.updated_at_ms) || row.updated_at_ms < 0 || row.updated_at_ms > now + 5000) return null
  let raw: unknown
  try { raw = JSON.parse(row.payload_json) } catch { return null }
  if (!object(raw) || !object(raw.UserInput) || !Array.isArray(raw.UserInput.content)) return null
  const input = raw.UserInput, content = input.content as unknown[]
  if (content.length > 1000 || (input.client_id != null && !id(input.client_id))) return null
  const texts: string[] = []
  let attachmentCount = 0
  for (const part of content) {
    if (!object(part)) return null
    if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text)
    else if (part.type === 'image' || part.type === 'localImage' || part.type === 'mention') attachmentCount++
    else return null // Future payload types must not look like an empty, fully readable queue.
  }
  const text = redactCodexQueueText(texts.join('\n'))
  return { item: { id: row.id, text: text.slice(0,4096), createdAt: row.created_at_ms,
    delivery: 'queue', state: 'queued', paused: false, attachmentCount, truncated: text.length > 4096 },
    ...(typeof input.client_id === 'string' ? { clientId: input.client_id } : {}) }
}

export function redactCodexQueueText(text: string): string {
  return text.replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*["']?[^\s"',;]+/gi, '$1=[REDACTED]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
}

function parseItem(raw: unknown, now: number): TeamCodexQueuedRequest | null {
  if (!object(raw) || !id(raw.id) || typeof raw.text !== 'string' || raw.text.length > 262_144
    || typeof raw.createdAt !== 'number' || !Number.isSafeInteger(raw.createdAt) || raw.createdAt < 0 || raw.createdAt > now + 5000) return null
  // Unknown source formats never become an apparently complete empty queue.
  if (raw.submissionIntent !== undefined && !['queue', 'send-now'].includes(String(raw.submissionIntent))) return null
  if (raw.submission !== undefined && !object(raw.submission)) return null
  if (raw.submissionOptions !== undefined && !object(raw.submissionOptions)) return null
  const submission = raw.submission as Json | undefined, options = raw.submissionOptions as Json | undefined
  if ([submission?.hostId, options?.executionHostId].some(host => host !== undefined && host !== 'local')) return null
  const state = submission?.status ?? 'queued'
  if (!['queued', 'pending', 'sending', 'outcome-unknown'].includes(String(state))) return null
  if (raw.pausedReason !== undefined && typeof raw.pausedReason !== 'string') return null
  if (raw.context !== undefined && !object(raw.context)) return null
  const context = raw.context as Json | undefined
  // Only counts; no attachment paths, images, IDE context or embedded instructions are copied.
  const attachmentCount = ['imageAttachments', 'fileAttachments', 'commentAttachments', 'selectedTextAttachments']
    .reduce((n, key) => n + (Array.isArray(context?.[key]) ? context[key].length : 0), 0)
  const text = redactCodexQueueText(raw.text)
  return { id: raw.id, text: text.slice(0,4096), createdAt: raw.createdAt,
    delivery: raw.submissionIntent === 'send-now' ? 'send-now' : 'queue',
    state: state === 'outcome-unknown' ? 'unknown' : state as TeamCodexQueuedRequest['state'],
    paused: !!raw.pausedReason, attachmentCount, truncated: text.length > 4096 }
}

/** Read-only compatibility with app-server and legacy desktop queues, not a scheduling API. */
export class TeamCodexDesktopQueueReader {
  private sawServerQueue = false
  constructor(private readonly home = process.env.CODEX_HOME || join(homedir(), '.codex')) {}

  read(homeKey: string, sessions: readonly string[], now: number): Map<string, QueueObservation> {
    if (sessions.length === 0) return new Map()
    let realHome: string
    try {
      if (lstatSync(this.home).isSymbolicLink()) return unavailable(sessions, 'wrong-home')
      realHome = realpathSync(this.home)
      if (createHash('sha256').update(realHome).digest('hex') !== homeKey) return unavailable(sessions, 'wrong-home')
    } catch { return unavailable(sessions, 'unavailable') }
    const server = this.readServer(realHome, sessions, now), legacy = this.readLegacy(realHome, sessions, now)
    return new Map(sessions.map(session => {
      const primary = server?.get(session), secondary = legacy?.get(session)
      const sources = [primary, secondary].filter((s): s is SourceObservation => !!s)
      if (!sources.length) return [session, unavailable([session], 'unavailable').get(session)!]
      // Match the desktop: server order first, then locally pending requests. Only IDs, never text,
      // identify the same request during the handoff from local storage to app-server storage.
      const seen = new Set([...(primary?.items.map(item => item.id) ?? []), ...(primary?.clientIds ?? [])])
      const combined = [...(primary?.items ?? []), ...(secondary?.items.filter(item => !seen.has(item.id)) ?? [])]
      const complete = sources.every(source => source.availability === 'ready') && combined.length <= MAX_ITEMS
      const failed = sources.find(source => source.availability !== 'ready')
      const sourceTimes = sources.flatMap(source => source.sourceAt === null ? [] : [source.sourceAt])
      return [session, { availability: complete ? 'ready' : combined.length || failed?.availability === 'partial' ? 'partial' : 'unavailable',
        reason: complete ? 'none' : failed?.reason ?? 'unsupported',
        sourceAt: sourceTimes.length ? Math.max(...sourceTimes) : null, items: combined.slice(0, MAX_ITEMS) } satisfies QueueObservation]
    }))
  }

  private readServer(home: string, sessions: readonly string[], now: number): QueueSource {
    const path = join(home, 'queue_1.sqlite')
    let stat: ReturnType<typeof lstatSync>
    try { stat = lstatSync(path); this.sawServerQueue = true }
    catch (error) { return missing(error) && !this.sawServerQueue ? null : unavailable(sessions, 'unavailable') }
    if (!stat.isFile() || stat.isSymbolicLink()) return unavailable(sessions, 'unsupported')
    let db: DatabaseSync | undefined
    try {
      let sourceAt = Math.floor(stat.mtimeMs)
      // SQLite must read the live WAL; immutable mode can silently miss the latest queue.
      // Reject linked sidecars and do not create a missing WAL shared-memory file.
      let hasWal = false, hasShm = false
      for (const suffix of ['-wal', '-shm']) {
        try {
          const sidecar = lstatSync(path + suffix)
          if (!sidecar.isFile() || sidecar.isSymbolicLink()) return unavailable(sessions, 'unsupported')
          if (suffix === '-wal') { hasWal = true; sourceAt = Math.max(sourceAt, Math.floor(sidecar.mtimeMs)) }
          else hasShm = true
        } catch (error) { if (!missing(error)) throw error }
      }
      if (hasWal && !hasShm) return unavailable(sessions, 'unavailable')
      db = new DatabaseSync(path, { readOnly: true, enableDoubleQuotedStringLiterals: false })
      db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=50; BEGIN')
      const table = db.prepare("SELECT type FROM sqlite_master WHERE name='queued_items'").get()
      if (table?.type !== 'table') return unavailable(sessions, 'unsupported')
      const query = db.prepare(`SELECT id, CASE WHEN length(CAST(payload_json AS BLOB))<=? THEN payload_json ELSE NULL END AS payload_json,
        created_at_ms, updated_at_ms FROM queued_items WHERE thread_id=? ORDER BY queue_order,id LIMIT ?`)
      const result = new Map<string, SourceObservation>()
      for (const session of sessions) {
        const rows = query.all(MAX_PAYLOAD, session, MAX_ITEMS + 1) as unknown as ServerRow[]
        let partial = rows.length > MAX_ITEMS
        const items: TeamCodexQueuedRequest[] = [], clientIds: string[] = [], seen = new Set<string>()
        for (const row of rows.slice(0, MAX_ITEMS)) {
          const parsed = parseServerItem(row, now)
          if (!parsed || seen.has(parsed.item.id)) { partial = true; continue }
          seen.add(parsed.item.id); items.push(parsed.item)
          if (parsed.clientId) clientIds.push(parsed.clientId)
        }
        result.set(session, { availability: partial ? 'partial' : 'ready', reason: partial ? 'unsupported' : 'none', sourceAt, items, clientIds })
      }
      const after = lstatSync(path)
      if (after.isSymbolicLink() || after.ino !== stat.ino || after.dev !== stat.dev) return unavailable(sessions, 'unavailable')
      return result
    } catch { return unavailable(sessions, 'unavailable') }
    finally { db?.close() }
  }

  private readLegacy(home: string, sessions: readonly string[], now: number): QueueSource {
    let fd: number | undefined
    try {
      fd = openSync(join(home, '.codex-global-state.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > MAX_BYTES || stat.mtimeMs > now + 5000) return unavailable(sessions, 'unsupported')
      // Bounded even if another process grows/replaces the file while we read it.
      const buffer = Buffer.alloc(stat.size + 1)
      let length = 0, bytes = 0
      while (length < buffer.length && (bytes = readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += bytes
      const after = fstatSync(fd)
      if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) return unavailable(sessions, 'unavailable')
      const raw: unknown = JSON.parse(buffer.subarray(0, length).toString('utf8'))
      if (!object(raw) || !object(raw['queued-follow-ups'])) return unavailable(sessions, 'unsupported')
      const queues = raw['queued-follow-ups']
      const sourceAt = Math.floor(stat.mtimeMs)
      return new Map(sessions.map((session): [string, QueueObservation] => {
        const entries: unknown = Object.hasOwn(queues, session) ? queues[session] : []
        if (!Array.isArray(entries)) return [session, { availability: 'unavailable', reason: 'unsupported', sourceAt, items: [] }]
        let partial = entries.length > MAX_ITEMS
        const seen = new Set<string>(), items: TeamCodexQueuedRequest[] = []
        for (const entry of entries.slice(0, MAX_ITEMS)) {
          const parsed = parseItem(entry, now)
          if (!parsed || seen.has(parsed.id)) { partial = true; continue }
          seen.add(parsed.id); items.push(parsed)
        }
        // File age is not freshness: an unchanged pending queue may legitimately last for hours.
        return [session, { availability: partial ? 'partial' : 'ready',
          reason: partial ? 'unsupported' : 'none', sourceAt, items }]
      }))
    } catch (error) { return missing(error) ? null : unavailable(sessions, 'unavailable') }
    finally { if (fd !== undefined) closeSync(fd) }
  }
}
