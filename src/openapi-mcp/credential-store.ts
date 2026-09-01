import type { ArkmeSecureValueStore } from '../keychain-store.js'
import type { ManagedOpenApiCredential, ManagedOpenApiCredentialStore } from './types.js'

const ACCOUNT = 'managed-api-key'
const KEY_ID = /^[0-9a-f]{24}$/
const API_KEY = /^arkme_([0-9a-f]{24})_[A-Za-z0-9_-]{43}$/
const MCP_REVISION = /^sha256:[0-9a-f]{64}$/
const CREDENTIAL_FIELDS = new Set([
  'schemaVersion', 'userId', 'loginDeviceId', 'keyId', 'generation', 'apiKey', 'expiresAtMillis', 'mcpRevision',
])

export class InvalidManagedOpenApiCredentialError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'InvalidManagedOpenApiCredentialError'
  }
}

export function parseManagedOpenApiCredential(value: unknown): ManagedOpenApiCredential | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !CREDENTIAL_FIELDS.has(key))
    || record.schemaVersion !== 1
    || !Number.isSafeInteger(record.userId) || (record.userId as number) <= 0
    || !Number.isSafeInteger(record.loginDeviceId) || (record.loginDeviceId as number) <= 0
    || typeof record.keyId !== 'string' || !KEY_ID.test(record.keyId)
    || !Number.isSafeInteger(record.generation) || (record.generation as number) <= 0
    || typeof record.apiKey !== 'string' || !API_KEY.test(record.apiKey)
    || API_KEY.exec(record.apiKey)?.[1] !== record.keyId
    || !Number.isSafeInteger(record.expiresAtMillis) || (record.expiresAtMillis as number) <= 0
    || typeof record.mcpRevision !== 'string' || !MCP_REVISION.test(record.mcpRevision)) return undefined
  return {
    schemaVersion: 1,
    userId: record.userId as number,
    loginDeviceId: record.loginDeviceId as number,
    keyId: record.keyId,
    generation: record.generation as number,
    apiKey: record.apiKey,
    expiresAtMillis: record.expiresAtMillis as number,
    mcpRevision: record.mcpRevision,
  }
}

export class SecureManagedOpenApiCredentialStore implements ManagedOpenApiCredentialStore {
  constructor(private readonly secureStore: ArkmeSecureValueStore) {}

  async read(): Promise<ManagedOpenApiCredential | undefined> {
    const raw = await this.secureStore.read(ACCOUNT)
    if (raw === undefined) return undefined
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch (error) {
      throw new InvalidManagedOpenApiCredentialError('OpenAPI MCP 安全凭据格式无效', { cause: error })
    }
    const credential = parseManagedOpenApiCredential(parsed)
    if (credential === undefined) throw new InvalidManagedOpenApiCredentialError('OpenAPI MCP 安全凭据合同无效')
    return credential
  }

  async write(credential: ManagedOpenApiCredential): Promise<void> {
    const validated = parseManagedOpenApiCredential(credential)
    if (validated === undefined) throw new Error('OpenAPI MCP 安全凭据合同无效')
    await this.secureStore.write(ACCOUNT, JSON.stringify(validated))
  }

  async delete(): Promise<void> {
    await this.secureStore.delete(ACCOUNT)
  }
}
