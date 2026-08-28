import { createHash, randomBytes } from 'node:crypto'
import type { ArkmeSecureValueStore } from '../keychain-store.js'
import { decodeBase64Url, encodeBase64Url } from './crypto.js'
import { DshRemoteError } from './errors.js'

interface PersistedRuntimeSecrets {
  schemaVersion: 2
  accountId: string
  ledgerKey: string
}

interface PersistedRuntimeCursor {
  schemaVersion: 2
  accountId: string
  runtimeRef: string
  channelRef: string
  lastTransportSequence: number
}

function normalizedAccountId(accountId: string): string {
  const normalized = accountId.trim()
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(normalized)) {
    throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控账号标识无效')
  }
  return normalized
}

function accountKey(accountId: string): string {
  return `dsh-remote-desktop:${normalizedAccountId(accountId)}`
}

function decodeSecrets(raw: string, accountId: string): { secrets: PersistedRuntimeSecrets; migrated: boolean } {
  let value: unknown
  try { value = JSON.parse(raw) }
  catch (error) { throw new DshRemoteError('REMOTE_STORAGE_FAILED', '远控本地密钥已损坏', false, {}, { cause: error }) }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DshRemoteError('REMOTE_STORAGE_FAILED', '远控本地密钥已损坏')
  }
  const source = value as Record<string, unknown>
  if ((source.schemaVersion !== 1 && source.schemaVersion !== 2) || source.accountId !== accountId
    || typeof source.ledgerKey !== 'string' || decodeBase64Url(source.ledgerKey).length !== 32) {
    throw new DshRemoteError('REMOTE_STORAGE_FAILED', '远控本地密钥合同不兼容')
  }
  return {
    secrets: { schemaVersion: 2, accountId, ledgerKey: source.ledgerKey },
    migrated: source.schemaVersion !== 2 || 'identity' in source,
  }
}

/**
 * Stores only the local command-ledger encryption key and replay cursor.
 * These values protect local recovery data; they are not remote authority.
 */
export class DshRemoteRuntimeSecretBroker {
  private readonly inFlight = new Map<string, Promise<PersistedRuntimeSecrets>>()
  private readonly cursorWrites = new Map<string, Promise<void>>()

  constructor(private readonly store: ArkmeSecureValueStore) {}

  async ledgerKey(accountId: string): Promise<Buffer> {
    return decodeBase64Url((await this.secrets(accountId)).ledgerKey)
  }

  async runtimeCursor(input: { accountId: string; runtimeRef: string; channelRef: string }): Promise<number> {
    const key = this.cursorKey(input)
    await this.cursorWrites.get(key)?.catch(() => undefined)
    const raw = await this.store.read(key)
    if (raw === undefined) return 0
    const source = this.parseCursor(raw, input)
    return source.lastTransportSequence
  }

  async putRuntimeCursor(input: {
    accountId: string
    runtimeRef: string
    channelRef: string
    lastTransportSequence: number
  }): Promise<void> {
    if (!Number.isSafeInteger(input.lastTransportSequence) || input.lastTransportSequence < 0) {
      throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控 transport sequence 无效')
    }
    const key = this.cursorKey(input)
    const previous = this.cursorWrites.get(key) ?? Promise.resolve()
    const writing = previous.catch(() => undefined).then(async () => {
      const raw = await this.store.read(key)
      if (raw !== undefined && this.parseCursor(raw, input).lastTransportSequence >= input.lastTransportSequence) return
      const value: PersistedRuntimeCursor = {
        schemaVersion: 2,
        accountId: input.accountId,
        runtimeRef: input.runtimeRef,
        channelRef: input.channelRef,
        lastTransportSequence: input.lastTransportSequence,
      }
      await this.store.write(key, JSON.stringify(value))
    })
    this.cursorWrites.set(key, writing)
    try { await writing }
    finally { if (this.cursorWrites.get(key) === writing) this.cursorWrites.delete(key) }
  }

  private async secrets(accountIdValue: string): Promise<PersistedRuntimeSecrets> {
    const accountId = normalizedAccountId(accountIdValue)
    const existing = this.inFlight.get(accountId)
    if (existing !== undefined) return await existing
    const loading = this.loadOrCreate(accountId)
    this.inFlight.set(accountId, loading)
    try { return await loading }
    catch (error) {
      if (this.inFlight.get(accountId) === loading) this.inFlight.delete(accountId)
      throw error
    }
  }

  private async loadOrCreate(accountId: string): Promise<PersistedRuntimeSecrets> {
    const key = accountKey(accountId)
    const raw = await this.store.read(key)
    if (raw !== undefined) {
      const decoded = decodeSecrets(raw, accountId)
      if (decoded.migrated) await this.store.write(key, JSON.stringify(decoded.secrets))
      return decoded.secrets
    }
    const created: PersistedRuntimeSecrets = {
      schemaVersion: 2,
      accountId,
      ledgerKey: encodeBase64Url(randomBytes(32)),
    }
    await this.store.write(key, JSON.stringify(created))
    return created
  }

  private parseCursor(raw: string, input: { accountId: string; runtimeRef: string; channelRef: string }): PersistedRuntimeCursor {
    let source: Partial<PersistedRuntimeCursor>
    try { source = JSON.parse(raw) as Partial<PersistedRuntimeCursor> }
    catch (error) { throw new DshRemoteError('REMOTE_STORAGE_FAILED', '远控 transport cursor 已损坏', false, {}, { cause: error }) }
    if (source.schemaVersion !== 2 || source.accountId !== input.accountId
      || source.runtimeRef !== input.runtimeRef || source.channelRef !== input.channelRef
      || typeof source.lastTransportSequence !== 'number' || !Number.isSafeInteger(source.lastTransportSequence)
      || source.lastTransportSequence < 0) {
      throw new DshRemoteError('REMOTE_STORAGE_FAILED', '远控 transport cursor 路由不匹配')
    }
    return source as PersistedRuntimeCursor
  }

  private cursorKey(input: { accountId: string; runtimeRef: string; channelRef: string }): string {
    normalizedAccountId(input.accountId)
    if ([input.runtimeRef, input.channelRef].some(value => value.trim() === '' || value.length > 256)) {
      throw new DshRemoteError('REMOTE_REQUEST_INVALID', '远控 transport cursor 路由无效')
    }
    const digest = createHash('sha256')
      .update(['dsh-remote-runtime-cursor-v2', input.accountId, input.runtimeRef, input.channelRef].join('\n'))
      .digest('base64url')
    return `dsh-remote-runtime-cursor:${digest}`
  }
}
