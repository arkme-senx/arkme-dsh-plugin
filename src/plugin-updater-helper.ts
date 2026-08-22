import { closeSync, existsSync, openSync, readFileSync } from 'node:fs'
import { readFile, unlink } from 'node:fs/promises'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isAbsolute, join, resolve } from 'node:path'
import semver from 'semver'
import { PluginUpdateInstallStateStore } from './plugin-update-install-state.js'
import { prepareProfilePackageManager } from './profile-package-manager.js'
import type { ArkmePluginUpdateInstallPhase, ArkmePluginUpdateInstallSnapshot } from './types.js'

const PARENT_EXIT_TIMEOUT_MS = 20_000
const HEALTH_TIMEOUT_MS = 45_000

export interface PluginUpdaterPlan {
  schemaVersion: 1
  jobId: string
  parentPid: number
  execPath: string
  execArgv: string[]
  dshBinPath: string
  restartArgv: string[]
  dshHome: string
  profileName: string
  previousVersion: string
  previousSpec: string
  targetVersion: string
  targetArtifactPath: string
  previousArtifactPath?: string
  stateDirectory: string
  healthUrl: string
  logPath: string
}

function nonEmptyString(value: unknown, maxLength = 4096): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized !== '' && normalized.length <= maxLength ? normalized : undefined
}

function stringArray(value: unknown, options: { allowEmpty?: boolean } = {}): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result = value.map(item => nonEmptyString(item))
  if (result.some(item => item === undefined) || (!options.allowEmpty && result.length === 0)) return undefined
  return result as string[]
}

export function parsePluginUpdaterPlan(value: unknown): PluginUpdaterPlan {
  if (value === null || typeof value !== 'object') throw new Error('updater plan must be an object')
  const source = value as Record<string, unknown>
  const jobId = nonEmptyString(source.jobId, 128)
  const execPath = nonEmptyString(source.execPath)
  const execArgv = stringArray(source.execArgv, { allowEmpty: true })
  const dshBinPath = nonEmptyString(source.dshBinPath)
  const dshHome = nonEmptyString(source.dshHome)
  const profileName = nonEmptyString(source.profileName, 64)
  const previousVersion = nonEmptyString(source.previousVersion, 128)
  const previousSpec = nonEmptyString(source.previousSpec, 4096)
  const targetVersion = nonEmptyString(source.targetVersion, 128)
  const targetArtifactPath = nonEmptyString(source.targetArtifactPath, 4096)
  const previousArtifactPath = nonEmptyString(source.previousArtifactPath, 4096)
  const stateDirectory = nonEmptyString(source.stateDirectory)
  const healthUrl = nonEmptyString(source.healthUrl)
  const logPath = nonEmptyString(source.logPath)
  const restartArgv = stringArray(source.restartArgv)
  if (source.schemaVersion !== 1 || jobId === undefined || execPath === undefined || execArgv === undefined
    || dshBinPath === undefined
    || dshHome === undefined || profileName === undefined || previousVersion === undefined
    || previousSpec === undefined || targetVersion === undefined || targetArtifactPath === undefined
    || stateDirectory === undefined || healthUrl === undefined
    || logPath === undefined || restartArgv === undefined || source.parentPid === undefined
    || typeof source.parentPid !== 'number' || !Number.isSafeInteger(source.parentPid) || source.parentPid <= 0) {
    throw new Error('updater plan is incomplete')
  }
  if (!isAbsolute(targetArtifactPath) || !existsSync(targetArtifactPath)
    || (previousArtifactPath !== undefined && (!isAbsolute(previousArtifactPath) || !existsSync(previousArtifactPath)))) {
    throw new Error('updater plan artifact paths must be existing absolute files')
  }
  const url = new URL(healthUrl)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('updater health URL must be loopback HTTP')
  }
  return {
    schemaVersion: 1,
    jobId,
    parentPid: source.parentPid,
    execPath,
    execArgv,
    dshBinPath,
    restartArgv,
    dshHome,
    profileName,
    previousVersion,
    previousSpec,
    targetVersion,
    targetArtifactPath,
    ...(previousArtifactPath === undefined ? {} : { previousArtifactPath }),
    stateDirectory,
    healthUrl: url.toString(),
    logPath,
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (processAlive(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200))
  return !processAlive(pid)
}

function isLocalPackageSpec(spec: string): boolean {
  return /^(?:link:|file:)/.test(spec)
}

export function buildTargetInstallArgs(plan: PluginUpdaterPlan): string[] {
  return [
    ...plan.execArgv,
    plan.dshBinPath,
    'plugin',
    '--profile',
    plan.profileName,
    'add',
    `file:${plan.targetArtifactPath}`,
  ]
}

function runTargetInstall(plan: PluginUpdaterPlan): boolean {
  const result = spawnSync(plan.execPath, buildTargetInstallArgs(plan), {
    env: { ...process.env, DSH_HOME: plan.dshHome },
    stdio: 'inherit',
    shell: false,
  })
  return result.status === 0
}

function runRollbackInstall(plan: PluginUpdaterPlan): boolean {
  const fallbackSpec = plan.previousArtifactPath === undefined
    ? plan.previousSpec
    : `file:${plan.previousArtifactPath}`
  if (plan.previousArtifactPath === undefined && !isLocalPackageSpec(fallbackSpec)) return false
  const args = [...plan.execArgv, plan.dshBinPath, 'plugin', '--profile', plan.profileName, 'add', fallbackSpec]
  const result = spawnSync(plan.execPath, args, {
    env: { ...process.env, DSH_HOME: plan.dshHome },
    stdio: 'inherit',
    shell: false,
  })
  return result.status === 0
}

function installedProfileVersion(plan: PluginUpdaterPlan): string {
  try {
    const manifest = JSON.parse(readFileSync(join(
      plan.dshHome,
      'profiles',
      plan.profileName,
      'node_modules',
      '@senguoyun',
      'dsh-arkme',
      'package.json',
    ), 'utf8')) as { version?: string }
    return manifest.version ?? ''
  } catch {
    return ''
  }
}

function restartDsh(plan: PluginUpdaterPlan): ChildProcess {
  const child = spawn(plan.execPath, plan.restartArgv, {
    detached: true,
    env: { ...process.env, DSH_HOME: plan.dshHome },
    stdio: 'inherit',
    shell: false,
  })
  child.unref()
  return child
}

async function waitForHealthy(plan: PluginUpdaterPlan, expectedVersion: string): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    const installedVersion = installedProfileVersion(plan)
    try {
      const response = await fetch(plan.healthUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: new URL(plan.healthUrl).origin },
        body: JSON.stringify({ operation: 'plugin.update.status' }),
        signal: AbortSignal.timeout(2_000),
      })
      if (response.ok) {
        const body = await response.json() as { ok?: boolean, value?: { installedVersion?: string } }
        if (body.ok === true && body.value?.installedVersion === expectedVersion) return true
      }
    } catch { /* The old process is down or the new process is still booting. */ }
    if (installedVersion === expectedVersion) {
      try {
        const root = await fetch(new URL('/', plan.healthUrl), { signal: AbortSignal.timeout(2_000) })
        if (root.ok) return true
      } catch { /* DSH has not started listening yet. */ }
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return false
}

export interface ManagedPluginUpdateOperations {
  runRollbackInstall: typeof runRollbackInstall
  waitForHealthy: typeof waitForHealthy
}

function managedOperations(overrides: Partial<ManagedPluginUpdateOperations>): ManagedPluginUpdateOperations {
  return { runRollbackInstall, waitForHealthy, ...overrides }
}

function planWithReplacementHealthUrl(plan: PluginUpdaterPlan, replacementUrl: string): PluginUpdaterPlan {
  const replacement = new URL(replacementUrl)
  if (replacement.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(replacement.hostname)) {
    throw new Error('managed plugin update replacement URL must be loopback HTTP')
  }
  const health = new URL(plan.healthUrl)
  health.protocol = replacement.protocol
  health.hostname = replacement.hostname
  health.port = replacement.port
  return { ...plan, healthUrl: health.toString() }
}

async function writePhase(
  store: PluginUpdateInstallStateStore,
  plan: PluginUpdaterPlan,
  phase: ArkmePluginUpdateInstallPhase,
  message: string,
): Promise<ArkmePluginUpdateInstallSnapshot> {
  const snapshot: ArkmePluginUpdateInstallSnapshot = {
    schemaVersion: 1,
    jobId: plan.jobId,
    phase,
    previousVersion: plan.previousVersion,
    targetVersion: plan.targetVersion,
    message,
    updatedAtMillis: Date.now(),
  }
  await store.write(snapshot)
  return snapshot
}

async function rollbackAndRestart(
  plan: PluginUpdaterPlan,
  store: PluginUpdateInstallStateStore,
  rolledBackMessage: string,
): Promise<void> {
  const rolledBack = runRollbackInstall(plan)
  if (!rolledBack) {
    await writePhase(store, plan, 'failed', '更新失败，旧版本恢复也失败；请使用更新命令手动修复。')
    return
  }
  restartDsh(plan)
  const healthy = await waitForHealthy(plan, plan.previousVersion)
  await writePhase(
    store,
    plan,
    healthy ? 'rolled-back' : 'failed',
    healthy ? rolledBackMessage : '已恢复旧版本文件，但 DSH 未能自动启动。',
  )
}

export async function runPluginUpdater(planPath: string): Promise<void> {
  const plan = parsePluginUpdaterPlan(JSON.parse(await readFile(planPath, 'utf8')) as unknown)
  await unlink(planPath).catch(() => undefined)
  const store = new PluginUpdateInstallStateStore(plan.stateDirectory)
  if (!await waitForProcessExit(plan.parentPid, PARENT_EXIT_TIMEOUT_MS)) {
    await writePhase(store, plan, 'failed', '旧 DSH 进程未能退出，更新已取消。')
    return
  }

  try {
    prepareProfilePackageManager(plan.dshHome, plan.profileName)
  } catch (error) {
    restartDsh(plan)
    const detail = error instanceof Error ? error.message : String(error)
    const healthy = await waitForHealthy(plan, plan.previousVersion)
    await writePhase(
      store,
      plan,
      'failed',
      healthy
        ? `Profile pnpm 不可用，更新已取消并重新启动旧版本：${detail}`
        : `Profile pnpm 不可用，更新已取消，但旧版本未能自动启动：${detail}`,
    )
    return
  }

  await writePhase(store, plan, 'installing', `正在安装 ${plan.targetVersion}…`)
  if (!runTargetInstall(plan)) {
    await writePhase(store, plan, 'failed', '新版本安装失败，正在恢复旧版本…')
    await rollbackAndRestart(plan, store, '新版本安装失败，已自动恢复旧版本。')
    return
  }
  const installedVersion = installedProfileVersion(plan)
  if (semver.valid(installedVersion) === null || semver.lt(installedVersion, plan.targetVersion)) {
    await writePhase(store, plan, 'failed', '未安装预期插件版本，正在恢复旧版本…')
    await rollbackAndRestart(plan, store, '插件版本不符合预期，已自动恢复旧版本。')
    return
  }
  plan.targetVersion = installedVersion

  await writePhase(store, plan, 'restarting', '安装完成，正在重启 DSH…')
  const child = restartDsh(plan)
  if (await waitForHealthy(plan, plan.targetVersion)) {
    await writePhase(store, plan, 'succeeded', `已更新到 ${plan.targetVersion}。`)
    return
  }

  child.kill('SIGTERM')
  if (child.pid !== undefined) await waitForProcessExit(child.pid, 10_000)
  await writePhase(store, plan, 'failed', '新版本健康检查失败，正在恢复旧版本…')
  await rollbackAndRestart(plan, store, '新版本启动失败，已自动恢复旧版本。')
}

export async function finalizeManagedPluginUpdate(
  planPath: string,
  replacementUrl: string,
  overrides: Partial<ManagedPluginUpdateOperations> = {},
): Promise<void> {
  const plan = planWithReplacementHealthUrl(
    parsePluginUpdaterPlan(JSON.parse(await readFile(planPath, 'utf8')) as unknown),
    replacementUrl,
  )
  const store = new PluginUpdateInstallStateStore(plan.stateDirectory)
  const ops = managedOperations(overrides)
  if (!await ops.waitForHealthy(plan, plan.targetVersion)) {
    throw new Error('managed plugin update did not become healthy')
  }
  await writePhase(store, plan, 'succeeded', `已更新到 ${plan.targetVersion}。`)
  await unlink(planPath)
}

export async function rollbackManagedPluginUpdate(
  planPath: string,
  overrides: Partial<ManagedPluginUpdateOperations> = {},
): Promise<void> {
  const plan = parsePluginUpdaterPlan(JSON.parse(await readFile(planPath, 'utf8')) as unknown)
  const store = new PluginUpdateInstallStateStore(plan.stateDirectory)
  const ops = managedOperations(overrides)
  if (!ops.runRollbackInstall(plan)) {
    await writePhase(store, plan, 'failed', '更新失败，旧版本恢复也失败；请使用更新命令手动修复。')
    throw new Error('managed plugin update rollback failed')
  }
  await writePhase(store, plan, 'rolled-back', '已恢复旧版本文件，正在由 Arkme 重启 DSH…')
  await unlink(planPath)
}

async function main(): Promise<void> {
  const planPath = process.argv[2]
  if (planPath === undefined) throw new Error('updater plan path is required')
  const plan = parsePluginUpdaterPlan(JSON.parse(await readFile(planPath, 'utf8')) as unknown)
  const logFd = openSync(plan.logPath, 'a', 0o600)
  try {
    // The helper itself already inherits the same log file, but reopening proves the target remains writable.
    closeSync(logFd)
    await runPluginUpdater(planPath)
  } catch (error) {
    const store = new PluginUpdateInstallStateStore(plan.stateDirectory)
    await writePhase(store, plan, 'failed', error instanceof Error ? error.message : String(error))
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
