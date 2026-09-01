import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { securePrivateDirectorySync, securePrivateFileSync } from './private-filesystem.js'

export interface QQ2006HarnessRuntimeConfig {
  sourceRoot: string
  runtimeHome: string
  dshHome: string
  nodeCommand: string
  port: number
}

interface RuntimeLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

const BOOT_ATTEMPTS = 60
const BOOT_RETRY_MS = 1_000

export function qq2006HarnessPageUrl(port: number): string {
  return `http://127.0.0.1:${String(port)}/?arkme-harness-embed=1&arkme-qq2006=1`
}

export function qq2006HarnessHealthUrl(port: number): string {
  return `http://127.0.0.1:${String(port)}/`
}

export function isDeepSeekHarnessPage(html: string): boolean {
  return /<title>\s*DeepSeek Harness\s*<\/title>/i.test(html)
}

export function qq2006HarnessCommand(config: QQ2006HarnessRuntimeConfig): {
  command: string
  args: string[]
  cwd: string
} {
  return {
    command: config.nodeCommand,
    args: [
      join(config.sourceRoot, 'apps', 'cli', 'lib', 'bin.js'),
      'web', '--host', '127.0.0.1', '--port', String(config.port),
    ],
    cwd: config.sourceRoot,
  }
}

/** Keeps the source-integrated QQ2006 Harness available to Arkme's nested client. */
export class QQ2006HarnessRuntime {
  readonly enabled: boolean
  readonly pageUrl: string
  private child: ChildProcess | undefined
  private readyPromise: Promise<boolean> | undefined
  private disposed = false

  constructor(
    private readonly config: QQ2006HarnessRuntimeConfig,
    private readonly logger: RuntimeLogger,
  ) {
    this.enabled = config.sourceRoot.trim() !== ''
    this.pageUrl = qq2006HarnessPageUrl(config.port)
  }

  start(): void {
    if (!this.enabled || this.readyPromise !== undefined) return
    this.readyPromise = this.boot()
  }

  async ready(): Promise<boolean> {
    this.start()
    return await (this.readyPromise ?? Promise.resolve(false))
  }

  dispose(): void {
    this.disposed = true
    if (this.child !== undefined && !this.child.killed) this.child.kill()
    this.child = undefined
  }

  private async boot(): Promise<boolean> {
    if (await this.healthy()) {
      this.logger.info('dsh-arkme: reusing QQ2006 Harness at %s', this.pageUrl)
      return true
    }

    const command = qq2006HarnessCommand(this.config)
    if (!existsSync(command.args[0]!) || !existsSync(join(this.config.sourceRoot, 'apps', 'web', 'dist', 'index.html'))) {
      this.logger.warn('dsh-arkme: QQ2006 Harness build is missing under %s', this.config.sourceRoot)
      return false
    }

    this.syncCredentials()
    try {
      this.child = spawn(command.command, command.args, {
        cwd: command.cwd,
        env: { ...process.env, DSH_HOME: this.config.runtimeHome },
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      })
      this.child.once('error', (error) => {
        this.logger.warn('dsh-arkme: QQ2006 Harness failed to start: %s', error.message)
      })
    } catch (error) {
      this.logger.warn('dsh-arkme: QQ2006 Harness failed to start: %s', error instanceof Error ? error.message : String(error))
      return false
    }

    for (let attempt = 0; attempt < BOOT_ATTEMPTS && !this.disposed; attempt += 1) {
      if (await this.healthy()) {
        this.logger.info('dsh-arkme: QQ2006 Harness ready at %s', this.pageUrl)
        return true
      }
      await new Promise(resolve => setTimeout(resolve, BOOT_RETRY_MS))
    }
    this.logger.warn('dsh-arkme: QQ2006 Harness did not become ready at %s', this.pageUrl)
    return false
  }

  private async healthy(): Promise<boolean> {
    try {
      const response = await fetch(qq2006HarnessHealthUrl(this.config.port), {
        signal: AbortSignal.timeout(1_000),
      })
      return response.ok && isDeepSeekHarnessPage(await response.text())
    } catch {
      return false
    }
  }

  private syncCredentials(): void {
    mkdirSync(this.config.runtimeHome, { recursive: true })
    securePrivateDirectorySync(this.config.runtimeHome)
    for (const name of ['.credentials.yaml', 'settings.yaml']) {
      const source = join(this.config.dshHome, name)
      if (!existsSync(source)) continue
      const target = join(this.config.runtimeHome, name)
      copyFileSync(source, target)
      securePrivateFileSync(target)
    }
  }
}
