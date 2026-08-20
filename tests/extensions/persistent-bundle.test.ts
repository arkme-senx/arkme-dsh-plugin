import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { packArkmeExtension } from '../../src/extensions/artifact.js'
import { renderPersistentClientBundle } from '../../src/extensions/persistent-client-bundle.js'
import { materializePersistentExtensionBundle } from '../../src/extensions/persistent-bundle.js'
import {
  ArkmeExtensionProfileInstaller,
  profilePluginCommandErrorDetail,
} from '../../src/extensions/profile-installer.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'arkme persistent bundle '))
  directories.push(root)
  const artifact = packArkmeExtension({
    name: '永久扩展', description: '测试', version: '1.0.0', arkmeProviderContract: 1,
    hostCode: 'return { apply() {} }', clientCode: 'return { apply() {} }',
  })
  const artifactPath = join(root, 'extension.arkext')
  return { root, artifact, artifactPath }
}

describe('persistent extension profile bundle', () => {
  it('keeps transpiler-injected function name helpers self-contained in the generated Client bundle', () => {
    const nativeToString = Function.prototype.toString
    const transformedFactory = [
      'function persistentClientFactory() {',
      '  class Styles { static { __name(this, "Styles") } }',
      '  const helper = __name(() => 42, "helper")',
      '  return { Styles, helper }',
      '}',
    ].join('\n')
    const toStringSpy = vi.spyOn(Function.prototype, 'toString').mockImplementation(function (this: Function) {
      return this.name === 'persistentClientFactory' ? transformedFactory : nativeToString.call(this)
    })
    let rendered: string
    try {
      rendered = renderPersistentClientBundle('@example/transformed-client', {
        extensionId: 'ext_transformed', version: '1.0.0', name: 'Transformed Client',
        code: 'return { apply() {} }', apiPath: '/arkme-self/api',
      })
    } finally {
      toStringSpy.mockRestore()
    }
    let loaded: { factory: (requireModule: (id: string) => unknown) => unknown } | undefined
    runInNewContext(rendered, {
      window: { __ModuleLoader__: { load: (entry: typeof loaded) => { loaded = entry } } },
    })

    const client = loaded!.factory(() => undefined) as { Styles: { name: string }; helper: () => number }

    expect(client.Styles.name).toBe('Styles')
    expect(client.helper()).toBe(42)
  })

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
    expect(readFileSync(join(result.bundleDirectory, 'lib', 'client.js'), 'utf8')).toContain('extensions.enabled-state')
    expect(JSON.parse(readFileSync(join(result.bundleDirectory, 'activation.json'), 'utf8'))).toEqual({
      schema_version: 1, extension_id: 'ext_test', enabled: true,
    })
  })

  it('keeps an installed dependency while toggling its public Profile bundle layer', async () => {
    const { root } = fixture()
    const profileDirectory = join(root, 'profiles', 'web')
    mkdirSync(profileDirectory, { recursive: true })
    const manifestPath = join(profileDirectory, 'package.json')
    writeFileSync(manifestPath, JSON.stringify({
      dependencies: { '@arkme-local/ext-0123456789abcdef': 'link:../../bundle' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@arkme-local/ext-0123456789abcdef'] } },
    }))
    const installer = new ArkmeExtensionProfileInstaller({
      dshHome: root, profileName: 'web', execPath: process.execPath, dshBinPath: '/dsh/bin', run: vi.fn(),
    })

    await installer.setEnabled('@arkme-local/ext-0123456789abcdef', false)
    let manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.dependencies).toHaveProperty('@arkme-local/ext-0123456789abcdef')
    expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base'])

    await installer.setEnabled('@arkme-local/ext-0123456789abcdef', true)
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest
    expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@arkme-local/ext-0123456789abcdef'])
  })

  it('serializes concurrent Profile switches so one extension cannot overwrite another', async () => {
    const { root } = fixture()
    const profileDirectory = join(root, 'profiles', 'web')
    mkdirSync(profileDirectory, { recursive: true })
    const first = '@arkme-local/ext-1111111111111111'
    const second = '@arkme-local/ext-2222222222222222'
    const manifestPath = join(profileDirectory, 'package.json')
    writeFileSync(manifestPath, JSON.stringify({
      dependencies: { [first]: 'link:../../first', [second]: 'link:../../second' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', first, second] } },
    }))
    const installer = new ArkmeExtensionProfileInstaller({
      dshHome: root, profileName: 'web', execPath: process.execPath, dshBinPath: '/dsh/bin', run: vi.fn(),
    })

    await Promise.all([installer.setEnabled(first, false), installer.setEnabled(second, false)])
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base'])
  })

  it('uses the official DSH profile command for add and remove', async () => {
    const { root } = fixture()
    const run = vi.fn(async () => undefined)
    const installer = new ArkmeExtensionProfileInstaller({
      dshHome: root, profileName: 'web', execPath: process.execPath, dshBinPath: '/dsh/bin', run,
    })
    const tarball = join(root, 'bundle with spaces.tgz')
    writeFileSync(tarball, 'fixture')
    await installer.install(root)
    await installer.installTarball(tarball)
    await installer.remove('@arkme-local/ext-0123456789abcdef')
    await installer.remove('@example/install-bundle')
    expect(run).toHaveBeenNthCalledWith(1, [
      'plugin', '--profile', 'web', '--config.minimum-release-age=0', 'add', `link:${root}`,
    ])
    expect(run).toHaveBeenNthCalledWith(2, [
      'plugin', '--profile', 'web', '--config.minimum-release-age=0', 'add', tarball,
    ])
    expect(run).toHaveBeenNthCalledWith(3, [
      'plugin', '--profile', 'web', '--config.minimum-release-age=0',
      'remove', '@arkme-local/ext-0123456789abcdef',
    ])
    expect(run).toHaveBeenNthCalledWith(4, [
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
