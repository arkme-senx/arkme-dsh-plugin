import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/** Local dispatch only. These IDs must be resolved by the authenticated host, not by message text. */
export interface CodexDispatchScope { ownerId: number; teamRef: string; sourceId: string }
export interface CodexDispatchTarget extends CodexDispatchScope { taskId: string; threadId: string }
export type CodexDispatchState = 'pending' | 'preparing' | 'waiting' | 'submitting'
  | 'queued_confirmed' | 'accepted_confirmed' | 'unknown' | 'cancelled' | 'expired'
export type CodexDispatchWaitReason = 'permission_required' | 'locked' | 'codex_unavailable'
  | 'draft_present' | 'user_active' | 'target_unavailable' | 'executor_restarted'
export interface CodexDispatchRequest extends CodexDispatchTarget {
  requestId: string; text: string; delivery: 'queue'; generation: string
  state: CodexDispatchState; reason: string; createdAt: number; updatedAt: number; expiresAt: number
  evidence: CodexDispatchEvidence | null
}
/** Only an adapter correlating NEW native evidence to this attempt may construct this receipt. */
export interface CodexDispatchEvidence {
  requestId: string; threadId: string; kind: 'queue' | 'turn'; nativeId: string
}
export interface CodexDispatchLease { request: CodexDispatchRequest; token: string; executorId: string }
interface RequestRow { payload: string; state: CodexDispatchState; reason: string; updated_at: number; evidence: string | null }
interface Control { enabled: number; generation: string }
interface Lane { request_id: string; token: string; executor_id: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const waitingReasons = new Set<CodexDispatchWaitReason>(['permission_required', 'locked', 'codex_unavailable',
  'draft_present', 'user_active', 'target_unavailable', 'executor_restarted'])
const reject = (code: string): never => { throw new Error(`CODEX_DISPATCH_${code}`) }
function scopeKey(scope: CodexDispatchScope): string {
  if (!Number.isSafeInteger(scope.ownerId) || scope.ownerId <= 0
    || !/^team_v1_[A-Za-z0-9_-]{32}$/.test(scope.teamRef) || !uuid.test(scope.sourceId)) reject('INVALID_SCOPE')
  return JSON.stringify([scope.ownerId, scope.teamRef, scope.sourceId])
}
function decode(row: RequestRow): CodexDispatchRequest {
  return { ...JSON.parse(row.payload), state: row.state, reason: row.reason, updatedAt: row.updated_at,
    evidence: row.evidence ? JSON.parse(row.evidence) : null } as CodexDispatchRequest
}

/**
 * A private, durable LOCAL outbox, deliberately separate from activity upload and Codex's queue DB.
 * Not an authentication boundary: only a trusted host/companion may call these methods.
 * Use one private database per physical input executor. Multiple preview processes must share it
 * or hold an additional OS-level singleton lock before enabling a real adapter.
 */
export class CodexDispatchJournal {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    // Commit the intent before permitting any native input. Never enable synchronous=OFF here.
    db.exec(`PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS codex_dispatch_control (
        scope TEXT PRIMARY KEY, enabled INTEGER NOT NULL, generation TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS codex_dispatch_requests (
        request_id TEXT PRIMARY KEY, scope TEXT NOT NULL, task_id TEXT NOT NULL,
        payload TEXT NOT NULL, state TEXT NOT NULL, reason TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, evidence TEXT);
      CREATE INDEX IF NOT EXISTS codex_dispatch_scope ON codex_dispatch_requests(scope,created_at);
      CREATE TABLE IF NOT EXISTS codex_dispatch_lane (
        id INTEGER PRIMARY KEY CHECK(id=1), request_id TEXT NOT NULL, token TEXT NOT NULL, executor_id TEXT NOT NULL);`)
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = work(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private control(key: string): Control | undefined {
    return this.db.prepare('SELECT enabled,generation FROM codex_dispatch_control WHERE scope=?').get(key) as Control | undefined
  }
  private row(id: string): RequestRow | undefined {
    return this.db.prepare('SELECT * FROM codex_dispatch_requests WHERE request_id=?').get(id) as RequestRow | undefined
  }
  private update(id: string, state: CodexDispatchState, reason = '', evidence: CodexDispatchEvidence | null = null): void {
    this.db.prepare('UPDATE codex_dispatch_requests SET state=?,reason=?,updated_at=?,evidence=? WHERE request_id=?')
      .run(state, reason, this.now(), evidence ? JSON.stringify(evidence) : null, id)
  }
  private release(): void { this.db.exec('DELETE FROM codex_dispatch_lane WHERE id=1') }
  private checked(lease: CodexDispatchLease, state: CodexDispatchState): CodexDispatchRequest {
    const lane = this.db.prepare('SELECT * FROM codex_dispatch_lane WHERE id=1').get() as Lane | undefined
    const row = this.row(lease.request.requestId)
    if (!lane || lane.request_id !== lease.request.requestId || lane.token !== lease.token
      || lane.executor_id !== lease.executorId || row?.state !== state) return reject('STALE_ATTEMPT')
    // Read the canonical payload; never trust a caller-modified lease object.
    return decode(row)
  }

  /** Must be reached through an explicit, local user control, never by enabling uploads. */
  enable(scope: CodexDispatchScope): void {
    const key = scopeKey(scope)
    this.transaction(() => {
      if (this.control(key)?.enabled) return
      this.db.prepare(`INSERT INTO codex_dispatch_control VALUES(?,1,?)
        ON CONFLICT(scope) DO UPDATE SET enabled=1,generation=excluded.generation`).run(key, randomUUID())
    })
  }

  /** Revocation fences unstarted requests permanently, even if the user subsequently re-enables. */
  revoke(scope: CodexDispatchScope): void {
    const key = scopeKey(scope)
    this.transaction(() => {
      this.db.prepare('UPDATE codex_dispatch_control SET enabled=0,generation=? WHERE scope=?').run(randomUUID(), key)
      this.db.prepare(`UPDATE codex_dispatch_requests SET state='cancelled',reason='control_revoked',updated_at=?
        WHERE scope=? AND state IN ('pending','waiting')`).run(this.now(), key)
      // An active executor retains the lane. It must recheck authorization before touching the UI;
      // a possibly submitted request is NOT reset or reassigned on logout/revocation.
    })
  }

  create(target: CodexDispatchTarget, requestId: string, text: string): CodexDispatchRequest {
    const key = scopeKey(target)
    if (!uuid.test(requestId) || !uuid.test(target.taskId) || !uuid.test(target.threadId)) reject('INVALID_TARGET')
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 16_384
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) reject('INVALID_TEXT')
    // No truncation or trimming: idempotency is based on the exact approved payload.
    return this.transaction(() => {
      const previous = this.row(requestId)
      if (previous) {
        const value = decode(previous)
        if (scopeKey(value) !== key || value.taskId !== target.taskId || value.threadId !== target.threadId || value.text !== text) reject('REQUEST_CONFLICT')
        return value
      }
      const control = this.control(key)
      if (!control?.enabled) return reject('CONTROL_DISABLED')
      const at = this.now()
      const value: CodexDispatchRequest = { ownerId: target.ownerId, teamRef: target.teamRef, sourceId: target.sourceId,
        taskId: target.taskId, threadId: target.threadId, requestId, text, delivery: 'queue', generation: control.generation,
        state: 'pending', reason: '', createdAt: at, updatedAt: at, expiresAt: at + 86_400_000, evidence: null }
      this.db.prepare('INSERT INTO codex_dispatch_requests VALUES(?,?,?,?,?,?,?,?,?,NULL)')
        .run(requestId, key, target.taskId, JSON.stringify(value), value.state, '', at, at, value.expiresAt)
      return value
    })
  }

  list(scope: CodexDispatchScope, taskId: string): CodexDispatchRequest[] {
    return (this.db.prepare('SELECT * FROM codex_dispatch_requests WHERE scope=? AND task_id=? ORDER BY created_at,rowid')
      .all(scopeKey(scope), taskId) as unknown as RequestRow[]).map(decode)
  }

  claim(scope: CodexDispatchScope, executorId: string): CodexDispatchLease | undefined {
    const key = scopeKey(scope)
    if (!uuid.test(executorId)) reject('INVALID_EXECUTOR')
    return this.transaction(() => {
      if (!this.control(key)?.enabled || this.db.prepare('SELECT 1 FROM codex_dispatch_lane').get()) return
      this.db.prepare(`UPDATE codex_dispatch_requests SET state='expired',reason='expired',updated_at=?
        WHERE scope=? AND state IN ('pending','waiting') AND expires_at<=?`).run(this.now(), key, this.now())
      const row = this.db.prepare(`SELECT * FROM codex_dispatch_requests WHERE scope=?
        AND state IN ('pending','waiting') ORDER BY created_at,rowid LIMIT 1`).get(key) as RequestRow | undefined
      if (!row) return
      const request = decode(row), token = randomUUID()
      this.update(request.requestId, 'preparing')
      this.db.prepare('INSERT INTO codex_dispatch_lane VALUES(1,?,?,?)').run(request.requestId, token, executorId)
      return { request: { ...request, state: 'preparing', reason: '', updatedAt: this.now() }, token, executorId }
    })
  }

  private authorizationFailure(request: CodexDispatchRequest): 'control_revoked' | 'expired' | undefined {
    const control = this.control(scopeKey(request))
    if (!control?.enabled || control.generation !== request.generation) return 'control_revoked'
    if (request.expiresAt <= this.now()) return 'expired'
    return undefined
  }

  wait(lease: CodexDispatchLease, reason: CodexDispatchWaitReason): void {
    if (!waitingReasons.has(reason)) reject('INVALID_WAIT_REASON')
    this.transaction(() => {
      const request = this.checked(lease, 'preparing'), failure = this.authorizationFailure(request)
      this.update(request.requestId, failure === 'expired' ? 'expired' : failure ? 'cancelled' : 'waiting', failure ?? reason)
      this.release()
    })
  }

  /** The returned canonical request is the ONLY payload the adapter may submit. */
  beginInput(lease: CodexDispatchLease): CodexDispatchRequest | undefined {
    return this.transaction(() => {
      const request = this.checked(lease, 'preparing'), failure = this.authorizationFailure(request)
      if (failure) {
        this.update(request.requestId, failure === 'expired' ? 'expired' : 'cancelled', failure)
        this.release(); return
      }
      this.update(request.requestId, 'submitting')
      return { ...request, state: 'submitting', reason: '', updatedAt: this.now() }
    })
  }

  /** Last-moment fence for the adapter, including between staging text and pressing send. */
  canSubmit(lease: CodexDispatchLease): boolean {
    try { return this.authorizationFailure(this.checked(lease, 'submitting')) === undefined }
    catch { return false }
  }

  finish(lease: CodexDispatchLease, evidence: CodexDispatchEvidence | null): CodexDispatchRequest {
    return this.transaction(() => {
      const request = this.checked(lease, 'submitting')
      const alreadyUsed = evidence && this.db.prepare(`SELECT 1 FROM codex_dispatch_requests
        WHERE json_extract(evidence,'$.threadId')=? AND json_extract(evidence,'$.kind')=?
          AND json_extract(evidence,'$.nativeId')=?`).get(evidence.threadId, evidence.kind, evidence.nativeId)
      const valid = !alreadyUsed && evidence && evidence.requestId === request.requestId && evidence.threadId === request.threadId
        && ['queue', 'turn'].includes(evidence.kind) && uuid.test(evidence.nativeId)
      // A receipt is confirmation, not completion. Null/malformed evidence never enables retry.
      const receipt = valid ? { requestId: request.requestId, threadId: request.threadId,
        kind: evidence.kind, nativeId: evidence.nativeId } : null
      this.update(request.requestId, receipt ? receipt.kind === 'queue' ? 'queued_confirmed' : 'accepted_confirmed' : 'unknown',
        receipt ? '' : 'delivery_unconfirmed', receipt)
      this.release()
      return decode(this.row(request.requestId)!)
    })
  }

  /**
   * Caller MUST prove the named executor has stopped while holding the OS singleton lock.
   * No timeouts/lease expiry automatically reclaim an executor that could still press send.
   */
  recoverStoppedExecutor(executorId: string): void {
    this.transaction(() => {
      const lane = this.db.prepare('SELECT * FROM codex_dispatch_lane WHERE id=1 AND executor_id=?').get(executorId) as Lane | undefined
      if (!lane) return
      const row = this.row(lane.request_id)
      if (row?.state === 'submitting') this.update(lane.request_id, 'unknown', 'delivery_unconfirmed')
      else if (row?.state === 'preparing') {
        const failure = this.authorizationFailure(decode(row))
        this.update(lane.request_id, failure === 'expired' ? 'expired' : failure ? 'cancelled' : 'waiting', failure ?? 'executor_restarted')
      }
      this.release()
    })
  }
}
