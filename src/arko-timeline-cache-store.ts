import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { securePrivateDirectory, securePrivateFile } from './private-filesystem.js'
import { ARKO_TIMELINE_CACHE_MAX_BYTES, parseArkoTimelineCache } from './arko-timeline-cache.js'
import type { ArkmeArkoTimelineCache } from './arko-timeline-contract.js'

export class ArkoTimelineCacheStore {
  private pending = 0
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly directory: string) {}
  async access(scope: string, value?: ArkmeArkoTimelineCache): Promise<ArkmeArkoTimelineCache | undefined> {
    if (!/^(test|prod):[1-9][0-9]*$/.test(scope)) throw new Error('Arko 缓存账号无效')
    if (this.pending >= 4) throw new Error('Arko 缓存正在保存，请稍后重试')
    const incoming = value === undefined ? undefined : parseArkoTimelineCache(structuredClone(value))
    if (value !== undefined && !incoming) throw new Error('Arko 缓存内容无效或超过容量')
    const path = join(this.directory, `${createHash('sha256').update(scope).digest('hex')}.json`)
    this.pending++
    const task = this.queue.then(async () => {
      if (incoming === undefined) {
        let file: Awaited<ReturnType<typeof open>> | undefined
        try { file = await open(path, 'r'); if ((await file.stat()).size > ARKO_TIMELINE_CACHE_MAX_BYTES) return
          const raw = JSON.parse(await file.readFile('utf8')); if (raw.scope !== scope) return
          return parseArkoTimelineCache(raw.value)
        } catch { return undefined } finally { await file?.close().catch(() => undefined) }
      }
      let temporary: string | undefined
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 }); await securePrivateDirectory(this.directory)
        // Only one queued writer; stale unmount writes must not replace a newer snapshot.
        const file = await open(path, 'r').catch(() => undefined)
        if (file) try { if ((await file.stat()).size <= ARKO_TIMELINE_CACHE_MAX_BYTES) {
          const previous = JSON.parse(await file.readFile('utf8'))
          if (previous.scope === scope && previous.value?.savedAtMillis > incoming.savedAtMillis) return parseArkoTimelineCache(previous.value)
        } } catch {} finally { await file.close() }
        const serialized = JSON.stringify({ scope, value: incoming })
        if (Buffer.byteLength(serialized, 'utf8') > ARKO_TIMELINE_CACHE_MAX_BYTES) throw new Error('Arko 缓存内容无效或超过容量')
        temporary = `${path}.${randomUUID()}.tmp`
        await writeFile(temporary, serialized, { mode: 0o600, flag: 'wx' })
        await securePrivateFile(temporary); await rename(temporary, path)
        return incoming
      } finally { if (temporary) await unlink(temporary).catch(() => undefined) }
    })
    const finished = task.finally(() => { this.pending-- })
    this.queue = finished.catch(() => undefined); return finished
  }
}
