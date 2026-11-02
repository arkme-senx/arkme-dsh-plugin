import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { EncryptedReferenceCodec } from './encrypted-reference.js'
import type { ArkmeLocalFile } from './file-transfer-contract.js'
import { ArkmePluginError } from './services/service.js'

export const GENERATED_ARTIFACT_PREFIX = 'arkme-generated-v1'
const MAX_BYTES = 1024 * 1024 * 1024
const TTL = 60 * 60_000
const invalid = () => new ArkmePluginError('generated-file-unavailable', '生成文件已过期或不属于当前账号，请重新导出', false, 404)

/** Immutable request-generated downloads. No upload queue, reception manifest,
 * source-file staging limit or user-controlled path participates in this store. */
export class GeneratedArtifacts {
  private active = false
  private readonly codec: EncryptedReferenceCodec
  constructor(private readonly directory: string, secret: () => Promise<string>, private readonly currentUser: () => Promise<number>, private readonly sourceRevision?: (signal?: AbortSignal) => Promise<number>, private readonly format = { prefix: GENERATED_ARTIFACT_PREFIX, extension: 'md', mimeType: 'text/markdown; charset=utf-8' }) {
    this.codec = new EncryptedReferenceCodec(secret, invalid)
  }
  async create<T>(userId: number, fileName: string, produce: (write: (text: string | Uint8Array) => Promise<void>) => Promise<T>, signal?: AbortSignal) {
    if (this.active) throw new ArkmePluginError('generated-file-busy', '已有导出正在生成，请稍后重试', true, 429)
    this.active = true
    const id = randomUUID(), partial = join(this.directory, `${id}.part`), path = join(this.directory, `${id}.${this.format.extension}`)
    let published = false
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const sourceRevision = await this.sourceRevision?.(signal)
      const retainedBytes = await this.cleanup()
      signal?.throwIfAborted()
      const file = await open(partial, 'wx', 0o600)
      let size = 0
      const hash = createHash('sha256')
      let result: T
      try {
        result = await produce(async text => {
          signal?.throwIfAborted()
          const bytes = typeof text === 'string' ? Buffer.from(text, 'utf8') : Buffer.from(text)
          if (size + bytes.length > MAX_BYTES || retainedBytes + size + bytes.length > 2 * MAX_BYTES) throw new ArkmePluginError('generated-file-too-large', '完整导出超过文件大小上限', false, 413)
          await file.writeFile(bytes)
          size += bytes.length; hash.update(bytes)
        })
        await file.sync()
      } finally { await file.close() }
      signal?.throwIfAborted()
      if (await this.currentUser() !== userId) throw invalid()
      if (this.sourceRevision && sourceRevision !== await this.sourceRevision(signal)) throw invalid()
      const expiresAtMillis = Date.now() + TTL
      await rename(partial, path)
      const fileRef = await this.codec.seal(this.format.prefix, { id, userId, size, fileName, expiresAtMillis, sha256: hash.digest('hex'), ...(sourceRevision === undefined ? {} : { sourceRevision }) })
      signal?.throwIfAborted()
      if (await this.currentUser() !== userId) throw invalid()
      published = true
      return { file: { fileRef, fileName, size, expiresAtMillis }, result }
    } finally {
      this.active = false
      await unlink(partial).catch(() => undefined)
      if (!published) await unlink(path).catch(() => undefined)
    }
  }
  async read(ref: string, signal?: AbortSignal): Promise<{ path: string; file: ArkmeLocalFile }> {
    const payload = await this.codec.open(this.format.prefix, ref)
    if (payload.userId !== await this.currentUser() || typeof payload.id !== 'string' || !/^[0-9a-f-]{36}$/.test(payload.id)
      || typeof payload.expiresAtMillis !== 'number' || payload.expiresAtMillis <= Date.now()
      || typeof payload.size !== 'number' || payload.size < 1 || payload.size > MAX_BYTES
      || typeof payload.fileName !== 'string') throw invalid()
    if (this.sourceRevision && payload.sourceRevision !== await this.sourceRevision(signal)) throw invalid()
    const path = join(this.directory, `${payload.id}.${this.format.extension}`)
    const info = await stat(path).catch(() => undefined)
    if (!info?.isFile() || info.size !== payload.size) throw invalid()
    return { path, file: { fileRef: ref, fileName: payload.fileName, size: info.size, mimeType: this.format.mimeType, fileKind: 4 } }
  }
  private async cleanup(): Promise<number> {
    let retained = 0
    for (const name of await readdir(this.directory)) {
      if (!/^[0-9a-f-]{36}\.(md|zip|part)$/.test(name)) continue
      const path = join(this.directory, name), info = await stat(path).catch(() => undefined)
      if (info && Date.now() - info.mtimeMs > TTL) await unlink(path).catch(() => undefined)
      else retained += info?.size ?? 0
    }
    return retained
  }
}
