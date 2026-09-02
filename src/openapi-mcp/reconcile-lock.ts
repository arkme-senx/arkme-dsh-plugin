import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { OpenApiMcpReconcileLock } from './types.js'

const STALE_AFTER_MILLIS = 2 * 60_000
const ACQUIRE_TIMEOUT_MILLIS = 5_000
const HEARTBEAT_MILLIS = 30_000

export function managedOpenApiMcpReconcileLockPath(
  credentialNamespace: string,
  coordinationRoot = join(homedir(), '.arkme', 'coordination'),
): string {
  const normalized = credentialNamespace.trim()
  if (normalized === '') throw new Error('OpenAPI MCP credential namespace is required')
  const namespaceDigest = createHash('sha256')
    .update(`arkme-openapi-mcp-lock-v1\0${normalized}`)
    .digest('hex')
  return join(coordinationRoot, 'openapi-mcp', namespaceDigest, 'reconcile.lock')
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

async function waitForLock(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const aborted = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted)
      resolve()
    }, 100)
    timer.unref()
    signal.addEventListener('abort', aborted, { once: true })
  })
}

export class FileOpenApiMcpReconcileLock implements OpenApiMcpReconcileLock {
  constructor(private readonly path: string) {}

  async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const deadline = Date.now() + ACQUIRE_TIMEOUT_MILLIS
    let handle: Awaited<ReturnType<typeof open>> | undefined
    let owner = ''
    while (handle === undefined) {
      if (signal.aborted) throw signal.reason
      try {
        const acquired = await open(this.path, 'wx', 0o600)
        const acquiredOwner = randomUUID()
        try {
          await acquired.writeFile(acquiredOwner, 'utf8')
        } catch (error) {
          await acquired.close().catch(() => undefined)
          await unlink(this.path).catch(() => undefined)
          throw error
        }
        handle = acquired
        owner = acquiredOwner
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error
        try {
          const metadata = await stat(this.path)
          if (Date.now() - metadata.mtimeMs > STALE_AFTER_MILLIS) {
            await unlink(this.path).catch(staleError => {
              if (errorCode(staleError) !== 'ENOENT') throw staleError
            })
            continue
          }
        } catch (statError) {
          if (errorCode(statError) === 'ENOENT') continue
          throw statError
        }
        if (Date.now() >= deadline) throw new Error('OpenAPI MCP 协调锁暂时不可用')
        await waitForLock(signal)
      }
    }
    const heartbeat = setInterval(() => {
      const now = new Date()
      void handle?.utimes(now, now).catch(() => undefined)
    }, HEARTBEAT_MILLIS)
    heartbeat.unref()
    try {
      return await operation()
    } finally {
      clearInterval(heartbeat)
      const acquiredMetadata = await handle.stat().catch(() => undefined)
      await handle.close()
      if (acquiredMetadata !== undefined) {
        const currentMetadata = await stat(this.path).catch(() => undefined)
        const currentOwner = await readFile(this.path, 'utf8').catch(() => undefined)
        if (currentMetadata?.dev === acquiredMetadata.dev && currentMetadata.ino === acquiredMetadata.ino && currentOwner === owner) {
          await unlink(this.path).catch(error => { if (errorCode(error) !== 'ENOENT') throw error })
        }
      }
    }
  }
}
