import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { securePrivateDirectory, securePrivateFile } from './private-filesystem.js'
import { ARRANGEMENT_BOARD_CACHE_MAX_BYTES, parseArrangementBoardCachePages, type ArkmeArrangementBoardCachePages } from './arrangement-board-cache.js'

/** Disposable, account/environment-scoped projection, separate from recovery evidence in state.json. */
export class ArrangementBoardCacheStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly directory: string) {}
  private path(environment: string, userId: number): string {
    if (!Number.isSafeInteger(userId) || userId <= 0 || !['test', 'prod'].includes(environment)) throw new Error('缓存账号或环境无效')
    const scope = createHash('sha256').update(JSON.stringify([environment, userId])).digest('hex')
    return join(this.directory, `arrangement-board-${scope}.json`)
  }
  private async read(environment: string, userId: number): Promise<ArkmeArrangementBoardCachePages> {
    let file: Awaited<ReturnType<typeof open>> | undefined
    try {
      file = await open(this.path(environment, userId), 'r')
      if ((await file.stat()).size > ARRANGEMENT_BOARD_CACHE_MAX_BYTES) return {}
      const value = JSON.parse(await file.readFile('utf8'))
      if (value.schemaVersion !== 1 || value.environment !== environment || value.userId !== userId) return {}
      return parseArrangementBoardCachePages(value.pages)
    } catch { return {} }
    finally { await file?.close().catch(() => undefined) }
  }
  async access(environment: string, userId: number, pages?: ArkmeArrangementBoardCachePages): Promise<ArkmeArrangementBoardCachePages> {
    // Snapshot at admission so queued callers cannot mutate a later write.
    const incoming = pages === undefined ? undefined : parseArrangementBoardCachePages(pages)
    const run = this.queue.then(async () => {
      const previous = await this.read(environment, userId)
      if (incoming === undefined) return previous
      let temporary: string | undefined
      try {
        const path = this.path(environment, userId)
        const merged = parseArrangementBoardCachePages({ ...previous, ...incoming })
        await mkdir(this.directory, { recursive: true, mode: 0o700 })
        await securePrivateDirectory(this.directory)
        temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
        await writeFile(temporary, JSON.stringify({ schemaVersion: 1, environment, userId, pages: merged }), { mode: 0o600, flag: 'wx' })
        await securePrivateFile(temporary)
        await rename(temporary, path)
        return merged
      } catch { return previous }
      finally { if (temporary) await unlink(temporary).catch(() => undefined) }
    })
    this.queue = run.catch(() => undefined)
    return run
  }
}
