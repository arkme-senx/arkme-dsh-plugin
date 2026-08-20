import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { packArkmeExtension } from '../../src/extensions/artifact.js'
import { materializePersistentExtensionBundle } from '../../src/extensions/persistent-bundle.js'
import {
  ArkmeExtensionProfileInstaller,
  profilePluginCommandErrorDetail,
} from '../../src/extensions/profile-installer.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'arkme-persistent-bundle-'))
  directories.push(root)
  const artifact = packArkmeExtension({
    name: '永久扩展', description: '测试', version: '1.0.0', arkmeProviderContract: 1,
    hostCode: 'return { apply() {} }', clientCode: 'return { apply() {} }',
  })
  const artifactPath = join(root, 'extension.arkext')
  return { root, artifact, artifactPath }
}

describe('persistent extension profile bundle', () => {
  it('materializes one immutable DSH bundle with Host and Client wrappers', () => {
    const { root, artifact, artifactPath } = fixture()
    const result = materializePersistentExtensionBundle({
      profileDirectory: root,
      artifactPath,
      trustedPublicKey: 'public-key',
      clientCode: 'return { apply() {} }',
      resolution: {
        extension_id: 'ext_test', version: '1.0.0', artifact_url: 'https://objects.test/a',
        artifact_size: artifact.bytes.byteLength, artifact_sha256: artifact.artifactSha256,
        manifest_sha256: artifact.manifestSha256, manifest: artifact.manifest,
        signature: 'signature', signing_key_id: 'key-1', published_at: 1_787_000_000_000, revoked: false,
      },
    })
    const manifest = JSON.parse(readFileSync(join(result.bundleDirectory, 'package.json'), 'utf8')) as {
      name: string; exports: Record<string, string>; dsh: { bundle: { patch: string }; client?: { inject: string[] } }
    }
    expect(manifest.name).toMatch(/^@arkme-local\/ext-[a-f0-9]{16}$/)
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client?.inject).toEqual([])
    expect(manifest.exports['./package.json']).toBe('./package.json')
    expect(readFileSync(join(result.bundleDirectory, 'cordis.patch.yml'), 'utf8')).toContain(manifest.name)
    expect(readFileSync(join(result.bundleDirectory, 'lib', 'index.js'), 'utf8')).toContain('applyPersistentArkmeHostExtension')
    expect(readFileSync(join(result.bundleDirectory, 'lib', 'client.js'), 'utf8')).toContain('extensions.persistent.invoke')
  })

  it('uses the official DSH profile command for add and remove', async () => {
    const { root } = fixture()
    const run = vi.fn(async () => undefined)
    const installer = new ArkmeExtensionProfileInstaller({
      dshHome: root, profileName: 'web', execPath: process.execPath, dshBinPath: '/dsh/bin', run,
    })
    await installer.install(root)
    await installer.remove('@arkme-local/ext-0123456789abcdef')
    await installer.remove('@example/install-bundle')
    expect(run).toHaveBeenNthCalledWith(1, [
      'plugin', '--profile', 'web', '--config.minimum-release-age=0', 'add', `link:${root}`,
    ])
    expect(run).toHaveBeenNthCalledWith(2, [
      'plugin', '--profile', 'web', '--config.minimum-release-age=0',
      'remove', '@arkme-local/ext-0123456789abcdef',
    ])
    expect(run).toHaveBeenNthCalledWith(3, [
      'plugin', '--profile', 'web', '--config.minimum-release-age=0',
      'remove', '@example/install-bundle',
    ])
  })

  it('preserves pnpm stdout together with the DSH fallback error', () => {
    expect(profilePluginCommandErrorDetail({
      stdout: 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION\nreal policy reason',
      stderr: 'dsh: pnpm failed in profile directory /tmp/profile',
    })).toBe([
      'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION',
      'real policy reason',
      'dsh: pnpm failed in profile directory /tmp/profile',
    ].join('\n'))
  })
})
