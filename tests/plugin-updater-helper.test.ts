import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmePluginUpdateManager } from '../src/plugin-update.js'
import {
  buildTargetInstallArgs,
  finalizeManagedPluginUpdate,
  parsePluginUpdaterPlan,
  rollbackManagedPluginUpdate,
  runPluginUpdater,
} from '../src/plugin-updater-helper.js'
import { PluginUpdateInstallStateStore } from '../src/plugin-update-install-state.js'
import {
  pluginPackageTgz,
  signedPluginUpdateManifest,
} from './plugin-update-fixtures.js'

async function runtimeFixture(spec: string) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-updater-'))
  const profileDir = join(root, 'profiles', 'web')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    packageManager: 'pnpm@11.19.0',
    dependencies: { '@senguoyun/dsh-arkme': spec },
  }))
  const dshBinPath = join(root, 'dsh-bin.js')
  const helperPath = join(root, 'plugin-updater-helper.js')
  await writeFile(dshBinPath, '#!/usr/bin/env node\n')
  await writeFile(helperPath, '#!/usr/bin/env node\n')
  return { root, dshBinPath, helperPath }
}

function privateUpdateFixture(version: string) {
  const artifactBytes = pluginPackageTgz(version)
  const artifactUrl = `https://releases.jotmo.test/arkme-releases/plugin/${version}/dsh-arkme-${version}.tgz`
  const signed = signedPluginUpdateManifest({ version, artifactUrl, artifactBytes })
  const fetchImpl: typeof fetch = async input => {
    const url = String(input)
    if (url.startsWith('https://api.jotmo.cc/api/public/v1/arkme/plugin-update/latest')) {
      return new Response(JSON.stringify(signed.payload), { status: 200 })
    }
    if (url === artifactUrl) {
      return new Response(artifactBytes, {
        status: 200,
        headers: { 'Content-Length': String(artifactBytes.byteLength) },
      })
    }
    return new Response('unexpected URL', { status: 500 })
  }
  return { ...signed, artifactBytes, artifactUrl, fetchImpl }
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
        previousSpec: 'link:/Applications/Arkme.app/Contents/Resources/node_modules/@senguoyun/dsh-arkme',
        targetVersion: '0.1.4',
        targetArtifactPath: join(fixture.root, 'state', 'plugin-cache', '0.1.4', 'dsh-arkme-0.1.4.tgz'),
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
      updateTrustedPublicKey: update.publicKeyPem,
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
      },
    })

    expect((await manager.check({ manual: true })).canInstallInApp).toBe(true)
    await expect(manager.install()).resolves.toMatchObject({
      phase: 'preparing', previousVersion: '0.1.3', targetVersion: '0.1.4',
    })
    expect(spawnUpdater).toHaveBeenCalledOnce()
    expect(requestShutdown).toHaveBeenCalledOnce()
  })

  it('hands plugin updates to the desktop managed restart protocol when supervised', async () => {
    vi.useFakeTimers()
    const fixture = await runtimeFixture('link:/Applications/Arkme.app/Contents/Resources/node_modules/@senguoyun/dsh-arkme')
    const update = privateUpdateFixture('0.1.4')
    const supervisedPlanPath = join(fixture.root, 'state', 'desktop-managed-profile-restart.json')
    const runProfilePluginAdd = vi.fn(async (plan: { targetArtifactPath: string }) => {
      expect(plan.targetArtifactPath).toBe(join(fixture.root, 'state', 'plugin-cache', '0.1.4', 'dsh-arkme-0.1.4.tgz'))
    })
    const spawnUpdater = vi.fn(async () => undefined)
    const requestProcessExit = vi.fn()
    const requestShutdown = vi.fn()
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      updateTrustedPublicKey: update.publicKeyPem,
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
        supervisedExitCode: 75,
        supervisedPlanPath,
        requestProcessExit,
        runProfilePluginAdd,
      },
    })

    await manager.check({ manual: true })
    await expect(manager.install()).resolves.toMatchObject({
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
    expect(spawnUpdater).not.toHaveBeenCalled()
    expect(requestShutdown).not.toHaveBeenCalled()
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
      updateTrustedPublicKey: update.publicKeyPem,
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
      updateTrustedPublicKey: update.publicKeyPem,
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
      stateDirectory: join(root, 'state'),
      healthUrl: 'http://127.0.0.1:3080/api',
      logPath: join(root, 'update.log'),
    })

    expect(buildTargetInstallArgs(plan)).toEqual([
      '--import', 'tsx/esm', '/tmp/dsh.js',
      'plugin', '--profile', 'web', 'add', `file:${targetArtifactPath}`,
    ])
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
      updateTrustedPublicKey: update.publicKeyPem,
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
      updateTrustedPublicKey: update.publicKeyPem,
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

  it('blocks semver profile sources when no cached current artifact exists for rollback', async () => {
    const fixture = await runtimeFixture('^0.1.3')
    const update = privateUpdateFixture('0.1.4')
    const spawnUpdater = vi.fn(async () => undefined)
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      updateServiceBaseUrl: 'https://api.jotmo.cc',
      updateArtifactBaseUrl: 'https://releases.jotmo.test',
      updateTrustedPublicKey: update.publicKeyPem,
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
    await writeFile(join(profileDirectory, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.19.0' }))
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
      targetVersion: '0.1.4',
      targetArtifactPath,
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
    }
    process.env.FAKE_TRACE_PATH = tracePath
    process.env.FAKE_VERSION_PATH = versionPath
    process.env.FAKE_PID_PATH = pidPath
    let serverPid: number | undefined
    try {
      await runPluginUpdater(planPath)
      const install = await new PluginUpdateInstallStateStore(stateDirectory).read()
      expect(install).toMatchObject({ phase: 'succeeded', targetVersion: '0.1.4' })
      const trace = await readFile(tracePath, 'utf8')
      expect(trace).toContain(pathToFileURL(targetArtifactPath).href)
      expect(trace).not.toContain('@senguoyun/dsh-arkme@0.1.4')
      serverPid = Number(await readFile(pidPath, 'utf8'))

      process.kill(serverPid, 'SIGTERM')
      serverPid = undefined
      await new Promise(resolve => setTimeout(resolve, 300))
      process.env.FAKE_FAIL_VERSION = '0.1.4'
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
      const rolledBack = await new PluginUpdateInstallStateStore(stateDirectory).read()
      expect(rolledBack).toMatchObject({ phase: 'rolled-back', previousVersion: '0.1.3' })
      expect(await readFile(versionPath, 'utf8')).toBe('0.1.3')
      expect(await readFile(tracePath, 'utf8')).toContain(pathToFileURL(previousArtifactPath).href)
      serverPid = Number(await readFile(pidPath, 'utf8'))
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
    }
  }, 15_000)

  it('finalizes and rolls back plugin updates under the desktop managed restart helper', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-managed-helper-'))
    const stateDirectory = join(root, 'state')
    const targetArtifactPath = join(root, 'cache', '0.1.4', 'dsh-arkme-0.1.4.tgz')
    const previousArtifactPath = join(root, 'cache', '0.1.3', 'dsh-arkme-0.1.3.tgz')
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
      stateDirectory,
      healthUrl: 'http://127.0.0.1:3000/arkme-self/api',
      logPath: join(root, 'helper.log'),
    }))
    const waitForHealthy = vi.fn(async (plan: { healthUrl: string }, version: string) => {
      expect(plan.healthUrl).toBe('http://127.0.0.1:4123/arkme-self/api')
      expect(version).toBe('0.1.4')
      return true
    })

    await finalizeManagedPluginUpdate(planPath, 'http://127.0.0.1:4123/', { waitForHealthy })
    await expect(readFile(planPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(new PluginUpdateInstallStateStore(stateDirectory).read()).resolves.toMatchObject({
      phase: 'succeeded',
      targetVersion: '0.1.4',
    })

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
      logPath: join(root, 'helper.log'),
    }))
    const runRollbackInstall = vi.fn(() => true)
    await rollbackManagedPluginUpdate(planPath, { runRollbackInstall })
    expect(runRollbackInstall).toHaveBeenCalledOnce()
    await expect(readFile(planPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(new PluginUpdateInstallStateStore(stateDirectory).read()).resolves.toMatchObject({
      phase: 'rolled-back',
      previousVersion: '0.1.3',
    })
  })
})
