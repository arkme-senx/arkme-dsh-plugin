import { execFile, spawn } from 'node:child_process'
import { closeSync, existsSync, openSync } from 'node:fs'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import type { ArkmeExtensionProfileRestartPlan } from './profile-restart-helper.js'
import type { ArkmeInstalledExtension } from './types.js'

const execFileAsync = promisify(execFile)

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
    await this.run(['plugin', '--profile', this.options.profileName, 'add', `link:${bundleDirectory}`])
  }

  async remove(packageName: string): Promise<void> {
    if (!/^@arkme-local\/ext-[a-f0-9]{16}$/.test(packageName)) throw new Error('扩展 Bundle 包名无效')
    await this.run(['plugin', '--profile', this.options.profileName, 'remove', packageName])
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
      schemaVersion: 1,
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
    try {
      await execFileAsync(this.options.execPath, [...(this.options.execArgv ?? []), this.options.dshBinPath, ...args], {
        env: { ...process.env, DSH_HOME: this.options.dshHome },
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
        timeout: 120_000,
      })
    } catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim().slice(0, 1_000)
      throw new Error(stderr === '' ? 'DSH Profile 插件操作失败' : `DSH Profile 插件操作失败：${stderr}`, { cause: error })
    }
  }
}
