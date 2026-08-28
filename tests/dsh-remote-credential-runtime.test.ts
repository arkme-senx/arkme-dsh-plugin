import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ArkmeSecureValueStore } from '../src/keychain-store.js'
import { DshRemoteRuntimeSecretBroker } from '../src/dsh-remote/runtime-secret-broker.js'
import { DshRemoteRuntimeStore } from '../src/dsh-remote/runtime-store.js'

class MemorySecrets implements ArkmeSecureValueStore {
  readonly values = new Map<string, string>()
  async read(account: string): Promise<string | undefined> { return this.values.get(account) }
  async write(account: string, value: string): Promise<void> { this.values.set(account, value) }
  async delete(account: string): Promise<void> { this.values.delete(account) }
}

describe('Runtime local persistence without device authorization', () => {
  it('shares only the local ledger key across Profiles', async () => {
    const secrets = new MemorySecrets()
    const first = new DshRemoteRuntimeSecretBroker(secrets)
    const second = new DshRemoteRuntimeSecretBroker(secrets)
    expect(await first.ledgerKey('42')).toEqual(await second.ledgerKey('42'))
    const stored = [...secrets.values.values()].join('\n')
    expect(stored).toContain('"schemaVersion":2')
    expect(stored).not.toMatch(/identity|privateJwk|publicKey|fingerprint/)
  })

  it('migrates the old keychain payload by retaining only its ledger key', async () => {
    const secrets = new MemorySecrets()
    secrets.values.set('dsh-remote-desktop:42', JSON.stringify({
      schemaVersion: 1, accountId: '42', ledgerKey: Buffer.alloc(32, 7).toString('base64url'),
      identity: { algorithm: 'Ed25519', privateJwk: { d: 'secret' }, publicKey: 'obsolete' },
    }))
    const broker = new DshRemoteRuntimeSecretBroker(secrets)
    expect(await broker.ledgerKey('42')).toEqual(Buffer.alloc(32, 7))
    expect(JSON.parse(secrets.values.get('dsh-remote-desktop:42')!)).toEqual({
      schemaVersion: 2, accountId: '42', ledgerKey: Buffer.alloc(32, 7).toString('base64url'),
    })
  })

  it('keeps the replay cursor monotonic per account and Runtime', async () => {
    const broker = new DshRemoteRuntimeSecretBroker(new MemorySecrets())
    const route = { accountId: '42', runtimeRef: 'runtime-01', channelRef: 'runtime-01' }
    await Promise.all([
      broker.putRuntimeCursor({ ...route, lastTransportSequence: 20 }),
      broker.putRuntimeCursor({ ...route, lastTransportSequence: 10 }),
    ])
    await expect(broker.runtimeCursor(route)).resolves.toBe(20)
    await expect(broker.runtimeCursor({ ...route, runtimeRef: 'runtime-02', channelRef: 'runtime-02' })).resolves.toBe(0)
  })

  it('migrates runtime-state v1 without credential, Binding, or remote toggle state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-runtime-state-'))
    const remoteDirectory = join(directory, 'dsh-remote')
    await mkdir(remoteDirectory)
    await writeFile(join(remoteDirectory, 'runtime-state.json'), JSON.stringify({
      schemaVersion: 1,
      accounts: {
        '42': {
          desktopRef: 'desktop-01', credentialRef: 'obsolete', bindings: { old: { bindingRef: 'old' } },
          runtimes: {
            web: {
              runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '42',
              remoteEnabled: false, hostGeneration: 3, capabilities: ['session.list'], updatedAtMillis: 1,
            },
          },
        },
      },
    }))
    const store = new DshRemoteRuntimeStore(directory)
    await expect(store.account('42')).resolves.toEqual({
      desktopRef: 'desktop-01',
      runtimes: [{
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '42',
        hostGeneration: 3, capabilities: ['session.list'], updatedAtMillis: 1,
      }],
    })
    const persisted = await readFile(join(remoteDirectory, 'runtime-state.json'), 'utf8')
    expect(persisted).toContain('"schemaVersion": 2')
    expect(persisted).not.toMatch(/credentialRef|bindings|remoteEnabled/)
  })

  it('persists only opaque projection inventory needed for explicit tombstones', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-runtime-projection-'))
    const first = new DshRemoteRuntimeStore(directory)
    await first.saveProjectionInventory('42', 'web', {
      workspaceRefs: ['workspace-2', 'workspace-1', 'workspace-1'],
      sessions: [{
        sessionRef: 'session-1',
        workspaceRef: 'workspace-1',
        sourceUpdatedAt: 10,
      }],
    })

    const second = new DshRemoteRuntimeStore(directory)
    await expect(second.projectionInventory('42', 'web')).resolves.toEqual({
      workspaceRefs: ['workspace-1', 'workspace-2'],
      sessions: [{
        sessionRef: 'session-1',
        workspaceRef: 'workspace-1',
        sourceUpdatedAt: 10,
      }],
    })
    const persisted = await readFile(join(directory, 'dsh-remote', 'runtime-state.json'), 'utf8')
    expect(persisted).not.toContain('/repo')
  })
})
