import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { packArkmeExtension } from '../../src/extensions/artifact.js'
import {
  renderArkmeBundleClientBundle, renderPersistentClientBundle,
} from '../../src/extensions/persistent-client-bundle.js'
import {
  materializePersistentExtensionBundle, quarantinePersistentExtension,
  readPersistentExtensionActivation, writePersistentExtensionActivation,
} from '../../src/extensions/persistent-bundle.js'
import {
  ArkmeExtensionProfileInstaller,
  profilePluginCommandErrorDetail,
} from '../../src/extensions/profile-installer.js'
import type { ArkmeInstalledExtension } from '../../src/extensions/types.js'
import { expectPrivatePath } from '../helpers/private-path.js'

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

  it('disposes a mounted stale Client when the Host rejects its runtime version', async () => {
    const requests: Array<{ operation: string; params: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (_input: string, init: { body?: string }) => {
      const request = JSON.parse(init.body ?? '{}') as { operation: string; params: Record<string, unknown> }
      requests.push(request)
      if (request.operation === 'extensions.persistent.client-state') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            value: { mount: true, extension_id: 'ext_stale', instance_key: 'instance-stale', generation: 1 },
          }),
        }
      }
      return {
        ok: false,
        status: 409,
        json: async () => ({
          ok: false,
          error: { code: 'extension-runtime-unavailable', message: '插件不可用，请重启 DSH 后重试' },
        }),
      }
    })
    const rendered = renderPersistentClientBundle('@example/stale-client', {
      extensionId: 'ext_stale', version: '1.0.0', name: 'Stale Client',
      code: 'return { apply() { return host.call("read").catch(() => undefined) } }',
      apiPath: '/arkme-self/api',
    })
    let loaded: { factory: (requireModule: (id: string) => unknown) => unknown } | undefined
    runInNewContext(rendered, {
      window: { __ModuleLoader__: { load: (entry: typeof loaded) => { loaded = entry } } },
      document: { createElement: vi.fn(), head: { append: vi.fn() } },
      fetch: fetchImpl,
      console,
    })
    const dispose = vi.fn(async () => undefined)
    const childContext = { fiber: { inject: {} }, get: vi.fn(() => undefined) }
    const outerContext = {
      effect: vi.fn(),
      plugin: vi.fn((plugin: { apply(ctx: unknown): unknown }) => Object.assign(
        Promise.resolve(plugin.apply(childContext)),
        { dispose },
      )),
    }

    await (loaded!.factory(() => ({})) as { apply(ctx: unknown): Promise<void> }).apply(outerContext)

    expect(requests).toEqual([
      { operation: 'extensions.persistent.client-state', params: { extensionId: 'ext_stale', version: '1.0.0' } },
      { operation: 'extensions.persistent.invoke', params: { extensionId: 'ext_stale', version: '1.0.0', method: 'read', args: null } },
    ])
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('isolates a Client slot collision and reports only that extension as unavailable', async () => {
    const requests: Array<{ operation: string; params: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (_input: string, init: { body?: string }) => {
      const request = JSON.parse(init.body ?? '{}') as { operation: string; params: Record<string, unknown> }
      requests.push(request)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          value: request.operation === 'extensions.persistent.client-state'
            ? { mount: true, extension_id: 'ext_colliding', instance_key: 'instance-colliding', generation: 1 }
            : { handled: true },
        }),
      }
    })
    const rendered = renderPersistentClientBundle('@example/colliding-client', {
      extensionId: 'ext_colliding', version: '1.0.0', name: 'Colliding Client',
      code: 'return { apply() {} }', apiPath: '/arkme-self/api',
    })
    let loaded: { factory: (requireModule: (id: string) => unknown) => unknown } | undefined
    runInNewContext(rendered, {
      window: { __ModuleLoader__: { load: (entry: typeof loaded) => { loaded = entry } } },
      document: { createElement: vi.fn(), head: { append: vi.fn() } },
      fetch: fetchImpl,
      console,
    })
    const dispose = vi.fn(async () => undefined)
    const outerContext = {
      effect: vi.fn(),
      plugin: vi.fn(() => Object.assign(
        Promise.reject(new Error('list slot "shell.overlay" already has an entry with id "snake-floating"')),
        { dispose },
      )),
    }

    await expect((loaded!.factory(() => ({})) as { apply(ctx: unknown): Promise<void> }).apply(outerContext))
      .resolves.toBeUndefined()
    await vi.waitFor(() => expect(requests.some(request => request.operation === 'extensions.client.failure')).toBe(true))

    expect(dispose).toHaveBeenCalledOnce()
    expect(requests.find(request => request.operation === 'extensions.client.failure')?.params).toMatchObject({
      identityKey: 'extensionId',
      extensionId: 'ext_colliding',
      version: '1.0.0',
      kind: 'runtime-load-failed',
      message: 'list slot "shell.overlay" already has an entry with id "snake-floating"',
      clientInstanceKey: 'instance-colliding',
      clientContentDigest: expect.stringMatching(/^client-v1-[a-f0-9]{64}$/),
    })
  })

  it('lets a newer Client instance replace an older lease and prevents the stale instance from reclaiming it', async () => {
    const entries = new Map<string, { factory: (requireModule: (id: string) => unknown) => unknown }>()
    const context = {
      window: { __ModuleLoader__: { load: (entry: { id: string; factory: (requireModule: (id: string) => unknown) => unknown }) => entries.set(entry.id, entry) } },
      document: { createElement: vi.fn(), head: { append: vi.fn() } },
      fetch: vi.fn(async (_input: string, init: { body?: string }) => {
        const request = JSON.parse(init.body ?? '{}') as { operation: string }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            value: request.operation === 'extensions.bundle.client-state'
              ? { mount: true, extension_id: 'ext_managed', instance_key: 'instance-old', generation: 1 }
              : request.operation === 'extensions.persistent.client-state'
                ? { mount: true, extension_id: 'ext_managed', instance_key: 'instance-current', generation: 2 }
                : {},
          }),
        }
      }),
      console,
    }
    runInNewContext(renderArkmeBundleClientBundle('dsh-snake-draggable', {
      version: '1.1.2', name: 'Local snake', code: 'return { apply() { return "old" } }', apiPath: '/arkme-self/api',
    }), context)
    runInNewContext(renderPersistentClientBundle('@arkme-local/ext-managed', {
      extensionId: 'ext_managed', version: '2.0.0', name: 'Managed snake',
      code: 'return { apply() { return "current" } }', apiPath: '/arkme-self/api',
    }), context)
    const localDispose = vi.fn(async () => undefined)
    const managedDispose = vi.fn(async () => undefined)
    const childContext = { fiber: { inject: {} }, get: vi.fn(() => undefined) }
    const cordisContext = (dispose: ReturnType<typeof vi.fn>) => ({
      effect: vi.fn(),
      plugin: vi.fn((plugin: { apply(ctx: unknown): unknown }) => Object.assign(
        Promise.resolve(plugin.apply(childContext)),
        { dispose },
      )),
    })

    await (entries.get('dsh-snake-draggable')!.factory(() => ({})) as { apply(ctx: unknown): Promise<void> })
      .apply(cordisContext(localDispose))
    await (entries.get('@arkme-local/ext-managed')!.factory(() => ({})) as { apply(ctx: unknown): Promise<void> })
      .apply(cordisContext(managedDispose))
    const lateOldPlugin = vi.fn()
    await (entries.get('dsh-snake-draggable')!.factory(() => ({})) as { apply(ctx: unknown): Promise<void> })
      .apply({ effect: vi.fn(), plugin: lateOldPlugin })

    expect(localDispose).toHaveBeenCalledOnce()
    expect(managedDispose).not.toHaveBeenCalled()
    expect(lateOldPlugin).not.toHaveBeenCalled()
  })

  it('skips a second mount of the same extension instance without disabling it', async () => {
    const entries = new Map<string, { factory: (requireModule: (id: string) => unknown) => unknown }>()
    const requests: Array<{ operation: string }> = []
    const context = {
      window: { __ModuleLoader__: { load: (entry: { id: string; factory: (requireModule: (id: string) => unknown) => unknown }) => entries.set(entry.id, entry) } },
      document: { createElement: vi.fn(), head: { append: vi.fn() } },
      fetch: vi.fn(async (_input: string, init: { body?: string }) => {
        const request = JSON.parse(init.body ?? '{}') as { operation: string }
        requests.push({ operation: request.operation })
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            value: {
              mount: true,
              extension_id: 'ext_same',
              instance_key: 'instance-same',
              generation: 7,
            },
          }),
        }
      }),
      console,
    }
    for (const packageName of ['@example/same-a', '@example/same-b']) {
      runInNewContext(renderArkmeBundleClientBundle(packageName, {
        version: '1.0.0', name: packageName, code: 'return { apply() {} }', apiPath: '/arkme-self/api',
      }), context)
    }
    const childContext = { fiber: { inject: {} }, get: vi.fn(() => undefined) }
    const firstPlugin = vi.fn((plugin: { apply(ctx: unknown): unknown }) => Object.assign(
      Promise.resolve(plugin.apply(childContext)),
      { dispose: vi.fn() },
    ))
    const secondPlugin = vi.fn()

    await (entries.get('@example/same-a')!.factory(() => ({})) as { apply(ctx: unknown): Promise<void> })
      .apply({ effect: vi.fn(), plugin: firstPlugin })
    await (entries.get('@example/same-b')!.factory(() => ({})) as { apply(ctx: unknown): Promise<void> })
      .apply({ effect: vi.fn(), plugin: secondPlugin })

    expect(firstPlugin).toHaveBeenCalledOnce()
    expect(secondPlugin).not.toHaveBeenCalled()
    expect(requests).toEqual([
      { operation: 'extensions.bundle.client-state' },
      { operation: 'extensions.bundle.client-state' },
    ])
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
      name: string
      exports: Record<string, string>
      dsh: {
        bundle: { patch: string }
        arkme?: { clientContentDigest?: string }
        client?: { inject: string[] }
      }
    }
    expect(manifest.name).toMatch(/^@arkme-local\/ext-[a-f0-9]{16}$/)
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.arkme).toMatchObject({
      clientContentDigest: expect.stringMatching(/^client-v1-[a-f0-9]{64}$/),
    })
    expect(manifest.dsh.client?.inject).toEqual([])
    expect(manifest.exports['./package.json']).toBe('./package.json')
    expect(readFileSync(join(result.bundleDirectory, 'cordis.patch.yml'), 'utf8')).toContain(manifest.name)
    expect(readFileSync(join(result.bundleDirectory, 'lib', 'index.js'), 'utf8')).toContain('applyPersistentArkmeHostExtension')
    expect(readFileSync(join(result.bundleDirectory, 'lib', 'client.js'), 'utf8')).toContain('extensions.persistent.invoke')
    expect(readFileSync(join(result.bundleDirectory, 'lib', 'client.js'), 'utf8')).toContain('extensions.persistent.client-state')
    expect(readFileSync(join(result.bundleDirectory, 'lib', 'client.js'), 'utf8')).toContain('"wrapperVersion":3')
    expect(readFileSync(join(result.bundleDirectory, 'lib', 'client.js'), 'utf8')).toContain('version: spec.version')
    expect(JSON.parse(readFileSync(join(result.bundleDirectory, 'activation.json'), 'utf8'))).toEqual({
      schema_version: 1, extension_id: 'ext_test', enabled: true,
    })
  })

  it('persists runtime quarantine atomically and clears it only on an explicit enable', () => {
    const { root, artifact, artifactPath } = fixture()
    const result = materializePersistentExtensionBundle({
      profileDirectory: root,
      artifactPath,
      trustedPublicKey: 'public-key',
      clientCode: 'return { apply() {} }',
      resolution: {
        extension_id: 'ext_quarantine', version: '1.0.0', artifact_url: 'https://objects.test/a',
        artifact_size: artifact.bytes.byteLength, artifact_sha256: artifact.artifactSha256,
        manifest_sha256: artifact.manifestSha256, manifest: artifact.manifest,
        signature: 'signature', signing_key_id: 'key-1', published_at: 1_787_000_000_000, revoked: false,
      },
    })
    const installationUrl = pathToFileURL(result.installationPath)

    quarantinePersistentExtension(result.bundleDirectory, 'ext_quarantine', new Error('BROKEN_HOST'), 123)
    expect(readPersistentExtensionActivation(installationUrl)).toEqual({
      schema_version: 1,
      extension_id: 'ext_quarantine',
      enabled: false,
      quarantine: { code: 'runtime-load-failed', failed_at_millis: 123, message: 'BROKEN_HOST' },
    })

    writePersistentExtensionActivation(result.bundleDirectory, 'ext_quarantine', true)
    expect(readPersistentExtensionActivation(installationUrl)).toEqual({
      schema_version: 1, extension_id: 'ext_quarantine', enabled: true,
    })
  })

  it('regenerates a legacy Client wrapper that cannot verify its installed version', () => {
    const { root, artifact, artifactPath } = fixture()
    const input = {
      profileDirectory: root,
      artifactPath,
      trustedPublicKey: 'public-key',
      clientCode: 'return { apply() {} }',
      resolution: {
        extension_id: 'ext_wrapper_upgrade', version: '1.0.0', artifact_url: 'https://objects.test/a',
        artifact_size: artifact.bytes.byteLength, artifact_sha256: artifact.artifactSha256,
        manifest_sha256: artifact.manifestSha256, manifest: artifact.manifest,
        signature: 'signature', signing_key_id: 'key-1', published_at: 1_787_000_000_000, revoked: false,
      },
    }
    const first = materializePersistentExtensionBundle(input)
    writeFileSync(join(first.bundleDirectory, 'lib', 'client.js'), 'extensions.persistent.invoke')

    const regenerated = materializePersistentExtensionBundle(input)

    expect(regenerated.bundleDirectory).toBe(first.bundleDirectory)
    expect(readFileSync(join(regenerated.bundleDirectory, 'lib', 'client.js'), 'utf8'))
      .toContain('extensions.persistent.client-state')
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
    await installer.removeMany(['dsh-snake-draggable', '@example/duplicate'])
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
    expect(run).toHaveBeenNthCalledWith(5, [
      'plugin', '--profile', 'web', '--config.minimum-release-age=0',
      'remove', 'dsh-snake-draggable', '@example/duplicate',
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

  it('hands a supervised restart back to the desktop process instead of spawning a replacement', async () => {
    vi.useFakeTimers()
    try {
      const { root } = fixture()
      const standaloneRestart = vi.fn(async () => undefined)
      const standaloneShutdown = vi.fn()
      const requestProcessExit = vi.fn()
      const supervisedPlanPath = join(root, 'custom-managed-state', 'desktop-managed-extension-restart.json')
      const previousInstalled = {
        extensionId: 'ext-test', installedVersion: '0.9.0', artifactSha256: 'a'.repeat(64),
        artifactPath: join(root, 'old.arkext'),
        manifest: {
          format: 'arkme-cordis-extension', format_version: 1, name: 'old', description: '', version: '0.9.0',
          runtime: { dsh: '*', arkme_provider_contract: 1 }, halves: { host: true, client: false },
          permissions: [], entrypoints: { host: 'host.js' },
        },
        enabled: true, active: true, permissionSnapshot: [], updateChannel: 'stable',
        installedAtMillis: 1, lastCheckedAtMillis: 1,
      } satisfies ArkmeInstalledExtension
      const installer = new ArkmeExtensionProfileInstaller({
        dshHome: root,
        profileName: 'web',
        execPath: process.execPath,
        dshBinPath: '/dsh/bin',
        stateDirectory: root,
        healthUrl: 'http://127.0.0.1:41234/arkme-self/api',
        restartArgv: ['dsh', 'web'],
        helperPath: '/extension-profile-restart-helper.js',
        installStoreDirectory: root,
        restart: standaloneRestart,
        requestShutdown: standaloneShutdown,
        supervisedExitCode: 75,
        supervisedPlanPath,
        requestProcessExit,
      })

      await installer.restart({
        extensionId: 'ext-test',
        packageName: '@arkme-local/ext-0123456789abcdef',
        targetBundlePath: join(root, 'new-bundle'),
        previousBundlePath: join(root, 'old-bundle'),
        cleanupPaths: [join(root, 'old-bundle'), join(root, 'old.arkext')],
        previousInstalled,
        expectActive: true,
      })
      await vi.advanceTimersByTimeAsync(800)

      expect(standaloneRestart).not.toHaveBeenCalled()
      expect(standaloneShutdown).not.toHaveBeenCalled()
      expect(requestProcessExit).toHaveBeenCalledWith(75)
      expectPrivatePath(supervisedPlanPath, 0o600)
      expect(JSON.parse(readFileSync(supervisedPlanPath, 'utf8'))).toMatchObject({
        extensionId: 'ext-test',
        packageName: '@arkme-local/ext-0123456789abcdef',
        expectActive: true,
        installStoreDirectory: root,
        targetBundlePath: join(root, 'new-bundle'),
        previousBundlePath: join(root, 'old-bundle'),
        cleanupPaths: [join(root, 'old-bundle'), join(root, 'old.arkext')],
        previousInstalled,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
