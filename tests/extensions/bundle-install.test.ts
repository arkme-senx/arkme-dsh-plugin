import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalExtensionSignatureMessage, packArkmeExtension } from '../../src/extensions/artifact.js'
import { packLocalBundleDirectory } from '../../src/extensions/bundle-artifact.js'
import { ArkmeExtensionInstallStore } from '../../src/extensions/install-store.js'
import { ArkmeExtensionManager } from '../../src/extensions/manager.js'
import { ExtensionPublishClient } from '../../src/extensions/publish-client.js'
import { canonicalBundleSignatureMessage } from '../../src/extensions/signature.js'
import { ARKME_EXTENSION_FORMAT_VERSION } from '../../src/extensions/types.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function bundleFixture() {
  const root = mkdtempSync(join(tmpdir(), 'bundle-install-source-'))
  directories.push(root)
  mkdirSync(join(root, 'lib'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: '@example/install-bundle', version: '1.0.0', files: ['lib', 'cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(root, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: arkme-7d9b476f25158df5-main',
    "      name: '@example/install-bundle'",
    '',
  ].join('\n'))
  writeFileSync(join(root, 'lib', 'index.js'), 'export function apply() {}\n')
  return packLocalBundleDirectory(root)
}

describe('Bundle v2 profile installation', () => {
  it('verifies and installs the downloaded tgz directly without an Arkme wrapper', async () => {
    const source = bundleFixture()
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const envelope = {
      artifact_contract_version: 2 as const,
      artifact_kind: 'dsh-bundle-tgz' as const,
      extension_id: 'ext-bundle',
      package_name: source.bundle.packageName,
      version: source.bundle.version,
      execution_model: source.bundle.executionModel,
      bundle_sha256: source.bundle.bundleSha256,
      package_json_sha256: source.bundle.packageJsonSha256,
      source_sha256: source.source.sourceSha256,
      published_at: 1_780_000_000_000,
      signing_key_id: 'bundle-key',
    }
    const resolution = {
      ...envelope,
      bundle_url: 'https://objects.test/bundle.tgz',
      bundle_size: source.bundle.bytes.byteLength,
      bundle_headers: {},
      requires_native_confirmation: true,
      signature: sign(null, canonicalBundleSignatureMessage(envelope), privateKey).toString('base64'),
      revoked: false,
      artifact_url: '', artifact_sha256: '', manifest_sha256: '',
      manifest: {
        format: 'arkme-cordis-extension' as const, format_version: 1 as const,
        name: 'unused', description: '', version: '1.0.0',
        runtime: { dsh: '>=0.1.0-rc.7', arkme_provider_contract: 1 },
        halves: { host: true, client: false }, permissions: [], entrypoints: { host: 'host.js' as const },
      },
    }
    const client = new ExtensionPublishClient(async <T>(path: string): Promise<T> => {
      if (path !== '/api/v1/extensions/resolve-install') throw new Error(`unexpected ${path}`)
      return resolution as T
    }, async () => new Response(source.bundle.bytes as BodyInit, {
      status: 200, headers: { 'Content-Length': String(source.bundle.bytes.byteLength) },
    }))
    const stateRoot = mkdtempSync(join(tmpdir(), 'bundle-install-state-'))
    directories.push(stateRoot)
    const profile = join(stateRoot, 'profiles', 'web')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }))
    const store = new ArkmeExtensionInstallStore(join(stateRoot, 'state'))
    const installTarball = vi.fn(async () => undefined)
    const manager = new ArkmeExtensionManager(client, store, {
      inspectPackage: () => { throw new Error('not used') },
      define: () => { throw new Error('not used') },
      run: async () => { throw new Error('not used') },
    }, {
      artifactDirectory: join(stateRoot, 'artifacts'),
      trustedSigningKeys: JSON.stringify({
        'bundle-key': publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      }),
      profileDirectory: profile,
      profileInstaller: { install: vi.fn(), installTarball, remove: vi.fn(), restart: vi.fn() } as never,
      pluginInventory: {
        list: () => ({ entries: [{
          entryId: 'arkme-test', moduleName: '@example/install-bundle', enabled: true, fiberPhase: 'active',
        }] }),
      },
    })

    await expect(manager.previewInstall('ext-bundle')).resolves.toMatchObject({
      extension_id: 'ext-bundle',
      package_name: '@example/install-bundle',
      execution_model: 'dsh-native',
      bundle_size: source.bundle.bytes.byteLength,
      requires_native_confirmation: true,
    })

    await expect(manager.apply({ agent: {}, extensionId: 'ext-bundle' })).resolves.toMatchObject({
      installed: true, active: false, restart_required: true,
    })

    expect(installTarball).toHaveBeenCalledOnce()
    const installedPath = installTarball.mock.calls[0]![0]
    expect(installedPath).toMatch(/\.tgz$/)
    expect(Buffer.from(readFileSync(installedPath)).equals(Buffer.from(source.bundle.bytes))).toBe(true)
    expect(store.get('ext-bundle')).toMatchObject({
      artifactSha256: source.bundle.bundleSha256,
      artifactPath: installedPath,
      profilePackageName: '@example/install-bundle',
      executionModel: 'dsh-native',
    })
    expect(store.get('ext-bundle')?.profilePackageName).not.toMatch(/^@arkme-local\//)
    expect(manager.listInstalled()[0]?.active).toBe(true)
    store.close()
  })

  it('keeps a published legacy arkext installable through the isolated Profile wrapper', async () => {
    const artifact = packArkmeExtension({
      name: 'Legacy', description: 'Published before Bundle v2', version: '1.0.0', arkmeProviderContract: 1,
      hostCode: 'return { name: "legacy", apply() {} }',
    })
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const envelope = {
      format_version: ARKME_EXTENSION_FORMAT_VERSION,
      extension_id: 'ext-legacy', version: artifact.manifest.version,
      artifact_sha256: artifact.artifactSha256, manifest_sha256: artifact.manifestSha256,
      published_at: 1_780_000_000_000, signing_key_id: 'legacy-key',
    }
    const resolution = {
      extension_id: envelope.extension_id, version: envelope.version,
      artifact_url: 'https://objects.test/legacy.arkext', artifact_size: artifact.bytes.byteLength,
      artifact_sha256: envelope.artifact_sha256, manifest_sha256: envelope.manifest_sha256,
      manifest: artifact.manifest,
      signature: sign(null, canonicalExtensionSignatureMessage(envelope), privateKey).toString('base64'),
      signing_key_id: envelope.signing_key_id, published_at: envelope.published_at, revoked: false,
    }
    const client = new ExtensionPublishClient(async <T>(): Promise<T> => resolution as T, async () => new Response(
      artifact.bytes as BodyInit,
      { status: 200, headers: { 'Content-Length': String(artifact.bytes.byteLength) } },
    ))
    const root = mkdtempSync(join(tmpdir(), 'legacy-install-compatibility-'))
    directories.push(root)
    const profile = join(root, 'profiles', 'web')
    mkdirSync(profile, { recursive: true })
    const store = new ArkmeExtensionInstallStore(root)
    const install = vi.fn(async () => undefined)
    const installTarball = vi.fn(async () => undefined)
    const manager = new ArkmeExtensionManager(client, store, {
      inspectPackage: () => { throw new Error('not used') }, define: () => { throw new Error('not used') },
      run: async () => { throw new Error('not used') },
    }, {
      artifactDirectory: join(root, 'artifacts'),
      trustedSigningKeys: JSON.stringify({
        'legacy-key': publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      }),
      profileDirectory: profile,
      profileInstaller: { install, installTarball, remove: vi.fn(), restart: vi.fn() } as never,
    })

    await expect(manager.apply({ agent: {}, extensionId: 'ext-legacy' })).resolves.toMatchObject({
      state: 'installed', installed: true, active: false, restart_required: true,
    })
    expect(install).toHaveBeenCalledOnce()
    expect(installTarball).not.toHaveBeenCalled()
    expect(store.get('ext-legacy')).toMatchObject({
      installedVersion: '1.0.0', artifactSha256: artifact.artifactSha256, active: false,
      profilePackageName: expect.stringMatching(/^@arkme-local\/ext-/),
    })
    expect(store.get('ext-legacy')).not.toHaveProperty('executionModel')
    store.close()
  })

  it('does not downgrade a malformed Bundle v2 resolution into the legacy installer', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]) as BodyInit, { status: 200 })) as typeof fetch
    const client = new ExtensionPublishClient(async <T>(): Promise<T> => ({
      artifact_contract_version: 2,
      artifact_kind: 'dsh-bundle-tgz',
      extension_id: 'ext-malformed-v2',
      version: '1.0.0',
      package_name: '',
      execution_model: 'dsh-native',
      bundle_url: '',
      bundle_size: 0,
      bundle_sha256: 'a'.repeat(64),
      package_json_sha256: 'b'.repeat(64),
      source_sha256: 'c'.repeat(64),
      artifact_url: 'https://objects.test/fallback.arkext',
      artifact_sha256: 'd'.repeat(64),
      manifest_sha256: 'e'.repeat(64),
      manifest: {
        format: 'arkme-cordis-extension', format_version: 1, name: 'Malformed', description: '', version: '1.0.0',
        runtime: { dsh: '>=0.1.0-rc.7', arkme_provider_contract: 1 }, halves: { host: true, client: false },
        permissions: [], entrypoints: { host: 'host.js' },
      },
      signature: 'invalid', signing_key_id: 'bundle-key', published_at: 1_780_000_000_000, revoked: false,
    } as T), fetchImpl)
    const root = mkdtempSync(join(tmpdir(), 'malformed-v2-install-'))
    directories.push(root)
    const store = new ArkmeExtensionInstallStore(root)
    const manager = new ArkmeExtensionManager(client, store, {
      inspectPackage: () => { throw new Error('not used') }, define: () => { throw new Error('not used') },
      run: async () => { throw new Error('not used') },
    }, { artifactDirectory: join(root, 'artifacts'), trustedSigningKeys: '{}' })

    await expect(manager.apply({ agent: {}, extensionId: 'ext-malformed-v2' })).rejects.toMatchObject({
      code: 'extension-install-contract-invalid',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.get('ext-malformed-v2')).toBeUndefined()
    store.close()
  })
})
