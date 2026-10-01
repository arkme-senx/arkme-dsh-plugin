import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type { DatabaseSync } from 'node:sqlite'
import type { TeamCodexEvent, TeamCodexTask } from './team-codex-contract.js'

export interface CloudEvent {
  event_id: string; version: number; turn_id: string; turn_seq: number
  kind: TeamCodexEvent['kind']; text: string; at: number; truncated: boolean
}
export interface CloudTask {
  task_id: string; version: number; project_key: string; project_name: string; task_title: string; branch: string; events: CloudEvent[]
}
export interface CloudBatch extends Record<string, unknown> {
  expected_owner_ref: string; team_ref: string; source_id: string; source_name: string; tasks: CloudTask[]
}
interface Source { id: string; owner: number; local_team: string; team: string; name: string }
interface TaskRow { id: string; local_id: string; source: string; payload: string; version: number; ack: number; blocked: string }
interface EventRow { id: string; task: string; slot: string; payload: string; version: number; ack: number; blocked: string }
const bytes = (s: string) => Buffer.byteLength(s, 'utf8')
export function clipUtf8(text: string, limit: number): string {
  if (bytes(text) <= limit) return text
  let result = '', size = 0
  for (const character of text) { size += bytes(character); if (size > limit) break; result += character }
  return result
}
const metadata = (text: string | undefined, limit: number) => clipUtf8((text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' '), limit)
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Durable identity/version/ACK ledger. No credentials, queue snapshots, paths or tool logs. */
export class TeamCodexCloudJournal {
  private previousSource = ''
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS codex_cloud_sources (
      id TEXT PRIMARY KEY, owner INTEGER NOT NULL, local_team TEXT NOT NULL, local_source TEXT NOT NULL,
      team TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(owner,local_team,local_source));
      CREATE TABLE IF NOT EXISTS codex_cloud_tasks (
      id TEXT PRIMARY KEY, local_id TEXT NOT NULL, source TEXT NOT NULL REFERENCES codex_cloud_sources(id),
      payload TEXT NOT NULL, version INTEGER NOT NULL, ack INTEGER NOT NULL DEFAULT 0, blocked TEXT NOT NULL DEFAULT '',
      UNIQUE(local_id,source));
      CREATE TABLE IF NOT EXISTS codex_cloud_turns (
      task TEXT NOT NULL REFERENCES codex_cloud_tasks(id), local_turn TEXT NOT NULL, seq INTEGER NOT NULL,
      PRIMARY KEY(task,local_turn), UNIQUE(task,seq));
      CREATE TABLE IF NOT EXISTS codex_cloud_events (
      id TEXT PRIMARY KEY, task TEXT NOT NULL REFERENCES codex_cloud_tasks(id), slot TEXT NOT NULL,
      payload TEXT NOT NULL, version INTEGER NOT NULL, ack INTEGER NOT NULL DEFAULT 0, blocked TEXT NOT NULL DEFAULT '',
      UNIQUE(task,slot));`)
  }

  private source(owner: number, localTeam: string, team: string, localSource: string): Source {
    const existing = this.db.prepare('SELECT * FROM codex_cloud_sources WHERE owner=? AND local_team=? AND local_source=?').get(owner, localTeam, localSource) as unknown as Source | undefined
    if (existing) {
      if (existing.team !== team) throw new Error('ACCOUNT_OR_DESTINATION_MISMATCH')
      return existing
    }
    const row: Source = { id: randomUUID(), owner, local_team: localTeam, team, name: metadata(hostname(), 128) || 'Codex' }
    this.db.prepare('INSERT INTO codex_cloud_sources(id,owner,local_team,local_source,team,name) VALUES(?,?,?,?,?,?)').run(row.id, owner, localTeam, localSource, team, row.name)
    return row
  }

  mapping(owner: number, team: string, localId: string): { taskId: string; sourceId: string; sourceName: string } | undefined {
    const row = this.db.prepare(`SELECT t.id,s.id AS source,s.name FROM codex_cloud_tasks t JOIN codex_cloud_sources s ON s.id=t.source
      WHERE s.owner=? AND s.local_team=? AND t.local_id=?`).get(owner, team, localId) as { id: string; source: string; name: string } | undefined
    return row && { taskId: row.id, sourceId: row.source, sourceName: row.name }
  }

  forget(owner: number, team: string, localId: string): void {
    const mapping = this.mapping(owner, team, localId)
    if (!mapping) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM codex_cloud_events WHERE task=?').run(mapping.taskId)
      this.db.prepare('DELETE FROM codex_cloud_turns WHERE task=?').run(mapping.taskId)
      this.db.prepare('DELETE FROM codex_cloud_tasks WHERE id=?').run(mapping.taskId)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  reconcile(owner: number, localTeam: string, team: string, tasks: readonly TeamCodexTask[], events: (task: TeamCodexTask) => TeamCodexEvent[]): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const task of tasks) {
        // Local v1 -> machine-wide migration must retain the original cloud identity/source.
        const hasMigrations = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='codex_legacy_migrations'").get()
        const migrated = hasMigrations ? this.db.prepare(`SELECT c.* FROM codex_cloud_tasks c JOIN codex_cloud_sources s ON s.id=c.source
          JOIN codex_legacy_migrations m ON m.connection_id=c.local_id WHERE m.task_id=? AND s.owner=? AND s.local_team=? LIMIT 1`).get(task.id,owner,localTeam) as unknown as TaskRow|undefined : undefined
        if(migrated) this.db.prepare('UPDATE codex_cloud_tasks SET local_id=? WHERE id=?').run(task.id,migrated.id)
        const retained = this.db.prepare(`SELECT s.* FROM codex_cloud_tasks c JOIN codex_cloud_sources s ON s.id=c.source
          WHERE c.local_id=? AND s.owner=? AND s.local_team=?`).get(task.id,owner,localTeam) as unknown as Source|undefined
        const source = retained ?? this.source(owner, localTeam, team, task.installationId ?? task.id)
        if(source.team!==team) throw new Error('ACCOUNT_OR_DESTINATION_MISMATCH')
        let row = this.db.prepare('SELECT * FROM codex_cloud_tasks WHERE local_id=? AND source=?').get(task.id, source.id) as unknown as TaskRow | undefined
        const payload = JSON.stringify({ project_key: metadata(task.projectKey || 'unknown', 1024), project_name: metadata(task.projectName, 256), task_title: metadata(task.title, 1024), branch: metadata(task.branch, 256) })
        if (!row) {
          row = { id: randomUUID(), local_id: task.id, source: source.id, payload, version: 1, ack: 0, blocked: '' }
          this.db.prepare('INSERT INTO codex_cloud_tasks(id,local_id,source,payload,version) VALUES(?,?,?,?,1)').run(row.id, task.id, source.id, payload)
        } else if (row.payload !== payload && !row.blocked) {
          this.db.prepare('UPDATE codex_cloud_tasks SET payload=?,version=version+1 WHERE id=?').run(payload, row.id)
        }
        // Backfill in original chronology. Later turns receive a stable, never-reused sequence.
        const ordered = [...events(task)].sort((a, b) => a.at - b.at || a.sequence - b.sequence)
        for (const event of ordered) {
          const localTurn = event.turnId
          let turn = this.db.prepare('SELECT seq FROM codex_cloud_turns WHERE task=? AND local_turn=?').get(row.id, localTurn) as { seq: number } | undefined
          if (!turn) {
            const { seq } = this.db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM codex_cloud_turns WHERE task=?').get(row.id) as { seq: number }
            turn = { seq }
            this.db.prepare('INSERT INTO codex_cloud_turns VALUES(?,?,?)').run(row.id, localTurn, seq)
          }
          const slot = digest(JSON.stringify([localTurn, event.kind]))
          const previous = this.db.prepare('SELECT * FROM codex_cloud_events WHERE task=? AND slot=?').get(row.id, slot) as unknown as EventRow | undefined
          const oldPayload = previous ? JSON.parse(previous.payload) as CloudEvent : undefined
          const text = clipUtf8(event.text, 256 * 1024)
          const eventPayload = JSON.stringify({ turn_id: digest(localTurn), turn_seq: turn.seq, kind: event.kind,
            text, at: oldPayload?.at ?? event.at, truncated: event.truncated || text !== event.text })
          if (!previous) this.db.prepare('INSERT INTO codex_cloud_events(id,task,slot,payload,version) VALUES(?,?,?,?,1)').run(randomUUID(), row.id, slot, eventPayload)
          else if (previous.payload !== eventPayload && !previous.blocked) this.db.prepare('UPDATE codex_cloud_events SET payload=?,version=version+1 WHERE id=?').run(eventPayload, previous.id)
        }
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  private rows(owner: number, localTeam: string, eligible: ReadonlySet<string>): TaskRow[] {
    return (this.db.prepare(`SELECT t.* FROM codex_cloud_tasks t JOIN codex_cloud_sources s ON s.id=t.source
      WHERE s.owner=? AND s.local_team=? ORDER BY t.rowid`).all(owner, localTeam) as unknown as TaskRow[]).filter(row => eligible.has(row.local_id))
  }

  counts(owner: number, team: string, eligible: ReadonlySet<string>): { pending: number; blocked: number } {
    let pending = 0, blocked = 0
    for (const task of this.rows(owner, team, eligible)) {
      if (task.blocked) blocked++; else if (task.ack < task.version) pending++
      const events = this.db.prepare('SELECT version,ack,blocked FROM codex_cloud_events WHERE task=?').all(task.id) as unknown as EventRow[]
      for (const event of events) { if (event.blocked) blocked++; else if (event.ack < event.version) pending++ }
    }
    return { pending, blocked }
  }

  batch(owner: number, localTeam: string, eligible: ReadonlySet<string>): CloudBatch | undefined {
    let batch: CloudBatch | undefined, count = 0
    const rows = this.rows(owner, localTeam, eligible)
    // A retrying device must not starve other sources belonging to this account/team.
    rows.sort((a, b) => Number(a.source === this.previousSource) - Number(b.source === this.previousSource))
    for (const row of rows) {
      if (batch && row.source !== batch.source_id) continue
      const events = this.db.prepare("SELECT * FROM codex_cloud_events WHERE task=? AND ack<version AND blocked='' ORDER BY rowid LIMIT 100").all(row.id) as unknown as EventRow[]
      if ((!events.length && (row.ack >= row.version || row.blocked))) continue
      if (!batch) {
        const source = this.db.prepare('SELECT * FROM codex_cloud_sources WHERE id=?').get(row.source) as unknown as Source
        batch = { expected_owner_ref: String(owner), team_ref: source.team, source_id: source.id, source_name: source.name, tasks: [] }
      }
      const task: CloudTask = { ...JSON.parse(row.payload), task_id: row.id, version: row.version, events: [] }
      batch.tasks.push(task)
      for (const event of events) {
        if (count === 100) break
        task.events.push({ ...JSON.parse(event.payload), event_id: event.id, version: event.version })
        if (bytes(JSON.stringify(batch)) > 1_048_576) { task.events.pop(); break }
        count++
      }
      if (bytes(JSON.stringify(batch)) > 1_048_576 || (!task.events.length && (row.ack >= row.version || row.blocked))) batch.tasks.pop()
      if (count === 100 || batch.tasks.length === 100) break
    }
    if (batch?.tasks.length) { this.previousSource = batch.source_id; return batch }
    return undefined
  }

  acknowledge(batch: CloudBatch, data: unknown): void {
    const response = object(data)
    if (response.owner_ref !== batch.expected_owner_ref) throw new Error('ACCOUNT_OR_DESTINATION_MISMATCH')
    const tasks = Array.isArray(response.task_results) ? response.task_results : []
    const events = Array.isArray(response.event_results) ? response.event_results : []
    const ack = (table: 'codex_cloud_tasks' | 'codex_cloud_events', id: string, version: number, matches: unknown[]) => {
      // Duplicate/missing ACKs are ambiguous: retry the same stable identity and version.
      if (matches.length !== 1) return
      const result = object(matches[0])
      if ((result.status === 'saved' || result.status === 'unchanged') && result.version === version) {
        this.db.prepare(`UPDATE ${table} SET ack=MAX(ack,?) WHERE id=?`).run(version, id)
      } else if (['stale', 'conflict'].includes(String(result.status)) || (result.status === 'rejected' && result.retryable !== true)) {
        this.db.prepare(`UPDATE ${table} SET blocked=? WHERE id=?`).run(String(result.error_code || result.status).slice(0, 128), id)
      }
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const task of batch.tasks) {
        ack('codex_cloud_tasks', task.task_id, task.version, tasks.filter(item => object(item).task_id === task.task_id))
        for (const event of task.events) ack('codex_cloud_events', event.event_id, event.version,
          events.filter(item => object(item).task_id === task.task_id && object(item).event_id === event.event_id))
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
