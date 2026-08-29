import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeExtensionInstallStore } from '../../src/extensions/install-store.js'
import {
  extensionProfileRollbackArgs,
  finalizeManagedExtensionProfileRestart,
  parseExtensionProfileRestartPlan,
  rollbackManagedExtensionProfileRestart,
  type ArkmeExtensionProfileRestartPlan,
} from '../../src/extensions/profile-restart-helper.js'
import type { ArkmeInstalledExtension } from '../../src/extensions/types.js'

function v2Plan() {
  return {
    schemaVersion: 2,
    parentPid: 123,
    execPath: '/runtime/node',
    dshBinPath: '/runtime/dsh/bin.js',
    execArgv: [],
    restartArgv: ['/runtime/dsh/bin.js', '--profile', 'web'],
    dshHome: '/isolated/dsh home',
    profileName: 'web',
    packageName: '@example/install-bundle',
    extensionId: 'ext-bundle',
    expectActive: true,
    targetBundlePath: '/isolated/artifacts/new bundle.tgz',
    previousBundlePath: '/isolated/artifacts/old bundle.tgz',
    cleanupPaths: [],
    installStoreDirectory: '/isolated/state',
    healthUrl: 'http://127.0.0.1:39123/arkme-self/api',
    logPath: '/isolated/state/restart.log',
  }
}

describe('Bundle v2 profile restart plan', () => {
  it('accepts a real package name and restores the previous tgz without link conversion', () => {
    const parsed = parseExtensionProfileRestartPlan(v2Plan())
    expect(parsed.schemaVersion).toBe(2)
    expect(extensionProfileRollbackArgs(parsed)).toEqual(['add', '/isolated/artifacts/old bundle.tgz'])
  })

  it('preserves a valid Release Set identity and rejects a forged identity', () => {
    const runtimeReleaseId = 'electron-runtime-v1-0123456789abcdef0123456789abcdef'
    expect(parseExtensionProfileRestartPlan({ ...v2Plan(), runtimeReleaseId })).toMatchObject({ runtimeReleaseId })
    expect(() => parseExtensionProfileRestartPlan({ ...v2Plan(), runtimeReleaseId: 'release-old' }))
      .toThrow('extension restart plan is incomplete')
  })

  it('removes the exact package when a first installation has no previous tgz', () => {
    const parsed = parseExtensionProfileRestartPlan({ ...v2Plan(), previousBundlePath: undefined })
    expect(extensionProfileRollbackArgs(parsed)).toEqual(['remove', '@example/install-bundle'])
  })

  it('accepts an activation-only restart with an explicit previous Profile projection', () => {
    const previousInstalled = installed('ext-bundle', '/isolated/artifacts/bundle.tgz', '/isolated/artifacts/bundle.tgz')
    const parsed = parseExtensionProfileRestartPlan({
      ...v2Plan(), schemaVersion: 3, activationChange: true, previousProfileIncluded: true, previousInstalled,
      expectActive: false,
    })
    expect(parsed).toMatchObject({
      schemaVersion: 3, activationChange: true, previousProfileIncluded: true, expectActive: false,
    })
    expect(() => extensionProfileRollbackArgs(parsed)).toThrow('does not use DSH plugin commands')
  })

  it('accepts a desktop quarantine re-enable without an install-store record', () => {
    const parsed = parseExtensionProfileRestartPlan({
      ...v2Plan(),
      schemaVersion: 4,
      activationChange: true,
      desktopQuarantineActivation: true,
      previousProfileIncluded: false,
      previousInstalled: undefined,
      extensionId: 'desktop-quarantine:@example/local-extension',
      packageName: '@example/local-extension',
    })

    expect(parsed).toMatchObject({
      schemaVersion: 4,
      activationChange: true,
      desktopQuarantineActivation: true,
      previousProfileIncluded: false,
    })
  })
})

const directories: string[] = []
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})

function installed(extensionId: string, bundlePath: string, artifactPath: string): ArkmeInstalledExtension {
  return {
    extensionId,
    installedVersion: '1.0.0',
    artifactSha256: 'a'.repeat(64),
    artifactPath,
    manifest: {
      format: 'arkme-cordis-extension', format_version: 1, name: 'fixture', description: '', version: '1.0.0',
      runtime: { dsh: '*', arkme_provider_contract: 1 }, halves: { host: true, client: false },
      permissions: [], entrypoints: { host: 'host.js' },
    },
    enabled: true,
    active: true,
    profilePackageName: '@arkme-local/ext-0123456789abcdef',
    profileBundlePath: bundlePath,
    permissionSnapshot: [], updateChannel: 'stable', installedAtMillis: 1, lastCheckedAtMillis: 1,
  }
}

async function fixture(input: { previousInstalled?: ArkmeInstalledExtension; expectActive?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arkme-managed-profile-restart-'))
  directories.push(root)
  const planPath = join(root, 'restart.json')
  const plan: ArkmeExtensionProfileRestartPlan = {
    schemaVersion: 1,
    parentPid: process.pid,
    execPath: process.execPath,
    dshBinPath: '/fixture/dsh.js',
    execArgv: [],
    restartArgv: ['dsh', 'web'],
    dshHome: root,
    profileName: 'web',
    packageName: '@arkme-local/ext-0123456789abcdef',
    extensionId: 'ext-test',
    expectActive: input.expectActive ?? true,
    cleanupPaths: [],
    installStoreDirectory: join(root, 'extensions'),
    ...(input.previousInstalled === undefined ? {} : {
      previousInstalled: input.previousInstalled,
      previousBundlePath: input.previousInstalled.profileBundlePath,
    }),
    healthUrl: 'http://127.0.0.1:41234/arkme-self/api',
    logPath: join(root, 'restart.log'),
  }
  await writeFile(planPath, JSON.stringify(plan), { mode: 0o600 })
  return { plan, planPath, root }
}

describe('desktop-managed extension profile restart', () => {
  it('validates the replacement before removing superseded update artifacts', async () => {
    const { plan, planPath, root } = await fixture()
    const oldBundle = join(root, 'profiles', 'old-bundle')
    const oldArtifact = join(root, 'extensions', 'old.arkext')
    await mkdir(oldBundle, { recursive: true })
    await mkdir(join(root, 'extensions'), { recursive: true })
    await writeFile(oldArtifact, 'old')
    await writeFile(planPath, JSON.stringify({ ...plan, cleanupPaths: [oldBundle, oldArtifact] }), { mode: 0o600 })
    const isHealthy = vi.fn(async () => true)

    await finalizeManagedExtensionProfileRestart(
      planPath,
      'http://127.0.0.1:51234/arkme-self/api',
      { isHealthy },
    )

    expect(isHealthy).toHaveBeenCalledWith(expect.objectContaining({
      healthUrl: 'http://127.0.0.1:51234/arkme-self/api',
    }))
    await expect(stat(oldBundle)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(oldArtifact)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(planPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the plan and artifacts when replacement validation fails', async () => {
    const { plan, planPath, root } = await fixture()
    const oldBundle = join(root, 'profiles', 'old-bundle')
    await mkdir(oldBundle, { recursive: true })
    await writeFile(planPath, JSON.stringify({ ...plan, cleanupPaths: [oldBundle] }), { mode: 0o600 })

    await expect(finalizeManagedExtensionProfileRestart(
      planPath,
      'http://127.0.0.1:51234/',
      { isHealthy: async () => false },
    )).rejects.toThrow('did not become healthy')

    await expect(stat(planPath)).resolves.toBeDefined()
    await expect(stat(oldBundle)).resolves.toBeDefined()
  })

  it('rolls a failed first install out of the profile and install store without spawning DSH', async () => {
    const { plan, planPath } = await fixture()
    const current = installed(plan.extensionId, '/bundle/new', '/artifact/new')
    const store = new ArkmeExtensionInstallStore(plan.installStoreDirectory)
    store.put(current)
    store.close()
    const profileCommand = vi.fn(() => true)
    const start = vi.fn()

    await rollbackManagedExtensionProfileRestart(planPath, { profileCommand, start })

    expect(profileCommand).toHaveBeenCalledWith(plan, ['remove', plan.packageName])
    expect(start).not.toHaveBeenCalled()
    await expect(stat(planPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const reopened = new ArkmeExtensionInstallStore(plan.installStoreDirectory)
    expect(reopened.get(plan.extensionId)).toBeUndefined()
    reopened.close()
  })

  it('restores the previous update or uninstall record as inactive without spawning DSH', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-managed-profile-previous-'))
    directories.push(root)
    const previous = installed('ext-test', join(root, 'old-bundle'), join(root, 'old.arkext'))
    const { plan, planPath } = await fixture({ previousInstalled: previous, expectActive: false })
    const current = installed(plan.extensionId, '/bundle/new', '/artifact/new')
    const store = new ArkmeExtensionInstallStore(plan.installStoreDirectory)
    store.put(current)
    store.close()
    const profileCommand = vi.fn(() => true)
    const start = vi.fn()

    await rollbackManagedExtensionProfileRestart(planPath, { profileCommand, start })

    expect(profileCommand).toHaveBeenCalledWith(plan, ['add', `link:${previous.profileBundlePath}`])
    expect(start).not.toHaveBeenCalled()
    await expect(stat(planPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const reopened = new ArkmeExtensionInstallStore(plan.installStoreDirectory)
    expect(reopened.get(plan.extensionId)).toMatchObject({
      artifactPath: previous.artifactPath,
      profileBundlePath: previous.profileBundlePath,
      active: false,
    })
    reopened.close()
  })

  it('rolls an activation-only restart back to its previous Bundle projection without a DSH plugin command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-managed-profile-activation-'))
    directories.push(root)
    const profileDirectory = join(root, 'profiles', 'web')
    await mkdir(profileDirectory, { recursive: true })
    const previous = installed('ext-test', join(root, 'bundle.tgz'), join(root, 'bundle.tgz'))
    await writeFile(join(profileDirectory, 'package.json'), JSON.stringify({
      dependencies: { [previous.profilePackageName!]: '1.0.0' },
      dsh: { profile: { bundles: [] } },
    }))
    const planPath = join(root, 'restart.json')
    const plan: ArkmeExtensionProfileRestartPlan = {
      schemaVersion: 3,
      parentPid: process.pid,
      execPath: process.execPath,
      dshBinPath: '/fixture/dsh.js',
      execArgv: [],
      restartArgv: ['dsh', 'web'],
      dshHome: root,
      profileName: 'web',
      packageName: previous.profilePackageName!,
      extensionId: previous.extensionId,
      expectActive: false,
      cleanupPaths: [],
      installStoreDirectory: join(root, 'extensions'),
      previousInstalled: previous,
      activationChange: true,
      previousProfileIncluded: true,
      healthUrl: 'http://127.0.0.1:41234/arkme-self/api',
      logPath: join(root, 'restart.log'),
    }
    await writeFile(planPath, JSON.stringify(plan), { mode: 0o600 })
    const current = { ...previous, enabled: false, active: false }
    const store = new ArkmeExtensionInstallStore(plan.installStoreDirectory)
    store.put(current)
    store.close()
    const profileCommand = vi.fn(() => true)
    const start = vi.fn()

    await rollbackManagedExtensionProfileRestart(planPath, { profileCommand, start })

    expect(profileCommand).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    const manifest = JSON.parse(await readFile(join(profileDirectory, 'package.json'), 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.dsh.profile.bundles).toEqual([previous.profilePackageName])
    const reopened = new ArkmeExtensionInstallStore(plan.installStoreDirectory)
    expect(reopened.get(plan.extensionId)).toMatchObject({ enabled: true, active: false })
    reopened.close()
  })

  it('rolls a failed desktop quarantine re-enable back out of the Profile without requiring install metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-managed-profile-quarantine-'))
    directories.push(root)
    const profileDirectory = join(root, 'profiles', 'web')
    await mkdir(profileDirectory, { recursive: true })
    await writeFile(join(profileDirectory, 'package.json'), JSON.stringify({
      dependencies: { '@example/local-extension': 'link:../../local-extension' },
      dsh: { profile: { bundles: ['@example/local-extension'] } },
    }))
    const planPath = join(root, 'restart.json')
    const plan: ArkmeExtensionProfileRestartPlan = {
      schemaVersion: 4,
      parentPid: process.pid,
      execPath: process.execPath,
      dshBinPath: '/fixture/dsh.js',
      execArgv: [],
      restartArgv: ['dsh', 'web'],
      dshHome: root,
      profileName: 'web',
      packageName: '@example/local-extension',
      extensionId: 'desktop-quarantine:@example/local-extension',
      expectActive: true,
      cleanupPaths: [],
      installStoreDirectory: join(root, 'extensions'),
      activationChange: true,
      desktopQuarantineActivation: true,
      previousProfileIncluded: false,
      healthUrl: 'http://127.0.0.1:41234/arkme-self/api',
      logPath: join(root, 'restart.log'),
    }
    await writeFile(planPath, JSON.stringify(plan), { mode: 0o600 })
    const profileCommand = vi.fn(() => true)

    await rollbackManagedExtensionProfileRestart(planPath, { profileCommand })

    expect(profileCommand).not.toHaveBeenCalled()
    const manifest = JSON.parse(await readFile(join(profileDirectory, 'package.json'), 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.dsh.profile.bundles).toEqual([])
  })
})
