import { createHash } from 'node:crypto'
import { constants, lstatSync, realpathSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { TeamCodexEvent, TeamCodexTurnTiming } from './team-codex-contract.js'
import { codexTurnTiming } from './team-codex-timing.js'

export interface CodexTimingSource {
  sessionId: string
  homeKey?: string
  live?: boolean
  /** Cloud turn hashes must be resolved through an exact account/source/task binding. */
  turns?: Map<string, string>
}
interface Scan {
  path: string; identity: string; size: number; mtime: number; olderAt: number
  values: Map<string, { at: number; timing: TeamCodexTurnTiming }>
}
const BUDGET = 4 * 1024 * 1024
const safeId = (id: string) => /^[A-Za-z0-9_-]{1,160}$/.test(id)

/** Reads only lifecycle metadata in one explicitly bound rollout. No history directory scan,
 * transcript import, Hook changes, or synchronous multi-gigabyte file reads. */
export class TeamCodexTurnTimingReader {
  private scans = new Map<string, Scan>()
  private pending = new Map<string, Promise<Map<string, TeamCodexTurnTiming>>>()
  constructor(private readonly home = process.env.CODEX_HOME || join(homedir(), '.codex'), private readonly now = Date.now) {}

  read(source: CodexTimingSource, turns: readonly string[]): Promise<Map<string, TeamCodexTurnTiming>> {
    if (!safeId(source.sessionId) || !turns.length || turns.some(id => !safeId(id))) return Promise.resolve(new Map())
    const key = JSON.stringify([source.homeKey, source.sessionId])
    const previous = this.pending.get(key)
    if (previous) return previous.then(() => this.read(source, turns))
    const work = this.scan(key, source, turns).catch(() => new Map<string, TeamCodexTurnTiming>())
      .finally(() => { this.pending.delete(key) })
    this.pending.set(key, work)
    return work
  }

  /** Exact, validated local rollout; callers still enforce account/task ownership. */
  location(source: CodexTimingSource): string | undefined {
    if (lstatSync(this.home).isSymbolicLink()) return
    const home = realpathSync(this.home)
    if (source.homeKey && createHash('sha256').update(home).digest('hex') !== source.homeKey) return
    const path = join(home, 'state_5.sqlite')
    for (const suffix of ['', '-wal', '-shm']) {
      try { const stat = lstatSync(path + suffix); if (!stat.isFile() || stat.isSymbolicLink()) return }
      catch (error) { if (suffix && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    }
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=50')
      const row = db.prepare('SELECT rollout_path FROM threads WHERE id=?').get(source.sessionId)
      if (typeof row?.rollout_path !== 'string' || !isAbsolute(row.rollout_path)) return
      // macOS may spell the same home under /var and /private/var. Resolve the
      // home alias, but still inspect each component beneath it for symlinks.
      let rel = relative(this.home, row.rollout_path)
      if (rel.startsWith('..') || isAbsolute(rel)) rel = relative(home, row.rollout_path)
      if (!['sessions', 'archived_sessions'].includes(rel.split(sep)[0]!) || rel.split(sep).includes('..')) return
      let current = home
      for (const segment of rel.split(sep)) { current = join(current, segment); if (lstatSync(current).isSymbolicLink()) return }
      if (realpathSync(row.rollout_path) !== current) return
      return current
    } finally { db.close() }
  }

  private async scan(key: string, source: CodexTimingSource, turns: readonly string[]): Promise<Map<string, TeamCodexTurnTiming>> {
    const path = this.location(source)
    if (!path) return new Map()
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stat = await file.stat()
      if (!stat.isFile()) return new Map()
      const identity = `${stat.dev}:${stat.ino}`
      const prefix = Buffer.alloc(Math.min(stat.size, 65536))
      await file.read(prefix, 0, prefix.length, 0)
      const firstEnd = prefix.indexOf(10)
      if (firstEnd < 0) return new Map()
      const meta = JSON.parse(prefix.subarray(0, firstEnd).toString('utf8'))
      if (meta.type !== 'session_meta' || meta.payload?.id !== source.sessionId) return new Map()
      let scan = this.scans.get(key)
      if (!scan || scan.path !== path || scan.identity !== identity || stat.size < scan.size) {
        scan = { path, identity, size: -1, mtime: -1, olderAt: stat.size, values: new Map() }
        if (this.scans.size >= 8) this.scans.delete(this.scans.keys().next().value!)
        this.scans.set(key, scan)
      }
      const parseWindow = async (end: number): Promise<number> => {
        const start = Math.max(0, end - BUDGET), buffer = Buffer.alloc(end - start)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, start)
        const bytes = buffer.subarray(0, bytesRead)
        const first = start ? bytes.indexOf(10) + 1 : 0
        if (start && (!first || first >= bytes.length)) return start // An oversized non-lifecycle line; keep bounded progress.
        let pos = first, next: number
        while ((next = bytes.indexOf(10, pos)) >= 0) {
          if (next - pos <= 256 * 1024) {
            const line = bytes.subarray(pos, next).toString('utf8')
            // Skip tool results, prompts and assistant prose before JSON parsing.
            if (/"type"\s*:\s*"event_msg"/.test(line) && /"type"\s*:\s*"(?:task_started|task_complete|turn_aborted)"/.test(line)) {
              try {
                const row = JSON.parse(line), p = row.payload
                if (row.type === 'event_msg' && p && safeId(p.turn_id ?? '') && (p.root_turn_id ?? p.turn_id) === p.turn_id) {
                  const state = p.type === 'task_started' ? 'working' : p.type === 'task_complete' ? 'finished' : p.type === 'turn_aborted' ? 'interrupted' : undefined
                  const at = Date.parse(row.timestamp)
                  const timing = state && codexTurnTiming({ state, startedAt: p.started_at * 1000, observedAt: this.now(),
                    ...(state === 'working' ? {} : { completedAt: p.completed_at * 1000, durationMs: p.duration_ms }) })
                  const old = scan!.values.get(p.turn_id)
                  if (timing && Number.isFinite(at) && (!old || at > old.at)) {
                    if (scan!.values.size >= 5000 && !old) scan!.values.delete(scan!.values.keys().next().value!)
                    scan!.values.set(p.turn_id, { at, timing })
                  }
                }
              } catch { /* A malformed record cannot invent a clock. */ }
            }
          }
          pos = next + 1
        }
        return start ? start + first : 0
      }
      if (scan.size !== stat.size || scan.mtime !== stat.mtimeMs) {
        const olderAt = await parseWindow(stat.size)
        if (scan.size < 0) scan.olderAt = olderAt
        scan.size = stat.size; scan.mtime = stat.mtimeMs
      }
      if (scan.olderAt > 0 && turns.some(turn => !scan!.values.has(turn))) scan.olderAt = await parseWindow(scan.olderAt)
      return new Map(turns.flatMap(turn => {
        const timing = scan!.values.get(turn)?.timing
        return timing ? [[turn, { ...timing, observedAt: timing.completedAt ?? this.now() }] as const] : []
      }))
    } finally { await file.close() }
  }
}

/** Stable account/task cache survives restart and a source file later being archived/removed. */
export class TeamCodexTurnTimingStore {
  private readonly reader: TeamCodexTurnTimingReader
  constructor(private readonly db: DatabaseSync, home?: string, now?: () => number) {
    this.reader = new TeamCodexTurnTimingReader(home, now)
    db.exec(`CREATE TABLE IF NOT EXISTS codex_turn_timings (
      scope TEXT NOT NULL,turn_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,turn_id));`)
  }
  async read(source: CodexTimingSource, events: readonly TeamCodexEvent[]): Promise<Map<string, TeamCodexTurnTiming>> {
    return this.reader.read(source, [...new Set(events.flatMap(event => source.turns
      ? source.turns.has(event.turnId) ? [source.turns.get(event.turnId)!] : [] : [event.turnId]))])
  }
  /** Caller revalidates the account and task after asynchronous reads, before committing. */
  project(scope: string, source: CodexTimingSource, events: readonly TeamCodexEvent[], fresh: Map<string, TeamCodexTurnTiming>): TeamCodexEvent[] {
    const get = this.db.prepare('SELECT payload FROM codex_turn_timings WHERE scope=? AND turn_id=?')
    const put = this.db.prepare('INSERT INTO codex_turn_timings VALUES(?,?,?) ON CONFLICT(scope,turn_id) DO UPDATE SET payload=excluded.payload')
    return events.map(event => {
      const old = get.get(scope, event.turnId)
      const cached = old && codexTurnTiming(JSON.parse(String(old.payload)))
      const next = fresh.get(source.turns?.get(event.turnId) ?? event.turnId)
      const remote = codexTurnTiming(event.timing)
      const fallback = remote && (!cached || remote.observedAt >= cached.observedAt) ? remote : cached
      const clock = next?.state==='working' && source.live!==true ? fallback
        : cached && cached.state !== 'working' && next?.state === 'working' ? cached : next ?? fallback
      const timing = clock?.state==='working' && clock!==remote ? {...clock,live:!!next&&source.live===true} : clock
      if (!timing) return event
      // Never attach an in-flight time to a completed event or another terminal outcome.
      if (event.kind === 'Stop' && timing.state !== 'finished' || event.kind === 'Interrupt' && timing.state !== 'interrupted') return event
      put.run(scope, event.turnId, JSON.stringify(timing))
      return { ...event, timing }
    })
  }
}
