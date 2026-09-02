import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { securePrivateDirectorySync, securePrivateFileSync } from '../private-filesystem.js'
import { canonicalJson, decryptLedgerPayload, encryptLedgerPayload } from './crypto.js'
import { DshRemoteError } from './errors.js'
import type { DshRemoteOperation } from './types.js'

export type DshRemoteLedgerState = 'pending' | 'completed' | 'outcome_unknown'

export interface DshRemoteLedgerIdentity {
  accountId: string
  runtimeRef: string
  requestRef: string
  operation: DshRemoteOperation
  arguments: Record<string, unknown>
  executeBeforeMillis: number
}

export interface DshRemoteLedgerEntry extends Omit<DshRemoteLedgerIdentity, 'arguments'> {
  argumentsHash: string
  state: DshRemoteLedgerState
  dshRpcId: string
  payload: Record<string, unknown>
  createdAtMillis: number
  updatedAtMillis: number
}

interface IdentityRow {
  identity_id: number
  account_id: string
  runtime_ref: string
  request_ref: string
  operation: DshRemoteOperation
  arguments_hash: string
  dsh_rpc_id: string
  execute_before_millis: number
  created_at_millis: number
}

interface EventRow {
  state: DshRemoteLedgerState
  nonce: string
  ciphertext: string
  created_at_millis: number
}

function argumentsHash(operation: string, argumentsValue: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson({ operation, arguments: argumentsValue })).digest('base64url')
}

/** Cross-client identity: mobile writes it before send and DSH echoes it in canonical history. */
export function dshRemoteCommandRpcId(input: Pick<DshRemoteLedgerIdentity, 'accountId' | 'runtimeRef' | 'requestRef'>): string {
  return `remote_${createHash('sha256')
    .update(`dsh-remote-rpc-v2\n${input.accountId}\n${input.runtimeRef}\n${input.requestRef}`)
    .digest('base64url').slice(0, 32)}`
}

export class DshRemoteCommandLedger {
  private readonly path: string
  private readonly database: DatabaseSync
  private readonly key: Buffer
  private readonly now: () => number

  constructor(
    directory: string,
    key: Uint8Array,
    options: { now?: () => number } = {},
  ) {
    if (key.length !== 32) throw new TypeError('DshRemoteCommandLedger key must be 32 bytes')
    this.key = Buffer.from(key)
    this.now = options.now ?? Date.now
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    securePrivateDirectorySync(directory)
    this.path = join(directory, 'remote-command-ledger.sqlite3')
    this.database = new DatabaseSync(this.path)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS remote_command_identity_v2 (
        identity_id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        runtime_ref TEXT NOT NULL,
        request_ref TEXT NOT NULL,
        operation TEXT NOT NULL,
        arguments_hash TEXT NOT NULL,
        dsh_rpc_id TEXT NOT NULL,
        execute_before_millis INTEGER NOT NULL,
        created_at_millis INTEGER NOT NULL,
        UNIQUE (account_id, runtime_ref, request_ref)
      );
      CREATE TABLE IF NOT EXISTS remote_command_event_v2 (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        identity_id INTEGER NOT NULL REFERENCES remote_command_identity_v2(identity_id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'outcome_unknown')),
        nonce TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        created_at_millis INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS remote_command_event_v2_identity
        ON remote_command_event_v2 (identity_id, event_id DESC);
      CREATE INDEX IF NOT EXISTS remote_command_identity_v2_created
        ON remote_command_identity_v2 (created_at_millis DESC);
    `)
    this.secureFiles()
  }

  begin(input: DshRemoteLedgerIdentity): { duplicate: boolean; entry: DshRemoteLedgerEntry } {
    this.validateIdentity(input)
    const hash = argumentsHash(input.operation, input.arguments)
    const existing = this.identity(input)
    if (existing !== undefined) {
      if (existing.operation !== input.operation || existing.arguments_hash !== hash || existing.account_id !== input.accountId) {
        throw new DshRemoteError('SESSION_STATE_CHANGED', '相同 request_ref 携带了不同操作或参数')
      }
      return { duplicate: true, entry: this.entry(existing) }
    }
    const now = this.now()
    this.transaction(() => {
      const result = this.database.prepare(`
        INSERT INTO remote_command_identity_v2 (
          account_id, runtime_ref, request_ref, operation, arguments_hash,
          dsh_rpc_id, execute_before_millis, created_at_millis
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.accountId, input.runtimeRef, input.requestRef, input.operation, hash,
        dshRemoteCommandRpcId(input), input.executeBeforeMillis, now,
      )
      this.appendEvent(Number(result.lastInsertRowid), 'pending', { arguments: input.arguments }, now)
    })
    this.secureFiles()
    const row = this.identity(input)
    if (row === undefined) throw new DshRemoteError('REMOTE_STORAGE_FAILED', '命令账本写入失败')
    return { duplicate: false, entry: this.entry(row) }
  }

  complete(
    identity: Pick<DshRemoteLedgerIdentity, 'accountId' | 'runtimeRef' | 'requestRef'>,
    result: Record<string, unknown>,
  ): DshRemoteLedgerEntry {
    const row = this.requireIdentity(identity)
    const current = this.entry(row)
    if (current.state === 'completed') return current
    if (current.state === 'outcome_unknown') {
      throw new DshRemoteError('COMMAND_OUTCOME_UNKNOWN', '命令结果尚未完成对账，禁止覆盖')
    }
    this.appendEvent(row.identity_id, 'completed', { result }, this.now())
    this.secureFiles()
    return this.entry(row)
  }

  completeRejected(
    identity: Pick<DshRemoteLedgerIdentity, 'accountId' | 'runtimeRef' | 'requestRef'>,
    error: Pick<DshRemoteError, 'code' | 'message' | 'retryable'>,
  ): DshRemoteLedgerEntry {
    return this.complete(identity, {
      rejected: { code: error.code, message: error.message.slice(0, 500), retryable: error.retryable },
    })
  }

  markOutcomeUnknown(
    identity: Pick<DshRemoteLedgerIdentity, 'accountId' | 'runtimeRef' | 'requestRef'>,
    reason: string,
  ): DshRemoteLedgerEntry {
    const row = this.requireIdentity(identity)
    const current = this.entry(row)
    if (current.state === 'completed' || current.state === 'outcome_unknown') return current
    this.appendEvent(row.identity_id, 'outcome_unknown', { reason: reason.slice(0, 500) }, this.now())
    this.secureFiles()
    return this.entry(row)
  }

  get(identity: Pick<DshRemoteLedgerIdentity, 'accountId' | 'runtimeRef' | 'requestRef'>): DshRemoteLedgerEntry | undefined {
    const row = this.identity(identity)
    if (row === undefined || row.account_id !== identity.accountId) return undefined
    return this.entry(row)
  }

  pending(accountId: string, nowMillis = this.now()): DshRemoteLedgerEntry[] {
    const rows = this.database.prepare(`
      SELECT identity_id, account_id, runtime_ref, request_ref, operation,
             arguments_hash, dsh_rpc_id, execute_before_millis, created_at_millis
      FROM remote_command_identity_v2
      WHERE account_id = ?
      ORDER BY created_at_millis ASC
    `).all(accountId) as unknown as IdentityRow[]
    return rows.map(row => this.entry(row)).filter(entry => entry.state === 'pending' && entry.executeBeforeMillis >= nowMillis)
  }

  /**
   * Returns every unsettled command still inside the v4 reconciliation window.
   *
   * An expired execute_before only prevents executing the command again. It must
   * not hide the crash window where DSH accepted the stable rpcId before the Host
   * persisted the result. Callers must inspect DSH history and either complete
   * the entry or mark outcome_unknown; they must never re-dispatch these rows.
   */
  unsettledForReconciliation(
    accountId: string,
    nowMillis = this.now(),
    reconciliationWindowMillis = 24 * 60 * 60_000,
  ): DshRemoteLedgerEntry[] {
    if (!Number.isSafeInteger(reconciliationWindowMillis) || reconciliationWindowMillis <= 0) {
      throw new DshRemoteError('REMOTE_REQUEST_INVALID', '命令对账窗口无效')
    }
    const rows = this.database.prepare(`
      SELECT identity_id, account_id, runtime_ref, request_ref, operation,
             arguments_hash, dsh_rpc_id, execute_before_millis, created_at_millis
      FROM remote_command_identity_v2
      WHERE account_id = ? AND created_at_millis >= ?
      ORDER BY created_at_millis ASC
    `).all(accountId, nowMillis - reconciliationWindowMillis) as unknown as IdentityRow[]
    return rows.map(row => this.entry(row)).filter(entry => entry.state === 'pending')
  }

  cleanup(options: { retentionMillis?: number; maxCommands?: number } = {}): number {
    const cutoff = this.now() - (options.retentionMillis ?? 7 * 24 * 60 * 60_000)
    const maxCommands = Math.min(100_000, Math.max(100, options.maxCommands ?? 10_000))
    const before = Number((this.database.prepare('SELECT COUNT(*) AS count FROM remote_command_identity_v2').get() as { count: number }).count)
    this.transaction(() => {
      this.database.prepare('DELETE FROM remote_command_identity_v2 WHERE created_at_millis < ?').run(cutoff)
      this.database.prepare(`
        DELETE FROM remote_command_identity_v2
        WHERE identity_id NOT IN (
          SELECT identity_id FROM remote_command_identity_v2 ORDER BY created_at_millis DESC LIMIT ?
        )
      `).run(maxCommands)
    })
    const after = Number((this.database.prepare('SELECT COUNT(*) AS count FROM remote_command_identity_v2').get() as { count: number }).count)
    this.secureFiles()
    return before - after
  }

  close(): void {
    this.database.close()
    this.secureFiles()
    this.key.fill(0)
  }

  private validateIdentity(input: DshRemoteLedgerIdentity): void {
    for (const [name, value] of Object.entries({
      accountId: input.accountId, runtimeRef: input.runtimeRef, requestRef: input.requestRef,
    })) {
      if (value.trim() === '' || value.length > 256) throw new DshRemoteError('REMOTE_REQUEST_INVALID', `${name} 无效`)
    }
    if (!Number.isSafeInteger(input.executeBeforeMillis) || input.executeBeforeMillis <= 0) {
      throw new DshRemoteError('REMOTE_REQUEST_INVALID', '命令 deadline 无效')
    }
  }

  private identity(input: Pick<DshRemoteLedgerIdentity, 'accountId' | 'runtimeRef' | 'requestRef'>): IdentityRow | undefined {
    return this.database.prepare(`
      SELECT identity_id, account_id, runtime_ref, request_ref, operation,
             arguments_hash, dsh_rpc_id, execute_before_millis, created_at_millis
      FROM remote_command_identity_v2
      WHERE account_id = ? AND runtime_ref = ? AND request_ref = ?
    `).get(input.accountId, input.runtimeRef, input.requestRef) as unknown as IdentityRow | undefined
  }

  private requireIdentity(input: Pick<DshRemoteLedgerIdentity, 'accountId' | 'runtimeRef' | 'requestRef'>): IdentityRow {
    const row = this.identity(input)
    if (row === undefined || row.account_id !== input.accountId) throw new DshRemoteError('SESSION_STATE_CHANGED', '命令账本记录不存在')
    return row
  }

  private entry(row: IdentityRow): DshRemoteLedgerEntry {
    const event = this.database.prepare(`
      SELECT state, nonce, ciphertext, created_at_millis
      FROM remote_command_event_v2 WHERE identity_id = ? ORDER BY event_id DESC LIMIT 1
    `).get(row.identity_id) as unknown as EventRow | undefined
    if (event === undefined) throw new DshRemoteError('REMOTE_STORAGE_FAILED', '命令账本状态缺失')
    const aad = this.eventAad(row, event.state, event.created_at_millis)
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(decryptLedgerPayload(this.key, event, aad).toString('utf8')) as Record<string, unknown>
    } catch (error) {
      if (error instanceof DshRemoteError) throw new DshRemoteError('REMOTE_STORAGE_FAILED', '命令账本认证失败', false, {}, { cause: error })
      throw error
    }
    return {
      accountId: row.account_id,
      runtimeRef: row.runtime_ref,
      requestRef: row.request_ref,
      operation: row.operation,
      executeBeforeMillis: row.execute_before_millis,
      argumentsHash: row.arguments_hash,
      state: event.state,
      dshRpcId: row.dsh_rpc_id,
      payload,
      createdAtMillis: row.created_at_millis,
      updatedAtMillis: event.created_at_millis,
    }
  }

  private appendEvent(identityId: number, state: DshRemoteLedgerState, payload: Record<string, unknown>, now: number): void {
    const row = this.database.prepare(`
      SELECT identity_id, account_id, runtime_ref, request_ref, operation,
             arguments_hash, dsh_rpc_id, execute_before_millis, created_at_millis
      FROM remote_command_identity_v2 WHERE identity_id = ?
    `).get(identityId) as unknown as IdentityRow | undefined
    if (row === undefined) throw new DshRemoteError('REMOTE_STORAGE_FAILED', '命令账本 identity 缺失')
    const encrypted = encryptLedgerPayload(this.key, canonicalJson(payload), this.eventAad(row, state, now), randomBytes(24))
    this.database.prepare(`
      INSERT INTO remote_command_event_v2 (identity_id, state, nonce, ciphertext, created_at_millis)
      VALUES (?, ?, ?, ?, ?)
    `).run(identityId, state, encrypted.nonce, encrypted.ciphertext, now)
  }

  private eventAad(row: IdentityRow, state: DshRemoteLedgerState, now: number): string {
    return canonicalJson({
      schemaVersion: 2, identityId: row.identity_id, accountId: row.account_id,
      runtimeRef: row.runtime_ref, requestRef: row.request_ref,
      operation: row.operation, argumentsHash: row.arguments_hash, state, createdAtMillis: now,
    })
  }

  private transaction(work: () => void): void {
    this.database.exec('BEGIN IMMEDIATE')
    try { work(); this.database.exec('COMMIT') }
    catch (error) { this.database.exec('ROLLBACK'); throw error }
  }

  private secureFiles(): void {
    for (const suffix of ['', '-wal', '-shm']) {
      try { securePrivateFileSync(`${this.path}${suffix}`) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
}
