import type { IncomingMessage, ServerResponse } from 'node:http'
import { ArkmePluginError } from '../arkme-service.js'
import type { ArkmePluginResponse } from '../types.js'
import type { ArkmeExtensionManager } from './manager.js'
import {
  ARKME_EXTENSION_ICON_MAX_BYTES, type ArkmeExtensionIconMediaType, type ArkmeExtensionIconResult,
} from './types.js'

export interface ArkmeExtensionIconRouteOptions {
  expectedPort: number
  allowNonLoopback: boolean
  manager(): ArkmeExtensionManager | undefined
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function headerText(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function assertLocalRequest(req: IncomingMessage, options: ArkmeExtensionIconRouteOptions, requireOrigin: boolean): void {
  if (!options.allowNonLoopback && !isLoopback(req.socket.remoteAddress)) {
    throw new ArkmePluginError('loopback-required', 'Arkme 插件仅允许本机访问', false, 403)
  }
  if (req.headers.origin === undefined) {
    if (requireOrigin) throw new ArkmePluginError('origin-required', '扩展头像修改必须从当前 DSH 页面发起', false, 403)
    return
  }
  let origin: URL
  try { origin = new URL(req.headers.origin) } catch (error) {
    throw new ArkmePluginError('origin-invalid', '请求来源无效', false, 403, { cause: error })
  }
  const port = origin.port === '' ? (origin.protocol === 'https:' ? 443 : 80) : Number(origin.port)
  if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || port !== options.expectedPort) {
    throw new ArkmePluginError('origin-rejected', '请求来源不受信任', false, 403)
  }
}

function requiredManager(options: ArkmeExtensionIconRouteOptions): ArkmeExtensionManager {
  const manager = options.manager()
  if (manager === undefined) throw new ArkmePluginError('extension-runtime-unavailable', '扩展运行时暂不可用', true, 503)
  return manager
}

function writeJson(res: ServerResponse, status: number, body: ArkmePluginResponse<ArkmeExtensionIconResult>): void {
  const encoded = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(encoded),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(encoded)
}

export function createArkmeExtensionIconUploadHandler(options: ArkmeExtensionIconRouteOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'POST') throw new ArkmePluginError('method-not-allowed', '只允许 POST 请求', false, 405)
      assertLocalRequest(req, options, true)
      const extensionId = headerText(req, 'x-arkme-extension-id').trim()
      const idempotencyKey = headerText(req, 'x-arkme-idempotency-key').trim()
      const mediaType = headerText(req, 'content-type').split(';')[0]?.trim().toLowerCase() as ArkmeExtensionIconMediaType
      const plannedSize = Number(headerText(req, 'content-length'))
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(extensionId)
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)
        || !['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)
        || !Number.isSafeInteger(plannedSize) || plannedSize <= 0 || plannedSize > ARKME_EXTENSION_ICON_MAX_BYTES) {
        throw new ArkmePluginError('extension-icon-metadata-invalid', '扩展头像类型、大小或扩展身份无效', false, 400)
      }
      const chunks: Buffer[] = []
      let received = 0
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        received += buffer.byteLength
        if (received > plannedSize || received > ARKME_EXTENSION_ICON_MAX_BYTES) {
          throw new ArkmePluginError('extension-icon-size-mismatch', '扩展头像大小与声明不一致', false, 400)
        }
        chunks.push(buffer)
      }
      if (received !== plannedSize) throw new ArkmePluginError('extension-icon-size-mismatch', '扩展头像上传不完整', false, 400)
      const result = await requiredManager(options).setIcon({
        extensionId,
        mediaType,
        data: new Uint8Array(Buffer.concat(chunks)),
        idempotencyKey,
      })
      writeJson(res, 200, { ok: true, value: result })
    } catch (error) {
      const known = error instanceof ArkmePluginError
        ? error
        : new ArkmePluginError('extension-icon-upload-internal', '扩展头像上传失败', true, 500, { cause: error })
      writeJson(res, known.httpStatus, { ok: false, error: { code: known.code, message: known.message, retryable: known.retryable } })
    }
  }
}

export function createArkmeExtensionIconReadHandler(options: ArkmeExtensionIconRouteOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new ArkmePluginError('method-not-allowed', '只允许 GET 或 HEAD 请求', false, 405)
      }
      assertLocalRequest(req, options, false)
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${String(options.expectedPort)}`)
      const extensionId = url.searchParams.get('extension_id') ?? ''
      const iconRef = url.searchParams.get('icon_ref') ?? ''
      const value = await requiredManager(options).readIcon(extensionId, iconRef)
      const etag = `"${value.iconRef}"`
      if (headerText(req, 'if-none-match') === etag) {
        res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, max-age=86400, immutable' })
        res.end()
        return
      }
      res.writeHead(200, {
        'Content-Type': value.mediaType,
        'Content-Length': value.data.byteLength,
        'Cache-Control': 'private, max-age=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
        ETag: etag,
      })
      if (req.method === 'HEAD') res.end()
      else res.end(value.data)
    } catch (error) {
      const known = error instanceof ArkmePluginError
        ? error
        : new ArkmePluginError('extension-icon-read-internal', '扩展头像读取失败', true, 500, { cause: error })
      if (!res.headersSent) writeJson(res, known.httpStatus, {
        ok: false,
        error: { code: known.code, message: known.message, retryable: known.retryable },
      })
      else res.destroy(error instanceof Error ? error : undefined)
    }
  }
}
