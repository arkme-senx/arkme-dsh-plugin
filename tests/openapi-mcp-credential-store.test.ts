import { describe, expect, it } from 'vitest'
import type { ArkmeSecureValueStore } from '../src/keychain-store.js'
import { SecureManagedOpenApiCredentialStore, parseManagedOpenApiCredential } from '../src/openapi-mcp/credential-store.js'

const keyId = '0123456789abcdef01234567'
const credential = {
  schemaVersion: 1 as const,
  userId: 42,
  loginDeviceId: 7,
  keyId,
  generation: 1,
  apiKey: `arkme_${keyId}_${'A'.repeat(43)}`,
  expiresAtMillis: 1_800_000_000_000,
  mcpRevision: `sha256:${'a'.repeat(64)}`,
}

class MemorySecureStore implements ArkmeSecureValueStore {
  value: string | undefined
  operations: string[] = []
  async read(account: string): Promise<string | undefined> { this.operations.push(`read:${account}`); return this.value }
  async write(account: string, payload: string): Promise<void> { this.operations.push(`write:${account}`); this.value = payload }
  async delete(account: string): Promise<void> { this.operations.push(`delete:${account}`); this.value = undefined }
}

describe('managed OpenAPI credential store', () => {
  it('round-trips only through the generic OS secure-value boundary', async () => {
    const secure = new MemorySecureStore()
    const store = new SecureManagedOpenApiCredentialStore(secure)
    await store.write(credential)
    await expect(store.read()).resolves.toEqual(credential)
    await store.delete()
    await expect(store.read()).resolves.toBeUndefined()
    expect(secure.operations.map(value => value.split(':')[0])).toEqual(['write', 'read', 'delete', 'read'])
  })

  it('fails closed when identifiers, revision or plaintext do not agree', () => {
    expect(parseManagedOpenApiCredential(credential)).toEqual(credential)
    expect(parseManagedOpenApiCredential({ ...credential, keyId: 'fedcba987654321001234567' })).toBeUndefined()
    expect(parseManagedOpenApiCredential({ ...credential, generation: 0 })).toBeUndefined()
    expect(parseManagedOpenApiCredential({ ...credential, mcpRevision: 'latest' })).toBeUndefined()
    expect(parseManagedOpenApiCredential({ ...credential, apiKey: 'arkme-secret' })).toBeUndefined()
    expect(parseManagedOpenApiCredential({ ...credential, refreshToken: 'must-not-exist' })).toBeUndefined()
  })

  it('never places plaintext in thrown validation messages', async () => {
    const secure = new MemorySecureStore()
    secure.value = JSON.stringify({ ...credential, apiKey: 'private-plaintext' })
    const store = new SecureManagedOpenApiCredentialStore(secure)
    let message = ''
    try { await store.read() } catch (error) { message = String(error) }
    expect(message).not.toContain('private-plaintext')
    expect(message).toContain('安全凭据合同无效')
  })
})
