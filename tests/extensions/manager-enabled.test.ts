import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeExtensionInstallStore } from '../../src/extensions/install-store.js'
import { ArkmeExtensionManager } from '../../src/extensions/manager.js'
import type { ArkmeInstalledExtension } from '../../src/extensions/types.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function installed(root: string, client: boolean): ArkmeInstalledExtension {
  return {
    extensionId: client ? 'ext-client' : 'ext-host',
    installedVersion: '1.0.0', artifactSha256: 'sha', artifactPath: join(root, 'artifact.arkext'),
    manifest: {
      format: 'arkme-cordis-extension', format_version: 1, name: '扩展', description: '',
      version: '1.0.0', runtime: { dsh: '*', arkme_provider_contract: 1 },
      halves: { host: true, client }, permissions: [], entrypoints: { host: 'host.js', ...(client ? { client: 'client.js' as const } : {}) },
    },
    enabled: true, active: true,
    profilePackageName: '@arkme-local/ext-0123456789abcdef',
    profileBundlePath: join(root, 'profile', 'arkme-extensions', 'bundle'),
    permissionSnapshot: [], updateChannel: 'stable', installedAtMillis: 1, lastCheckedAtMillis: 1,
  }
}

describe('extension desired enable state owner', () => {
  it('keeps the artifact installed, removes only the Profile layer, and exposes no Host paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-enabled-'))
    directories.push(root)
    mkdirSync(join(root, 'profile', 'arkme-extensions', 'bundle'), { recursive: true })
    writeFileSync(join(root, 'profile', 'arkme-extensions', 'bundle', 'activation.json'), JSON.stringify({ schema_version: 1, extension_id: 'ext-host', enabled: true }))
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put(installed(root, false))
    const setEnabled = vi.fn(async () => undefined)
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: join(root, 'profile'),
      profileInstaller: { install: vi.fn(), remove: vi.fn(), restart: vi.fn(), setEnabled },
    })

    await expect(manager.setEnabled({ agent: undefined, extensionId: 'ext-host', enabled: false }))
      .resolves.toMatchObject({ installed: true, enabled: false, active: false, restart_required: false })
    expect(setEnabled).toHaveBeenCalledWith('@arkme-local/ext-0123456789abcdef', false)
    expect(store.get('ext-host')).toMatchObject({ installedVersion: '1.0.0', enabled: false })
    expect(JSON.parse(readFileSync(join(root, 'profile', 'arkme-extensions', 'bundle', 'activation.json'), 'utf8'))).toMatchObject({ enabled: false })
    expect(manager.listInstalled()[0]).not.toHaveProperty('artifactPath')
    expect(manager.listInstalled()[0]).not.toHaveProperty('profileBundlePath')

    await expect(manager.setEnabled({ agent: undefined, extensionId: 'ext-host', enabled: true }))
      .resolves.toMatchObject({ enabled: true, active: false, restart_required: true })
    expect(setEnabled).toHaveBeenLastCalledWith('@arkme-local/ext-0123456789abcdef', true)
    store.close()
  })

  it('reports a restart when a currently mounted Client half must disappear', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-client-enabled-'))
    directories.push(root)
    mkdirSync(join(root, 'profile', 'arkme-extensions', 'bundle'), { recursive: true })
    writeFileSync(join(root, 'profile', 'arkme-extensions', 'bundle', 'activation.json'), JSON.stringify({ schema_version: 1, extension_id: 'ext-client', enabled: true }))
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put(installed(root, true))
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: join(root, 'profile'),
      profileInstaller: { install: vi.fn(), remove: vi.fn(), restart: vi.fn(), setEnabled: vi.fn() },
    })
    await expect(manager.setEnabled({ agent: undefined, extensionId: 'ext-client', enabled: false }))
      .resolves.toMatchObject({ enabled: false, restart_required: true })
    await expect(manager.setEnabled({ agent: undefined, extensionId: 'ext-client', enabled: false }))
      .resolves.toMatchObject({ enabled: false, restart_required: true })
    store.close()
  })

  it('keeps a native Bundle active until restart while persisting the disabled Profile layer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-native-enabled-'))
    directories.push(root)
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put({
      ...installed(root, false),
      extensionId: 'ext-native',
      artifactPath: join(root, 'bundle.tgz'),
      profilePackageName: '@example/native-bundle',
      profileBundlePath: join(root, 'bundle.tgz'),
      executionModel: 'dsh-native',
    })
    const setEnabled = vi.fn(async () => undefined)
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: join(root, 'profile'),
      profileInstaller: {
        install: vi.fn(), installTarball: vi.fn(), remove: vi.fn(), restart: vi.fn(), setEnabled,
      } as never,
      pluginInventory: {
        list: () => ({ entries: [{
          entryId: 'native', moduleName: '@example/native-bundle', enabled: true, fiberPhase: 'active',
        }] }),
      },
    })

    await expect(manager.setEnabled({ agent: undefined, extensionId: 'ext-native', enabled: false }))
      .resolves.toMatchObject({ enabled: false, active: true, restart_required: true })
    expect(setEnabled).toHaveBeenCalledWith('@example/native-bundle', false)
    expect(manager.listInstalled()).toEqual([
      expect.objectContaining({ extensionId: 'ext-native', enabled: false, active: true }),
    ])
    expect(manager.listInstalled()[0]).not.toHaveProperty('profileBundlePath')
    store.close()
  })

  it('re-applies other disabled Profile layers after DSH package reconciliation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-reconcile-'))
    directories.push(root)
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put({
      ...installed(root, false), extensionId: 'ext-disabled', enabled: false, active: false,
      profilePackageName: '@arkme-local/ext-1111111111111111',
    })
    store.put({
      ...installed(root, false), extensionId: 'ext-remove',
      profilePackageName: '@arkme-local/ext-2222222222222222',
    })
    const remove = vi.fn(async () => undefined)
    const setEnabled = vi.fn(async () => undefined)
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: join(root, 'profile'),
      profileInstaller: { install: vi.fn(), remove, restart: vi.fn(), setEnabled },
    })

    await manager.uninstall({ agent: undefined, extensionId: 'ext-remove' })
    expect(remove).toHaveBeenCalledWith('@arkme-local/ext-2222222222222222')
    expect(setEnabled).toHaveBeenCalledWith('@arkme-local/ext-1111111111111111', false)
    store.close()
  })
})
