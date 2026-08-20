import { closeSync, openSync } from 'node:fs'
import { readFile, rm, unlink } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ArkmeExtensionInstallStore } from './install-store.js'
import { localExtensionPnpmArgs, prepareProfilePackageManager } from '../profile-package-manager.js'
import type { ArkmeInstalledExtension } from './types.js'

const PARENT_EXIT_TIMEOUT_MS = 20_000
const HEALTH_TIMEOUT_MS = 45_000

export interface ArkmeExtensionProfileRestartPlan {
  schemaVersion: 1
  parentPid: number
  execPath: string
  dshBinPath: string
  execArgv: string[]
  restartArgv: string[]
  dshHome: string
  profileName: string
  packageName: string
  extensionId: string
  expectActive: boolean
  targetBundlePath?: string
  previousBundlePath?: string
  cleanupPaths?: string[]
  installStoreDirectory: string
  previousInstalled?: ArkmeInstalledExtension
  healthUrl: string
  logPath: string
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 4096 ? value : undefined
}

export function parseExtensionProfileRestartPlan(value: unknown): ArkmeExtensionProfileRestartPlan {
  if (value === null || typeof value !== 'object') throw new Error('extension restart plan must be an object')
  const source = value as Record<string, unknown>
  const plan = {
    schemaVersion: source.schemaVersion,
    parentPid: source.parentPid,
    execPath: stringValue(source.execPath), dshBinPath: stringValue(source.dshBinPath),
    execArgv: Array.isArray(source.execArgv) ? source.execArgv.filter((item): item is string => stringValue(item) !== undefined) : [],
    restartArgv: Array.isArray(source.restartArgv) ? source.restartArgv.filter((item): item is string => stringValue(item) !== undefined) : [],
    dshHome: stringValue(source.dshHome), profileName: stringValue(source.profileName), packageName: stringValue(source.packageName),
    extensionId: stringValue(source.extensionId), expectActive: source.expectActive,
    targetBundlePath: stringValue(source.targetBundlePath), previousBundlePath: stringValue(source.previousBundlePath),
    cleanupPaths: Array.isArray(source.cleanupPaths)
      ? source.cleanupPaths.map(stringValue).filter((item): item is string => item !== undefined)
      : [],
    installStoreDirectory: stringValue(source.installStoreDirectory),
    previousInstalled: source.previousInstalled !== null && typeof source.previousInstalled === 'object'
      ? source.previousInstalled as ArkmeInstalledExtension
      : undefined,
    healthUrl: stringValue(source.healthUrl), logPath: stringValue(source.logPath),
  }
  if (plan.schemaVersion !== 1 || typeof plan.parentPid !== 'number' || !Number.isSafeInteger(plan.parentPid)
    || plan.parentPid <= 0 || plan.execPath === undefined || plan.dshBinPath === undefined || plan.restartArgv.length === 0
    || plan.dshHome === undefined || plan.profileName === undefined || plan.packageName === undefined
    || plan.extensionId === undefined || typeof plan.expectActive !== 'boolean'
    || plan.installStoreDirectory === undefined
    || plan.healthUrl === undefined || plan.logPath === undefined
    || !/^@arkme-local\/ext-[a-f0-9]{16}$/.test(plan.packageName)) {
    throw new Error('extension restart plan is incomplete')
  }
  const health = new URL(plan.healthUrl)
  if (health.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(health.hostname)) {
    throw new Error('extension restart health URL must be loopback HTTP')
  }
  return { ...plan, schemaVersion: 1, healthUrl: health.toString() } as ArkmeExtensionProfileRestartPlan
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + PARENT_EXIT_TIMEOUT_MS
  while (alive(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200))
  if (alive(pid)) throw new Error('old DSH process did not exit')
}

function start(plan: ArkmeExtensionProfileRestartPlan) {
  const child = spawn(plan.execPath, plan.restartArgv, {
    detached: true, env: { ...process.env, DSH_HOME: plan.dshHome }, stdio: 'inherit', shell: false,
  })
  child.unref()
  return child
}

async function healthy(plan: ArkmeExtensionProfileRestartPlan): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch(plan.healthUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: new URL(plan.healthUrl).origin },
        body: JSON.stringify({ operation: 'extensions.installed-list' }),
        signal: AbortSignal.timeout(2_000),
      })
      if (response.ok) {
        const body = await response.json() as { ok?: boolean; value?: Array<{ extensionId?: string; active?: boolean }> }
        const installed = body.value?.find(item => item.extensionId === plan.extensionId)
        if (body.ok === true && (plan.expectActive ? installed?.active === true : installed === undefined)) return true
      }
    } catch { /* Restart is still in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return false
}

function profileCommand(plan: ArkmeExtensionProfileRestartPlan, args: string[]): boolean {
  prepareProfilePackageManager(plan.dshHome, plan.profileName)
  return spawnSync(plan.execPath, [
    ...plan.execArgv,
    plan.dshBinPath,
    'plugin', '--profile', plan.profileName,
    ...localExtensionPnpmArgs(args),
  ], {
    env: { ...process.env, DSH_HOME: plan.dshHome }, stdio: 'inherit', shell: false,
  }).status === 0
}

export interface ExtensionProfileRestartOperations {
  start: typeof start
  isHealthy: typeof healthy
  profileCommand: typeof profileCommand
  removePath: (path: string) => Promise<void>
}

const defaultOperations: ExtensionProfileRestartOperations = {
  start,
  isHealthy: healthy,
  profileCommand,
  removePath: async path => await rm(path, { recursive: true, force: true }),
}

function operations(overrides: Partial<ExtensionProfileRestartOperations>): ExtensionProfileRestartOperations {
  return { ...defaultOperations, ...overrides }
}

async function cleanup(
  plan: ArkmeExtensionProfileRestartPlan,
  helper: ExtensionProfileRestartOperations,
): Promise<void> {
  for (const path of plan.cleanupPaths ?? []) {
    const fromHome = relative(resolve(plan.dshHome), resolve(path))
    if (fromHome === '' || fromHome.startsWith('..')) continue
    await helper.removePath(resolve(path))
  }
}

async function rollback(
  plan: ArkmeExtensionProfileRestartPlan,
  restart: boolean,
  helper: ExtensionProfileRestartOperations,
): Promise<void> {
  const restored = plan.previousBundlePath === undefined
    ? helper.profileCommand(plan, ['remove', plan.packageName])
    : helper.profileCommand(plan, ['add', `link:${plan.previousBundlePath}`])
  if (!restored) throw new Error('extension profile rollback failed')
  const store = new ArkmeExtensionInstallStore(plan.installStoreDirectory)
  try {
    if (plan.previousInstalled === undefined) store.remove(plan.extensionId)
    else store.put({ ...plan.previousInstalled, active: false })
  } finally {
    store.close()
  }
  if (restart) helper.start(plan)
}

export async function runExtensionProfileRestart(planPath: string): Promise<void> {
  const plan = parseExtensionProfileRestartPlan(JSON.parse(await readFile(planPath, 'utf8')) as unknown)
  await unlink(planPath).catch(() => undefined)
  await waitForExit(plan.parentPid)
  const child = defaultOperations.start(plan)
  if (await defaultOperations.isHealthy(plan)) {
    await cleanup(plan, defaultOperations)
    return
  }
  child.kill('SIGTERM')
  if (child.pid !== undefined) await waitForExit(child.pid).catch(() => undefined)
  await rollback(plan, true, defaultOperations)
}

export async function finalizeManagedExtensionProfileRestart(
  planPath: string,
  replacementUrl: string,
  overrides: Partial<ExtensionProfileRestartOperations> = {},
): Promise<void> {
  const stored = JSON.parse(await readFile(planPath, 'utf8')) as unknown
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error('extension restart plan must be an object')
  }
  const original = parseExtensionProfileRestartPlan(stored)
  const replacement = new URL(replacementUrl)
  if (replacement.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(replacement.hostname)) {
    throw new Error('managed restart replacement URL must be loopback HTTP')
  }
  const health = new URL(original.healthUrl)
  health.protocol = replacement.protocol
  health.hostname = replacement.hostname
  health.port = replacement.port
  const plan = parseExtensionProfileRestartPlan({ ...stored, healthUrl: health.toString() })
  const helper = operations(overrides)
  if (!await helper.isHealthy(plan)) throw new Error('restarted extension profile did not become healthy')
  await cleanup(plan, helper)
  await unlink(planPath)
}

export async function rollbackManagedExtensionProfileRestart(
  planPath: string,
  overrides: Partial<ExtensionProfileRestartOperations> = {},
): Promise<void> {
  const plan = parseExtensionProfileRestartPlan(JSON.parse(await readFile(planPath, 'utf8')) as unknown)
  await rollback(plan, false, operations(overrides))
  await unlink(planPath)
}

async function main(): Promise<void> {
  const mode = process.argv[2]
  const managed = mode === '--managed-finalize' || mode === '--managed-rollback'
  const planPath = managed ? process.argv[3] : mode
  if (planPath === undefined) throw new Error('extension restart plan path is required')
  const parsed = parseExtensionProfileRestartPlan(JSON.parse(await readFile(planPath, 'utf8')) as unknown)
  const log = openSync(parsed.logPath, 'a', 0o600)
  closeSync(log)
  if (mode === '--managed-finalize') {
    const healthUrl = process.argv[4]
    if (healthUrl === undefined) throw new Error('managed restart health URL is required')
    await finalizeManagedExtensionProfileRestart(planPath, healthUrl)
    return
  }
  if (mode === '--managed-rollback') {
    await rollbackManagedExtensionProfileRestart(planPath)
    return
  }
  await runExtensionProfileRestart(planPath)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
