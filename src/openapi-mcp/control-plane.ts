import { SecretValue } from '../secret-value.js'
import { readBoundedResponse } from './bounded-response.js'
import type {
  ManagedOpenApiControlPlane,
  ManagedOpenApiControlResult,
  ManagedOpenApiCredentialObservation,
} from './types.js'

const KEY_ID = /^[0-9a-f]{24}$/
const KEY_DIGEST = /^[0-9a-f]{64}$/
const API_KEY = /^arkme_([0-9a-f]{24})_[A-Za-z0-9_-]{43}$/

export type OpenApiControlPlaneFailureKind = 'unauthorized' | 'transient' | 'contract'

export class OpenApiControlPlaneError extends Error {
  constructor(readonly kind: OpenApiControlPlaneFailureKind, message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

interface Envelope { code?: unknown; data?: unknown }

export class HttpManagedOpenApiControlPlane implements ManagedOpenApiControlPlane {
  private readonly baseUrl: string

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch,
    private readonly timeoutMs: number,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async ensure(accessToken: SecretValue, observed: ManagedOpenApiCredentialObservation | undefined, signal: AbortSignal): Promise<ManagedOpenApiControlResult> {
    if (observed !== undefined && (!KEY_ID.test(observed.keyId) || !Number.isSafeInteger(observed.generation)
      || observed.generation <= 0 || !KEY_DIGEST.test(observed.keyDigest))) {
      throw new OpenApiControlPlaneError('contract', 'OpenAPI MCP 本地凭据观察无效')
    }
    return parseControlResult(await this.post('/api/v1/platform/api-key/managed/ensure', {
      ...(observed === undefined ? {} : {
        observed_key_id: observed.keyId,
        observed_generation: observed.generation,
        observed_key_digest: observed.keyDigest,
      }),
    }, accessToken, signal))
  }

  async disconnect(apiKey: SecretValue, signal: AbortSignal): Promise<void> {
    const value = await this.post('/api/v1/platform/api-key/managed/disconnect', {}, apiKey, signal)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new OpenApiControlPlaneError('contract', 'OpenAPI MCP 断开响应无效')
    }
    const record = value as Record<string, unknown>
    if (record.state !== 'disconnected' || Object.keys(record).some(key => key !== 'state')) {
      throw new OpenApiControlPlaneError('contract', 'OpenAPI MCP 断开响应无效')
    }
  }

  private async post(path: string, body: Record<string, unknown>, bearerCredential: SecretValue, signal: AbortSignal): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs)
    const combinedSignal = AbortSignal.any([signal, timeoutSignal])
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearerCredential.reveal()}` },
        body: JSON.stringify(body),
        signal: combinedSignal,
      })
    } catch (error) {
      if (signal.aborted) throw signal.reason
      throw new OpenApiControlPlaneError('transient', 'OpenAPI MCP 控制面暂时不可用', { cause: error })
    }
    if (response.status === 401 || response.status === 403) {
      throw new OpenApiControlPlaneError('unauthorized', 'OpenAPI MCP 控制凭据已失效')
    }
    if (!response.ok) throw new OpenApiControlPlaneError('transient', 'OpenAPI MCP 控制面暂时不可用')
    let raw: string
    try { raw = await readBoundedResponse(response) } catch (error) {
      throw new OpenApiControlPlaneError('contract', 'OpenAPI MCP 控制响应超出限制', { cause: error })
    }
    let envelope: Envelope
    try { envelope = JSON.parse(raw) as Envelope } catch (error) {
      throw new OpenApiControlPlaneError('contract', 'OpenAPI MCP 控制响应不是有效 JSON', { cause: error })
    }
    if (envelope.code !== 200) throw new OpenApiControlPlaneError('transient', 'OpenAPI MCP 控制操作未成功')
    return envelope.data
  }
}

function parseControlResult(value: unknown): ManagedOpenApiControlResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenApiControlPlaneError('contract', 'OpenAPI MCP 控制响应无效')
  }
  const record = value as Record<string, unknown>
  if (record.state !== 'ready' && record.state !== 'issued') {
    throw new OpenApiControlPlaneError('contract', 'OpenAPI MCP Key 响应无效')
  }
  const allowedFields = new Set([
    'state', 'key_id', 'generation', 'expires_at', 'reconcile_after_seconds',
    ...(record.state === 'issued' ? ['api_key'] : []),
  ])
  if (Object.keys(record).some(key => !allowedFields.has(key))) {
    throw new OpenApiControlPlaneError('contract', 'OpenAPI MCP Key 响应包含未知字段')
  }
  if (!Number.isSafeInteger(record.reconcile_after_seconds)
    || (record.reconcile_after_seconds as number) < 60
    || (record.reconcile_after_seconds as number) > 7 * 24 * 60 * 60) {
    throw new OpenApiControlPlaneError('contract', 'OpenAPI MCP 协调合同无效')
  }
  const common = { reconcileAfterSeconds: record.reconcile_after_seconds as number }
  if (typeof record.key_id !== 'string' || !KEY_ID.test(record.key_id)
    || !Number.isSafeInteger(record.generation) || (record.generation as number) <= 0
    || !Number.isSafeInteger(record.expires_at) || (record.expires_at as number) <= 0) {
    throw new OpenApiControlPlaneError('contract', 'OpenAPI MCP Key 响应无效')
  }
  if (record.state === 'ready') {
    if (record.api_key !== undefined) throw new OpenApiControlPlaneError('contract', 'OpenAPI MCP ready 响应不应包含明文')
    return {
      state: record.state, keyId: record.key_id, generation: record.generation as number,
      expiresAtMillis: record.expires_at as number, ...common,
    }
  }
  if (typeof record.api_key !== 'string' || !API_KEY.test(record.api_key) || API_KEY.exec(record.api_key)?.[1] !== record.key_id) {
    throw new OpenApiControlPlaneError('contract', 'OpenAPI MCP 签发响应缺少有效明文')
  }
  return {
    state: record.state, keyId: record.key_id, generation: record.generation as number, apiKey: record.api_key,
    expiresAtMillis: record.expires_at as number, ...common,
  }
}
