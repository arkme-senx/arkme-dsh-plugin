import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ArkmePluginUpdateInstallPhase, ArkmePluginUpdateInstallSnapshot } from './types.js'
import { securePrivateDirectory, securePrivateFile } from './private-filesystem.js'

const PHASES = new Set<ArkmePluginUpdateInstallPhase>([
  'idle', 'preparing', 'downloading', 'verifying', 'installing', 'restarting', 'succeeded', 'failed', 'rolled-back',
])

function boundedString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength)
}

export function parsePluginUpdateInstallSnapshot(value: unknown): ArkmePluginUpdateInstallSnapshot | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const phase = source.phase as ArkmePluginUpdateInstallPhase
  const jobId = boundedString(source.jobId, 128)
  const previousVersion = boundedString(source.previousVersion, 128)
  const targetVersion = boundedString(source.targetVersion, 128)
  const message = boundedString(source.message, 500)
  const updatedAtMillis = source.updatedAtMillis
  if (source.schemaVersion !== 1 || !PHASES.has(phase) || jobId === ''
    || previousVersion === '' || targetVersion === '' || typeof updatedAtMillis !== 'number'
    || !Number.isFinite(updatedAtMillis) || updatedAtMillis <= 0) return undefined
  return {
    schemaVersion: 1,
    jobId,
    phase,
    previousVersion,
    targetVersion,
    message,
    updatedAtMillis,
  }
}

export class PluginUpdateInstallStateStore {
  readonly path: string

  constructor(directory: string) {
    this.path = join(directory, 'plugin-update-install-state.json')
  }

  async read(): Promise<ArkmePluginUpdateInstallSnapshot | undefined> {
    try {
      return parsePluginUpdateInstallSnapshot(JSON.parse(await readFile(this.path, 'utf8')) as unknown)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      return undefined
    }
  }

  async write(snapshot: ArkmePluginUpdateInstallSnapshot): Promise<void> {
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await securePrivateDirectory(directory)
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(snapshot, undefined, 2)}\n`, { mode: 0o600 })
    await securePrivateFile(temporary)
    await rename(temporary, this.path)
    await securePrivateFile(this.path)
  }

  async clear(): Promise<void> {
    await unlink(this.path).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }
}
