import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { securePrivateDirectory, securePrivateFile } from './private-filesystem.js'
import type { ArkmePluginUpdateLevel, ArkmePluginUpdateNotice } from './types.js'

export interface PersistedPluginUpdateState {
  version: 1
  lastCheckedAtMillis?: number
  lastSuccessfulCheckAtMillis?: number
  lastKnownLatestVersion?: string
  lastKnownNotice?: ArkmePluginUpdateNotice
  acknowledgedVersion?: string
  snoozedUntilMillis?: number
  consecutiveFailures: number
}

function emptyState(): PersistedPluginUpdateState {
  return { version: 1, consecutiveFailures: 0 }
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized !== '' && normalized.length <= maxLength ? normalized : undefined
}

function updateLevel(value: unknown): ArkmePluginUpdateLevel {
  return value === 'important' || value === 'critical' ? value : 'normal'
}

function safeReleaseNotesUrl(value: unknown): string | undefined {
  const raw = boundedString(value, 2048)
  if (raw === undefined) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
      || !['github.com', 'arkme.ai', 'www.arkme.ai']
        .includes(url.hostname.toLowerCase())) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function normalizedNotice(value: unknown): ArkmePluginUpdateNotice | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  if (source.schemaVersion !== 1) return undefined
  const title = boundedString(source.title, 60)
  const summary = boundedString(source.summary, 200)
  const rawPublishedAt = boundedString(source.publishedAt, 64)
  const publishedAt = rawPublishedAt !== undefined && Number.isFinite(Date.parse(rawPublishedAt))
    ? rawPublishedAt
    : undefined
  const releaseNotesUrl = safeReleaseNotesUrl(source.releaseNotesUrl)
  return {
    schemaVersion: 1,
    level: updateLevel(source.level),
    ...(title === undefined ? {} : { title }),
    ...(summary === undefined ? {} : { summary }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(releaseNotesUrl === undefined ? {} : { releaseNotesUrl }),
  }
}

function parseState(raw: string): PersistedPluginUpdateState {
  const value = JSON.parse(raw) as unknown
  if (value === null || typeof value !== 'object') return emptyState()
  const source = value as Record<string, unknown>
  const lastCheckedAtMillis = positiveNumber(source.lastCheckedAtMillis)
  const lastSuccessfulCheckAtMillis = positiveNumber(source.lastSuccessfulCheckAtMillis)
  const lastKnownLatestVersion = boundedString(source.lastKnownLatestVersion, 128)
  const lastKnownNotice = normalizedNotice(source.lastKnownNotice)
  const acknowledgedVersion = boundedString(source.acknowledgedVersion, 128)
  const snoozedUntilMillis = positiveNumber(source.snoozedUntilMillis)
  return {
    version: 1,
    ...(lastCheckedAtMillis === undefined ? {} : { lastCheckedAtMillis }),
    ...(lastSuccessfulCheckAtMillis === undefined ? {} : { lastSuccessfulCheckAtMillis }),
    ...(lastKnownLatestVersion === undefined ? {} : { lastKnownLatestVersion }),
    ...(lastKnownNotice === undefined ? {} : { lastKnownNotice }),
    ...(acknowledgedVersion === undefined ? {} : { acknowledgedVersion }),
    ...(snoozedUntilMillis === undefined ? {} : { snoozedUntilMillis }),
    consecutiveFailures: typeof source.consecutiveFailures === 'number'
      && Number.isSafeInteger(source.consecutiveFailures) && source.consecutiveFailures > 0
      ? Math.min(source.consecutiveFailures, 100)
      : 0,
  }
}

function cloneState(state: PersistedPluginUpdateState): PersistedPluginUpdateState {
  return {
    ...state,
    ...(state.lastKnownNotice === undefined ? {} : { lastKnownNotice: { ...state.lastKnownNotice } }),
  }
}

export interface PluginUpdateStateStoreOptions {
  onRecover?: (error: unknown) => void
}

export class PluginUpdateStateStore {
  private readonly path: string
  private readonly onRecover: ((error: unknown) => void) | undefined
  private state: PersistedPluginUpdateState | undefined
  private queue: Promise<void> = Promise.resolve()

  constructor(directory: string, options: PluginUpdateStateStoreOptions = {}) {
    this.path = join(directory, 'plugin-update-state.json')
    this.onRecover = options.onRecover
  }

  async snapshot(): Promise<PersistedPluginUpdateState> {
    let result = emptyState()
    await this.serial(async () => {
      result = cloneState(await this.load())
    })
    return result
  }

  async update(mutator: (state: PersistedPluginUpdateState) => void): Promise<PersistedPluginUpdateState> {
    let result = emptyState()
    await this.serial(async () => {
      const state = await this.load()
      mutator(state)
      await this.write(state)
      result = cloneState(state)
    })
    return result
  }

  private async serial(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work, work)
    this.queue = next.then(() => undefined, () => undefined)
    await next
  }

  private async load(): Promise<PersistedPluginUpdateState> {
    if (this.state !== undefined) return this.state
    try {
      this.state = parseState(await readFile(this.path, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.onRecover?.(error)
      this.state = emptyState()
      await this.write(this.state)
    }
    return this.state
  }

  private async write(state: PersistedPluginUpdateState): Promise<void> {
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await securePrivateDirectory(directory)
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 })
    await securePrivateFile(temporary)
    await rename(temporary, this.path)
    await securePrivateFile(this.path)
    this.state = state
  }
}
