import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readdir, stat, unlink } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import {
  MAX_RECORDING_IMPORT_BYTES,
  recordingImportFileKind,
  type PublicRecordingImportJob,
} from './recording-import-contract.js'
import { ArkmePluginError } from './services/service.js'

export interface ArkmeRecordingImportRouteOptions {
  expectedPort: number
  allowNonLoopback: boolean
  temporaryDirectory: string
}

export const RECORDING_IMPORT_TEMPORARY_FILE_TTL_MILLIS = 48 * 60 * 60_000

export async function scavengeRecordingImportTemporaryFiles(
  directory: string,
  nowMillis = Date.now(),
  ttlMillis = RECORDING_IMPORT_TEMPORARY_FILE_TTL_MILLIS,
  protectedPaths: ReadonlySet<string> = new Set(),
): Promise<number> {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch { return 0 }
  let removed = 0
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.upload')) continue
    const path = join(directory, entry.name)
    if (protectedPaths.has(path)) continue
    try {
      const metadata = await stat(path)
      if (nowMillis - metadata.mtimeMs < ttlMillis) continue
      await unlink(path)
      removed += 1
    } catch { /* Best-effort recovery cleanup. */ }
  }
  return removed
}

interface ArkmeRecordingImportAcceptor {
  recordingImportUserId(): Promise<number>
  acceptRecordingImport(
    temporaryPath: string,
    metadata: { fileName: string; mimeType: string; fileSize: number; sha256: string; startAtMillis: number },
    expectedUserId: number,
  ): Promise<PublicRecordingImportJob>
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function assertLocalRequest(req: IncomingMessage, options: ArkmeRecordingImportRouteOptions): void {
  if (!options.allowNonLoopback && !isLoopback(req.socket.remoteAddress)) {
    throw new ArkmePluginError('loopback-required', 'Arkme 插件仅允许本机访问', false, 403)
  }
  if (req.headers.origin === undefined) {
    throw new ArkmePluginError('origin-required', '录音导入需要同源页面请求', false, 403)
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

function headerText(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(encoded),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(encoded)
}

export function createArkmeRecordingImportHandler(
  service: ArkmeRecordingImportAcceptor,
  options: ArkmeRecordingImportRouteOptions,
) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let temporaryPath = ''
    let accepted = false
    try {
      if (req.method !== 'POST') throw new ArkmePluginError('method-not-allowed', '只允许 POST 请求', false, 405)
      assertLocalRequest(req, options)
      const fileSize = Number(headerText(req, 'content-length'))
      const mimeType = headerText(req, 'content-type').split(';')[0]?.trim().toLowerCase() ?? ''
      const startAtMillis = Number(headerText(req, 'x-arkme-start-at'))
      let fileName = ''
      try { fileName = decodeURIComponent(headerText(req, 'x-arkme-file-name')).trim() } catch { fileName = '' }
      if (fileName === '' || fileName.length > 255) {
        throw new ArkmePluginError('recording-import-name-invalid', '录音文件名无效', false)
      }
      try {
        recordingImportFileKind({ fileName, mimeType, fileSize, durationMillis: 1 })
      } catch (error) {
        if (error !== null && typeof error === 'object' && 'code' in error && 'message' in error) {
          const source = error as { code: string; message: string }
          throw new ArkmePluginError(source.code, source.message, false)
        }
        throw error
      }
      if (!Number.isSafeInteger(startAtMillis) || startAtMillis <= 0) {
        throw new ArkmePluginError('recording-import-start-invalid', '录音开始时间无效', false)
      }
      const expectedUserId = await service.recordingImportUserId()

      await mkdir(options.temporaryDirectory, { recursive: true, mode: 0o700 })
      temporaryPath = join(options.temporaryDirectory, `${randomUUID()}.upload`)
      const handle = await open(temporaryPath, 'wx', 0o600)
      const hash = createHash('sha256')
      let received = 0
      try {
        for await (const chunk of req) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          received += buffer.length
          if (received > fileSize || received > MAX_RECORDING_IMPORT_BYTES) {
            throw new ArkmePluginError('recording-import-size-mismatch', '录音文件大小与声明不一致', false)
          }
          hash.update(buffer)
          await handle.write(buffer)
        }
      } finally {
        await handle.close()
      }
      if (received !== fileSize) throw new ArkmePluginError('recording-import-size-mismatch', '录音文件上传不完整', false)
      const value = await service.acceptRecordingImport(temporaryPath, {
        fileName,
        mimeType,
        fileSize: received,
        sha256: hash.digest('hex'),
        startAtMillis,
      }, expectedUserId)
      accepted = true
      writeJson(res, 202, { ok: true, value })
    } catch (error) {
      const known = error instanceof ArkmePluginError
        ? error
        : new ArkmePluginError('recording-import-internal-error', '录音导入失败', true, 500, { cause: error })
      writeJson(res, known.httpStatus, {
        ok: false,
        error: { code: known.code, message: known.message, retryable: known.retryable },
      })
    } finally {
      if (!accepted && temporaryPath !== '') await unlink(temporaryPath).catch(() => undefined)
    }
  }
}
