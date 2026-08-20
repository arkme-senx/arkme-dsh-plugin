import { closeSync, existsSync, openSync, readFileSync } from 'node:fs'
import { chmod, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { PluginUpdateInstallStateStore } from './plugin-update-install-state.js'
import { PluginUpdateStateStore, type PersistedPluginUpdateState } from './plugin-update-state.js'
import { prepareProfilePackageManager } from './profile-package-manager.js'
import type { PluginUpdaterPlan } from './plugin-updater-helper.js'
import type {
  ArkmePluginUpdateAvailability,
  ArkmePluginUpdateLevel,
  ArkmePluginUpdateNotice,
  ArkmePluginUpdateInstallSnapshot,
  ArkmePluginUpdateStatus,
} from './types.js'

export const ARKME_PLUGIN_PACKAGE_NAME = '@senguoyun/dsh-arkme'
const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org'
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000
const MAX_REGISTRY_RESPONSE_BYTES = 64 * 1024
const MANUAL_CHECK_INTERVAL_MS = 60_000
const STARTUP_JITTER_MIN_MS = 5_000
const STARTUP_JITTER_SPAN_MS = 25_000
const ALLOWED_RELEASE_NOTES_HOSTS = new Set([
  'github.com',
  'npmjs.com',
  'www.npmjs.com',
  'arkme.ai',
  'www.arkme.ai',
])

export type ArkmePluginUpdateChannel = 'stable' | 'next'

export interface PluginUpdateLogger {
  debug?(message: string, ...args: unknown[]): void
  info?(message: string, ...args: unknown[]): void
  warn?(message: string, ...args: unknown[]): void
}

export interface ArkmePluginUpdateManagerOptions {
  enabled: boolean
  channel: ArkmePluginUpdateChannel
  registryUrl: string
  intervalMs: number
  stateDirectory: string
  installedVersion?: string
  fetchImpl?: typeof fetch
  requestTimeoutMs?: number
  now?: () => number
  random?: () => number
  logger?: PluginUpdateLogger
  stateStore?: PluginUpdateStateStore
  installRuntime?: PluginUpdateInstallRuntime
}

export interface PluginUpdateInstallRuntime {
  dshHome: string
  profileName: string
  healthUrl: string
  execPath?: string
  execArgv?: string[]
  dshBinPath?: string
  restartArgv?: string[]
  helperPath?: string
  spawnUpdater?: (planPath: string, logPath: string) => Promise<void>
  requestShutdown?: () => void
  preparePackageManager?: (dshHome: string, profileName: string) => void
  allowLocalInstall?: boolean
}

interface RegistryPackageMetadata {
  version: string
  notice?: ArkmePluginUpdateNotice
}

export class ArkmePluginUpdateError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ArkmePluginUpdateError'
  }
}

export function readInstalledPluginVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as unknown
  if (manifest === null || typeof manifest !== 'object') throw new Error('dsh-arkme: package manifest is invalid')
  const version = (manifest as Record<string, unknown>).version
  if (typeof version !== 'string' || semver.valid(version) === null) {
    throw new Error('dsh-arkme: package version is invalid')
  }
  return version
}

export function validateUpdateRegistryOrigin(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('dsh-arkme: updateRegistryUrl must be an HTTPS origin without credentials or path')
  }
  return url.origin
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized !== '' && normalized.length <= maxLength ? normalized : undefined
}

function noticeLevel(value: unknown): ArkmePluginUpdateLevel {
  return value === 'important' || value === 'critical' ? value : 'normal'
}

function safeReleaseNotesUrl(value: unknown): string | undefined {
  const raw = boundedString(value, 2048)
  if (raw === undefined) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
      || !ALLOWED_RELEASE_NOTES_HOSTS.has(url.hostname.toLowerCase())) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function safePublishedAt(value: unknown): string | undefined {
  const raw = boundedString(value, 64)
  if (raw === undefined || !Number.isFinite(Date.parse(raw))) return undefined
  return raw
}

function parseNotice(value: unknown): ArkmePluginUpdateNotice | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  if (source.schemaVersion !== 1) return undefined
  const title = boundedString(source.title, 60)
  const summary = boundedString(source.summary, 200)
  const publishedAt = safePublishedAt(source.publishedAt)
  const releaseNotesUrl = safeReleaseNotesUrl(source.releaseNotesUrl)
  return {
    schemaVersion: 1,
    level: noticeLevel(source.level),
    ...(title === undefined ? {} : { title }),
    ...(summary === undefined ? {} : { summary }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(releaseNotesUrl === undefined ? {} : { releaseNotesUrl }),
  }
}

export function parseRegistryPackageMetadata(value: unknown): RegistryPackageMetadata {
  if (value === null || typeof value !== 'object') {
    throw new ArkmePluginUpdateError('plugin-update-response-invalid', '更新服务返回格式无效', true)
  }
  const source = value as Record<string, unknown>
  if (source.name !== ARKME_PLUGIN_PACKAGE_NAME) {
    throw new ArkmePluginUpdateError('plugin-update-package-mismatch', '更新服务返回了错误的插件包', true)
  }
  if (typeof source.version !== 'string' || semver.valid(source.version) === null) {
    throw new ArkmePluginUpdateError('plugin-update-version-invalid', '更新服务返回了无效版本', true)
  }
  const arkme = source.arkme !== null && typeof source.arkme === 'object'
    ? source.arkme as Record<string, unknown>
    : {}
  const notice = parseNotice(arkme.updateNotice)
  return {
    version: source.version,
    ...(notice === undefined ? {} : { notice }),
  }
}

async function readLimitedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REGISTRY_RESPONSE_BYTES) {
    throw new ArkmePluginUpdateError('plugin-update-response-too-large', '更新服务响应过大', true)
  }
  if (response.body === null) {
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_REGISTRY_RESPONSE_BYTES) {
      throw new ArkmePluginUpdateError('plugin-update-response-too-large', '更新服务响应过大', true)
    }
    return text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    bytes += result.value.byteLength
    if (bytes > MAX_REGISTRY_RESPONSE_BYTES) {
      await reader.cancel()
      throw new ArkmePluginUpdateError('plugin-update-response-too-large', '更新服务响应过大', true)
    }
    chunks.push(result.value)
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8')
}

function retryDelayMillis(failures: number): number {
  if (failures <= 1) return 15 * 60_000
  if (failures === 2) return 30 * 60_000
  if (failures === 3) return 60 * 60_000
  return 6 * 60 * 60_000
}

export class ArkmePluginUpdateManager {
  private readonly enabled: boolean
  private readonly channel: ArkmePluginUpdateChannel
  private readonly registryOrigin: string
  private readonly intervalMs: number
  private readonly installedVersion: string
  private readonly fetchImpl: typeof fetch
  private readonly requestTimeoutMs: number
  private readonly now: () => number
  private readonly random: () => number
  private readonly logger: PluginUpdateLogger
  private readonly stateStore: PluginUpdateStateStore
  private readonly stateDirectory: string
  private readonly installStore: PluginUpdateInstallStateStore
  private readonly installRuntime: PluginUpdateInstallRuntime | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: Promise<ArkmePluginUpdateStatus> | undefined
  private activeController: AbortController | undefined
  private started = false
  private disposed = false

  constructor(options: ArkmePluginUpdateManagerOptions) {
    this.enabled = options.enabled
    this.channel = options.channel
    this.registryOrigin = validateUpdateRegistryOrigin(options.registryUrl || DEFAULT_REGISTRY_URL)
    this.intervalMs = Math.max(60_000, Math.trunc(options.intervalMs))
    this.installedVersion = options.installedVersion ?? readInstalledPluginVersion()
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.logger = options.logger ?? {}
    this.stateDirectory = options.stateDirectory
    this.stateStore = options.stateStore ?? new PluginUpdateStateStore(options.stateDirectory, {
      onRecover: error => this.logger.warn?.('dsh-arkme: recovered invalid plugin update state: %s', String(error)),
    })
    this.installStore = new PluginUpdateInstallStateStore(options.stateDirectory)
    this.installRuntime = options.installRuntime
  }

  start(): () => void {
    if (this.started) return () => this.dispose()
    this.started = true
    if (this.enabled) {
      const jitter = STARTUP_JITTER_MIN_MS + Math.floor(this.random() * STARTUP_JITTER_SPAN_MS)
      this.schedule(jitter)
    }
    return () => this.dispose()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.activeController?.abort()
    this.activeController = undefined
  }

  async status(options: { refreshIfStale?: boolean } = {}): Promise<ArkmePluginUpdateStatus> {
    const state = await this.stateStore.snapshot()
    const status = this.project(state)
    if (options.refreshIfStale !== false && this.enabled && this.isDue(state)) {
      void this.check().catch(error => {
        this.logger.debug?.('dsh-arkme: background plugin update check failed: %s', String(error))
      })
    }
    return status
  }

  async check(options: { manual?: boolean } = {}): Promise<ArkmePluginUpdateStatus> {
    if (!this.enabled || this.disposed) return this.project(await this.stateStore.snapshot(), false)
    if (this.inFlight !== undefined) return await this.inFlight
    const task = this.checkOnce(options)
    this.inFlight = task
    try {
      return await task
    } finally {
      this.inFlight = undefined
      if (this.started && !this.disposed) void this.scheduleNext()
    }
  }

  private async checkOnce(options: { manual?: boolean }): Promise<ArkmePluginUpdateStatus> {
    const state = await this.stateStore.snapshot()
    const now = this.now()
    if (options.manual === true) {
      if (state.lastCheckedAtMillis !== undefined && now - state.lastCheckedAtMillis < MANUAL_CHECK_INTERVAL_MS) {
        return this.project(state, false)
      }
    } else if (!this.isDue(state)) {
      return this.project(state, false)
    }
    return await this.performCheck()
  }

  async acknowledge(snoozeHours = 24): Promise<ArkmePluginUpdateStatus> {
    const current = await this.status({ refreshIfStale: false })
    if (current.availability !== 'available' || current.latestVersion === undefined) {
      throw new ArkmePluginUpdateError('plugin-update-not-available', '当前没有可确认的插件更新', false)
    }
    const hours = Math.min(24, Math.max(0, Number.isFinite(snoozeHours) ? snoozeHours : 0))
    const snoozedUntilMillis = current.level === 'critical' || hours === 0
      ? undefined
      : this.now() + Math.trunc(hours * 60 * 60_000)
    const latestVersion = current.latestVersion
    const state = await this.stateStore.update(value => {
      value.acknowledgedVersion = latestVersion
      if (snoozedUntilMillis === undefined) delete value.snoozedUntilMillis
      else value.snoozedUntilMillis = snoozedUntilMillis
    })
    this.logger.info?.('dsh-arkme: plugin update acknowledged latest=%s snoozeHours=%s', latestVersion, hours)
    return this.project(state, false)
  }

  async installStatus(): Promise<ArkmePluginUpdateInstallSnapshot | undefined> {
    return await this.installStore.read()
  }

  async install(): Promise<ArkmePluginUpdateInstallSnapshot> {
    const status = await this.status({ refreshIfStale: false })
    if (status.availability !== 'available' || status.latestVersion === undefined) {
      throw new ArkmePluginUpdateError('plugin-update-not-available', '当前没有可安装的插件更新', false)
    }
    const capability = this.installationCapability()
    if (!capability.canInstall || this.installRuntime === undefined) {
      throw new ArkmePluginUpdateError(
        'plugin-update-install-unavailable',
        capability.reason === 'local-install'
          ? '当前是本地开发安装，不能自动覆盖'
          : '当前 DSH 运行方式不支持应用内更新',
        false,
      )
    }
    const previous = await this.installStore.read()
    if (previous !== undefined && ['preparing', 'installing', 'restarting'].includes(previous.phase)) {
      return previous
    }

    const runtime = this.installRuntime
    try {
      (runtime.preparePackageManager ?? prepareProfilePackageManager)(runtime.dshHome, runtime.profileName)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new ArkmePluginUpdateError(
        'profile-package-manager-unavailable',
        `无法确认 DSH Profile 的 pnpm：${detail}`,
        false,
      )
    }
    const execArgv = runtime.execArgv ?? process.execArgv
    const jobId = randomUUID()
    const now = this.now()
    const snapshot: ArkmePluginUpdateInstallSnapshot = {
      schemaVersion: 1,
      jobId,
      phase: 'preparing',
      previousVersion: this.installedVersion,
      targetVersion: status.latestVersion,
      message: `准备更新到 ${status.latestVersion}…`,
      updatedAtMillis: now,
    }
    await this.installStore.write(snapshot)

    const planPath = join(this.stateDirectory, `plugin-update-plan-${jobId}.json`)
    const logPath = join(this.stateDirectory, 'plugin-update-helper.log')
    const plan: PluginUpdaterPlan = {
      schemaVersion: 1,
      jobId,
      parentPid: process.pid,
      execPath: runtime.execPath ?? process.execPath,
      execArgv,
      dshBinPath: runtime.dshBinPath ?? process.argv[1] ?? '',
      restartArgv: runtime.restartArgv ?? [...execArgv, ...process.argv.slice(1)],
      dshHome: runtime.dshHome,
      profileName: runtime.profileName,
      previousVersion: this.installedVersion,
      previousSpec: capability.previousSpec ?? this.installedVersion,
      targetVersion: status.latestVersion,
      stateDirectory: this.stateDirectory,
      healthUrl: runtime.healthUrl,
      logPath,
    }
    await writeFile(planPath, `${JSON.stringify(plan, undefined, 2)}\n`, { mode: 0o600 })
    await chmod(planPath, 0o600)
    try {
      await (runtime.spawnUpdater ?? this.spawnUpdater.bind(this))(planPath, logPath)
    } catch (error) {
      await unlink(planPath).catch(() => undefined)
      await this.installStore.write({
        ...snapshot,
        phase: 'failed',
        message: '无法启动独立更新进程。',
        updatedAtMillis: this.now(),
      })
      throw new ArkmePluginUpdateError('plugin-update-helper-failed', '无法启动独立更新进程', true)
    }
    const shutdown = runtime.requestShutdown ?? (() => {
      const timer = setTimeout(() => process.kill(process.pid, 'SIGTERM'), 800)
      timer.unref?.()
    })
    shutdown()
    return snapshot
  }

  private async performCheck(): Promise<ArkmePluginUpdateStatus> {
    const startedAt = this.now()
    this.logger.debug?.('dsh-arkme: plugin update check started channel=%s', this.channel)
    try {
      const metadata = await this.fetchLatestMetadata()
      if (this.disposed) return this.project(await this.stateStore.snapshot(), false)
      const checkedAt = this.now()
      const state = await this.stateStore.update(value => {
        const changedVersion = value.lastKnownLatestVersion !== metadata.version
        value.lastCheckedAtMillis = checkedAt
        value.lastSuccessfulCheckAtMillis = checkedAt
        value.lastKnownLatestVersion = metadata.version
        if (metadata.notice === undefined) delete value.lastKnownNotice
        else value.lastKnownNotice = metadata.notice
        value.consecutiveFailures = 0
        if (changedVersion || semver.gte(this.installedVersion, metadata.version)) {
          delete value.acknowledgedVersion
          delete value.snoozedUntilMillis
        }
      })
      const status = this.project(state, false)
      this.logger.info?.(
        'dsh-arkme: plugin update check succeeded installed=%s latest=%s channel=%s durationMs=%s',
        this.installedVersion, metadata.version, this.channel, checkedAt - startedAt,
      )
      if (status.availability === 'available') {
        this.logger.info?.('dsh-arkme: plugin update available installed=%s latest=%s level=%s',
          this.installedVersion, metadata.version, status.level)
      }
      return status
    } catch (error) {
      if (this.disposed) return this.project(await this.stateStore.snapshot(), false)
      const checkedAt = this.now()
      const state = await this.stateStore.update(value => {
        value.lastCheckedAtMillis = checkedAt
        value.consecutiveFailures = Math.min(100, value.consecutiveFailures + 1)
      })
      const code = error instanceof ArkmePluginUpdateError ? error.code : 'plugin-update-check-failed'
      this.logger.warn?.('dsh-arkme: plugin update check failed code=%s durationMs=%s failures=%s',
        code, checkedAt - startedAt, state.consecutiveFailures)
      return this.project(state, false)
    }
  }

  private async fetchLatestMetadata(): Promise<RegistryPackageMetadata> {
    const tag = this.channel === 'next' ? 'next' : 'latest'
    const url = new URL(`/${encodeURIComponent(ARKME_PLUGIN_PACKAGE_NAME)}/${tag}`, this.registryOrigin)
    const controller = new AbortController()
    this.activeController = controller
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    timeout.unref?.()
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new ArkmePluginUpdateError(
          'plugin-update-http-error',
          `更新服务返回 HTTP ${String(response.status)}`,
          response.status >= 500 || response.status === 429,
        )
      }
      let value: unknown
      try {
        value = JSON.parse(await readLimitedResponse(response)) as unknown
      } catch (error) {
        if (error instanceof ArkmePluginUpdateError) throw error
        throw new ArkmePluginUpdateError('plugin-update-response-invalid', '更新服务返回了无效 JSON', true)
      }
      return parseRegistryPackageMetadata(value)
    } catch (error) {
      if (error instanceof ArkmePluginUpdateError) throw error
      const code = controller.signal.aborted ? 'plugin-update-timeout' : 'plugin-update-network-error'
      throw new ArkmePluginUpdateError(code, controller.signal.aborted ? '检查更新超时' : '无法连接更新服务', true)
    } finally {
      clearTimeout(timeout)
      if (this.activeController === controller) this.activeController = undefined
    }
  }

  private project(state: PersistedPluginUpdateState, checking = this.inFlight !== undefined): ArkmePluginUpdateStatus {
    const latestVersion = state.lastKnownLatestVersion !== undefined && semver.valid(state.lastKnownLatestVersion) !== null
      ? state.lastKnownLatestVersion
      : undefined
    let availability: ArkmePluginUpdateAvailability = 'unknown'
    if (this.enabled && latestVersion !== undefined && semver.valid(this.installedVersion) !== null) {
      availability = semver.gt(latestVersion, this.installedVersion)
        ? 'available'
        : semver.eq(latestVersion, this.installedVersion) ? 'current' : 'ahead'
    }
    const notice = availability === 'available' ? state.lastKnownNotice : undefined
    const acknowledged = availability === 'available'
      && latestVersion !== undefined && state.acknowledgedVersion === latestVersion
    const snoozedUntilMillis = acknowledged && state.snoozedUntilMillis !== undefined
      && state.snoozedUntilMillis > this.now()
      ? state.snoozedUntilMillis
      : undefined
    const stale = this.enabled && (state.lastSuccessfulCheckAtMillis === undefined
      || this.now() - state.lastSuccessfulCheckAtMillis >= this.intervalMs
      || state.consecutiveFailures > 0)
    const capability = this.installationCapability()
    return {
      enabled: this.enabled,
      installedVersion: this.installedVersion,
      ...(latestVersion === undefined ? {} : { latestVersion }),
      availability,
      level: notice?.level ?? 'normal',
      ...(availability !== 'available' ? {} : {
        title: notice?.title ?? 'Arkme 插件有新版本',
        summary: notice?.summary ?? `可以从 ${this.installedVersion} 更新到 ${latestVersion ?? '新版本'}。`,
        ...(notice?.releaseNotesUrl === undefined ? {} : { releaseNotesUrl: notice.releaseNotesUrl }),
      }),
      ...(state.lastCheckedAtMillis === undefined ? {} : { checkedAtMillis: state.lastCheckedAtMillis }),
      ...(state.lastSuccessfulCheckAtMillis === undefined
        ? {}
        : { lastSuccessfulCheckAtMillis: state.lastSuccessfulCheckAtMillis }),
      stale,
      checkFailed: state.consecutiveFailures > 0,
      checking,
      acknowledged,
      ...(snoozedUntilMillis === undefined ? {} : { snoozedUntilMillis }),
      updateCommand: this.channel === 'next'
        ? 'dsh plugin --profile web up @senguoyun/dsh-arkme@next --latest'
        : 'dsh plugin --profile web up @senguoyun/dsh-arkme --latest',
      canInstallInApp: capability.canInstall,
      ...(capability.reason === undefined ? {} : { installBlockedReason: capability.reason }),
      restartRequired: true,
    }
  }

  private installationCapability(): {
    canInstall: boolean
    reason?: ArkmePluginUpdateStatus['installBlockedReason']
    previousSpec?: string
  } {
    if (!this.enabled) return { canInstall: false, reason: 'update-disabled' }
    const runtime = this.installRuntime
    if (runtime === undefined) return { canInstall: false, reason: 'runtime-unavailable' }
    const execPath = runtime.execPath ?? process.execPath
    const execArgv = runtime.execArgv ?? process.execArgv
    const dshBinPath = runtime.dshBinPath ?? process.argv[1]
    const restartArgv = runtime.restartArgv ?? [...execArgv, ...process.argv.slice(1)]
    const helperPath = runtime.helperPath ?? fileURLToPath(new URL('./plugin-updater-helper.js', import.meta.url))
    if (dshBinPath === undefined || !isAbsolute(execPath) || !isAbsolute(dshBinPath)
      || restartArgv.length === 0 || !existsSync(execPath) || !existsSync(dshBinPath) || !existsSync(helperPath)) {
      return { canInstall: false, reason: 'runtime-unavailable' }
    }
    try {
      const manifestPath = join(runtime.dshHome, 'profiles', runtime.profileName, 'package.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        dependencies?: Record<string, string>
      }
      const spec = manifest.dependencies?.[ARKME_PLUGIN_PACKAGE_NAME]
      if (spec === undefined) return { canInstall: false, reason: 'profile-unavailable' }
      if (semver.validRange(spec) === null && runtime.allowLocalInstall !== true) {
        return { canInstall: false, reason: 'local-install', previousSpec: spec }
      }
      return { canInstall: true, previousSpec: spec }
    } catch {
      return { canInstall: false, reason: 'profile-unavailable' }
    }
  }

  private async spawnUpdater(planPath: string, logPath: string): Promise<void> {
    const runtime = this.installRuntime
    if (runtime === undefined) throw new Error('install runtime missing')
    const execPath = runtime.execPath ?? process.execPath
    const helperPath = runtime.helperPath ?? fileURLToPath(new URL('./plugin-updater-helper.js', import.meta.url))
    const logFd = openSync(logPath, 'a', 0o600)
    try {
      await chmod(logPath, 0o600)
      await new Promise<void>((resolve, reject) => {
        const child = spawn(execPath, [helperPath, planPath], {
          detached: true,
          env: process.env,
          stdio: ['ignore', logFd, logFd],
          shell: false,
        })
        child.once('spawn', () => {
          void (async () => {
            const deadline = Date.now() + 3_000
            while (existsSync(planPath) && Date.now() < deadline) {
              await new Promise(wait => setTimeout(wait, 50))
            }
            if (existsSync(planPath)) {
              child.kill('SIGTERM')
              reject(new Error('plugin updater did not accept its plan'))
              return
            }
            child.unref()
            resolve()
          })()
        })
        child.once('error', reject)
      })
    } finally {
      closeSync(logFd)
    }
  }

  private isDue(state: PersistedPluginUpdateState): boolean {
    if (!this.enabled) return false
    const now = this.now()
    if (state.consecutiveFailures > 0 && state.lastCheckedAtMillis !== undefined) {
      return now >= state.lastCheckedAtMillis + retryDelayMillis(state.consecutiveFailures)
    }
    return state.lastSuccessfulCheckAtMillis === undefined
      || now >= state.lastSuccessfulCheckAtMillis + this.intervalMs
  }

  private schedule(delayMs: number): void {
    if (this.disposed || !this.enabled) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.check().catch(error => {
        this.logger.debug?.('dsh-arkme: scheduled plugin update check failed: %s', String(error))
      })
    }, Math.max(1, delayMs))
    this.timer.unref?.()
  }

  private async scheduleNext(): Promise<void> {
    const state = await this.stateStore.snapshot()
    const now = this.now()
    const nextAt = state.consecutiveFailures > 0 && state.lastCheckedAtMillis !== undefined
      ? state.lastCheckedAtMillis + retryDelayMillis(state.consecutiveFailures)
      : (state.lastSuccessfulCheckAtMillis ?? now) + this.intervalMs
    this.schedule(Math.max(1_000, nextAt - now))
  }
}
