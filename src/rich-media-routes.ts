import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, unlink } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ArkmePluginError, ArkmeService } from './arkme-service.js'
import type { ArkmePluginResponse, ArkmeUploadedAsset } from './types.js'

export interface ArkmeRichMediaRouteOptions {
  expectedPort: number
  allowNonLoopback: boolean
  temporaryDirectory: string
  maxUploadBytes: number
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function assertLocalRequest(req: IncomingMessage, options: ArkmeRichMediaRouteOptions): void {
  if (!options.allowNonLoopback && !isLoopback(req.socket.remoteAddress)) {
    throw new ArkmePluginError('loopback-required', 'Arkme 插件仅允许本机访问', false, 403)
  }
  if (req.headers.origin === undefined) return
  let origin: URL
  try { origin = new URL(req.headers.origin) } catch (error) {
    throw new ArkmePluginError('origin-invalid', '请求来源无效', false, 403, { cause: error })
  }
  const port = origin.port === '' ? (origin.protocol === 'https:' ? 443 : 80) : Number(origin.port)
  if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || port !== options.expectedPort) {
    throw new ArkmePluginError('origin-rejected', '请求来源不受信任', false, 403)
  }
}

function writeJson(res: ServerResponse, status: number, body: ArkmePluginResponse<ArkmeUploadedAsset>): void {
  const encoded = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(encoded), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(encoded)
}

function headerText(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function fileKindFor(mimeType: string): 1 | 2 | 3 | 4 {
  if (mimeType.startsWith('image/')) return 1
  if (mimeType.startsWith('audio/')) return 2
  if (mimeType.startsWith('video/')) return 3
  return 4
}

export function createArkmeUploadHandler(service: ArkmeService, options: ArkmeRichMediaRouteOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let temporaryPath = ''
    try {
      if (req.method !== 'POST') throw new ArkmePluginError('method-not-allowed', '只允许 POST 请求', false, 405)
      assertLocalRequest(req, options)
      const plannedSize = Number(headerText(req, 'content-length'))
      const encodedName = headerText(req, 'x-arkme-file-name')
      const mimeType = headerText(req, 'content-type').split(';')[0]?.trim() || 'application/octet-stream'
      let fileName = ''
      try { fileName = decodeURIComponent(encodedName).trim() } catch { fileName = '' }
      if (!Number.isSafeInteger(plannedSize) || plannedSize <= 0 || plannedSize > options.maxUploadBytes || fileName === '' || fileName.length > 255) {
        throw new ArkmePluginError('upload-metadata-invalid', '文件为空、过大或文件名无效', false, 400)
      }
      await mkdir(options.temporaryDirectory, { recursive: true, mode: 0o700 })
      temporaryPath = join(options.temporaryDirectory, `${randomUUID()}.upload`)
      const handle = await open(temporaryPath, 'wx', 0o600)
      const hash = createHash('sha256')
      let received = 0
      try {
        for await (const chunk of req) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          received += buffer.length
          if (received > plannedSize || received > options.maxUploadBytes) throw new ArkmePluginError('upload-size-mismatch', '上传文件大小与声明不一致', false, 400)
          hash.update(buffer)
          await handle.write(buffer)
        }
      } finally { await handle.close() }
      if (received !== plannedSize) throw new ArkmePluginError('upload-size-mismatch', '上传文件不完整', false, 400)
      const value = await service.uploadLocalFile(temporaryPath, { size: received, sha256: hash.digest('hex'), mimeType, fileName, fileKind: fileKindFor(mimeType) })
      writeJson(res, 200, { ok: true, value })
    } catch (error) {
      const known = error instanceof ArkmePluginError ? error : new ArkmePluginError('upload-internal-error', '文件上传失败', true, 500, { cause: error })
      writeJson(res, known.httpStatus, { ok: false, error: { code: known.code, message: known.message, retryable: known.retryable } })
    } finally {
      if (temporaryPath !== '') await unlink(temporaryPath).catch(() => undefined)
    }
  }
}

export function createArkmeMediaHandler(service: ArkmeService, options: ArkmeRichMediaRouteOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ArkmePluginError('method-not-allowed', '只允许 GET 或 HEAD 请求', false, 405)
      assertLocalRequest(req, options)
      const ref = new URL(req.url ?? '/', `http://127.0.0.1:${String(options.expectedPort)}`).searchParams.get('ref') ?? ''
      const { response, descriptor } = await service.fetchMedia(ref, headerText(req, 'range') || undefined)
      const contentType = response.headers.get('content-type') ?? descriptor.mimeType
      const cacheableImage = contentType.toLowerCase().startsWith('image/') && response.status === 200
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Cache-Control': cacheableImage ? 'private, max-age=86400, immutable' : 'private, max-age=60',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(descriptor.fileName)}`,
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': response.headers.get('accept-ranges') ?? 'bytes',
      }
      for (const name of ['content-length', 'content-range']) {
        const value = response.headers.get(name)
        if (value !== null) headers[name] = value
      }
      res.writeHead(response.status, headers)
      if (req.method === 'HEAD' || response.body === null) { res.end(); return }
      await pipeline(Readable.fromWeb(response.body as never), res)
    } catch (error) {
      const known = error instanceof ArkmePluginError ? error : new ArkmePluginError('media-internal-error', '媒体读取失败', true, 500, { cause: error })
      if (!res.headersSent) {
        const encoded = JSON.stringify({ ok: false, error: { code: known.code, message: known.message, retryable: known.retryable } })
        res.writeHead(known.httpStatus, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(encoded), 'Cache-Control': 'no-store' })
        res.end(encoded)
      } else res.destroy(error instanceof Error ? error : undefined)
    }
  }
}
