import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, unlink } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { arkmeCanInlineLocalFile, arkmeNormalizedFileMimeType, arkmePickedFileKind } from './file-transfer-contract.js'
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

function writeJson(res: ServerResponse, status: number, body: ArkmePluginResponse<unknown>): void {
  const encoded = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(encoded), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(encoded)
}

function headerText(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function clientExpectedUserId(req: IncomingMessage): number | undefined {
  const raw = headerText(req, 'x-arkme-expected-user-id').trim()
  if (raw === '') return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0 || String(value) !== raw) {
    throw new ArkmePluginError('file-expected-user-invalid', '文件操作的预期账号无效', false, 400)
  }
  return value
}

async function assertRouteUser(service: ArkmeService, expectedUserId: number): Promise<void> {
  if (await service.fileSessionUser() !== expectedUserId) {
    throw new ArkmePluginError('file-account-changed', '账号已切换，本次文件操作已取消', false, 409)
  }
}

export function createArkmeUploadHandler(service: ArkmeService, options: ArkmeRichMediaRouteOptions, mode: 'upload' | 'stage' = 'upload') {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let temporaryPath = ''
    try {
      if (req.method !== 'POST') throw new ArkmePluginError('method-not-allowed', '只允许 POST 请求', false, 405)
      assertLocalRequest(req, options)
      const requestedUserId = clientExpectedUserId(req)
      const expectedUserId = await service.fileSessionUser()
      if (requestedUserId !== undefined && requestedUserId !== expectedUserId) {
        throw new ArkmePluginError('file-account-changed', '账号已切换，本次文件操作已取消', false, 409)
      }
      await assertRouteUser(service, expectedUserId)
      const plannedSize = Number(headerText(req, 'content-length'))
      const encodedName = headerText(req, 'x-arkme-file-name')
      const mimeType = headerText(req, 'content-type').split(';')[0]?.trim() || 'application/octet-stream'
      let fileName = ''
      try { fileName = decodeURIComponent(encodedName).trim() } catch { fileName = '' }
      if (!Number.isSafeInteger(plannedSize) || plannedSize <= 0 || plannedSize > options.maxUploadBytes || fileName === '' || fileName.length > 255) {
        throw new ArkmePluginError('upload-metadata-invalid', '文件为空、过大或文件名无效', false, 400)
      }
      const normalizedMimeType = arkmeNormalizedFileMimeType(mimeType, fileName)
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
      await assertRouteUser(service, expectedUserId)
      const uploadedFileKind = normalizedMimeType.startsWith('audio/') ? 2 : arkmePickedFileKind(normalizedMimeType, fileName)
      const value = mode === 'stage'
        ? await service.fileStage(temporaryPath, { size: received, mimeType: normalizedMimeType, fileName }, expectedUserId)
        : await service.uploadLocalFile(
          temporaryPath,
          { size: received, sha256: hash.digest('hex'), mimeType: normalizedMimeType, fileName, fileKind: uploadedFileKind },
          { expectedUserId },
        )
      writeJson(res, 200, { ok: true, value })
    } catch (error) {
      const known = error instanceof ArkmePluginError ? error : new ArkmePluginError('upload-internal-error', '文件上传失败', true, 500, { cause: error })
      writeJson(res, known.httpStatus, { ok: false, error: { code: known.code, message: known.message, retryable: known.retryable } })
    } finally {
      if (temporaryPath !== '') await unlink(temporaryPath).catch(() => undefined)
    }
  }
}

export function createArkmeLocalFileHandler(service: ArkmeService, options: ArkmeRichMediaRouteOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ArkmePluginError('method-not-allowed', '只允许读取文件', false, 405)
      assertLocalRequest(req, options)
      const url = new URL(req.url ?? '/', `http://localhost:${options.expectedPort}`)
      const { path, file } = await service.fileReadLocal(url.searchParams.get('ref') ?? '')
      const safeInline = arkmeCanInlineLocalFile(file.mimeType, file.fileName)
      const attachment = url.searchParams.get('download') === '1' || !safeInline
      let start = 0; let end = file.size - 1
      const range = headerText(req, 'range')
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range)
        if (!match) { res.writeHead(416, { 'Content-Range': `bytes */${file.size}` }); res.end(); return }
        start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end
        if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${file.size}` }); res.end(); return }
      }
      res.writeHead(range ? 206 : 200, {
        'Content-Type': file.mimeType, 'Content-Length': end - start + 1,
        'Content-Disposition': `${attachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'",
        'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${file.size}` } : {}),
      })
      if (req.method === 'HEAD') { res.end(); return }
      await pipeline(createReadStream(path, { start, end }), res)
    } catch (error) {
      if (res.headersSent) { res.destroy(); return }
      const known = error instanceof ArkmePluginError ? error : new ArkmePluginError('file-read-failed', '本地文件无法读取', true, 500)
      writeJson(res, known.httpStatus, { ok: false, error: { code: known.code, message: known.message, retryable: known.retryable } })
    }
  }
}

export function createArkmeMediaHandler(service: ArkmeService, options: ArkmeRichMediaRouteOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort(new Error('媒体读取超时')) }, 2_000)
    const abortOnClose = () => { controller.abort(new Error('媒体请求已取消')) }
    res.once('close', abortOnClose)
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ArkmePluginError('method-not-allowed', '只允许 GET 或 HEAD 请求', false, 405)
      assertLocalRequest(req, options)
      const ref = new URL(req.url ?? '/', `http://127.0.0.1:${String(options.expectedPort)}`).searchParams.get('ref') ?? ''
      const { response, descriptor } = await service.fetchMedia(ref, headerText(req, 'range') || undefined, controller.signal)
      clearTimeout(timeout)
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
    } finally {
      clearTimeout(timeout)
      res.removeListener('close', abortOnClose)
    }
  }
}
