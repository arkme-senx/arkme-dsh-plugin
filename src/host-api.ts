import type { IncomingMessage, ServerResponse } from 'node:http'
import { ArkmePluginError, ArkmeService } from './arkme-service.js'
import { ArkmeOutgoingCallError, type ArkmeOutgoingCallFailureCode } from './outgoing-call-contract.js'
import type {
  ArkmePluginRequest, ArkmePluginResponse, ArkmeRecordCursor, ArkmeSourceDirectory, ArkmeTimelineCursor,
} from './types.js'
import type { ArkmeCaptchaResult } from './types.js'

const MAX_REQUEST_BYTES = 128 * 1024

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

async function readRequest(req: IncomingMessage): Promise<ArkmePluginRequest> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_REQUEST_BYTES) {
      throw new ArkmePluginError('request-too-large', '请求内容过大', false, 413)
    }
    chunks.push(buffer)
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    throw new ArkmePluginError('request-invalid', '请求 JSON 无效', false, 400, { cause: error })
  }
  if (value === null || typeof value !== 'object') {
    throw new ArkmePluginError('request-invalid', '请求格式无效', false)
  }
  const source = value as Record<string, unknown>
  if (typeof source.operation !== 'string') {
    throw new ArkmePluginError('operation-required', '缺少操作类型', false)
  }
  return {
    operation: source.operation as ArkmePluginRequest['operation'],
    ...(source.params !== null && typeof source.params === 'object'
      ? { params: source.params as Record<string, unknown> }
      : {}),
  }
}

function writeJson(res: ServerResponse, status: number, body: ArkmePluginResponse): void {
  const encoded = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(encoded),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(encoded)
}

function stringParam(params: Record<string, unknown>, key: string): string {
  return typeof params[key] === 'string' ? params[key] : ''
}

function numberParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanParam(params: Record<string, unknown>, key: string): boolean {
  return params[key] === true
}

function requiredCallParam(
  params: Record<string, unknown>,
  key: string,
  code: string,
  maxLength = 512,
): string {
  const value = stringParam(params, key).trim()
  if (value === '' || value.length > maxLength) {
    throw new ArkmePluginError(code, '呼叫请求参数无效', false)
  }
  return value
}

function outgoingMediaTypeParam(params: Record<string, unknown>): 'audio' | 'video' {
  const value = stringParam(params, 'mediaType')
  if (value !== 'audio' && value !== 'video') {
    throw new ArkmePluginError('call-media-type-invalid', '呼叫媒体类型无效', false)
  }
  return value
}

const OUTGOING_FAILURE_CODES = new Set<ArkmeOutgoingCallFailureCode>([
  'call-ui-unavailable',
  'call-active',
  'call-source-invalid',
  'call-peer-unavailable',
  'call-permission-denied',
  'call-bootstrap-failed',
  'call-engine-failed',
  'call-cancelled',
])

function outgoingFailureCodeParam(params: Record<string, unknown>): ArkmeOutgoingCallFailureCode {
  const code = stringParam(params, 'code') as ArkmeOutgoingCallFailureCode
  if (!OUTGOING_FAILURE_CODES.has(code)) {
    throw new ArkmePluginError('call-failure-invalid', '呼叫失败类型无效', false)
  }
  return code
}

function cursorParam(params: Record<string, unknown>): ArkmeRecordCursor | undefined {
  const raw = params.cursor
  if (raw === null || typeof raw !== 'object') return undefined
  const cursor = raw as Record<string, unknown>
  const sendAtMillis = numberParam(cursor, 'sendAtMillis', 0)
  const recordUid = stringParam(cursor, 'recordUid')
  return sendAtMillis > 0 && recordUid !== '' ? { sendAtMillis, recordUid } : undefined
}

function timelineCursorParam(params: Record<string, unknown>): ArkmeTimelineCursor | undefined {
  const raw = params.cursor
  if (raw === null || typeof raw !== 'object') return undefined
  const cursor = raw as Record<string, unknown>
  const sendAtMillis = numberParam(cursor, 'sendAtMillis', 0)
  const itemUid = stringParam(cursor, 'itemUid')
  const beforeSequence = numberParam(cursor, 'beforeSequence', 0)
  if (beforeSequence > 0) return { beforeSequence }
  return sendAtMillis > 0 && itemUid !== '' ? { sendAtMillis, itemUid } : undefined
}

function captchaParam(params: Record<string, unknown>): ArkmeCaptchaResult {
  const raw = params.captcha
  const source = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    lot_number: stringParam(source, 'lot_number'),
    captcha_output: stringParam(source, 'captcha_output'),
    pass_token: stringParam(source, 'pass_token'),
    gen_time: stringParam(source, 'gen_time'),
  }
}

export interface ArkmeHostApiOptions {
  expectedPort: number
  allowNonLoopback: boolean
}

export function createArkmeHostApi(service: ArkmeService, options: ArkmeHostApiOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'POST') {
        throw new ArkmePluginError('method-not-allowed', '只允许 POST 请求', false, 405)
      }
      if (!options.allowNonLoopback && !isLoopback(req.socket.remoteAddress)) {
        throw new ArkmePluginError('loopback-required', 'Arkme 插件仅允许本机访问', false, 403)
      }
      const origin = req.headers.origin
      if (origin !== undefined) {
        let parsed: URL
        try {
          parsed = new URL(origin)
        } catch (error) {
          throw new ArkmePluginError('origin-invalid', '请求来源无效', false, 403, { cause: error })
        }
        const port = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port)
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || port !== options.expectedPort) {
          throw new ArkmePluginError('origin-rejected', '请求来源不受信任', false, 403)
        }
      }
      const request = await readRequest(req)
      const params = request.params ?? {}
      const value = await dispatchArkmeHostOperation(service, request.operation, params)
      writeJson(res, 200, { ok: true, value })
    } catch (error) {
      const known = error instanceof ArkmePluginError
        ? error
        : error instanceof ArkmeOutgoingCallError
          ? new ArkmePluginError(error.code, error.message, error.retryable, error.code === 'call-active' ? 409 : 400)
          : new ArkmePluginError('internal-error', 'Arkme 插件处理失败', true, 500, { cause: error })
      writeJson(res, known.httpStatus, {
        ok: false,
        error: { code: known.code, message: known.message, retryable: known.retryable },
      })
    }
  }
}

export async function dispatchArkmeHostOperation(
  service: ArkmeService,
  operation: ArkmePluginRequest['operation'],
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (operation) {
    case 'provider.capabilities': return service.providerCapabilities()
    case 'provider.state': return await service.providerState()
    case 'chat.realtime.state': return service.chatRealtimeState()
    case 'auth.status': return await service.authStatus()
    case 'auth.config': return service.clientConfig()
    case 'auth.begin': return await service.beginWechatLogin()
    case 'auth.poll': return await service.pollWechatLogin(stringParam(params, 'attemptId'))
    case 'auth.test.login': return await service.testLogin(numberParam(params, 'userId', 0))
    case 'auth.phone.send': return await service.sendPhoneCode(
      stringParam(params, 'phone'),
      captchaParam(params),
    )
    case 'auth.phone.verify': return await service.verifyPhoneCode(
      stringParam(params, 'phone'),
      stringParam(params, 'code'),
    )
    case 'auth.logout': return await service.logout()
    case 'recordings.calendar': return await service.recordingCalendar(
      numberParam(params, 'fromStamp', 0),
      numberParam(params, 'toStamp', 0),
    )
    case 'recordings.day': return await service.recordingDay(numberParam(params, 'dateStamp', 0))
    case 'records.cache': return await service.cachedSnapshot()
    case 'records.refresh': return await service.refreshSnapshot()
    case 'records.search': {
      const beforeMillis = numberParam(params, 'beforeMillis', 0)
      return await service.searchRecords({
        query: stringParam(params, 'query'),
        limit: numberParam(params, 'limit', 10),
        ...(beforeMillis > 0 ? { beforeMillis } : {}),
        syncAll: booleanParam(params, 'syncAll'),
      })
    }
    case 'records.summary': return await service.summary()
    case 'records.list': return await service.list(numberParam(params, 'limit', 30), cursorParam(params))
    case 'records.create': return await service.createText(
      stringParam(params, 'recordUid'),
      stringParam(params, 'textContent'),
    )
    case 'records.outbox': return await service.pendingWrites()
    case 'records.retry': return await service.retryPending(stringParam(params, 'recordUid'))
    case 'user.profile': return await service.cachedProfile()
    case 'user.profile.refresh': return await service.refreshProfile()
    case 'image.read': {
      const image = await service.readImage(stringParam(params, 'imageRef'))
      return {
        mediaType: image.mediaType,
        bytes: image.bytes,
        dataBase64: Buffer.from(image.data).toString('base64'),
      }
    }
    case 'official-community.entry-state': return await service.officialCommunityEntryState()
    case 'official-community.join': return await service.joinOfficialCommunity()
    case 'sources.list': return await service.listSources(
      stringParam(params, 'directory') as ArkmeSourceDirectory,
      {
        limit: numberParam(params, 'limit', 30),
        ...(stringParam(params, 'cursor') === '' ? {} : { cursor: stringParam(params, 'cursor') }),
      },
    )
    case 'source.timeline': {
      const cursor = timelineCursorParam(params)
      return await service.readSource(
        stringParam(params, 'sourceRef'),
        { limit: numberParam(params, 'limit', 30), ...(cursor === undefined ? {} : { cursor }) },
      )
    }
    case 'source.mark-read': return await service.markSourceRead(
      stringParam(params, 'sourceRef'),
      numberParam(params, 'readSequence', 0),
    )
    case 'source.send-text': return await service.sendSourceText(
      stringParam(params, 'sourceRef'),
      stringParam(params, 'textContent'),
      {
        ...(stringParam(params, 'recordUid') === '' ? {} : { recordUid: stringParam(params, 'recordUid') }),
        ...(stringParam(params, 'relationUid') === '' ? {} : { relationUid: stringParam(params, 'relationUid') }),
      },
    )
    case 'calls.outgoing.intent.claim': return await service.claimOutgoingCallIntent()
    case 'calls.outgoing.intent.resolve': {
      const intentId = requiredCallParam(params, 'intentId', 'call-intent-invalid')
      const claimToken = requiredCallParam(params, 'claimToken', 'call-intent-invalid')
      const status = stringParam(params, 'status')
      if (status === 'calling') {
        return await service.resolveOutgoingCallIntent({
          intentId,
          claimToken,
          outcome: { status: 'calling' },
        })
      }
      if (status !== 'failed') {
        throw new ArkmePluginError('call-intent-invalid', '呼叫意图状态无效', false)
      }
      return await service.resolveOutgoingCallIntent({
        intentId,
        claimToken,
        outcome: {
          status: 'failed',
          code: outgoingFailureCodeParam(params),
          message: requiredCallParam(params, 'message', 'call-failure-invalid', 500),
        },
      })
    }
    case 'calls.outgoing.prepare': return await service.prepareOutgoingCall({
      sourceRef: requiredCallParam(params, 'sourceRef', 'call-source-invalid', 4096),
      mediaType: outgoingMediaTypeParam(params),
      callRequestId: requiredCallParam(params, 'callRequestId', 'call-request-invalid'),
    })
    case 'calls.outgoing.heartbeat': return await service.heartbeatOutgoingCall(
      requiredCallParam(params, 'callRequestId', 'call-request-invalid'),
    )
    case 'calls.outgoing.release': return await service.releaseOutgoingCall(
      requiredCallParam(params, 'callRequestId', 'call-request-invalid'),
    )
    default: throw new ArkmePluginError('operation-unknown', '不支持的Arkme 插件操作', false, 404)
  }
}
