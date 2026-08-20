import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArkmePluginUpdateManager } from '../src/plugin-update.js'
import { buildTargetInstallArgs, parsePluginUpdaterPlan, runPluginUpdater } from '../src/plugin-updater-helper.js'
import { PluginUpdateInstallStateStore } from '../src/plugin-update-install-state.js'

function response(version: string): Response {
  return new Response(JSON.stringify({ name: '@senguoyun/dsh-arkme', version }), { status: 200 })
}

async function runtimeFixture(spec: string) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-updater-'))
  const profileDir = join(root, 'profiles', 'web')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    dependencies: { '@senguoyun/dsh-arkme': spec },
  }))
  const dshBinPath = join(root, 'dsh-bin.js')
  const helperPath = join(root, 'plugin-updater-helper.js')
  await writeFile(dshBinPath, '#!/usr/bin/env node\n')
  await writeFile(helperPath, '#!/usr/bin/env node\n')
  return { root, dshBinPath, helperPath }
}

describe('companion plugin updater', () => {
  it('enables in-app install only for Registry-backed profile dependencies', async () => {
    const fixture = await runtimeFixture('^0.1.3')
    const spawnUpdater = vi.fn(async (planPath: string) => {
      const plan = JSON.parse(await readFile(planPath, 'utf8')) as Record<string, unknown>
      expect(plan).toMatchObject({
        schemaVersion: 1,
        dshHome: fixture.root,
        profileName: 'web',
        previousVersion: '0.1.3',
        previousSpec: '^0.1.3',
        targetVersion: '0.1.4',
        execArgv: ['--import', 'tsx/esm'],
        restartArgv: ['--import', 'tsx/esm', fixture.dshBinPath, 'web', '--port', '3080'],
      })
      expect(plan).not.toHaveProperty('accessToken')
      expect(plan).not.toHaveProperty('command')
    })
    const requestShutdown = vi.fn()
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      registryUrl: 'https://registry.npmjs.org',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: async () => response('0.1.4'),
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

  it('preserves the current Node loader arguments in the default updater plan', async () => {
    const fixture = await runtimeFixture('0.1.3')
    const spawnUpdater = vi.fn(async (planPath: string) => {
      const plan = JSON.parse(await readFile(planPath, 'utf8')) as {
        execArgv: string[]
        restartArgv: string[]
      }
      expect(plan.execArgv).toEqual(process.execArgv)
      expect(plan.restartArgv).toEqual([...process.execArgv, ...process.argv.slice(1)])
    })
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      registryUrl: 'https://registry.npmjs.org',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: async () => response('0.1.4'),
      installRuntime: {
        dshHome: fixture.root,
        profileName: 'web',
        healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
        dshBinPath: fixture.dshBinPath,
        helperPath: fixture.helperPath,
        preparePackageManager: () => undefined,
        spawnUpdater,
        requestShutdown: () => undefined,
      },
    })

    await manager.check({ manual: true })
    await manager.install()
    expect(spawnUpdater).toHaveBeenCalledOnce()
  })

  it('shows in-app update for a local link without modifying the checkout', async () => {
    const fixture = await runtimeFixture('link:/tmp/plugin-checkout')
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      registryUrl: 'https://registry.npmjs.org',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: async () => response('0.1.4'),
      installRuntime: {
        dshHome: fixture.root,
        profileName: 'web',
        healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
        execArgv: [],
        dshBinPath: fixture.dshBinPath,
        helperPath: fixture.helperPath,
        restartArgv: [fixture.dshBinPath, 'web'],
      },
    })

    const status = await manager.check({ manual: true })
    expect(status).toMatchObject({ canInstallInApp: true })
    expect(status).not.toHaveProperty('installBlockedReason')
  })

  it('does not stop DSH when the Profile package manager preflight fails', async () => {
    const fixture = await runtimeFixture('0.1.3')
    const spawnUpdater = vi.fn(async () => undefined)
    const requestShutdown = vi.fn()
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      registryUrl: 'https://registry.npmjs.org',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.3',
      fetchImpl: async () => response('0.1.4'),
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

  it('allows an explicit local override to hide in-app update', async () => {
    const fixture = await runtimeFixture('link:/tmp/plugin-checkout')
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      registryUrl: 'https://registry.npmjs.org',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.2',
      fetchImpl: async () => response('0.1.3'),
      installRuntime: {
        dshHome: fixture.root,
        profileName: 'web',
        healthUrl: 'http://127.0.0.1:3080/arkme-self/api',
        execArgv: [],
        dshBinPath: fixture.dshBinPath,
        helperPath: fixture.helperPath,
        restartArgv: [fixture.dshBinPath, 'web'],
        allowLocalInstall: false,
        spawnUpdater: async () => undefined,
        requestShutdown: () => undefined,
      },
    })

    expect(await manager.check({ manual: true })).toMatchObject({
      installedVersion: '0.1.2', latestVersion: '0.1.3', canInstallInApp: false,
      installBlockedReason: 'local-install',
    })
  })

  it('still blocks Git and URL profile sources', async () => {
    const fixture = await runtimeFixture('git+https://example.com/plugin.git')
    const manager = new ArkmePluginUpdateManager({
      enabled: true,
      channel: 'stable',
      registryUrl: 'https://registry.npmjs.org',
      intervalMs: 60_000,
      stateDirectory: join(fixture.root, 'state'),
      installedVersion: '0.1.2',
      fetchImpl: async () => response('0.1.3'),
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

  it('rejects updater plans that can reach non-loopback health endpoints', () => {
    const base = {
      schemaVersion: 1,
      jobId: 'job-1',
      parentPid: 123,
      execPath: '/usr/bin/node',
      execArgv: ['--import', 'tsx/esm'],
      dshBinPath: '/tmp/dsh.js',
      restartArgv: ['--import', 'tsx/esm', '/tmp/dsh.js', 'web'],
      dshHome: '/tmp/dsh-home',
      profileName: 'web',
      previousVersion: '0.1.3',
      previousSpec: '0.1.3',
      targetVersion: '0.1.4',
      stateDirectory: '/tmp/state',
      logPath: '/tmp/update.log',
    }
    expect(() => parsePluginUpdaterPlan({ ...base, healthUrl: 'https://example.com/api' }))
      .toThrow(/loopback/)
    expect(() => parsePluginUpdaterPlan({
      ...base, execArgv: undefined, healthUrl: 'http://127.0.0.1:3080/api',
    }))
      .toThrow(/incomplete/)
    expect(parsePluginUpdaterPlan({ ...base, healthUrl: 'http://127.0.0.1:3080/api' }).targetVersion)
      .toBe('0.1.4')
    expect(buildTargetInstallArgs(parsePluginUpdaterPlan({
      ...base,
      healthUrl: 'http://127.0.0.1:3080/api',
    }))).toEqual([
      '--import', 'tsx/esm', '/tmp/dsh.js',
      'plugin', '--profile', 'web', 'add', '@senguoyun/dsh-arkme@0.1.4',
    ])
    expect(buildTargetInstallArgs(parsePluginUpdaterPlan({
      ...base,
      previousSpec: 'link:/tmp/plugin',
      healthUrl: 'http://127.0.0.1:3080/api',
    }))).toEqual([
      '--import', 'tsx/esm', '/tmp/dsh.js',
      'plugin', '--profile', 'web', 'add', '@senguoyun/dsh-arkme@0.1.4',
    ])
  })

  it('installs through the fixed DSH CLI, restarts, and proves the target version healthy', async () => {
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
import { createServer } from 'node:http'
import { join } from 'node:path'
const args = process.argv.slice(2)
appendFileSync(process.env.FAKE_TRACE_PATH, JSON.stringify(args) + '\\n')
if (args[0] === 'plugin') {
  const spec = args.find(value => value.startsWith('@senguoyun/dsh-arkme@'))
  const version = spec === undefined ? process.env.FAKE_LATEST_VERSION : spec.slice('@senguoyun/dsh-arkme@'.length)
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
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const version = readFileSync(process.env.FAKE_VERSION_PATH, 'utf8').trim()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, value: { installedVersion: version } }))
    })
  }).listen(port, '127.0.0.1')
}
`)
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
      previousSpec: '0.1.3',
      targetVersion: '0.1.4',
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
      latest: process.env.FAKE_LATEST_VERSION,
    }
    process.env.FAKE_TRACE_PATH = tracePath
    process.env.FAKE_VERSION_PATH = versionPath
    process.env.FAKE_PID_PATH = pidPath
    process.env.FAKE_LATEST_VERSION = '0.1.4'
    let serverPid: number | undefined
    try {
      await runPluginUpdater(planPath)
      const install = await new PluginUpdateInstallStateStore(stateDirectory).read()
      expect(install).toMatchObject({ phase: 'succeeded', targetVersion: '0.1.4' })
      const trace = await readFile(tracePath, 'utf8')
      expect(trace).toContain('"plugin","--profile","web","add","@senguoyun/dsh-arkme@0.1.4"')
      expect(trace).toContain(`"web","--port","${String(port)}"`)
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
      if (previousEnv.latest === undefined) delete process.env.FAKE_LATEST_VERSION
      else process.env.FAKE_LATEST_VERSION = previousEnv.latest
    }
  }, 15_000)
})
