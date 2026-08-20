import { execFile, spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, statSync } from 'node:fs'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { localExtensionPnpmArgs, prepareProfilePackageManager } from '../profile-package-manager.js'
import type { ArkmeExtensionProfileRestartPlan } from './profile-restart-helper.js'
import type { ArkmeInstalledExtension } from './types.js'

const execFileAsync = promisify(execFile)

export function profilePluginCommandErrorDetail(error: unknown): string {
  const child = error as { stdout?: unknown; stderr?: unknown }
  return [child.stdout, child.stderr]
    .map(value => String(value ?? '').trim())
    .filter(value => value !== '')
    .join('\n')
    .slice(0, 2_000)
}

export interface ArkmeExtensionProfileInstallerOptions {
  dshHome: string
  profileName: string
  execPath: string
  dshBinPath: string
  execArgv?: string[]
  stateDirectory?: string
  healthUrl?: string
  restartArgv?: string[]
  helperPath?: string
  installStoreDirectory?: string
  run?: (args: readonly string[]) => Promise<void>
  restart?: (plan: ArkmeExtensionProfileRestartPlan) => Promise<void>
  requestShutdown?: () => void
}

export class ArkmeExtensionProfileInstaller {
  constructor(private readonly options: ArkmeExtensionProfileInstallerOptions) {}

  async install(bundleDirectory: string): Promise<void> {
    if (!existsSync(bundleDirectory)) throw new Error('扩展 Bundle 目录不存在')
    await this.run([
      'plugin', '--profile', this.options.profileName,
      ...localExtensionPnpmArgs(['add', `link:${bundleDirectory}`]),
    ])
  }

  async installTarball(bundlePath: string): Promise<void> {
    if (!existsSync(bundlePath) || !statSync(bundlePath).isFile()) throw new Error('扩展 Bundle tgz 不存在')
    await this.run([
      'plugin', '--profile', this.options.profileName,
      ...localExtensionPnpmArgs(['add', bundlePath]),
    ])
  }

  async remove(packageName: string): Promise<void> {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName)) throw new Error('扩展 Bundle 包名无效')
    await this.run([
      'plugin', '--profile', this.options.profileName,
      ...localExtensionPnpmArgs(['remove', packageName]),
    ])
  }

  async restart(input: {
    extensionId: string
    packageName: string
    targetBundlePath?: string
    previousBundlePath?: string
    cleanupPaths?: string[]
    previousInstalled?: ArkmeInstalledExtension
    expectActive: boolean
  }): Promise<void> {
    if (this.options.stateDirectory === undefined || this.options.healthUrl === undefined
      || this.options.helperPath === undefined || this.options.restartArgv === undefined
      || this.options.installStoreDirectory === undefined) return
    const plan: ArkmeExtensionProfileRestartPlan = {
      schemaVersion: input.targetBundlePath?.endsWith('.tgz') === true
        || input.previousBundlePath?.endsWith('.tgz') === true
        || input.previousInstalled?.executionModel !== undefined ? 2 : 1,
      parentPid: process.pid,
      execPath: this.options.execPath,
      dshBinPath: this.options.dshBinPath,
      execArgv: this.options.execArgv ?? [],
      restartArgv: this.options.restartArgv,
      dshHome: this.options.dshHome,
      profileName: this.options.profileName,
      packageName: input.packageName,
      extensionId: input.extensionId,
      expectActive: input.expectActive,
      ...(input.targetBundlePath === undefined ? {} : { targetBundlePath: input.targetBundlePath }),
      ...(input.previousBundlePath === undefined ? {} : { previousBundlePath: input.previousBundlePath }),
      ...(input.cleanupPaths === undefined ? {} : { cleanupPaths: input.cleanupPaths }),
      installStoreDirectory: this.options.installStoreDirectory,
      ...(input.previousInstalled === undefined ? {} : { previousInstalled: input.previousInstalled }),
      healthUrl: this.options.healthUrl,
      logPath: join(this.options.stateDirectory, 'extension-profile-restart.log'),
    }
    if (this.options.restart !== undefined) await this.options.restart(plan)
    else {
      const planPath = join(this.options.stateDirectory, `extension-profile-restart-${randomUUID()}.json`)
      await writeFile(planPath, `${JSON.stringify(plan, undefined, 2)}\n`, { mode: 0o600 })
      await chmod(planPath, 0o600)
      const log = openSync(plan.logPath, 'a', 0o600)
      const child = spawn(this.options.execPath, [this.options.helperPath, planPath], {
        detached: true,
        env: { ...process.env, DSH_HOME: this.options.dshHome },
        stdio: ['ignore', log, log],
        shell: false,
      })
      child.unref()
      closeSync(log)
    }
    const shutdown = this.options.requestShutdown ?? (() => {
      const timer = setTimeout(() => process.kill(process.pid, 'SIGTERM'), 800)
      timer.unref?.()
    })
    shutdown()
  }

  private async run(args: readonly string[]): Promise<void> {
    if (this.options.run !== undefined) return await this.options.run(args)
    if (!existsSync(this.options.execPath) || !existsSync(this.options.dshBinPath)) {
      throw new Error('当前 DSH 运行方式不支持修改 Profile 插件')
    }
    prepareProfilePackageManager(this.options.dshHome, this.options.profileName)
    try {
      await execFileAsync(this.options.execPath, [...(this.options.execArgv ?? []), this.options.dshBinPath, ...args], {
        env: { ...process.env, DSH_HOME: this.options.dshHome },
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
        timeout: 120_000,
      })
    } catch (error) {
      const detail = profilePluginCommandErrorDetail(error)
      throw new Error(detail === '' ? 'DSH Profile 插件操作失败' : `DSH Profile 插件操作失败：${detail}`, { cause: error })
    }
  }
}
