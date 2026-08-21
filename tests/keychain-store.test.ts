import { access, chmod, type FileHandle, mkdtemp, mkdir, open, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ArkmeKeychainStore,
  ArkmeLinuxFileCredentialStore,
  type ArkmeSessionCredentials,
  ArkmeWindowsCredentialStore,
  type ArkmeWindowsCredentialBackend,
  createArkmeSessionStore,
  createArkmeSessionStores,
} from '../src/keychain-store.js'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arkme-linux-credentials-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    recursive: true,
    force: true,
  })))
})

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
    expect(() => createArkmeSessionStore('test', {
      platform: 'linux',
      linuxCredentialPath: join(tmpdir(), 'arkme-test-session.json'),
    })).not.toThrow()
    expect(() => createArkmeSessionStore('test', { platform: 'freebsd' })).toThrow(/不支持保存 Arkme 登录凭据/)
  })

  it('treats a missing Windows credential as logged out', async () => {
    const backend = new MemoryWindowsCredentialBackend()
    const store = new ArkmeWindowsCredentialStore('test', backend)

    await expect(store.read()).resolves.toBeUndefined()
    expect(backend.operations).toEqual(['read:test:session'])
  })

  it.skipIf(process.platform === 'win32')('persists a Linux session in an owner-only file', async () => {
    const directory = await temporaryDirectory()
    const credentialPath = join(directory, 'credentials', 'session.json')
    const store = new ArkmeLinuxFileCredentialStore(credentialPath)

    await store.write(session)

    await expect(new ArkmeLinuxFileCredentialStore(credentialPath).read()).resolves.toEqual(session)
    expect(JSON.parse(await readFile(credentialPath, 'utf8'))).toEqual(session)
    expect((await stat(join(directory, 'credentials'))).mode & 0o777).toBe(0o700)
    expect((await stat(credentialPath)).mode & 0o777).toBe(0o600)
  })

  it.skipIf(process.platform === 'win32')('rejects an invalid Linux session document instead of treating it as logged out', async () => {
    const directory = await temporaryDirectory()
    const credentialPath = join(directory, 'credentials', 'session.json')
    await mkdir(join(directory, 'credentials'), { mode: 0o700 })
    await writeFile(credentialPath, JSON.stringify({
      userId: 10001,
      accessToken: '',
      refreshToken: 'refresh-secret',
    }), { mode: 0o600 })

    await expect(new ArkmeLinuxFileCredentialStore(credentialPath).read())
      .rejects.toThrow(/Linux.*Arkme 登录凭据/)
  })

  it.skipIf(process.platform === 'win32')('rejects malformed Linux credential JSON', async () => {
    const directory = await temporaryDirectory()
    const credentialPath = join(directory, 'credentials', 'session.json')
    await mkdir(join(directory, 'credentials'), { mode: 0o700 })
    await writeFile(credentialPath, '{not-json', { mode: 0o600 })

    await expect(new ArkmeLinuxFileCredentialStore(credentialPath).read())
      .rejects.toThrow(/无法读取 Linux 中的 Arkme 登录凭据/)
  })

  it.skipIf(process.platform === 'win32')('rejects a Linux credential file readable by group or other users', async () => {
    const directory = await temporaryDirectory()
    const credentialPath = join(directory, 'session.json')
    await writeFile(credentialPath, JSON.stringify(session), { mode: 0o644 })
    await chmod(credentialPath, 0o644)

    await expect(new ArkmeLinuxFileCredentialStore(credentialPath).read())
      .rejects.toThrow(/权限.*600/)
  })

  it.skipIf(process.platform === 'win32')('rejects a Linux credential directory accessible to other users', async () => {
    const directory = await temporaryDirectory()
    const credentialDirectory = join(directory, 'credentials')
    const credentialPath = join(credentialDirectory, 'session.json')
    await mkdir(credentialDirectory, { mode: 0o755 })
    await chmod(credentialDirectory, 0o755)
    await writeFile(credentialPath, JSON.stringify(session), { mode: 0o600 })

    await expect(new ArkmeLinuxFileCredentialStore(credentialPath).read())
      .rejects.toThrow(/凭据目录权限.*700/)
  })

  it.skipIf(process.platform === 'win32')('removes a persisted Linux session on logout', async () => {
    const directory = await temporaryDirectory()
    const credentialPath = join(directory, 'credentials', 'session.json')
    const store = new ArkmeLinuxFileCredentialStore(credentialPath)
    await store.write(session)

    await store.delete()

    await expect(access(credentialPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(new ArkmeLinuxFileCredentialStore(credentialPath).read()).resolves.toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('does not let an in-flight Linux read restore a session after logout', async () => {
    const directory = await temporaryDirectory()
    const credentialPath = join(directory, 'credentials', 'session.json')
    await new ArkmeLinuxFileCredentialStore(credentialPath).write(session)
    const store = new ArkmeLinuxFileCredentialStore(credentialPath)
    const probe = await open(credentialPath, 'r')
    const fileHandlePrototype = Object.getPrototypeOf(probe) as { readFile: FileHandle['readFile'] }
    await probe.close()
    const readStarted = Promise.withResolvers<void>()
    const releaseRead = Promise.withResolvers<void>()
    const readFileSpy = vi.spyOn(fileHandlePrototype, 'readFile').mockImplementation(async () => {
      readStarted.resolve()
      await releaseRead.promise
      return JSON.stringify(session)
    })
    const reading = store.read()
    await readStarted.promise
    const deleting = store.delete()

    try {
      const outcome = await Promise.race([
        deleting.then(() => 'deleted' as const),
        new Promise<'blocked'>(resolve => setTimeout(() => { resolve('blocked') }, 100)),
      ])
      expect(outcome).toBe('blocked')
    } finally {
      releaseRead.resolve()
      await Promise.allSettled([reading, deleting])
      readFileSpy.mockRestore()
    }

    await expect(new ArkmeLinuxFileCredentialStore(credentialPath).read()).resolves.toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('refuses to write Linux credentials through a symlinked credential directory', async () => {
    const directory = await temporaryDirectory()
    const stateDirectory = join(directory, 'state')
    const credentialDirectory = join(stateDirectory, 'credentials')
    const outsideDirectory = join(directory, 'outside')
    await mkdir(stateDirectory, { mode: 0o700 })
    await mkdir(outsideDirectory, { mode: 0o700 })
    await symlink(outsideDirectory, credentialDirectory, 'dir')

    await expect(new ArkmeLinuxFileCredentialStore(join(credentialDirectory, 'session.json')).write(session))
      .rejects.toThrow(/Linux.*凭据目录.*符号链接/)
    await expect(access(join(outsideDirectory, 'session.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform === 'win32')('preserves the previous Linux session when an atomic write fails', async () => {
    const directory = await temporaryDirectory()
    const credentialDirectory = join(directory, 'credentials')
    const credentialPath = join(credentialDirectory, 'session.json')
    await new ArkmeLinuxFileCredentialStore(credentialPath).write(session)
    const probe = await open(credentialPath, 'r')
    const fileHandlePrototype = Object.getPrototypeOf(probe) as { sync: FileHandle['sync'] }
    await probe.close()
    const syncSpy = vi.spyOn(fileHandlePrototype, 'sync').mockRejectedValue(new Error('simulated sync failure'))

    try {
      await expect(new ArkmeLinuxFileCredentialStore(credentialPath).write({
        ...session,
        accessToken: 'replacement-access-secret',
      })).rejects.toThrow(/无法写入 Linux 中的 Arkme 登录凭据/)
    } finally {
      syncSpy.mockRestore()
    }

    await chmod(credentialDirectory, 0o700)
    await expect(new ArkmeLinuxFileCredentialStore(credentialPath).read()).resolves.toEqual(session)
    expect(await readdir(credentialDirectory)).toEqual(['session.json'])
  })

  it.skipIf(process.platform === 'win32')('places current and pending Linux sessions under the configured state directory', async () => {
    const stateDirectory = await temporaryDirectory()
    const stores = createArkmeSessionStores('com.senqisi.dsh-arkme', 'prod', stateDirectory, {
      platform: 'linux',
    })
    const pendingSession = { ...session, accessToken: 'pending-access-secret' }

    await stores.sessionStore.write(session)
    await stores.pendingSessionStore.write(pendingSession)

    await expect(readFile(join(stateDirectory, 'credentials', 'session.json'), 'utf8'))
      .resolves.toBe(JSON.stringify(session))
    await expect(readFile(join(stateDirectory, 'credentials', 'pending-binding-session.json'), 'utf8'))
      .resolves.toBe(JSON.stringify(pendingSession))
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
