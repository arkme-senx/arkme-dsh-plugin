import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeExtensionInstallStore } from '../../src/extensions/install-store.js'
import {
  finalizeManagedExtensionProfileRestart,
  rollbackManagedExtensionProfileRestart,
  type ArkmeExtensionProfileRestartPlan,
} from '../../src/extensions/profile-restart-helper.js'
import type { ArkmeInstalledExtension } from '../../src/extensions/types.js'

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
})
