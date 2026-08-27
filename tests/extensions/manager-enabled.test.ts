import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { packArkmeExtension } from '../../src/extensions/artifact.js'
import { materializeCordisBundle } from '../../src/extensions/bundle-materializer.js'
import { arkmeClientContentDigest } from '../../src/extensions/client-owner.js'
import { ArkmeExtensionInstallStore } from '../../src/extensions/install-store.js'
import { ArkmeExtensionManager } from '../../src/extensions/manager.js'
import { materializePersistentExtensionBundle } from '../../src/extensions/persistent-bundle.js'
import { ArkmeExtensionProfileInstaller } from '../../src/extensions/profile-installer.js'
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
  it('rebases a copied persistent extension onto the current Profile after validating its identity', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme extension relocated '))
    directories.push(root)
    const currentHome = join(root, 'Current Home With Spaces')
    const profile = join(currentHome, 'profiles', 'web')
    const artifactDirectory = join(currentHome, 'arkme-self', 'extensions')
    const extensionId = 'ext-relocated'
    const version = '1.0.0'
    const artifact = packArkmeExtension({
      name: 'Relocated', description: '', version, arkmeProviderContract: 1,
      hostCode: 'return { apply() {} }', clientCode: 'return { apply() {} }',
    })
    const artifactPath = join(artifactDirectory, extensionId, version, 'extension.arkext')
    mkdirSync(join(artifactDirectory, extensionId, version), { recursive: true })
    writeFileSync(artifactPath, artifact.bytes)
    const bundle = materializePersistentExtensionBundle({
      profileDirectory: profile,
      artifactPath,
      trustedPublicKey: 'public-key',
      clientCode: 'return { apply() {} }',
      resolution: {
        extension_id: extensionId, version, artifact_url: 'https://objects.test/relocated',
        artifact_size: artifact.bytes.byteLength, artifact_sha256: artifact.artifactSha256,
        manifest_sha256: artifact.manifestSha256, manifest: artifact.manifest,
        signature: 'signature', signing_key_id: 'key-1', published_at: 1_787_000_000_000, revoked: false,
      },
    })
    const oldHome = join(root, 'Previous Home')
    const oldArtifactPath = join(oldHome, 'arkme-self', 'extensions', extensionId, version, 'extension.arkext')
    const oldBundlePath = join(oldHome, 'profiles', 'web', 'arkme-extensions', 'relocated', version)
    const installationPath = join(bundle.bundleDirectory, 'installation.json')
    writeFileSync(installationPath, JSON.stringify({
      ...JSON.parse(readFileSync(installationPath, 'utf8')) as Record<string, unknown>,
      artifact_path: oldArtifactPath,
    }))
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { [bundle.packageName]: `link:${oldBundlePath}` },
      dsh: { profile: { bundles: [bundle.packageName] } },
    }))
    const store = new ArkmeExtensionInstallStore(artifactDirectory)
    store.put({
      extensionId,
      installedVersion: version,
      artifactSha256: artifact.artifactSha256,
      artifactPath: oldArtifactPath,
      manifest: artifact.manifest,
      enabled: true,
      active: true,
      profilePackageName: bundle.packageName,
      profileBundlePath: oldBundlePath,
      permissionSnapshot: [],
      updateChannel: 'stable',
      installedAtMillis: 7,
      lastCheckedAtMillis: 7,
    })
    const install = vi.fn(async () => undefined)
    const canonicalArtifactPath = realpathSync(artifactPath)
    const canonicalBundlePath = realpathSync(bundle.bundleDirectory)
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory,
      trustedSigningKeys: '{}',
      profileDirectory: profile,
      profileInstaller: { install, remove: vi.fn(), restart: vi.fn(), setEnabled: vi.fn() },
      persistentRuntimeState: () => ({
        version,
        installationUrl: pathToFileURL(join(canonicalBundlePath, 'installation.json')).href,
        active: true,
      }),
    })

    expect(store.get(extensionId)).toMatchObject({
      artifactPath: canonicalArtifactPath,
      profileBundlePath: canonicalBundlePath,
    })
    expect(JSON.parse(readFileSync(installationPath, 'utf8'))).toMatchObject({ artifact_path: canonicalArtifactPath })
    expect(manager.persistentClientState(extensionId, version)).toMatchObject({ mount: true })

    await manager.reconcileInstallationMetrics()
    expect(install).toHaveBeenCalledWith(canonicalBundlePath)
    store.close()
  })

  it('does not rebase a copied persistent Bundle with a mismatched installation identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-relocated-invalid-'))
    directories.push(root)
    const currentHome = join(root, 'current')
    const profile = join(currentHome, 'profiles', 'web')
    const artifactDirectory = join(currentHome, 'arkme-self', 'extensions')
    const extensionId = 'ext-relocated-invalid'
    const version = '1.0.0'
    const artifact = packArkmeExtension({
      name: 'Relocated invalid', description: '', version, arkmeProviderContract: 1,
      hostCode: 'return { apply() {} }', clientCode: 'return { apply() {} }',
    })
    const artifactPath = join(artifactDirectory, extensionId, version, 'extension.arkext')
    mkdirSync(join(artifactDirectory, extensionId, version), { recursive: true })
    writeFileSync(artifactPath, artifact.bytes)
    const bundle = materializePersistentExtensionBundle({
      profileDirectory: profile,
      artifactPath,
      trustedPublicKey: 'public-key',
      resolution: {
        extension_id: extensionId, version, artifact_url: 'https://objects.test/invalid',
        artifact_size: artifact.bytes.byteLength, artifact_sha256: artifact.artifactSha256,
        manifest_sha256: artifact.manifestSha256, manifest: artifact.manifest,
        signature: 'signature', signing_key_id: 'key-1', published_at: 1_787_000_000_000, revoked: false,
      },
    })
    const installationPath = join(bundle.bundleDirectory, 'installation.json')
    writeFileSync(installationPath, JSON.stringify({
      ...JSON.parse(readFileSync(installationPath, 'utf8')) as Record<string, unknown>,
      extension_id: 'ext-other',
    }))
    const oldArtifactPath = join(root, 'old', extensionId, version, 'extension.arkext')
    const oldBundlePath = join(root, 'old-profile', 'arkme-extensions', extensionId, version)
    const store = new ArkmeExtensionInstallStore(artifactDirectory)
    store.put({
      extensionId,
      installedVersion: version,
      artifactSha256: artifact.artifactSha256,
      artifactPath: oldArtifactPath,
      manifest: artifact.manifest,
      enabled: true,
      active: true,
      profilePackageName: bundle.packageName,
      profileBundlePath: oldBundlePath,
      permissionSnapshot: [],
      updateChannel: 'stable',
      installedAtMillis: 7,
      lastCheckedAtMillis: 7,
    })
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory,
      trustedSigningKeys: '{}',
      profileDirectory: profile,
      profileInstaller: { install: vi.fn(), remove: vi.fn(), restart: vi.fn(), setEnabled: vi.fn() },
      persistentRuntimeState: () => ({
        version,
        installationUrl: pathToFileURL(installationPath).href,
        active: true,
      }),
    })

    expect(store.get(extensionId)).toMatchObject({
      artifactPath: oldArtifactPath,
      profileBundlePath: oldBundlePath,
    })
    expect(manager.persistentClientState(extensionId, version)).toMatchObject({
      mount: false,
      reason: 'runtime-mismatch',
    })
    store.close()
  })

  it('leases a Bundle Client by canonical extension id and exact installed instance', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-client-lease-'))
    directories.push(root)
    const clientCode = 'return { apply() {} }'
    const source = materializeCordisBundle({
      packageName: '@example/weather', name: 'Weather', description: '', version: '1.0.0', clientCode,
    })
    const artifactPath = join(root, 'weather.tgz')
    writeFileSync(artifactPath, source.bundle.bytes)
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put({
      ...installed(root, true),
      extensionId: 'ext-weather',
      artifactSha256: source.bundle.bundleSha256,
      artifactPath,
      profilePackageName: '@example/weather',
      profileBundlePath: artifactPath,
      executionModel: 'arkme-sandboxed',
      artifactContractVersion: 2,
      installedAtMillis: 7,
    })
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}',
    })

    const state = manager.bundleClientState(
      '@example/weather', '1.0.0', arkmeClientContentDigest(clientCode),
    )
    expect(state).toMatchObject({
      extension_id: 'ext-weather', version: '1.0.0', mount: true, generation: 7,
      instance_key: expect.stringMatching(/^instance-v1-[a-f0-9]{64}$/),
    })
    expect(manager.bundleClientState('@example/weather', '1.0.0', arkmeClientContentDigest('different')))
      .toMatchObject({ extension_id: 'ext-weather', mount: false, reason: 'content-mismatch' })
    await expect(manager.reportClientFailure({
      identityKey: 'packageName', extensionId: '@example/weather', version: '1.0.0',
      clientOwnerKey: arkmeClientContentDigest(clientCode), kind: 'duplicate-owner', message: 'legacy collision',
    })).resolves.toEqual({ handled: true, disabled: false })
    expect(store.get('ext-weather')?.enabled).toBe(true)
    await expect(manager.reportClientFailure({
      identityKey: 'packageName', extensionId: '@example/weather', version: '1.0.0',
      clientInstanceKey: state.instance_key, kind: 'runtime-load-failed', message: 'slot collision',
    })).resolves.toEqual({ handled: true, disabled: true })
    expect(store.get('ext-weather')).toMatchObject({ enabled: false, active: false, lastError: 'slot collision' })
    store.close()
  })

  it('projects a quarantined persistent extension as disabled and inactive for the Client', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-quarantined-'))
    directories.push(root)
    const bundle = join(root, 'profile', 'arkme-extensions', 'bundle')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(bundle, 'installation.json'), JSON.stringify({ extension_id: 'ext-client' }))
    writeFileSync(join(bundle, 'activation.json'), JSON.stringify({
      schema_version: 1,
      extension_id: 'ext-client',
      enabled: false,
      quarantine: {
        code: 'runtime-load-failed',
        failed_at_millis: 1,
        message: 'harness.defineTool is not a function',
      },
    }))
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put(installed(root, true))
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: join(root, 'profile'),
      profileInstaller: { install: vi.fn(), remove: vi.fn(), restart: vi.fn(), setEnabled: vi.fn() },
    })

    expect(manager.listInstalled()).toEqual([expect.objectContaining({
      extensionId: 'ext-client',
      enabled: false,
      active: false,
      unavailable: {
        code: 'runtime-load-failed',
        message: '插件运行失败，已自动停用。',
      },
    })])
    expect(manager.enabledState('ext-client')).toMatchObject({ installed: true, enabled: false, active: false })
    expect(store.get('ext-client')).toMatchObject({
      enabled: false,
      active: false,
      lastError: 'harness.defineTool is not a function',
    })
    store.close()
  })

  it('does not treat an active same-package wrapper from an older version as the installed runtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-version-mismatch-'))
    directories.push(root)
    const bundle = join(root, 'profile', 'arkme-extensions', 'bundle-1.0.1')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(bundle, 'installation.json'), JSON.stringify({ extension_id: 'ext-host', version: '1.0.1' }))
    writeFileSync(join(bundle, 'activation.json'), JSON.stringify({
      schema_version: 1, extension_id: 'ext-host', enabled: true,
    }))
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put({ ...installed(root, false), installedVersion: '1.0.1', profileBundlePath: bundle, active: false })
    const persistentRuntimeState = vi.fn(() => ({
      version: '1.0.0',
      installationUrl: new URL('file:///old/profile/1.0.0/installation.json').href,
      active: true,
    }))
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: join(root, 'profile'),
      profileInstaller: { install: vi.fn(), remove: vi.fn(), restart: vi.fn(), setEnabled: vi.fn() },
      persistentRuntimeState,
      pluginInventory: {
        list: () => ({ entries: [{
          entryId: 'legacy', moduleName: '@arkme-local/ext-0123456789abcdef', enabled: true, fiberPhase: 'active',
        }] }),
      },
    })

    expect(manager.listInstalled()).toEqual([
      expect.objectContaining({ extensionId: 'ext-host', installedVersion: '1.0.1', enabled: true, active: false }),
    ])
    expect(manager.enabledState('ext-host')).toMatchObject({ enabled: false, active: false })
    expect(manager.persistentClientState('ext-host', '1.0.0')).toEqual({
      extension_id: 'ext-host', version: '1.0.0', mount: false, reason: 'version-mismatch',
    })
    expect(manager.persistentClientState('ext-host', '1.0.1')).toEqual({
      extension_id: 'ext-host', version: '1.0.1', mount: false, reason: 'runtime-mismatch',
    })
    store.close()
  })

  it('accepts an equivalent real path while retaining the Profile containment guard', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-realpath-'))
    directories.push(root)
    const actualRoot = join(root, 'actual')
    const aliasRoot = join(root, 'alias')
    const bundle = join(actualRoot, 'profile', 'arkme-extensions', 'bundle')
    mkdirSync(bundle, { recursive: true })
    symlinkSync(actualRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir')
    writeFileSync(join(bundle, 'activation.json'), JSON.stringify({ schema_version: 1, extension_id: 'ext-host', enabled: true }))
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put(installed(aliasRoot, false))
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: join(actualRoot, 'profile'),
      profileInstaller: { install: vi.fn(), remove: vi.fn(), restart: vi.fn(), setEnabled: vi.fn() },
    })

    await expect(manager.setEnabled({ agent: undefined, extensionId: 'ext-host', enabled: false }))
      .resolves.toMatchObject({ enabled: false })
    expect(JSON.parse(readFileSync(join(bundle, 'activation.json'), 'utf8'))).toMatchObject({ enabled: false })
    store.close()
  })

  it('rejects a Bundle symlink that resolves outside the Profile extension root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-realpath-escape-'))
    directories.push(root)
    const extensionRoot = join(root, 'profile', 'arkme-extensions')
    const outside = join(root, 'outside')
    mkdirSync(extensionRoot, { recursive: true })
    mkdirSync(outside)
    writeFileSync(join(outside, 'activation.json'), JSON.stringify({ schema_version: 1, extension_id: 'ext-host', enabled: true }))
    symlinkSync(outside, join(extensionRoot, 'bundle'), process.platform === 'win32' ? 'junction' : 'dir')
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put(installed(root, false))
    const setEnabled = vi.fn(async () => undefined)
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: join(root, 'profile'),
      profileInstaller: { install: vi.fn(), remove: vi.fn(), restart: vi.fn(), setEnabled },
    })

    await expect(manager.setEnabled({ agent: undefined, extensionId: 'ext-host', enabled: false }))
      .rejects.toThrow('本地扩展 Bundle 路径无效')
    expect(setEnabled).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(join(outside, 'activation.json'), 'utf8'))).toMatchObject({ enabled: true })
    store.close()
  })

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

  it('does not advertise a Profile restart when a Client extension has no Profile package', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-client-session-only-'))
    directories.push(root)
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    const { profilePackageName: _package, profileBundlePath: _bundle, ...sessionOnly } = installed(root, true)
    store.put(sessionOnly)
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}',
    })

    await expect(manager.setEnabled({ agent: undefined, extensionId: 'ext-client', enabled: false }))
      .resolves.toMatchObject({ enabled: false, active: false, restart_required: false })
    await expect(manager.restartProfileChange('ext-client')).rejects.toThrow('没有等待重启的变更')
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

  it('preserves the first rollback baseline when a native disable request is repeated', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-native-repeat-disable-'))
    directories.push(root)
    const profile = join(root, 'profiles', 'web')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'deepseek-pet': '1.0.0' },
      dsh: { profile: { bundles: ['deepseek-pet'] } },
    }))
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put({
      ...installed(root, false), extensionId: 'ext-native',
      profilePackageName: 'deepseek-pet', profileBundlePath: join(root, 'pet.tgz'),
      executionModel: 'dsh-native',
    })
    const installer = new ArkmeExtensionProfileInstaller({
      dshHome: root, profileName: 'web', execPath: process.execPath, dshBinPath: '/dsh/bin', run: vi.fn(),
    })
    const restart = vi.fn(async () => undefined)
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: profile,
      profileInstaller: {
        install: vi.fn(), installTarball: vi.fn(), remove: vi.fn(),
        setEnabled: installer.setEnabled.bind(installer), restart,
      },
      pluginInventory: {
        list: () => ({ entries: [{
          entryId: 'deepseek-pet', moduleName: 'deepseek-pet', enabled: true, fiberPhase: 'active',
        }] }),
      },
    })

    await manager.setEnabled({ agent: undefined, extensionId: 'ext-native', enabled: false })
    await manager.setEnabled({ agent: undefined, extensionId: 'ext-native', enabled: false })
    await manager.restartProfileChange('ext-native')

    expect(restart).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-native', expectActive: false, previousProfileIncluded: true,
      previousInstalled: expect.objectContaining({ enabled: true, active: true }),
    }))
    store.close()
  })

  it('uses the current DSH Loader inventory instead of stale persisted activity after restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-native-restarted-'))
    directories.push(root)
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put({
      ...installed(root, false), extensionId: 'ext-native', enabled: false, active: true,
      profilePackageName: 'deepseek-pet', executionModel: 'dsh-native',
    })
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}',
      pluginInventory: { list: () => ({ entries: [] }) },
    })

    expect(manager.listInstalled()).toEqual([
      expect.objectContaining({ extensionId: 'ext-native', enabled: false, active: false }),
    ])
    expect(manager.listInstalled()[0]).not.toHaveProperty('restartRequired')
    store.close()
  })

  it('heals an idempotently disabled native Bundle after DSH re-adds its Profile layer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-native-drift-'))
    directories.push(root)
    const profile = join(root, 'profiles', 'web')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'deepseek-pet': '1.0.0' },
      dsh: { profile: { bundles: ['deepseek-pet'] } },
    }))
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put({
      ...installed(root, false), extensionId: 'ext-native', enabled: false, active: false,
      profilePackageName: 'deepseek-pet', executionModel: 'dsh-native',
    })
    const installer = new ArkmeExtensionProfileInstaller({
      dshHome: root, profileName: 'web', execPath: process.execPath, dshBinPath: '/dsh/bin', run: vi.fn(),
    })
    const restart = vi.fn(async () => undefined)
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: profile,
      profileInstaller: {
        install: vi.fn(), installTarball: vi.fn(), remove: vi.fn(),
        setEnabled: installer.setEnabled.bind(installer), restart,
      },
      pluginInventory: {
        list: () => ({ entries: [{
          entryId: 'deepseek-pet', moduleName: 'deepseek-pet', enabled: true, fiberPhase: 'active',
        }] }),
      },
    })

    await expect(manager.setEnabled({ agent: undefined, extensionId: 'ext-native', enabled: false }))
      .resolves.toMatchObject({ enabled: false, active: true, restart_required: true })
    expect(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')))
      .toMatchObject({ dsh: { profile: { bundles: [] } } })
    await manager.restartProfileChange('ext-native')
    expect(restart).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'ext-native', packageName: 'deepseek-pet', expectActive: false,
      activationChange: true, previousProfileIncluded: true,
    }))
    store.close()
  })

  it('repairs disabled Profile drift on Host startup and exposes the pending restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-startup-drift-'))
    directories.push(root)
    const profile = join(root, 'profiles', 'web')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'deepseek-pet': '1.0.0' },
      dsh: { profile: { bundles: ['deepseek-pet'] } },
    }))
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put({
      ...installed(root, false), extensionId: 'ext-native', enabled: false, active: false,
      profilePackageName: 'deepseek-pet', executionModel: 'dsh-native',
    })
    const installer = new ArkmeExtensionProfileInstaller({
      dshHome: root, profileName: 'web', execPath: process.execPath, dshBinPath: '/dsh/bin', run: vi.fn(),
    })
    const restart = vi.fn(async () => undefined)
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: profile,
      profileInstaller: {
        install: vi.fn(), installTarball: vi.fn(), remove: vi.fn(),
        setEnabled: installer.setEnabled.bind(installer), restart,
      },
      pluginInventory: {
        list: () => ({ entries: [{
          entryId: 'deepseek-pet', moduleName: 'deepseek-pet', enabled: true, fiberPhase: 'active',
        }] }),
      },
    })

    await manager.reconcileInstallationMetrics()
    expect(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')))
      .toMatchObject({ dsh: { profile: { bundles: [] } } })
    expect(manager.listInstalled()).toEqual([
      expect.objectContaining({ extensionId: 'ext-native', enabled: false, active: true, restartRequired: true }),
    ])
    expect(manager.enabledState('ext-native')).toMatchObject({ restart_required: true })
    await manager.restartProfileChange('ext-native')
    expect(restart).toHaveBeenCalledWith(expect.objectContaining({ activationChange: true, expectActive: false }))
    store.close()
  })

  it('keeps successful startup repairs and finishes reconciliation when another repair fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-startup-partial-repair-'))
    directories.push(root)
    const profile = join(root, 'profiles', 'web')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'pet-a': '1.0.0', 'pet-b': '1.0.0' },
      dsh: { profile: { bundles: ['pet-a', 'pet-b'] } },
    }))
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put({
      ...installed(root, false), extensionId: 'ext-a', enabled: false, active: false,
      profilePackageName: 'pet-a', executionModel: 'dsh-native',
    })
    store.put({
      ...installed(root, false), extensionId: 'ext-b', enabled: false, active: false,
      profilePackageName: 'pet-b', executionModel: 'dsh-native',
    })
    const installer = new ArkmeExtensionProfileInstaller({
      dshHome: root, profileName: 'web', execPath: process.execPath, dshBinPath: '/dsh/bin', run: vi.fn(),
    })
    const setEnabled = vi.fn(async (packageName: string, enabled: boolean) => {
      if (packageName === 'pet-b') throw new Error('fixture policy failure')
      await installer.setEnabled(packageName, enabled)
    })
    const syncInstallationStates = vi.fn(async () => undefined)
    const manager = new ArkmeExtensionManager({ syncInstallationStates } as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: profile,
      profileInstaller: {
        install: vi.fn(), installTarball: vi.fn(), remove: vi.fn(), restart: vi.fn(), setEnabled,
      },
      pluginInventory: {
        list: () => ({ entries: [
          { entryId: 'pet-a', moduleName: 'pet-a', enabled: true, fiberPhase: 'active' },
          { entryId: 'pet-b', moduleName: 'pet-b', enabled: true, fiberPhase: 'active' },
        ] }),
      },
    })

    await expect(manager.reconcileInstallationMetrics()).rejects.toThrow('ext-b')

    expect(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')))
      .toMatchObject({ dsh: { profile: { bundles: ['pet-b'] } } })
    const views = manager.listInstalled()
    expect(views.find(item => item.extensionId === 'ext-a')).toMatchObject({ restartRequired: true })
    expect(views.find(item => item.extensionId === 'ext-b')).not.toHaveProperty('restartRequired')
    expect(syncInstallationStates).toHaveBeenCalledOnce()
    store.close()
  })

  it('re-applies other disabled Profile layers after DSH package reconciliation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-reconcile-'))
    directories.push(root)
    const profile = join(root, 'profile')
    mkdirSync(profile)
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { '@arkme-local/ext-1111111111111111': 'link:installed' },
      dsh: { profile: { bundles: ['@arkme-local/ext-1111111111111111'] } },
    }))
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
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: profile,
      profileInstaller: { install: vi.fn(), remove, restart: vi.fn(), setEnabled },
    })

    await manager.uninstall({ agent: undefined, extensionId: 'ext-remove' })
    expect(remove).toHaveBeenCalledWith('@arkme-local/ext-2222222222222222')
    expect(setEnabled).toHaveBeenCalledWith('@arkme-local/ext-1111111111111111', false)
    store.close()
  })

  it('skips a disabled extension record whose package is no longer installed in the Profile', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-stale-disabled-'))
    directories.push(root)
    const profile = join(root, 'profile')
    mkdirSync(profile)
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { '@arkme-local/ext-2222222222222222': 'link:installed' },
      dsh: { profile: { bundles: ['@arkme-local/ext-2222222222222222'] } },
    }))
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put({
      ...installed(root, false), extensionId: 'ext-stale', enabled: false, active: false,
      profilePackageName: '@arkme-local/ext-1111111111111111',
    })
    store.put({
      ...installed(root, false), extensionId: 'ext-remove',
      profilePackageName: '@arkme-local/ext-2222222222222222',
    })
    const remove = vi.fn(async () => undefined)
    const setEnabled = vi.fn(async () => {
      throw new Error('扩展尚未安装到当前 DSH Profile')
    })
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: profile,
      profileInstaller: { install: vi.fn(), remove, restart: vi.fn(), setEnabled },
    })

    await expect(manager.uninstall({ agent: undefined, extensionId: 'ext-remove' }))
      .resolves.toMatchObject({ installed: false })
    expect(remove).toHaveBeenCalledWith('@arkme-local/ext-2222222222222222')
    expect(setEnabled).not.toHaveBeenCalled()
    store.close()
  })

  it('upgrades an old managed Client wrapper and replaces an older package with the same extension id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arkme-extension-owner-reconcile-'))
    directories.push(root)
    const profile = join(root, 'profile')
    const bundle = join(profile, 'arkme-extensions', 'managed', '1.0.0')
    const local = join(root, 'dsh-snake-draggable')
    mkdirSync(join(bundle, 'lib'), { recursive: true })
    mkdirSync(join(local, 'arkme'), { recursive: true })
    const clientCode = 'return { apply() {} }'
    const artifact = packArkmeExtension({
      name: 'Snake', description: '', version: '1.0.0', arkmeProviderContract: 1,
      hostCode: 'return { apply() {} }', clientCode,
    })
    const artifactPath = join(root, 'snake.arkext')
    writeFileSync(artifactPath, artifact.bytes)
    writeFileSync(join(bundle, 'lib', 'client.js'), 'legacy wrapper without failure isolation')
    writeFileSync(join(bundle, 'installation.json'), JSON.stringify({ extension_id: 'ext-snake', version: '1.0.0' }))
    writeFileSync(join(bundle, 'activation.json'), JSON.stringify({ schema_version: 1, extension_id: 'ext-snake', enabled: true }))
    writeFileSync(join(local, 'package.json'), JSON.stringify({ name: 'dsh-snake-draggable' }))
    writeFileSync(join(local, 'installation.json'), JSON.stringify({ extension_id: 'ext-snake', version: '0.9.0' }))
    writeFileSync(join(local, 'arkme', 'source.json'), JSON.stringify({ clientCode: 'return { apply() { return "old" } }' }))
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: {
        '@arkme-local/ext-managed': `link:${bundle}`,
        'dsh-snake-draggable': `link:${local}`,
      },
      dsh: { profile: { bundles: ['@arkme-local/ext-managed', 'dsh-snake-draggable'] } },
    }))
    const store = new ArkmeExtensionInstallStore(join(root, 'store'))
    store.put({
      ...installed(root, true),
      extensionId: 'ext-snake',
      installedVersion: '1.0.0',
      artifactSha256: artifact.artifactSha256,
      artifactPath,
      manifest: artifact.manifest,
      profilePackageName: '@arkme-local/ext-managed',
      profileBundlePath: bundle,
    })
    const removeMany = vi.fn(async () => undefined)
    const setEnabled = vi.fn(async () => undefined)
    const manager = new ArkmeExtensionManager({} as never, store, {} as never, {
      artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}', profileDirectory: profile,
      profileInstaller: {
        install: vi.fn(), installTarball: vi.fn(), remove: vi.fn(), removeMany, restart: vi.fn(), setEnabled,
      },
    })

    await manager.reconcileInstallationMetrics()

    const wrapper = readFileSync(join(bundle, 'lib', 'client.js'), 'utf8')
    expect(wrapper).toContain('extensions.client.failure')
    expect(wrapper).toContain('"wrapperVersion":4')
    expect(wrapper).toContain(arkmeClientContentDigest(clientCode))
    expect(removeMany).toHaveBeenCalledWith(['dsh-snake-draggable'])
    await expect(manager.reportClientFailure({
      identityKey: 'extensionId', extensionId: 'ext-snake', version: '1.0.0',
      clientOwnerKey: arkmeClientContentDigest(clientCode), kind: 'runtime-load-failed', message: 'slot collision',
    })).resolves.toEqual({ handled: true, disabled: true })
    expect(setEnabled).toHaveBeenCalledWith('@arkme-local/ext-managed', false)
    expect(JSON.parse(readFileSync(join(bundle, 'activation.json'), 'utf8'))).toMatchObject({
      enabled: false,
      quarantine: { code: 'runtime-load-failed', message: 'slot collision' },
    })
    expect(store.get('ext-snake')).toMatchObject({ enabled: false, active: false, lastError: 'slot collision' })
    store.close()
  })
})
