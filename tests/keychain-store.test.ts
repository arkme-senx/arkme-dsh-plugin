import { describe, expect, it } from 'vitest'
import {
  ArkmeKeychainStore,
  type ArkmeSessionCredentials,
  ArkmeWindowsCredentialStore,
  type ArkmeWindowsCredentialBackend,
  createArkmeSessionStore,
} from '../src/keychain-store.js'

class MemoryWindowsCredentialBackend implements ArkmeWindowsCredentialBackend {
  payload: string | undefined
  deleteFails = false
  readonly operations: string[] = []

  async read(service: string, account: string): Promise<string | undefined> {
    this.operations.push(`read:${service}:${account}`)
    return this.payload
  }

  async write(service: string, account: string, payload: string): Promise<void> {
    this.operations.push(`write:${service}:${account}:${payload}`)
    this.payload = payload
  }

  async delete(service: string, account: string): Promise<void> {
    this.operations.push(`delete:${service}:${account}`)
    if (this.deleteFails) throw new Error('delete failed')
    this.payload = undefined
  }
}

const session: ArkmeSessionCredentials = {
  userId: 10001,
  accessToken: 'access-secret',
  refreshToken: 'refresh-secret',
}

describe('Arkme session credential stores', () => {
  it('selects the native store for each supported desktop platform', () => {
    const backend = new MemoryWindowsCredentialBackend()
    expect(createArkmeSessionStore('test', { platform: 'darwin' })).toBeInstanceOf(ArkmeKeychainStore)
    expect(createArkmeSessionStore('test', {
      platform: 'win32',
      windowsBackend: backend,
    })).toBeInstanceOf(ArkmeWindowsCredentialStore)
    expect(() => createArkmeSessionStore('test', { platform: 'linux' })).toThrow(/只支持在 macOS 或 Windows/)
  })

  it('treats a missing Windows credential as logged out', async () => {
    const backend = new MemoryWindowsCredentialBackend()
    const store = new ArkmeWindowsCredentialStore('test', backend)

    await expect(store.read()).resolves.toBeUndefined()
    expect(backend.operations).toEqual(['read:test:session'])
  })

  it('reads and validates a persisted Windows session', async () => {
    const backend = new MemoryWindowsCredentialBackend()
    backend.payload = JSON.stringify(session)
    const store = new ArkmeWindowsCredentialStore('test', backend)

    await expect(store.read()).resolves.toEqual(session)
    backend.payload = undefined
    await expect(store.read()).resolves.toEqual(session)
    expect(backend.operations).toEqual(['read:test:session'])
  })

  it('rejects malformed Windows credential JSON without exposing it', async () => {
    const backend = new MemoryWindowsCredentialBackend()
    backend.payload = '{not-json'
    const store = new ArkmeWindowsCredentialStore('test', backend)

    await expect(store.read()).rejects.toThrow(/无法读取 Windows Credential Locker/)
  })

  it('rejects sessions that exceed the native Windows credential blob limit', async () => {
    const backend = new MemoryWindowsCredentialBackend()
    const store = new ArkmeWindowsCredentialStore('test', backend)

    await expect(store.write({ ...session, accessToken: 'a'.repeat(2000) }))
      .rejects.toThrow(/超出 Windows Credential Locker 容量限制/)
    expect(backend.operations).toEqual([])
    await expect(store.read()).resolves.toBeUndefined()
  })

  it('serializes Windows writes before deleting the credential', async () => {
    const backend = new MemoryWindowsCredentialBackend()
    const store = new ArkmeWindowsCredentialStore('test', backend)
    const refreshed = { ...session, accessToken: 'new-access-secret' }

    await store.write(session)
    await store.write(refreshed)
    await expect(store.read()).resolves.toEqual(refreshed)
    await store.delete()

    expect(backend.operations).toEqual([
      `write:test:session:${JSON.stringify(session)}`,
      `write:test:session:${JSON.stringify(refreshed)}`,
      'delete:test:session',
    ])
    expect(backend.payload).toBeUndefined()
    await expect(store.read()).resolves.toBeUndefined()
  })

  it('fails logout when Windows leaves the persisted credential behind', async () => {
    const backend = new MemoryWindowsCredentialBackend()
    backend.payload = JSON.stringify(session)
    backend.deleteFails = true
    const store = new ArkmeWindowsCredentialStore('test', backend)

    await expect(store.delete()).rejects.toThrow(/无法删除 Windows Credential Locker/)
    await expect(store.read()).resolves.toEqual(session)
    expect(backend.operations).toEqual(['delete:test:session', 'read:test:session'])
    expect(backend.payload).toBe(JSON.stringify(session))
  })
})
