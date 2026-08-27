import type { IncomingMessage, ServerResponse } from 'node:http'
import { ArkmePluginError } from './arkme-service.js'
import {
  ARKME_VOICEPRINT_ENROLLMENT_MAX_AUDIO_BYTES,
  ARKME_VOICEPRINT_ENROLLMENT_MAX_DURATION_MS,
  ARKME_VOICEPRINT_ENROLLMENT_MIN_DURATION_MS,
  type ArkmePluginResponse,
  type ArkmeVoiceprintEnrollmentResult,
} from './types.js'
import { validateVoiceprintPcm16Wav } from './voiceprint-wav.js'
import type { ArkmeBoundVoiceprintEnrollment } from './services/voiceprint-service.js'

export interface ArkmeVoiceprintEnrollmentPort {
  bindVoiceprintEnrollment(): Promise<ArkmeBoundVoiceprintEnrollment>
}

export interface ArkmeVoiceprintRouteOptions {
  expectedPort: number
  allowNonLoopback: boolean
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function headerText(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function assertLocalRequest(req: IncomingMessage, options: ArkmeVoiceprintRouteOptions): void {
  if (!options.allowNonLoopback && !isLoopback(req.socket.remoteAddress)) {
    throw new ArkmePluginError('loopback-required', 'Arkme 插件仅允许本机访问', false, 403)
  }
  if (req.headers.origin === undefined) {
    throw new ArkmePluginError('origin-required', '请求来源无效', false, 403)
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

function writeJson(
  res: ServerResponse,
  status: number,
  body: ArkmePluginResponse<ArkmeVoiceprintEnrollmentResult>,
): void {
  const encoded = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(encoded),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(encoded)
}

export function createArkmeVoiceprintEnrollmentHandler(
  enrollment: ArkmeVoiceprintEnrollmentPort,
  options: ArkmeVoiceprintRouteOptions,
) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const requestAbort = new AbortController()
    const abortRequest = () => { requestAbort.abort() }
    const abortClosedResponse = () => { if (!res.writableEnded) requestAbort.abort() }
    req.once('aborted', abortRequest)
    res.once('close', abortClosedResponse)
    try {
      if (req.method !== 'POST') throw new ArkmePluginError('method-not-allowed', '只允许 POST 请求', false, 405)
      assertLocalRequest(req, options)
      const contentType = headerText(req, 'content-type').split(';')[0]?.trim().toLowerCase()
      const durationMs = Number(headerText(req, 'x-arkme-duration-ms').trim())
      const plannedSize = Number(headerText(req, 'content-length').trim())
      if (contentType !== 'audio/wav'
        || !Number.isSafeInteger(durationMs)
        || durationMs < ARKME_VOICEPRINT_ENROLLMENT_MIN_DURATION_MS
        || durationMs > ARKME_VOICEPRINT_ENROLLMENT_MAX_DURATION_MS
        || !Number.isSafeInteger(plannedSize)
        || plannedSize < 44
        || plannedSize > ARKME_VOICEPRINT_ENROLLMENT_MAX_AUDIO_BYTES) {
        throw new ArkmePluginError('voiceprint-enrollment-metadata-invalid', '声纹录音格式、时长或大小无效', false)
      }
      const boundEnrollment = await enrollment.bindVoiceprintEnrollment()
      const chunks: Buffer[] = []
      let received = 0
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        received += buffer.byteLength
        if (received > plannedSize || received > ARKME_VOICEPRINT_ENROLLMENT_MAX_AUDIO_BYTES) {
          throw new ArkmePluginError('voiceprint-enrollment-size-mismatch', '声纹录音上传不完整', false)
        }
        chunks.push(buffer)
      }
      if (received !== plannedSize) {
        throw new ArkmePluginError('voiceprint-enrollment-size-mismatch', '声纹录音上传不完整', false)
      }
      const wav = new Uint8Array(Buffer.concat(chunks))
      try { validateVoiceprintPcm16Wav(wav, durationMs) }
      catch (error) {
        throw new ArkmePluginError('voiceprint-enrollment-wav-invalid', '声纹录音必须是时长匹配的单声道 PCM16 WAV', false, 400, { cause: error })
      }
      const value = await boundEnrollment.enrollVoiceprintWav({ wav, durationMs }, { signal: requestAbort.signal })
      writeJson(res, 200, { ok: true, value })
    } catch (error) {
      const known = error instanceof ArkmePluginError
        ? error
        : new ArkmePluginError('voiceprint-enrollment-internal-error', '声纹录入失败', true, 500, { cause: error })
      if (!res.destroyed && !res.writableEnded) {
        writeJson(res, known.httpStatus, {
          ok: false,
          error: { code: known.code, message: known.message, retryable: known.retryable },
        })
      }
    } finally {
      req.off('aborted', abortRequest)
      res.off('close', abortClosedResponse)
    }
  }
}
