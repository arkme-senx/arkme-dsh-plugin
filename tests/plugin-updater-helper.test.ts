import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmePluginUpdateManager } from '../src/plugin-update.js'
import {
  assertTargetArtifactIntegrity,
  buildTargetInstallArgs,
  buildTargetRemoveArgs,
  finalizeManagedPluginUpdate,
  parsePluginUpdaterPlan,
  rollbackManagedPluginUpdate,
  runPluginUpdater,
} from '../src/plugin-updater-helper.js'
import { PluginUpdateInstallStateStore } from '../src/plugin-update-install-state.js'
import {
  pluginPackageTgz,
} from './plugin-update-fixtures.js'

interface PluginUpdateLogEntry {
  timestamp: string
  jobId: string
  stage: string
  previousVersion: string
  targetVersion: string
  pid: number
  durationMs?: number
  error?: string
}

async function readPluginUpdateLog(logPath: string): Promise<PluginUpdateLogEntry[]> {
  return (await readFile(logPath, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .filter(line => line.startsWith('[plugin-update] '))
    .map(line => JSON.parse(line.slice('[plugin-update] '.length)) as PluginUpdateLogEntry)
}

async function runtimeFixture(spec: string) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-updater-'))
  const profileDir = join(root, 'profiles', 'web')
  await mkdir(profileDir, { recursive: true })
  let storedSpec = spec
  if (spec.startsWith('link:/Applications/Arkme.app/')) {
    const localSource = join(root, 'current plugin source')
    await mkdir(localSource, { recursive: true })
    storedSpec = `link:${localSource}`
  }
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    packageManager: 'pnpm@11.19.0',
    dependencies: { '@senguoyun/dsh-arkme': storedSpec },
  }))
  const dshBinPath = join(root, 'dsh-bin.js')
  const helperPath = join(root, 'plugin-updater-helper.js')
  await writeFile(dshBinPath, '#!/usr/bin/env node\n')
  await writeFile(helperPath, '#!/usr/bin/env node\n')
  return { root, dshBinPath, helperPath, spec: storedSpec }
}

async function writeInstalledProfilePluginVersion(root: string, version: string) {
  const pluginDirectory = join(root, 'profiles', 'web', 'node_modules', '@senguoyun', 'dsh-arkme')
  await mkdir(pluginDirectory, { recursive: true })
  await writeFile(join(pluginDirectory, 'package.json'), JSON.stringify({
    name: '@senguoyun/dsh-arkme',
    version,
  }))
}

function privateUpdateFixture(version: string) {
  const artifactBytes = pluginPackageTgz(version)
  const artifactUrl = `https://releases.jotmo.test/arkme-releases/plugin/${version}/dsh-arkme-${version}.tgz`
  const payload = { version, releaseNotes: '自有服务器分发的插件更新', downloadUrl: artifactUrl }
  const fetchImpl: typeof fetch = async input => {
    const url = String(input)
    if (url.startsWith('https://api.jotmo.cc/api/public/v1/arkme/plugin-update/latest')) {
      return new Response(JSON.stringify(payload), { status: 200 })
    }
    if (url === artifactUrl) {
      return new Response(artifactBytes, {
        status: 200,
        headers: { 'Content-Length': String(artifactBytes.byteLength) },
      })
    }
    return new Response('unexpected URL', { status: 500 })
  }
  return { artifactBytes, artifactUrl, fetchImpl }
}

describe('companion plugin updater', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pre-downloads the private tgz and passes only a local artifact path to the helper', async () => {
    const fixture = await runtimeFixture('link:/Applications/Arkme.app/Contents/Resources/node_modules/@senguoyun/dsh-arkme')
    const update = privateUpdateFixture('0.1.4')
    const spawnUpdater = vi.fn(async (planPath: string) => {
      const plan = JSON.parse(await readFile(planPath, 'utf8')) as Record<string, unknown>
      expect(plan).toMatchObject({
        schemaVersion: 1,
        dshHome: fixture.root,
        profileName: 'web',
        previousVersion: '0.1.3',
        previousSpec: fixture.spec,
        targetVersion: '0.1.4',
        targetArtifactPath: join(fixture.root, 'state', 'plugin-cache', '0.1.4', 'dsh-arkme-0.1.4.tgz'),
        targetArtifactSha512: createHash('sha512').update(update.artifactBytes).digest('hex'),
        appVersion: '1.2.0',
        dshVersion: '0.1.0-rc.8',
        disabledProfilePackages: ['deepseek-pet'],
        execArgv: ['--import', 'tsx/esm'],
        restartArgv: ['--import', 'tsx/esm', fixture.dshBinPath, 'web', '--port', '3080'],
      })
      expect(plan).not.toHaveProperty('accessToken')
      expect(plan).not.toHaveProperty('command')
      expect(JSON.stringify(plan)).not.toContain('registry.npmjs.org')
      expect(await readFile(String(plan.targetArtifactPath))).toEqual(update.artifactBytes)
    })
    const requestShutdown = vi.fn()
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: update.fetchImpl,
      installRuntime: {
        dshHome: fixture.root,
        profileName: 'web',
        healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
        execArgv: ['--import', 'tsx/esm'],
        dshBinPath: fixture.dshBinPath,
        helperPath: fixture.helperPath,
        restartArgv: ['--import', 'tsx/esm', fixture.dshBinPath, 'web', '--port', '3080'],
        preparePackageManager: () => undefined,
        spawnUpdater,
        requestShutdown,
        disabledProfilePackages: () => ['deepseek-pet'],
      },
    })

    expect((await manager.check({ manual: true })).canInstallInApp).toBe(true)
    await expect(manager.install()).resolves.toMatchObject({
      phase: 'preparing', previousVersion: '0.1.3', targetVersion: '0.1.4',
    })
    expect(spawnUpdater).toHaveBeenCalledOnce()
    expect(requestShutdown).toHaveBeenCalledOnce()
    const lifecycle = await readPluginUpdateLog(join(fixture.root, 'state', 'plugin-update-helper.log'))
    expect(lifecycle.map(entry => entry.stage).slice(-3)).toEqual([
      'helper-spawn-started',
      'helper-spawn-completed',
      'shutdown-requested',
    ])
  })

  it('hands plugin updates to the desktop managed restart protocol when supervised', async () => {
    vi.useFakeTimers()
    const fixture = await runtimeFixture('link:/Applications/Arkme.app/Contents/Resources/node_modules/@senguoyun/dsh-arkme')
    const update = privateUpdateFixture('0.1.4')
    const supervisedPlanPath = join(fixture.root, 'state', 'desktop-managed-profile-restart.json')
    const harnessLogPath = join(fixture.root, 'logs', 'harness.log')
    const runProfilePluginAdd = vi.fn(async (plan: { targetArtifactPath: string }) => {
      expect(plan.targetArtifactPath).toBe(join(fixture.root, 'state', 'plugin-cache', '0.1.4', 'dsh-arkme-0.1.4.tgz'))
      await writeInstalledProfilePluginVersion(fixture.root, '0.1.4')
    })
    const runProfilePluginRemove = vi.fn(async () => undefined)
    const spawnUpdater = vi.fn(async () => undefined)
    const requestProcessExit = vi.fn()
    const requestShutdown = vi.fn()
    const installRuntime = {
      dshHome: fixture.root,
      profileName: 'web',
      healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
      execArgv: ['--import', 'tsx/esm'],
      dshBinPath: fixture.dshBinPath,
      helperPath: fixture.helperPath,
      restartArgv: ['--import', 'tsx/esm', fixture.dshBinPath, 'web', '--port', '3080'],
      preparePackageManager: () => undefined,
      spawnUpdater,
      requestShutdown,
      supervisedExitCode: 75,
      supervisedPlanPath,
      harnessLogPath,
      requestProcessExit,
      runProfilePluginAdd,
    }
    Object.assign(installRuntime, { runProfilePluginRemove })
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: update.fetchImpl,
      installRuntime,
    })

    await manager.check({ manual: true })
    const install = await manager.install()
    expect(install).toMatchObject({
      phase: 'restarting',
      previousVersion: '0.1.3',
      targetVersion: '0.1.4',
    })
    const plan = JSON.parse(await readFile(supervisedPlanPath, 'utf8')) as Record<string, unknown>
    expect(plan).toMatchObject({
      schemaVersion: 1,
      targetVersion: '0.1.4',
      targetArtifactPath: join(fixture.root, 'state', 'plugin-cache', '0.1.4', 'dsh-arkme-0.1.4.tgz'),
    })
    expect(runProfilePluginAdd).toHaveBeenCalledOnce()
    expect(runProfilePluginRemove).toHaveBeenCalledOnce()
    expect(spawnUpdater).not.toHaveBeenCalled()
    expect(requestShutdown).not.toHaveBeenCalled()
    const lifecycle = await readPluginUpdateLog(harnessLogPath)
    expect(lifecycle.map(entry => entry.stage)).toEqual([
      'package-manager-preflight-started',
      'package-manager-preflight-completed',
      'preparing',
      'downloading-started',
      'downloading-completed',
      'verifying-completed',
      'installing',
      'profile-remove-started',
      'profile-remove-completed',
      'profile-add-started',
      'profile-add-completed',
      'installed-version-checked',
      'restart-plan-writing',
      'restart-plan-written',
      'restarting',
      'process-exit-scheduled',
    ])
    expect(lifecycle.every(entry => entry.jobId === install.jobId)).toBe(true)
    expect(lifecycle.every(entry => entry.previousVersion === '0.1.3')).toBe(true)
    expect(lifecycle.every(entry => entry.targetVersion === '0.1.4')).toBe(true)
    expect(lifecycle.every(entry => Number.isInteger(entry.pid) && entry.pid > 0)).toBe(true)
    expect(lifecycle.every(entry => Number.isNaN(Date.parse(entry.timestamp)) === false)).toBe(true)
    await vi.advanceTimersByTimeAsync(800)
    expect(requestProcessExit).toHaveBeenCalledWith(75)
  })

  it('logs a supervised install failure and its rollback before returning failed', async () => {
    const fixture = await runtimeFixture('link:/Applications/Arkme.app/Contents/Resources/node_modules/@senguoyun/dsh-arkme')
    await writeInstalledProfilePluginVersion(fixture.root, '0.1.3')
    const update = privateUpdateFixture('0.1.4')
    const harnessLogPath = join(fixture.root, 'logs', 'harness.log')
    const runProfilePluginRemove = vi.fn(async () => undefined)
    const runProfilePluginAdd = vi.fn(async () => {
      throw new Error('profile add failed client_secret=must-not-leak')
    })
    const runProfilePluginRollback = vi.fn(async () => {
      await writeInstalledProfilePluginVersion(fixture.root, '0.1.3')
    })
    const installRuntime = {
      dshHome: fixture.root,
      profileName: 'web',
      healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
      dshBinPath: fixture.dshBinPath,
      helperPath: fixture.helperPath,
      preparePackageManager: () => undefined,
      supervisedExitCode: 75,
      supervisedPlanPath: join(fixture.root, 'state', 'desktop-managed-profile-restart.json'),
      harnessLogPath,
      runProfilePluginRemove,
      runProfilePluginAdd,
      runProfilePluginRollback,
    }
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: update.fetchImpl,
      installRuntime,
    })

    await manager.check({ manual: true })
    await expect(manager.install()).rejects.toMatchObject({ code: 'plugin-update-install-failed' })
    expect(runProfilePluginRollback).toHaveBeenCalledOnce()
    const lifecycle = await readPluginUpdateLog(harnessLogPath)
    expect(lifecycle.map(entry => entry.stage).slice(-5)).toEqual([
      'profile-add-started',
      'profile-add-failed',
      'rollback-started',
      'rollback-completed',
      'failed',
    ])
    expect(await readFile(harnessLogPath, 'utf8')).not.toContain('must-not-leak')
  })

  it('keeps a supervised update running when lifecycle logging and fallback warning both fail', async () => {
    vi.useFakeTimers()
    const fixture = await runtimeFixture('link:/Applications/Arkme.app/Contents/Resources/node_modules/@senguoyun/dsh-arkme')
    const update = privateUpdateFixture('0.1.4')
    const runProfilePluginAdd = vi.fn(async () => {
      await writeInstalledProfilePluginVersion(fixture.root, '0.1.4')
    })
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: update.fetchImpl,
      logger: { warn: () => { throw new Error('warning sink failed') } },
      installRuntime: {
        dshHome: fixture.root,
        profileName: 'web',
        healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
        dshBinPath: fixture.dshBinPath,
        helperPath: fixture.helperPath,
        preparePackageManager: () => undefined,
        supervisedExitCode: 75,
        supervisedPlanPath: join(fixture.root, 'state', 'desktop-managed-profile-restart.json'),
        harnessLogPath: fixture.root,
        requestProcessExit: vi.fn(),
        runProfilePluginRemove: async () => undefined,
        runProfilePluginAdd,
      },
    })

    await manager.check({ manual: true })
    await expect(manager.install()).resolves.toMatchObject({ phase: 'restarting' })
  })

  it('replaces an embedded link before installing a supervised tgz update', async () => {
    vi.useFakeTimers()
    const fixture = await runtimeFixture('link:/Applications/Arkme.app/Contents/Resources/node_modules/@senguoyun/dsh-arkme')
    await writeInstalledProfilePluginVersion(fixture.root, '0.1.3')
    const update = privateUpdateFixture('0.1.4')
    const supervisedPlanPath = join(fixture.root, 'state', 'desktop-managed-profile-restart.json')
    const calls: string[] = []
    const runProfilePluginRemove = vi.fn(async () => {
      calls.push('remove')
      await rm(join(fixture.root, 'profiles', 'web', 'node_modules', '@senguoyun', 'dsh-arkme'), {
        recursive: true,
        force: true,
      })
    })
    const runProfilePluginAdd = vi.fn(async () => {
      calls.push('add')
      await writeInstalledProfilePluginVersion(fixture.root, '0.1.4')
    })
    const requestProcessExit = vi.fn()
    const installRuntime = {
      dshHome: fixture.root,
      profileName: 'web',
      healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
      execArgv: ['--import', 'tsx/esm'],
      dshBinPath: fixture.dshBinPath,
      helperPath: fixture.helperPath,
      restartArgv: ['--import', 'tsx/esm', fixture.dshBinPath, 'web', '--port', '3080'],
      preparePackageManager: () => undefined,
      supervisedExitCode: 75,
      supervisedPlanPath,
      requestProcessExit,
      runProfilePluginAdd,
    }
    Object.assign(installRuntime, { runProfilePluginRemove })
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: update.fetchImpl,
      installRuntime,
    })

    await manager.check({ manual: true })
    await expect(manager.install()).resolves.toMatchObject({ phase: 'restarting', targetVersion: '0.1.4' })

    expect(calls).toEqual(['remove', 'add'])
    expect(runProfilePluginRemove).toHaveBeenCalledOnce()
    expect(runProfilePluginAdd).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(800)
    expect(requestProcessExit).toHaveBeenCalledWith(75)
  })

  it('removes a stale linked installation when the profile declares a cached file artifact', async () => {
    vi.useFakeTimers()
    const fixture = await runtimeFixture('link:/Applications/Arkme.app/Contents/Resources/node_modules/@senguoyun/dsh-arkme')
    const previousArtifactPath = join(fixture.root, 'previous', 'dsh-arkme-0.1.3.tgz')
    await mkdir(dirname(previousArtifactPath), { recursive: true })
    await writeFile(previousArtifactPath, pluginPackageTgz('0.1.3'))
    await writeFile(join(fixture.root, 'profiles', 'web', 'package.json'), JSON.stringify({
      packageManager: 'pnpm@11.19.0',
      dependencies: { '@senguoyun/dsh-arkme': `file:${previousArtifactPath}` },
    }))
    await writeInstalledProfilePluginVersion(fixture.root, '0.1.3')

    const update = privateUpdateFixture('0.1.4')
    const supervisedPlanPath = join(fixture.root, 'state', 'desktop-managed-profile-restart.json')
    const calls: string[] = []
    let removed = false
    const runProfilePluginRemove = vi.fn(async () => {
      calls.push('remove')
      removed = true
      await rm(join(fixture.root, 'profiles', 'web', 'node_modules', '@senguoyun', 'dsh-arkme'), {
        recursive: true,
        force: true,
      })
    })
    const runProfilePluginAdd = vi.fn(async () => {
      calls.push('add')
      if (removed) await writeInstalledProfilePluginVersion(fixture.root, '0.1.4')
    })
    const requestProcessExit = vi.fn()
    const installRuntime = {
      dshHome: fixture.root,
      profileName: 'web',
      healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
      execArgv: ['--import', 'tsx/esm'],
      dshBinPath: fixture.dshBinPath,
      helperPath: fixture.helperPath,
      restartArgv: ['--import', 'tsx/esm', fixture.dshBinPath, 'web', '--port', '3080'],
      preparePackageManager: () => undefined,
      supervisedExitCode: 75,
      supervisedPlanPath,
      requestProcessExit,
      runProfilePluginAdd,
    }
    Object.assign(installRuntime, { runProfilePluginRemove })
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: update.fetchImpl,
      installRuntime,
    })

    await manager.check({ manual: true })
    await expect(manager.install()).resolves.toMatchObject({ phase: 'restarting', targetVersion: '0.1.4' })

    expect(calls).toEqual(['remove', 'add'])
    expect(JSON.parse(await readFile(join(
      fixture.root,
      'profiles',
      'web',
      'node_modules',
      '@senguoyun',
      'dsh-arkme',
      'package.json',
    ), 'utf8'))).toMatchObject({ version: '0.1.4' })
    await vi.advanceTimersByTimeAsync(800)
    expect(requestProcessExit).toHaveBeenCalledWith(75)
  })

  it('treats downloading and verifying install phases as active work', async () => {
    const fixture = await runtimeFixture('link:/Applications/Arkme.app/plugin')
    const update = privateUpdateFixture('0.1.4')
    const stateDirectory = join(fixture.root, 'state')
    await new PluginUpdateInstallStateStore(stateDirectory).write({
      schemaVersion: 1,
      jobId: 'active-download',
      phase: 'downloading',
      previousVersion: '0.1.3',
      targetVersion: '0.1.4',
      message: '正在下载…',
      updatedAtMillis: Date.now(),
    })
    const spawnUpdater = vi.fn(async () => undefined)
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      intervalMs: 60_000,
      stateDirectory,
      installedVersion: '0.1.3',
      fetchImpl: update.fetchImpl,
      installRuntime: {
        dshHome: fixture.root,
        profileName: 'web',
        healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
        dshBinPath: fixture.dshBinPath,
        helperPath: fixture.helperPath,
        preparePackageManager: () => undefined,
        spawnUpdater,
      },
    })

    await manager.check({ manual: true })
    await expect(manager.install()).resolves.toMatchObject({ jobId: 'active-download', phase: 'downloading' })
    expect(spawnUpdater).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent install requests before writing the active install state', async () => {
    const fixture = await runtimeFixture('link:/Applications/Arkme.app/plugin')
    const update = privateUpdateFixture('0.1.4')
    let releaseSpawn!: () => void
    const spawnUpdater = vi.fn(async () => {
      await new Promise<void>(resolve => { releaseSpawn = resolve })
    })
    const requestShutdown = vi.fn()
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: update.fetchImpl,
      installRuntime: {
        dshHome: fixture.root,
        profileName: 'web',
        healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
        dshBinPath: fixture.dshBinPath,
        helperPath: fixture.helperPath,
        preparePackageManager: () => undefined,
        spawnUpdater,
        requestShutdown,
      },
    })

    await manager.check({ manual: true })
    const first = manager.install()
    const second = manager.install()
    await vi.waitFor(() => expect(spawnUpdater).toHaveBeenCalledOnce())
    releaseSpawn()
    const results = await Promise.all([first, second])

    expect(results[0].jobId).toBe(results[1].jobId)
    expect(spawnUpdater).toHaveBeenCalledOnce()
    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('preserves Node loader args and builds an unescaped file spec for paths with spaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh arkme plan-'))
    const targetArtifactPath = join(root, 'dsh-arkme-0.1.4.tgz')
    await writeFile(targetArtifactPath, 'tgz')
    const plan = parsePluginUpdaterPlan({
      schemaVersion: 1,
      jobId: 'job-1',
      parentPid: 123,
      execPath: process.execPath,
      execArgv: ['--import', 'tsx/esm'],
      dshBinPath: '/tmp/dsh.js',
      restartArgv: ['--import', 'tsx/esm', '/tmp/dsh.js', 'web'],
      dshHome: root,
      profileName: 'web',
      previousVersion: '0.1.3',
      previousSpec: 'link:/Applications/Arkme.app/plugin',
      targetVersion: '0.1.4',
      targetArtifactPath,
      targetArtifactSha512: createHash('sha512').update('tgz').digest('hex'),
      stateDirectory: join(root, 'state'),
      healthUrl: 'http://127.0.0.1:3080/api',
      logPath: join(root, 'update.log'),
    })

    expect(buildTargetInstallArgs(plan)).toEqual([
      '--import', 'tsx/esm', '/tmp/dsh.js',
      'plugin', '--profile', 'web', 'add', `file:${targetArtifactPath}`,
    ])
    expect(buildTargetRemoveArgs(plan)).toEqual([
      '--import', 'tsx/esm', '/tmp/dsh.js',
      'plugin', '--profile', 'web', 'remove', '@senguoyun/dsh-arkme',
    ])
    expect(() => parsePluginUpdaterPlan({
      ...plan,
      disabledProfilePackages: ['../outside-profile'],
    })).toThrow('updater plan is incomplete')
    expect(() => assertTargetArtifactIntegrity(plan)).not.toThrow()
    await writeFile(targetArtifactPath, 'tampered tgz')
    expect(() => assertTargetArtifactIntegrity(plan)).toThrow(/digest/i)
  })

  it('does not stop DSH when the Profile package manager preflight fails', async () => {
    const fixture = await runtimeFixture('link:/Applications/Arkme.app/plugin')
    const update = privateUpdateFixture('0.1.4')
    const spawnUpdater = vi.fn(async () => undefined)
    const requestShutdown = vi.fn()
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: update.fetchImpl,
      installRuntime: {
        dshHome: fixture.root,
        profileName: 'web',
        healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
        dshBinPath: fixture.dshBinPath,
        helperPath: fixture.helperPath,
        preparePackageManager: () => { throw new Error('pnpm 版本不匹配') },
        spawnUpdater,
        requestShutdown,
      },
    })

    await manager.check({ manual: true })
    await expect(manager.install()).rejects.toMatchObject({ code: 'profile-package-manager-unavailable' })
    expect(spawnUpdater).not.toHaveBeenCalled()
    expect(requestShutdown).not.toHaveBeenCalled()
  })

  it('blocks Git and remote URL profile sources because rollback must stay local', async () => {
    const fixture = await runtimeFixture('git+https://example.com/plugin.git')
    const update = privateUpdateFixture('0.1.4')
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.2',
      fetchImpl: update.fetchImpl,
      installRuntime: {
        dshHome: fixture.root,
        profileName: 'web',
        healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
        execArgv: [],
        dshBinPath: fixture.dshBinPath,
        helperPath: fixture.helperPath,
        restartArgv: [fixture.dshBinPath, 'web'],
        allowLocalInstall: true,
      },
    })

    expect(await manager.check({ manual: true })).toMatchObject({
      canInstallInApp: false, installBlockedReason: 'local-install',
    })
  })

  it('blocks a missing file source before stopping the current DSH process', async () => {
    const fixture = await runtimeFixture('file:/missing/dsh-arkme-0.1.3.tgz')
    const update = privateUpdateFixture('0.1.4')
    const requestShutdown = vi.fn()
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: update.fetchImpl,
      installRuntime: {
        dshHome: fixture.root,
        profileName: 'web',
        healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
        dshBinPath: fixture.dshBinPath,
        helperPath: fixture.helperPath,
        allowLocalInstall: true,
        requestShutdown,
      },
    })

    expect(await manager.check({ manual: true })).toMatchObject({
      canInstallInApp: false,
      installBlockedReason: 'local-install',
    })
    await expect(manager.install()).rejects.toMatchObject({ code: 'plugin-update-install-unavailable' })
    expect(requestShutdown).not.toHaveBeenCalled()
  })

  it('blocks semver profile sources when no cached current artifact exists for rollback', async () => {
    const fixture = await runtimeFixture('^0.1.3')
    const update = privateUpdateFixture('0.1.4')
    const spawnUpdater = vi.fn(async () => undefined)
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: update.fetchImpl,
      installRuntime: {
        dshHome: fixture.root,
        profileName: 'web',
        healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
        execArgv: [],
        dshBinPath: fixture.dshBinPath,
        helperPath: fixture.helperPath,
        restartArgv: [fixture.dshBinPath, 'web'],
        preparePackageManager: () => undefined,
        spawnUpdater,
      },
    })

    expect(await manager.check({ manual: true })).toMatchObject({
      availability: 'available',
      canInstallInApp: false,
      installBlockedReason: 'local-install',
    })
    await expect(manager.install()).rejects.toMatchObject({
      code: 'plugin-update-install-unavailable',
    })
    expect(spawnUpdater).not.toHaveBeenCalled()
  })

  it('installs through file: tgz, restarts, and rolls back from the previous local artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-updater-integration-'))
    const fakeDsh = join(root, 'fake-dsh.mjs')
    const tracePath = join(root, 'trace.log')
    const versionPath = join(root, 'version.txt')
    const pidPath = join(root, 'server.pid')
    const stateDirectory = join(root, 'state')
    await mkdir(stateDirectory, { recursive: true })
    const profileDirectory = join(root, 'profiles', 'web')
    await mkdir(profileDirectory, { recursive: true })
    await writeFile(join(profileDirectory, 'package.json'), JSON.stringify({
      packageManager: 'pnpm@11.19.0',
      dependencies: { '@senguoyun/dsh-arkme': 'file:current.tgz', 'deepseek-pet': '1.0.0' },
      dsh: { profile: { bundles: ['@senguoyun/dsh-arkme'] } },
    }))
    await writeFile(versionPath, '0.1.3')
    await writeFile(fakeDsh, `
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(process.env.FAKE_TRACE_PATH, JSON.stringify(args) + '\\n')
if (args[0] === 'plugin') {
  const spec = args.at(-1)
  const path = spec.startsWith('file:') ? fileURLToPath(spec) : spec
  const version = path.includes('0.1.4') ? '0.1.4' : '0.1.3'
  if (version === process.env.FAKE_FAIL_VERSION) process.exit(1)
  writeFileSync(process.env.FAKE_VERSION_PATH, version)
  const packageDir = join(process.env.DSH_HOME, 'profiles', 'web', 'node_modules', '@senguoyun', 'dsh-arkme')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: '@senguoyun/dsh-arkme', version }))
  const profilePath = join(process.env.DSH_HOME, 'profiles', 'web', 'package.json')
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
  profile.dsh.profile.bundles = version === process.env.FAKE_INVALID_POLICY_VERSION
    ? null
    : Object.keys(profile.dependencies)
  writeFileSync(profilePath, JSON.stringify(profile))
  process.exit(0)
}
if (args[0] === 'web') {
  const port = Number(args[args.indexOf('--port') + 1])
  writeFileSync(process.env.FAKE_PID_PATH, String(process.pid))
  createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      const version = readFileSync(process.env.FAKE_VERSION_PATH, 'utf8').trim()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, value: { installedVersion: version } }))
    })
  }).listen(port, '127.0.0.1')
}
`)
    const targetArtifactPath = join(root, 'cache', '0.1.4', 'dsh-arkme-0.1.4.tgz')
    const previousArtifactPath = join(root, 'cache', '0.1.3', 'dsh-arkme-0.1.3.tgz')
    await mkdir(resolve(targetArtifactPath, '..'), { recursive: true })
    await mkdir(resolve(previousArtifactPath, '..'), { recursive: true })
    await writeFile(targetArtifactPath, 'target tgz')
    await writeFile(previousArtifactPath, 'previous tgz')
    const probe = createServer()
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
    const address = probe.address()
    if (address === null || typeof address === 'string') throw new Error('failed to allocate test port')
    const port = address.port
    await new Promise<void>((resolve, reject) => probe.close(error => error === undefined ? resolve() : reject(error)))
    const deadParent = spawn(process.execPath, ['-e', ''])
    const deadParentPid = deadParent.pid
    if (deadParentPid === undefined) throw new Error('missing dead parent pid')
    await new Promise<void>((resolve, reject) => {
      deadParent.once('exit', () => resolve())
      deadParent.once('error', reject)
    })
    const planPath = join(root, 'plan.json')
    const plan = {
      schemaVersion: 1,
      jobId: 'integration-job',
      parentPid: deadParentPid,
      execPath: process.execPath,
      execArgv: [],
      dshBinPath: fakeDsh,
      restartArgv: [fakeDsh, 'web', '--port', String(port)],
      dshHome: root,
      profileName: 'web',
      previousVersion: '0.1.3',
      previousSpec: 'link:/Applications/Arkme.app/plugin',
      previousArtifactPath,
      disabledProfilePackages: ['deepseek-pet'],
      targetVersion: '0.1.4',
      targetArtifactPath,
      targetArtifactSha512: createHash('sha512').update('target tgz').digest('hex'),
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      stateDirectory,
      healthUrl: `http://127.0.0.1:${String(port)}/arkme-self/api`,
      logPath: join(root, 'helper.log'),
    }
    await writeFile(planPath, JSON.stringify(plan))
    const previousEnv = {
      trace: process.env.FAKE_TRACE_PATH,
      version: process.env.FAKE_VERSION_PATH,
      pid: process.env.FAKE_PID_PATH,
      fail: process.env.FAKE_FAIL_VERSION,
      invalidPolicy: process.env.FAKE_INVALID_POLICY_VERSION,
    }
    process.env.FAKE_TRACE_PATH = tracePath
    process.env.FAKE_VERSION_PATH = versionPath
    process.env.FAKE_PID_PATH = pidPath
    let serverPid: number | undefined
    try {
      await runPluginUpdater(planPath)
      serverPid = Number(await readFile(pidPath, 'utf8'))
      const install = await new PluginUpdateInstallStateStore(stateDirectory).read()
      expect(install).toMatchObject({ phase: 'succeeded', targetVersion: '0.1.4' })
      const trace = (await readFile(tracePath, 'utf8')).trim().split(/\r?\n/)
        .map(line => JSON.parse(line) as string[])
      const profileCommands = trace.filter(args => args[0] === 'plugin')
      expect(profileCommands[0]).toEqual([
        'plugin', '--profile', 'web', 'remove', '@senguoyun/dsh-arkme',
      ])
      expect(profileCommands[1]).toEqual([
        'plugin', '--profile', 'web', 'add', `file:${targetArtifactPath}`,
      ])
      expect(trace.some(args => args.includes(`file:${targetArtifactPath}`))).toBe(true)
      expect(trace.flat()).not.toContain('@senguoyun/dsh-arkme@0.1.4')
      const converged = JSON.parse(await readFile(join(profileDirectory, 'package.json'), 'utf8')) as {
        dsh: { profile: { bundles: string[] } }
      }
      expect(converged.dsh.profile.bundles).not.toContain('deepseek-pet')

      process.kill(serverPid, 'SIGTERM')
      serverPid = undefined
      await new Promise(resolve => setTimeout(resolve, 300))
      process.env.FAKE_FAIL_VERSION = '0.1.4'
      process.env.FAKE_INVALID_POLICY_VERSION = '0.1.3'
      const rollbackParent = spawn(process.execPath, ['-e', ''])
      const rollbackParentPid = rollbackParent.pid
      if (rollbackParentPid === undefined) throw new Error('missing rollback parent pid')
      await new Promise<void>((resolve, reject) => {
        rollbackParent.once('exit', () => resolve())
        rollbackParent.once('error', reject)
      })
      const rollbackPlanPath = join(root, 'rollback-plan.json')
      await writeFile(rollbackPlanPath, JSON.stringify({
        ...plan,
        jobId: 'rollback-job',
        parentPid: rollbackParentPid,
      }))
      await runPluginUpdater(rollbackPlanPath)
      serverPid = Number(await readFile(pidPath, 'utf8'))
      const rolledBack = await new PluginUpdateInstallStateStore(stateDirectory).read()
      expect(rolledBack).toMatchObject({ phase: 'rolled-back', previousVersion: '0.1.3' })
      expect(rolledBack?.message).toContain('部分已关闭扩展的 Profile 状态未能收敛')
      expect(await readFile(versionPath, 'utf8')).toBe('0.1.3')
      const rollbackTrace = (await readFile(tracePath, 'utf8')).trim().split(/\r?\n/)
        .map(line => JSON.parse(line) as string[])
      const rollbackProfileCommands = rollbackTrace.filter(args => args[0] === 'plugin')
      expect(rollbackProfileCommands.slice(-2)).toEqual([
        ['plugin', '--profile', 'web', 'remove', '@senguoyun/dsh-arkme'],
        ['plugin', '--profile', 'web', 'add', `file:${previousArtifactPath}`],
      ])
      expect(rollbackTrace.some(args => args.includes(`file:${previousArtifactPath}`))).toBe(true)
      const rolledBackProfile = JSON.parse(await readFile(join(profileDirectory, 'package.json'), 'utf8')) as {
        dsh: { profile: { bundles: string[] | null } }
      }
      expect(rolledBackProfile.dsh.profile.bundles).toBeNull()
    } finally {
      if (serverPid !== undefined && Number.isSafeInteger(serverPid)) {
        try { process.kill(serverPid, 'SIGTERM') } catch { /* already stopped */ }
      }
      if (previousEnv.trace === undefined) delete process.env.FAKE_TRACE_PATH
      else process.env.FAKE_TRACE_PATH = previousEnv.trace
      if (previousEnv.version === undefined) delete process.env.FAKE_VERSION_PATH
      else process.env.FAKE_VERSION_PATH = previousEnv.version
      if (previousEnv.pid === undefined) delete process.env.FAKE_PID_PATH
      else process.env.FAKE_PID_PATH = previousEnv.pid
      if (previousEnv.fail === undefined) delete process.env.FAKE_FAIL_VERSION
      else process.env.FAKE_FAIL_VERSION = previousEnv.fail
      if (previousEnv.invalidPolicy === undefined) delete process.env.FAKE_INVALID_POLICY_VERSION
      else process.env.FAKE_INVALID_POLICY_VERSION = previousEnv.invalidPolicy
    }
  }, 15_000)

  it('migrates a legacy managed plan into a durable receipt on first fixed-version update', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-legacy-plan-'))
    const stateDirectory = join(root, 'state')
    const targetArtifactPath = join(root, 'cache', '0.1.4', 'dsh-arkme-0.1.4.tgz')
    const dshBinPath = join(root, 'dsh', 'lib', 'bin.js')
    await mkdir(dirname(targetArtifactPath), { recursive: true })
    await mkdir(dirname(dshBinPath), { recursive: true })
    await writeFile(targetArtifactPath, 'target tgz')
    await writeFile(dshBinPath, '')
    await writeFile(join(root, 'dsh', 'package.json'), JSON.stringify({ version: '0.1.0-rc.8' }))
    const planPath = join(root, 'managed-plan.json')
    await writeFile(planPath, JSON.stringify({
      schemaVersion: 1,
      jobId: 'legacy-managed-plan',
      parentPid: process.pid,
      execPath: process.execPath,
      execArgv: [],
      dshBinPath,
      restartArgv: [dshBinPath, 'web'],
      dshHome: root,
      profileName: 'web',
      previousVersion: '0.1.3',
      previousSpec: 'file:/previous.tgz',
      targetVersion: '0.1.4',
      targetArtifactPath,
      stateDirectory,
      healthUrl: 'http://127.0.0.1:3000/arkme-self/api',
      logPath: join(root, 'helper.log'),
    }))
    const previousAppVersion = process.env.ARKME_APP_VERSION
    process.env.ARKME_APP_VERSION = '1.2.0'
    try {
      await finalizeManagedPluginUpdate(planPath, 'http://127.0.0.1:4123/', {
        waitForHealthy: async () => true,
      })
    } finally {
      if (previousAppVersion === undefined) delete process.env.ARKME_APP_VERSION
      else process.env.ARKME_APP_VERSION = previousAppVersion
    }

    await expect(readFile(planPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(
      join(dirname(targetArtifactPath), 'plugin-update-install-receipt.json'),
      'utf8',
    )).resolves.toContain(createHash('sha512').update('target tgz').digest('hex'))
    await expect(new PluginUpdateInstallStateStore(stateDirectory).read()).resolves.toMatchObject({
      phase: 'succeeded',
      targetArtifactSha512: createHash('sha512').update('target tgz').digest('hex'),
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
    })
  })

  it('does not publish succeeded or delete the plan when receipt persistence fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-managed-receipt-failure-'))
    const stateDirectory = join(root, 'state')
    const targetArtifactPath = join(root, 'cache', '0.1.4', 'dsh-arkme-0.1.4.tgz')
    const harnessLogPath = join(root, 'harness.log')
    await mkdir(dirname(targetArtifactPath), { recursive: true })
    await writeFile(targetArtifactPath, 'target tgz')
    const planPath = join(root, 'managed-plan.json')
    await writeFile(planPath, JSON.stringify({
      schemaVersion: 1,
      jobId: 'managed-receipt-failure',
      parentPid: process.pid,
      execPath: process.execPath,
      execArgv: [],
      dshBinPath: join(root, 'dsh-bin.js'),
      restartArgv: [join(root, 'dsh-bin.js'), 'web'],
      dshHome: root,
      profileName: 'web',
      previousVersion: '0.1.3',
      previousSpec: 'file:/previous.tgz',
      targetVersion: '0.1.4',
      targetArtifactPath,
      targetArtifactSha512: createHash('sha512').update('target tgz').digest('hex'),
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      stateDirectory,
      healthUrl: 'http://127.0.0.1:3000/arkme-self/api',
      logPath: harnessLogPath,
    }))
    const store = new PluginUpdateInstallStateStore(stateDirectory)
    await store.write({
      schemaVersion: 1,
      jobId: 'managed-receipt-failure',
      phase: 'restarting',
      previousVersion: '0.1.3',
      targetVersion: '0.1.4',
      message: 'restarting',
      updatedAtMillis: Date.now(),
    })

    await expect(finalizeManagedPluginUpdate(planPath, 'http://127.0.0.1:4123/', {
      waitForHealthy: async () => true,
      writeInstallReceipt: async () => { throw new Error('disk full') },
    })).rejects.toThrow('disk full')
    await expect(store.read()).resolves.toMatchObject({ phase: 'restarting' })
    await expect(readFile(planPath, 'utf8')).resolves.toContain('managed-receipt-failure')
    const lifecycle = await readPluginUpdateLog(harnessLogPath)
    expect(lifecycle.map(entry => entry.stage)).toEqual([
      'artifact-verification-started',
      'artifact-verification-completed',
      'replacement-health-check-started',
      'replacement-health-check-passed',
      'artifact-reverification-started',
      'artifact-reverification-completed',
      'receipt-writing',
      'receipt-write-failed',
    ])
    expect(lifecycle.at(-1)).toMatchObject({
      jobId: 'managed-receipt-failure',
      error: 'disk full',
    })
  })

  it('keeps managed finalization running when lifecycle logging and stderr fallback both fail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-managed-log-failure-'))
    const targetArtifactPath = join(root, 'cache', '0.1.4', 'dsh-arkme-0.1.4.tgz')
    await mkdir(dirname(targetArtifactPath), { recursive: true })
    await writeFile(targetArtifactPath, 'target tgz')
    const planPath = join(root, 'managed-plan.json')
    await writeFile(planPath, JSON.stringify({
      schemaVersion: 1,
      jobId: 'managed-log-failure',
      parentPid: process.pid,
      execPath: process.execPath,
      execArgv: [],
      dshBinPath: join(root, 'dsh-bin.js'),
      restartArgv: [join(root, 'dsh-bin.js'), 'web'],
      dshHome: root,
      profileName: 'web',
      previousVersion: '0.1.3',
      previousSpec: 'file:/previous.tgz',
      targetVersion: '0.1.4',
      targetArtifactPath,
      targetArtifactSha512: createHash('sha512').update('target tgz').digest('hex'),
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      stateDirectory: join(root, 'state'),
      healthUrl: 'http://127.0.0.1:3000/arkme-self/api',
      logPath: root,
    }))
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => {
      throw new Error('stderr failed')
    })
    try {
      await expect(finalizeManagedPluginUpdate(planPath, 'http://127.0.0.1:4123/', {
        waitForHealthy: async () => true,
        writeInstallReceipt: async () => undefined,
      })).resolves.toBeUndefined()
    } finally {
      stderr.mockRestore()
    }
  })

  it('finalizes and rolls back plugin updates under the desktop managed restart helper', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-managed-helper-'))
    const stateDirectory = join(root, 'state')
    const targetArtifactPath = join(root, 'cache', '0.1.4', 'dsh-arkme-0.1.4.tgz')
    const previousArtifactPath = join(root, 'cache', '0.1.3', 'dsh-arkme-0.1.3.tgz')
    const harnessLogPath = join(root, 'harness.log')
    await mkdir(resolve(targetArtifactPath, '..'), { recursive: true })
    await mkdir(resolve(previousArtifactPath, '..'), { recursive: true })
    await writeFile(targetArtifactPath, 'target tgz')
    await writeFile(previousArtifactPath, 'previous tgz')
    const planPath = join(root, 'managed-plan.json')
    await writeFile(planPath, JSON.stringify({
      schemaVersion: 1,
      jobId: 'managed-job',
      parentPid: process.pid,
      execPath: process.execPath,
      execArgv: [],
      dshBinPath: join(root, 'dsh-bin.js'),
      restartArgv: [join(root, 'dsh-bin.js'), 'web'],
      dshHome: root,
      profileName: 'web',
      previousVersion: '0.1.3',
      previousSpec: 'file:/previous.tgz',
      previousArtifactPath,
      targetVersion: '0.1.4',
      targetArtifactPath,
      targetArtifactSha512: createHash('sha512').update('target tgz').digest('hex'),
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
      stateDirectory,
      healthUrl: 'http://127.0.0.1:3000/arkme-self/api',
      logPath: harnessLogPath,
    }))
    const waitForHealthy = vi.fn(async (plan: { healthUrl: string }, version: string) => {
      expect(plan.healthUrl).toBe('http://127.0.0.1:4123/arkme-self/api')
      expect(version).toBe('0.1.4')
      return true
    })

    await finalizeManagedPluginUpdate(planPath, 'http://127.0.0.1:4123/', { waitForHealthy })
    await expect(readFile(planPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const receipt = JSON.parse(await readFile(
      join(dirname(targetArtifactPath), 'plugin-update-install-receipt.json'),
      'utf8',
    )) as unknown
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      packageName: '@senguoyun/dsh-arkme',
      targetVersion: '0.1.4',
      targetArtifactPath,
      targetArtifactSha512: createHash('sha512').update('target tgz').digest('hex'),
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
    })
    await expect(new PluginUpdateInstallStateStore(stateDirectory).read()).resolves.toMatchObject({
      phase: 'succeeded',
      targetVersion: '0.1.4',
      targetArtifactPath,
      targetArtifactSha512: createHash('sha512').update('target tgz').digest('hex'),
      appVersion: '1.2.0',
      dshVersion: '0.1.0-rc.8',
    })
    expect((await readPluginUpdateLog(harnessLogPath)).map(entry => entry.stage)).toEqual([
      'artifact-verification-started',
      'artifact-verification-completed',
      'replacement-health-check-started',
      'replacement-health-check-passed',
      'artifact-reverification-started',
      'artifact-reverification-completed',
      'receipt-writing',
      'receipt-written',
      'succeeded',
    ])

    await writeFile(planPath, JSON.stringify({
      schemaVersion: 1,
      jobId: 'managed-rollback',
      parentPid: process.pid,
      execPath: process.execPath,
      execArgv: [],
      dshBinPath: join(root, 'dsh-bin.js'),
      restartArgv: [join(root, 'dsh-bin.js'), 'web'],
      dshHome: root,
      profileName: 'web',
      previousVersion: '0.1.3',
      previousSpec: 'file:/previous.tgz',
      previousArtifactPath,
      targetVersion: '0.1.4',
      targetArtifactPath,
      stateDirectory,
      healthUrl: 'http://127.0.0.1:3000/arkme-self/api',
      logPath: harnessLogPath,
    }))
    const runRollbackInstall = vi.fn(() => ({ packageRestored: true, profilePolicyRestored: false }))
    await rollbackManagedPluginUpdate(planPath, { runRollbackInstall })
    expect(runRollbackInstall).toHaveBeenCalledOnce()
    await expect(readFile(planPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(new PluginUpdateInstallStateStore(stateDirectory).read()).resolves.toMatchObject({
      phase: 'rolled-back',
      previousVersion: '0.1.3',
      message: expect.stringContaining('部分已关闭扩展的 Profile 状态未能收敛'),
    })
    const rollbackLifecycle = (await readPluginUpdateLog(harnessLogPath))
      .filter(entry => entry.jobId === 'managed-rollback')
    expect(rollbackLifecycle.map(entry => entry.stage)).toEqual([
      'rollback-started',
      'rollback-completed',
      'rolled-back',
    ])
  })
})
