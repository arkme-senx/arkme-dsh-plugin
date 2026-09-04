import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { appendFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { createGzip } from 'node:zlib'
import { securePrivateDirectorySync, securePrivateFileSync } from '../private-filesystem.js'
import { decryptLedgerPayload, encryptLedgerPayload } from './crypto.js'
import { canonicalHistoryEntry } from './presentation.js'
import { asDshRemoteError, DshRemoteError } from './errors.js'
import { projectCompletedTurns } from './turn-projector.js'
import type { DshRemoteHistoryEntry } from './dsh-event-contract.js'
import type { DshRemoteControlPlane, DshRemoteRuntimeProjection, DshRemoteTimelineNode } from './types.js'

const PROJECTION_INPUT_LIMIT_BYTES = 4 * 1024 * 1024
const RETRY_MAX_MILLIS = 30_000
const COMMITTED_RETENTION_MILLIS = 7 * 24 * 60 * 60_000
const DEFAULT_MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024
const DEFAULT_MAX_PENDING_SPOOL_BYTES = 512 * 1024 * 1024

export type DshRemoteTurnUploadState = 'OPEN' | 'SEALED' | 'PREPARED' | 'UPLOADED' | 'COMMITTED'
type DshRemoteTurnStatus = 'completed' | 'interrupted' | 'error' | 'max_tokens'

interface TurnRow {
  turn_id: string
  session_ref: string
  turn_ref: string
  start_seq: number
  end_seq: number
  turn_status: DshRemoteTurnStatus
  state: DshRemoteTurnUploadState
  spool_name: string
  object_name: string
  event_count: number
  spool_bytes: number
  content_sha256: string | null
  compressed_bytes: number | null
  upload_id: string | null
  upload_credential_nonce: string | null
  upload_credential_ciphertext: string | null
  expires_at_millis: number | null
  prepared_host_generation: number | null
  attempts: number
  next_attempt_at_millis: number
  created_at_millis: number
  updated_at_millis: number
}

interface HistoryCompletionRow {
  session_ref: string
  source_revision: string | null
  through_seq: number
  state: 'PENDING' | 'FINALIZED'
  attempts: number
  next_attempt_at_millis: number
  created_at_millis: number
  updated_at_millis: number
}

interface PreparedUpload {
  uploadId: string
  uploadUrl?: string
  uploadHeaders?: Record<string, string>
  expiresAtMillis: number
  alreadyCommitted: boolean
}

export interface DshRemoteTurnUploadOutboxStats {
  OPEN: number
  SEALED: number
  PREPARED: number
  UPLOADED: number
  COMMITTED: number
}

export interface DshRemoteTurnUploadOutboxOptions {
  directory: string
  profileRef: string
  key: Uint8Array
  controlPlane: DshRemoteControlPlane
  now?: () => number
  fetch?: typeof fetch
  retryBaseMillis?: number
  maxObjectBytes?: number
  maxPendingSpoolBytes?: number
  onError?: (error: unknown, sessionRef?: string) => void
  onFinalized?: (sessionRef: string) => void
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DshRemoteError('REMOTE_INVALID_RESPONSE', `Backend ${field} 无效`, true)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string, max = 2_048): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new DshRemoteError('REMOTE_INVALID_RESPONSE', `Backend ${field} 无效`, true)
  }
  return value.trim()
}

function turnStatus(entry: DshRemoteHistoryEntry): DshRemoteTurnStatus {
  const data = entry.event.data !== null && typeof entry.event.data === 'object' && !Array.isArray(entry.event.data)
    ? entry.event.data as Record<string, unknown> : {}
  const raw = data.reason
  const reason = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? String((raw as Record<string, unknown>).kind ?? '') : String(raw ?? '')
  if (reason === 'error') return 'error'
  if (reason === 'max-tokens' || reason === 'max_tokens') return 'max_tokens'
  if (['interrupted', 'cancelled', 'canceled', 'aborted'].includes(reason)) return 'interrupted'
  return 'completed'
}

function isTerminalTurnEvent(entry: DshRemoteHistoryEntry): boolean {
  return entry.event.type === 'turn/end'
}

function parsePreparedUpload(value: Record<string, unknown>): PreparedUpload {
  const alreadyCommitted = value.already_committed === true
  const uploadHeaders: Record<string, string> = {}
  const headers = value.upload_headers === undefined ? {} : record(value.upload_headers, 'upload_headers')
  for (const [name, headerValue] of Object.entries(headers)) {
    if (typeof headerValue !== 'string' || name.trim() === '') {
      throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'Backend upload_headers 无效', true)
    }
    uploadHeaders[name] = headerValue
  }
  let uploadUrl: string | undefined
  if (!alreadyCommitted) {
    uploadUrl = requiredString(value.upload_url, 'upload_url', 8_192)
    let parsed: URL
    try { parsed = new URL(uploadUrl) }
    catch (error) {
      throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'Backend upload_url 无效', true, {}, { cause: error })
    }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname))) {
      throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'Backend upload_url 必须使用 HTTPS', true)
    }
  }
  const expires = value.expires_at
  if (!alreadyCommitted && (typeof expires !== 'number' || !Number.isSafeInteger(expires) || expires <= 0)) {
    throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'Backend expires_at 无效', true)
  }
  return {
    uploadId: alreadyCommitted
      ? typeof value.upload_id === 'string' ? value.upload_id.trim() : ''
      : requiredString(value.upload_id, 'upload_id', 512),
    ...(uploadUrl === undefined ? {} : { uploadUrl, uploadHeaders }),
    // Accept Unix seconds and milliseconds across a rolling Backend deployment.
    expiresAtMillis: typeof expires === 'number'
      ? expires < 10_000_000_000 ? expires * 1_000 : expires
      : Number.MAX_SAFE_INTEGER,
    alreadyCommitted,
  }
}

function stableTurnId(profileRef: string, sessionRef: string, startSeq: number): string {
  return createHash('sha256')
    .update(`dsh-remote-turn-outbox-v1\n${profileRef}\n${sessionRef}\n${String(startSeq)}`)
    .digest('base64url')
}

function idempotencyKey(row: TurnRow): string {
  return createHash('sha256').update([
    'dsh-remote-turn-object-v1', row.session_ref, row.turn_ref,
    String(row.start_seq), String(row.end_seq), row.content_sha256 ?? '',
  ].join('\n')).digest('base64url')
}

/**
 * Account-scoped durable owner for completed Turn uploads.
 *
 * Raw events are appended one JSON record at a time. The final gzip object is
 * streamed from disk, so a large Turn never becomes one in-memory JSON value.
 */
export class DshRemoteTurnUploadOutbox {
  private readonly database: DatabaseSync
  private readonly spoolDirectory: string
  private readonly now: () => number
  private readonly fetcher: typeof fetch
  private readonly retryBaseMillis: number
  private readonly maxObjectBytes: number
  private readonly maxPendingSpoolBytes: number
  private readonly key: Buffer
  private readonly databasePath: string
  private readonly recovery: Promise<void>
  private runtime: DshRemoteRuntimeProjection | undefined
  private captureTail: Promise<void> = Promise.resolve()
  private drainFlight: Promise<void> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private controller = new AbortController()
  private closed = false
  private pendingSpoolBytes = 0
  private readonly verifiedHistorySessions = new Set<string>()

  constructor(private readonly options: DshRemoteTurnUploadOutboxOptions) {
    if (options.key.length !== 32) throw new TypeError('DshRemoteTurnUploadOutbox key must be 32 bytes')
    this.key = Buffer.from(options.key)
    this.now = options.now ?? Date.now
    this.fetcher = options.fetch ?? fetch
    this.retryBaseMillis = Math.max(100, Math.min(5_000, options.retryBaseMillis ?? 500))
    this.maxObjectBytes = Math.max(1, Math.min(DEFAULT_MAX_OBJECT_BYTES, options.maxObjectBytes ?? DEFAULT_MAX_OBJECT_BYTES))
    this.maxPendingSpoolBytes = Math.max(
      1,
      Math.min(DEFAULT_MAX_PENDING_SPOOL_BYTES, options.maxPendingSpoolBytes ?? DEFAULT_MAX_PENDING_SPOOL_BYTES),
    )
    mkdirSync(options.directory, { recursive: true, mode: 0o700 })
    securePrivateDirectorySync(options.directory)
    this.spoolDirectory = join(options.directory, 'spool')
    mkdirSync(this.spoolDirectory, { recursive: true, mode: 0o700 })
    securePrivateDirectorySync(this.spoolDirectory)
    this.databasePath = join(options.directory, 'turn-upload.sqlite3')
    this.database = new DatabaseSync(this.databasePath)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS dsh_turn_upload_v2 (
        turn_id TEXT PRIMARY KEY,
        session_ref TEXT NOT NULL,
        turn_ref TEXT NOT NULL,
        start_seq INTEGER NOT NULL,
        end_seq INTEGER NOT NULL,
        turn_status TEXT NOT NULL CHECK (turn_status IN ('completed', 'interrupted', 'error', 'max_tokens')),
        state TEXT NOT NULL CHECK (state IN ('OPEN', 'SEALED', 'PREPARED', 'UPLOADED', 'COMMITTED')),
        spool_name TEXT NOT NULL,
        object_name TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        spool_bytes INTEGER NOT NULL,
        content_sha256 TEXT,
        compressed_bytes INTEGER,
        upload_id TEXT,
        upload_credential_nonce TEXT,
        upload_credential_ciphertext TEXT,
        expires_at_millis INTEGER,
        prepared_host_generation INTEGER,
        attempts INTEGER NOT NULL,
        next_attempt_at_millis INTEGER NOT NULL,
        created_at_millis INTEGER NOT NULL,
        updated_at_millis INTEGER NOT NULL,
        UNIQUE (session_ref, start_seq)
      );
      CREATE INDEX IF NOT EXISTS dsh_turn_upload_v2_drain
        ON dsh_turn_upload_v2 (state, next_attempt_at_millis, created_at_millis);
      CREATE INDEX IF NOT EXISTS dsh_turn_upload_v2_session
        ON dsh_turn_upload_v2 (session_ref, start_seq);
      CREATE TABLE IF NOT EXISTS dsh_history_scan_v2 (
        session_ref TEXT PRIMARY KEY,
        source_revision TEXT NOT NULL,
        completed_through_seq INTEGER NOT NULL,
        updated_at_millis INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dsh_history_completion_v2 (
        session_ref TEXT PRIMARY KEY,
        source_revision TEXT,
        through_seq INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('PENDING', 'FINALIZED')),
        attempts INTEGER NOT NULL,
        next_attempt_at_millis INTEGER NOT NULL,
        created_at_millis INTEGER NOT NULL,
        updated_at_millis INTEGER NOT NULL
      );
      DROP TABLE IF EXISTS dsh_history_finalization_v1;
      DROP TABLE IF EXISTS dsh_history_backfill_v1;
    `)
    this.secureDatabaseFiles()
    this.cleanupCommitted()
    this.recovery = this.recoverOpenTurnsFromDisk()
  }

  async activate(runtime: DshRemoteRuntimeProjection): Promise<void> {
    if (this.closed) throw new Error('DshRemoteTurnUploadOutbox is closed')
    await this.recovery
    this.runtime = runtime
    this.database.prepare(`
      UPDATE dsh_turn_upload_v2
      SET attempts = 0, next_attempt_at_millis = 0, updated_at_millis = ?
      WHERE state = 'SEALED'
    `).run(this.now())
    this.database.prepare(`
      UPDATE dsh_turn_upload_v2
      SET state = 'SEALED', upload_id = NULL, upload_credential_nonce = NULL,
          upload_credential_ciphertext = NULL, expires_at_millis = NULL,
          prepared_host_generation = NULL, next_attempt_at_millis = 0
      WHERE state IN ('PREPARED', 'UPLOADED')
        AND prepared_host_generation IS NOT NULL
        AND prepared_host_generation <> ?
    `).run(runtime.hostGeneration)
    this.database.prepare(`
      UPDATE dsh_history_completion_v2
      SET attempts = 0, next_attempt_at_millis = 0, updated_at_millis = ?
      WHERE state = 'PENDING'
    `).run(this.now())
    this.scheduleDrain(0)
  }

  async capture(sessionRef: string, entries: readonly DshRemoteHistoryEntry[]): Promise<void> {
    if (this.closed || entries.length === 0) return
    const operation = this.captureTail.then(async () => { await this.captureEntries(sessionRef, entries) })
    this.captureTail = operation.catch(() => undefined)
    return await operation
  }

  private async captureEntries(sessionRef: string, entries: readonly DshRemoteHistoryEntry[]): Promise<void> {
    await this.recovery
    const sorted = [...entries].sort((left, right) => left.event.seq - right.event.seq)
    let open = this.openTurn(sessionRef)
    let lastSeq = open?.end_seq ?? -1
    let lines: string[] = []
    let bytes = 0
    const flush = async (): Promise<void> => {
      if (open === undefined || lines.length === 0) return
      await appendFile(this.spoolPath(open), lines.join(''), { encoding: 'utf8', mode: 0o600 })
      const now = this.now()
      this.database.prepare(`
        UPDATE dsh_turn_upload_v2
        SET end_seq = ?, event_count = event_count + ?,
            spool_bytes = spool_bytes + ?, updated_at_millis = ?
        WHERE turn_id = ? AND state = 'OPEN'
      `).run(lastSeq, lines.length, bytes, now, open.turn_id)
      this.pendingSpoolBytes += bytes
      open = this.requireRow(open.turn_id)
      lines = []
      bytes = 0
    }
    for (const entry of sorted) {
      if (entry.event.type === 'turn/start') {
        if (open !== undefined && open.start_seq !== entry.event.seq) {
          await flush()
          this.seal(open, 'interrupted', open.end_seq)
          open = undefined
        }
        open ??= this.createOpenTurn(sessionRef, entry.event.seq)
        lastSeq = open.end_seq
      }
      if (open === undefined || open.state !== 'OPEN' || entry.event.seq <= lastSeq) continue
      const line = `${JSON.stringify(canonicalHistoryEntry(entry))}\n`
      const lineBytes = Buffer.byteLength(line)
      if (this.pendingSpoolBytes + bytes + lineBytes > this.maxPendingSpoolBytes) {
        throw new DshRemoteError('REMOTE_STORAGE_FAILED', 'Turn Outbox 已达到本地容量上限')
      }
      lines.push(line)
      bytes += lineBytes
      lastSeq = entry.event.seq
      if (isTerminalTurnEvent(entry)) {
        await flush()
        this.seal(open, turnStatus(entry), open.end_seq)
        open = undefined
        lastSeq = -1
      }
    }
    await flush()
    this.scheduleDrain(0)
  }

  stats(): DshRemoteTurnUploadOutboxStats {
    const result: DshRemoteTurnUploadOutboxStats = { OPEN: 0, SEALED: 0, PREPARED: 0, UPLOADED: 0, COMMITTED: 0 }
    const rows = this.database.prepare(`
      SELECT state, COUNT(*) AS count FROM dsh_turn_upload_v2 GROUP BY state
    `).all() as unknown as Array<{ state: DshRemoteTurnUploadState; count: number }>
    for (const row of rows) result[row.state] = Number(row.count)
    return result
  }

  needsHistoryRevision(sessionRef: string, sourceRevision: string): boolean {
    const known = this.database.prepare(`
      SELECT 1 AS known
      WHERE EXISTS (
        SELECT 1 FROM dsh_history_scan_v2
        WHERE session_ref = ? AND source_revision = ?
      ) OR EXISTS (
        SELECT 1 FROM dsh_history_completion_v2
        WHERE session_ref = ? AND source_revision = ?
      )
    `).get(sessionRef, sourceRevision, sessionRef, sourceRevision)
    return known === undefined
  }

  queueHistoryFinalization(sessionRef: string, sourceRevision: string, throughSeq: number): void {
    if (sessionRef.trim() === '' || sessionRef.length > 128 || sourceRevision.trim() === '' ||
      sourceRevision.length > 1024 || !Number.isSafeInteger(throughSeq) || throughSeq < -1) {
      throw new DshRemoteError('REMOTE_STORAGE_FAILED', '历史重传 checkpoint 无效')
    }
    this.verifiedHistorySessions.delete(sessionRef)
    const now = this.now()
    this.database.prepare(`
      INSERT INTO dsh_history_completion_v2 (
        session_ref, source_revision, through_seq, state, attempts,
        next_attempt_at_millis, created_at_millis, updated_at_millis
      ) VALUES (?, ?, ?, 'PENDING', 0, 0, ?, ?)
      ON CONFLICT(session_ref) DO UPDATE SET
        source_revision = excluded.source_revision,
        through_seq = excluded.through_seq,
        state = 'PENDING', attempts = 0, next_attempt_at_millis = 0,
        updated_at_millis = excluded.updated_at_millis
      WHERE excluded.through_seq >= dsh_history_completion_v2.through_seq
        AND (dsh_history_completion_v2.source_revision IS NOT excluded.source_revision
          OR dsh_history_completion_v2.through_seq <> excluded.through_seq)
    `).run(sessionRef, sourceRevision, throughSeq, now, now)
    this.scheduleDrain(0)
  }

  private queueLiveCompletion(sessionRef: string, throughSeq: number): void {
    if (!this.verifiedHistorySessions.has(sessionRef)) return
    const now = this.now()
    this.database.prepare(`
      INSERT INTO dsh_history_completion_v2 (
        session_ref, source_revision, through_seq, state, attempts,
        next_attempt_at_millis, created_at_millis, updated_at_millis
      ) VALUES (?, NULL, ?, 'PENDING', 0, 0, ?, ?)
      ON CONFLICT(session_ref) DO UPDATE SET
        source_revision = NULL, through_seq = excluded.through_seq,
        state = 'PENDING', attempts = 0, next_attempt_at_millis = 0,
        updated_at_millis = excluded.updated_at_millis
      WHERE excluded.through_seq > dsh_history_completion_v2.through_seq
    `).run(sessionRef, throughSeq, now, now)
    this.scheduleDrain(0)
  }

  async drain(): Promise<void> {
    await this.recovery
    if (this.closed || this.runtime === undefined) return
    if (this.drainFlight !== undefined) return await this.drainFlight
    const flight = this.performDrain()
    this.drainFlight = flight
    try { await flight }
    finally { if (this.drainFlight === flight) this.drainFlight = undefined }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    await this.captureTail
    await this.recovery.catch(() => undefined)
    this.controller.abort()
    await this.drainFlight?.catch(() => undefined)
    this.database.close()
    this.key.fill(0)
  }

  private createOpenTurn(
    sessionRef: string,
    startSeq: number,
  ): TurnRow {
    const turnId = stableTurnId(this.options.profileRef, sessionRef, startSeq)
    const now = this.now()
    this.database.prepare(`
      INSERT OR IGNORE INTO dsh_turn_upload_v2 (
        turn_id, session_ref, turn_ref, start_seq, end_seq, turn_status, state,
        spool_name, object_name, event_count, spool_bytes,
        attempts, next_attempt_at_millis, created_at_millis, updated_at_millis
      ) VALUES (?, ?, ?, ?, ?, 'interrupted', 'OPEN', ?, ?, 0, 0, 0, 0, ?, ?)
    `).run(
      turnId, sessionRef, `turn:${String(startSeq)}:open`, startSeq, startSeq - 1,
      `${turnId}.ndjson`, `${turnId}.json.gz`, now, now,
    )
    return this.requireRow(turnId)
  }

  private seal(row: TurnRow, status: DshRemoteTurnStatus, endSeq: number): void {
    this.database.prepare(`
      UPDATE dsh_turn_upload_v2
      SET turn_ref = ?, end_seq = ?, turn_status = ?, state = 'SEALED',
          next_attempt_at_millis = 0, updated_at_millis = ?
      WHERE turn_id = ? AND state = 'OPEN'
    `).run(`turn:${String(row.start_seq)}:${String(endSeq)}`, endSeq, status, this.now(), row.turn_id)
  }

  private openTurn(sessionRef: string): TurnRow | undefined {
    return this.database.prepare(`
      SELECT * FROM dsh_turn_upload_v2
      WHERE session_ref = ? AND state = 'OPEN'
      ORDER BY start_seq DESC LIMIT 1
    `).get(sessionRef) as unknown as TurnRow | undefined
  }

  private requireRow(turnId: string): TurnRow {
    const row = this.database.prepare('SELECT * FROM dsh_turn_upload_v2 WHERE turn_id = ?').get(turnId) as unknown as TurnRow | undefined
    if (row === undefined) throw new DshRemoteError('REMOTE_STORAGE_FAILED', 'Turn Outbox 条目不存在')
    return row
  }

  private nextReady(): TurnRow | undefined {
    return this.database.prepare(`
      SELECT * FROM dsh_turn_upload_v2
      WHERE state IN ('SEALED', 'PREPARED', 'UPLOADED') AND next_attempt_at_millis <= ?
      ORDER BY CASE WHEN attempts = 0 THEN 0 ELSE 1 END, created_at_millis ASC
      LIMIT 1
    `).get(this.now()) as unknown as TurnRow | undefined
  }

  private nextFinalizationReady(): HistoryCompletionRow | undefined {
    return this.database.prepare(`
      SELECT * FROM dsh_history_completion_v2
      WHERE state = 'PENDING' AND next_attempt_at_millis <= ?
      ORDER BY CASE WHEN attempts = 0 THEN 0 ELSE 1 END, created_at_millis ASC
      LIMIT 1
    `).get(this.now()) as unknown as HistoryCompletionRow | undefined
  }

  private committedHistoryProof(row: HistoryCompletionRow): {
    turnCount: number
    lastTurnRef: string
    lastEndSeq: number
  } | undefined {
    const pending = this.database.prepare(`
      SELECT 1 FROM dsh_turn_upload_v2
      WHERE session_ref = ? AND start_seq <= ? AND state <> 'COMMITTED'
      LIMIT 1
    `).get(row.session_ref, row.through_seq)
    if (pending !== undefined) return undefined
    const count = this.database.prepare(`
      SELECT COUNT(*) AS count FROM dsh_turn_upload_v2
      WHERE session_ref = ? AND start_seq <= ? AND state = 'COMMITTED'
    `).get(row.session_ref, row.through_seq) as unknown as { count: number }
    const last = this.database.prepare(`
      SELECT turn_ref, end_seq FROM dsh_turn_upload_v2
      WHERE session_ref = ? AND start_seq <= ? AND state = 'COMMITTED'
      ORDER BY start_seq DESC, turn_ref DESC LIMIT 1
    `).get(row.session_ref, row.through_seq) as unknown as Pick<TurnRow, 'turn_ref' | 'end_seq'> | undefined
    return {
      turnCount: Number(count.count),
      lastTurnRef: last?.turn_ref ?? '',
      lastEndSeq: last?.end_seq ?? -1,
    }
  }

  private deferFinalization(row: HistoryCompletionRow, error: unknown): void {
    const remote = asDshRemoteError(error)
    const attempts = row.attempts + 1
    const delay = Math.min(RETRY_MAX_MILLIS, this.retryBaseMillis * (2 ** Math.min(6, attempts - 1)))
    const nextAttempt = remote.retryable ? this.now() + delay : Number.MAX_SAFE_INTEGER
    this.database.prepare(`
      UPDATE dsh_history_completion_v2
      SET attempts = ?, next_attempt_at_millis = ?, updated_at_millis = ?
      WHERE session_ref = ? AND source_revision IS ? AND through_seq = ? AND state = 'PENDING'
    `).run(attempts, nextAttempt, this.now(), row.session_ref, row.source_revision, row.through_seq)
    this.options.onError?.(error, row.session_ref)
    if (remote.retryable) this.scheduleDrain(delay)
  }

  private async finalizeHistory(row: HistoryCompletionRow, runtime: DshRemoteRuntimeProjection, signal: AbortSignal): Promise<void> {
    const proof = this.committedHistoryProof(row)
    if (proof === undefined) {
      const delay = this.retryBaseMillis
      this.database.prepare(`
        UPDATE dsh_history_completion_v2
        SET next_attempt_at_millis = ?, updated_at_millis = ?
        WHERE session_ref = ? AND source_revision IS ? AND through_seq = ? AND state = 'PENDING'
      `).run(this.now() + delay, this.now(), row.session_ref, row.source_revision, row.through_seq)
      this.scheduleDrain(delay)
      return
    }
    const complete = this.options.controlPlane.completeSessionTurnObjectHistory
    if (complete === undefined) {
      throw new DshRemoteError('CAPABILITY_UNSUPPORTED', 'Backend 不支持 OSS Turn 历史完成证明', true)
    }
    await complete.call(this.options.controlPlane, {
      runtime_ref: runtime.runtimeRef,
      host_generation: runtime.hostGeneration,
      session_ref: row.session_ref,
      through_seq: row.through_seq,
      committed_turn_count: proof.turnCount,
      last_committed_turn_ref: proof.lastTurnRef,
      last_committed_end_seq: proof.lastEndSeq,
    }, signal)
    const now = this.now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const updated = this.database.prepare(`
        UPDATE dsh_history_completion_v2
        SET state = 'FINALIZED', attempts = 0, next_attempt_at_millis = 0, updated_at_millis = ?
        WHERE session_ref = ? AND source_revision IS ? AND through_seq = ? AND state = 'PENDING'
      `).run(now, row.session_ref, row.source_revision, row.through_seq)
      if (updated.changes > 0 && row.source_revision !== null) {
        this.database.prepare(`
          INSERT INTO dsh_history_scan_v2 (
            session_ref, source_revision, completed_through_seq, updated_at_millis
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(session_ref) DO UPDATE SET
            source_revision = excluded.source_revision,
            completed_through_seq = excluded.completed_through_seq,
            updated_at_millis = excluded.updated_at_millis
        `).run(row.session_ref, row.source_revision, row.through_seq, now)
      }
      this.database.exec('COMMIT')
      if (updated.changes > 0 && row.source_revision !== null) {
        this.verifiedHistorySessions.add(row.session_ref)
      }
      if (updated.changes > 0) this.options.onFinalized?.(row.session_ref)
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private async performDrain(): Promise<void> {
    while (!this.closed && this.runtime !== undefined) {
      const row = this.nextReady()
      if (row === undefined) {
        const finalization = this.nextFinalizationReady()
        if (finalization === undefined) return
        try {
          await this.finalizeHistory(finalization, this.runtime, this.controller.signal)
        } catch (error) {
          if (this.closed || this.controller.signal.aborted) return
          this.deferFinalization(finalization, error)
        }
        continue
      }
      try {
        await this.advance(row, this.runtime, this.controller.signal)
      } catch (error) {
        if (this.closed || this.controller.signal.aborted) return
        const remote = asDshRemoteError(error)
        const attempts = row.attempts + 1
        const delay = Math.min(RETRY_MAX_MILLIS, this.retryBaseMillis * (2 ** Math.min(6, attempts - 1)))
        this.database.prepare(`
          UPDATE dsh_turn_upload_v2
          SET attempts = ?, next_attempt_at_millis = ?, updated_at_millis = ?
          WHERE turn_id = ?
        `).run(attempts, remote.retryable ? this.now() + delay : Number.MAX_SAFE_INTEGER, this.now(), row.turn_id)
        this.options.onError?.(error, row.session_ref)
        if (remote.retryable) {
          this.scheduleDrain(delay)
          return
        }
        // A permanently paused poison row must not starve unrelated ready
        // Turns. Its MAX_SAFE_INTEGER deadline keeps it inspectable in Outbox.
        continue
      }
    }
  }

  private async advance(row: TurnRow, runtime: DshRemoteRuntimeProjection, signal: AbortSignal): Promise<void> {
    if (row.state === 'SEALED') {
      const preparedFile = await this.prepareObjectFile(row, signal)
      row = this.requireRow(row.turn_id)
      const prepare = this.options.controlPlane.prepareSessionTurnUpload
      if (prepare === undefined) throw new DshRemoteError('CAPABILITY_UNSUPPORTED', 'Backend 不支持 Turn OSS 上传', true)
      const response = await prepare.call(this.options.controlPlane, {
        runtime_ref: runtime.runtimeRef,
        host_generation: runtime.hostGeneration,
        session_ref: row.session_ref,
        turn_ref: row.turn_ref,
        start_seq: row.start_seq,
        end_seq: row.end_seq,
        status: row.turn_status,
        event_count: preparedFile.eventCount,
        compressed_bytes: preparedFile.bytes,
        content_sha256: preparedFile.sha256,
        content_md5: preparedFile.md5,
        presentation_version: 1,
        idempotency_key: idempotencyKey(row),
      }, signal)
      const prepared = parsePreparedUpload(response)
      if (prepared.alreadyCommitted) {
        this.database.prepare(`
          UPDATE dsh_turn_upload_v2
          SET state = 'COMMITTED', spool_bytes = 0, upload_id = NULL,
              upload_credential_nonce = NULL, upload_credential_ciphertext = NULL,
              expires_at_millis = NULL, prepared_host_generation = ?,
              next_attempt_at_millis = 0, updated_at_millis = ?
          WHERE turn_id = ?
        `).run(runtime.hostGeneration, this.now(), row.turn_id)
        this.pendingSpoolBytes = Math.max(0, this.pendingSpoolBytes - row.spool_bytes)
        this.removePayloadFiles(row)
        this.queueLiveCompletion(row.session_ref, row.end_seq)
        return
      }
      const credential = encryptLedgerPayload(
        this.key,
        JSON.stringify({ uploadUrl: prepared.uploadUrl, uploadHeaders: prepared.uploadHeaders }),
        `dsh-remote-turn-upload-credential-v1\n${row.turn_id}`,
      )
      this.database.prepare(`
        UPDATE dsh_turn_upload_v2
        SET state = ?, upload_id = ?, upload_credential_nonce = ?, upload_credential_ciphertext = ?,
            expires_at_millis = ?, prepared_host_generation = ?,
            updated_at_millis = ?
        WHERE turn_id = ?
      `).run(
        'PREPARED', prepared.uploadId, credential.nonce, credential.ciphertext,
        prepared.expiresAtMillis, runtime.hostGeneration,
        this.now(), row.turn_id,
      )
      row = this.requireRow(row.turn_id)
    }
    if (row.state === 'PREPARED') {
      if ((row.expires_at_millis ?? 0) <= this.now() + 5_000) {
        this.database.prepare(`
          UPDATE dsh_turn_upload_v2
          SET state = 'SEALED', upload_id = NULL, upload_credential_nonce = NULL,
              upload_credential_ciphertext = NULL, expires_at_millis = NULL,
              prepared_host_generation = NULL, updated_at_millis = ?
          WHERE turn_id = ?
        `).run(this.now(), row.turn_id)
        throw new DshRemoteError('REMOTE_NETWORK_UNAVAILABLE', 'Turn 上传凭证已过期，等待重新准备', true)
      }
      await this.putObject(row, signal)
      this.database.prepare(`
        UPDATE dsh_turn_upload_v2 SET state = 'UPLOADED', updated_at_millis = ? WHERE turn_id = ?
      `).run(this.now(), row.turn_id)
      row = this.requireRow(row.turn_id)
    }
    if (row.state === 'UPLOADED') {
      const commit = this.options.controlPlane.commitSessionTurnUpload
      if (commit === undefined) throw new DshRemoteError('CAPABILITY_UNSUPPORTED', 'Backend 不支持 Turn OSS 提交', true)
      try {
        await commit.call(this.options.controlPlane, {
          upload_id: row.upload_id,
          content_sha256: row.content_sha256,
        }, signal)
      } catch (error) {
        const remote = asDshRemoteError(error)
        if (remote.code !== 'REMOTE_NOT_FOUND') throw error
        // UploadIntent TTL can expire after the exact object succeeded. A fresh
        // prepare will either return already_committed or sign the same object;
        // the stable content hash remains the final idempotency identity.
        this.database.prepare(`
          UPDATE dsh_turn_upload_v2
          SET state = 'SEALED', upload_id = NULL, upload_credential_nonce = NULL,
              upload_credential_ciphertext = NULL, expires_at_millis = NULL,
              prepared_host_generation = NULL, next_attempt_at_millis = 0,
              updated_at_millis = ?
          WHERE turn_id = ?
        `).run(this.now(), row.turn_id)
        throw new DshRemoteError('REMOTE_NETWORK_UNAVAILABLE', 'Turn UploadIntent 已过期，等待重新准备', true)
      }
      this.database.prepare(`
        UPDATE dsh_turn_upload_v2
        SET state = 'COMMITTED', upload_credential_nonce = NULL,
            upload_credential_ciphertext = NULL, expires_at_millis = NULL,
            spool_bytes = 0, next_attempt_at_millis = 0, updated_at_millis = ?
        WHERE turn_id = ?
      `).run(this.now(), row.turn_id)
      this.pendingSpoolBytes = Math.max(0, this.pendingSpoolBytes - row.spool_bytes)
      this.removePayloadFiles(row)
      this.queueLiveCompletion(row.session_ref, row.end_seq)
    }
  }

  private async prepareObjectFile(
    row: TurnRow,
    signal: AbortSignal,
  ): Promise<{ bytes: number; sha256: string; md5: string; eventCount: number }> {
    const objectPath = this.objectPath(row)
    if (!existsSync(objectPath)) {
      const summary = await this.spoolSummary(row, signal)
      const temporaryPath = `${objectPath}.tmp`
      rmSync(temporaryPath, { force: true })
      const prefix = JSON.stringify({
        schema: 'dsh.turn.v1',
        turn: {
          turn_ref: row.turn_ref,
          start_seq: row.start_seq,
          end_seq: row.end_seq,
          status: row.turn_status,
        },
        presentation: {
          version: 1,
          nodes: summary.nodes,
          ...(summary.presentationTruncated ? { truncated: true } : {}),
        },
      }).slice(0, -1)
      const source = Readable.from(this.objectJson(row, `${prefix},"events":[`, summary.eventCount, signal))
      await pipeline(
        source,
        createGzip(),
        createWriteStream(temporaryPath, { mode: 0o600, flags: 'wx' }),
        { signal },
      )
      renameSync(temporaryPath, objectPath)
      securePrivateFileSync(objectPath)
    }
    const { sha256, md5 } = await this.hashFile(objectPath, signal)
    const bytes = (await stat(objectPath)).size
    if (bytes > this.maxObjectBytes) {
      throw new DshRemoteError(
        'CAPABILITY_UNSUPPORTED',
        `Turn 压缩对象超过单对象上限（${String(this.maxObjectBytes)} bytes），需要 manifest 分片协议`,
      )
    }
    const eventCount = (await this.spoolSummary(row, signal)).eventCount
    this.database.prepare(`
      UPDATE dsh_turn_upload_v2
      SET event_count = ?, content_sha256 = ?, compressed_bytes = ?, updated_at_millis = ?
      WHERE turn_id = ?
    `).run(eventCount, sha256, bytes, this.now(), row.turn_id)
    return { bytes, sha256, md5, eventCount }
  }

  private async *objectJson(
    row: TurnRow,
    prefix: string,
    expectedCount: number,
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    yield prefix
    let first = true
    let count = 0
    let previousSeq = -1
    for await (const line of this.spoolLines(row, signal)) {
      const parsed = JSON.parse(line) as DshRemoteHistoryEntry
      const seq = parsed.event.seq
      if (!Number.isSafeInteger(seq) || seq <= previousSeq) continue
      previousSeq = seq
      yield `${first ? '' : ','}${line}`
      first = false
      count += 1
      if (count % 512 === 0) {
        await new Promise<void>(resolve => { setImmediate(resolve) })
      }
    }
    if (count !== expectedCount) throw new DshRemoteError('REMOTE_STORAGE_FAILED', 'Turn spool 在封存后发生变化')
    yield `],"integrity":{"event_count":${String(count)}}}`
  }

  private async spoolSummary(row: TurnRow, signal: AbortSignal): Promise<{
    eventCount: number
    nodes: DshRemoteTimelineNode[]
    presentationTruncated: boolean
  }> {
    let eventCount = 0
    let previousSeq = -1
    let projectionBytes = 0
    let presentationTruncated = false
    let projectionEntries: DshRemoteHistoryEntry[] = []
    for await (const line of this.spoolLines(row, signal)) {
      const parsed = JSON.parse(line) as DshRemoteHistoryEntry
      const seq = parsed.event.seq
      if (!Number.isSafeInteger(seq) || seq <= previousSeq) continue
      previousSeq = seq
      eventCount += 1
      const bytes = Buffer.byteLength(line)
      if (!presentationTruncated && projectionBytes + bytes > PROJECTION_INPUT_LIMIT_BYTES) {
        presentationTruncated = true
        // Raw assistant chunks dominate pathological Turns. The final
        // assistant/message and lifecycle events still produce a useful,
        // bounded presentation while every raw chunk remains in events[].
        projectionEntries = projectionEntries.filter(item => item.event.type !== 'assistant/chunk')
        projectionBytes = projectionEntries.reduce(
          (total, item) => total + Buffer.byteLength(JSON.stringify(item)), 0,
        )
      }
      if ((!presentationTruncated || parsed.event.type !== 'assistant/chunk')
        && projectionBytes + bytes <= PROJECTION_INPUT_LIMIT_BYTES) {
        projectionEntries.push(parsed)
        projectionBytes += bytes
      }
      if (eventCount % 512 === 0) {
        await new Promise<void>(resolve => { setImmediate(resolve) })
      }
    }
    const projected = projectCompletedTurns(projectionEntries)
    const nodes = projected.turns[0]?.nodes ?? []
    presentationTruncated ||= projected.oversizedTurnRefs.length > 0
    return { eventCount, nodes, presentationTruncated }
  }

  private async *spoolLines(row: TurnRow, signal: AbortSignal): AsyncGenerator<string> {
    const stream = createReadStream(this.spoolPath(row), { encoding: 'utf8', signal })
    const input = createInterface({
      input: stream,
      crlfDelay: Infinity,
    })
    try {
      for await (const line of input) if (line !== '') yield line
    } finally {
      input.close()
      stream.destroy()
    }
  }

  private async putObject(row: TurnRow, signal: AbortSignal): Promise<void> {
    if (row.upload_credential_nonce === null || row.upload_credential_ciphertext === null) {
      throw new DshRemoteError('REMOTE_STORAGE_FAILED', 'Turn 上传凭证缺失')
    }
    const credential = JSON.parse(decryptLedgerPayload(this.key, {
      nonce: row.upload_credential_nonce,
      ciphertext: row.upload_credential_ciphertext,
    }, `dsh-remote-turn-upload-credential-v1\n${row.turn_id}`).toString('utf8')) as {
      uploadUrl?: unknown
      uploadHeaders?: unknown
    }
    const uploadUrl = requiredString(credential.uploadUrl, 'persisted upload_url', 8_192)
    const headers = new Headers(record(credential.uploadHeaders ?? {}, 'persisted upload_headers') as Record<string, string>)
    headers.set('content-length', String(row.compressed_bytes))
    const response = await this.fetcher(uploadUrl, {
      method: 'PUT', headers,
      body: Readable.toWeb(createReadStream(this.objectPath(row), { signal })) as ReadableStream,
      signal,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    // A no-overwrite exact-object policy can report an earlier unknown-success
    // retry as conflict; Backend HEAD validation remains the final authority.
    if (!response.ok && response.status !== 409 && response.status !== 412) {
      throw new DshRemoteError('REMOTE_NETWORK_UNAVAILABLE', `OSS Turn 上传失败（HTTP ${String(response.status)}）`, true)
    }
  }

  private async hashFile(path: string, signal: AbortSignal): Promise<{ sha256: string; md5: string }> {
    const sha256 = createHash('sha256')
    const md5 = createHash('md5')
    for await (const chunk of createReadStream(path, { signal })) {
      sha256.update(chunk as Buffer)
      md5.update(chunk as Buffer)
    }
    return { sha256: sha256.digest('hex'), md5: md5.digest('base64') }
  }

  private spoolPath(row: Pick<TurnRow, 'spool_name'>): string {
    return join(this.spoolDirectory, basename(row.spool_name))
  }

  private objectPath(row: Pick<TurnRow, 'object_name'>): string {
    return join(this.spoolDirectory, basename(row.object_name))
  }

  private removePayloadFiles(row: TurnRow): void {
    rmSync(this.spoolPath(row), { force: true })
    rmSync(this.objectPath(row), { force: true })
  }

  private scheduleDrain(delayMillis: number): void {
    if (this.closed || this.runtime === undefined) return
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.drain().catch(error => { this.options.onError?.(error) })
    }, delayMillis)
    this.retryTimer.unref()
  }

  private cleanupCommitted(): void {
    const committed = this.database.prepare(`
      SELECT * FROM dsh_turn_upload_v2
      WHERE state = 'COMMITTED' AND session_ref NOT IN (
        SELECT session_ref FROM dsh_history_completion_v2 WHERE state = 'PENDING'
      )
    `).all() as unknown as TurnRow[]
    for (const row of committed) this.removePayloadFiles(row)
    const cutoff = this.now() - COMMITTED_RETENTION_MILLIS
    this.database.prepare(`
      DELETE FROM dsh_turn_upload_v2
      WHERE state = 'COMMITTED' AND updated_at_millis < ? AND session_ref NOT IN (
        SELECT session_ref FROM dsh_history_completion_v2 WHERE state = 'PENDING'
      )
    `).run(cutoff)
    this.database.prepare(`
      DELETE FROM dsh_turn_upload_v2
      WHERE state = 'COMMITTED' AND session_ref NOT IN (
        SELECT session_ref FROM dsh_history_completion_v2 WHERE state = 'PENDING'
      ) AND turn_id NOT IN (
        SELECT turn_id FROM dsh_turn_upload_v2
        WHERE state = 'COMMITTED' ORDER BY updated_at_millis DESC LIMIT 10000
      )
    `).run()
  }

  private async recoverOpenTurnsFromDisk(): Promise<void> {
    const rows = this.database.prepare(`
      SELECT * FROM dsh_turn_upload_v2 WHERE state = 'OPEN'
    `).all() as unknown as TurnRow[]
    for (const row of rows) {
      const path = this.spoolPath(row)
      if (!existsSync(path)) {
        this.discardUnrecoverableRow(row)
        continue
      }
      let eventCount = 0
      let endSeq = row.start_seq - 1
      try {
        for await (const line of this.spoolLines(row, this.controller.signal)) {
          const parsed = JSON.parse(line) as DshRemoteHistoryEntry
          if (!Number.isSafeInteger(parsed.event.seq) || parsed.event.seq <= endSeq) continue
          endSeq = parsed.event.seq
          eventCount += 1
        }
      } catch {
        this.discardUnrecoverableRow(row)
        continue
      }
      if (eventCount === 0) {
        this.database.prepare('DELETE FROM dsh_turn_upload_v2 WHERE turn_id = ?').run(row.turn_id)
        rmSync(path, { force: true })
        continue
      }
      const spoolBytes = (await stat(path)).size
      this.database.prepare(`
        UPDATE dsh_turn_upload_v2
        SET end_seq = ?, event_count = ?, spool_bytes = ?, updated_at_millis = ?
        WHERE turn_id = ?
      `).run(
        endSeq, eventCount, spoolBytes, this.now(), row.turn_id,
      )
    }
    const pending = this.database.prepare(`
      SELECT COALESCE(SUM(spool_bytes), 0) AS bytes
      FROM dsh_turn_upload_v2 WHERE state <> 'COMMITTED'
    `).get() as unknown as { bytes: number }
    this.pendingSpoolBytes = Number(pending.bytes)
  }

  private discardUnrecoverableRow(row: TurnRow): void {
    this.database.prepare('DELETE FROM dsh_turn_upload_v2 WHERE turn_id = ?').run(row.turn_id)
    this.database.prepare('DELETE FROM dsh_history_completion_v2 WHERE session_ref = ?').run(row.session_ref)
    this.database.prepare('DELETE FROM dsh_history_scan_v2 WHERE session_ref = ?').run(row.session_ref)
    this.verifiedHistorySessions.delete(row.session_ref)
    this.removePayloadFiles(row)
  }

  private secureDatabaseFiles(): void {
    for (const suffix of ['', '-wal', '-shm']) {
      try { securePrivateFileSync(`${this.databasePath}${suffix}`) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
  }
}
