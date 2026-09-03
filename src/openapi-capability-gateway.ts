import {
  ManagedOpenApiCredentialRejectedError,
  ManagedOpenApiCredentialUnavailableError,
  ManagedOpenApiMcpExecutionSupersededError,
  type ManagedOpenApiCredentialExecutor,
} from './openapi-mcp/types.js'
import { readBoundedResponse } from './openapi-mcp/bounded-response.js'

const REQUEST_TIMEOUT_MILLIS = 20_000

export class OpenApiCapabilityError extends Error {
  constructor(
    readonly code: 'invalid-input' | 'unavailable' | 'invalid-response' | 'login-required' | 'account-changed',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'OpenApiCapabilityError'
  }
}

export interface OpenApiTeamCapabilityClient {
  list(input: { limit: number; page_cursor?: string }, signal: AbortSignal): Promise<unknown>
  resolve(input: { items: Array<{ item_id: string; query: string; limit?: number; page_cursor?: string }> }, signal: AbortSignal): Promise<unknown>
  listMembers(input: { team_ref: string; limit: number; page_cursor?: string }, signal: AbortSignal): Promise<unknown>
  create(input: { items: Array<{ item_id: string; idempotency_key: string; name: string; jotmo_id: string }> }, signal: AbortSignal): Promise<unknown>
  joinByJotmoID(input: { items: Array<{ item_id: string; jotmo_id: string }> }, signal: AbortSignal): Promise<unknown>
}

export class HttpOpenApiCapabilityGateway implements OpenApiTeamCapabilityClient {
  private readonly baseURL: URL

  constructor(
    baseURL: string,
    private readonly credentials: ManagedOpenApiCredentialExecutor,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const parsed = new URL(baseURL)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username !== '' || parsed.password !== ''
      || parsed.search !== '' || parsed.hash !== '' || (parsed.pathname !== '' && parsed.pathname !== '/')) {
      throw new TypeError('Arkme OpenAPI base URL must be an HTTP origin')
    }
    parsed.pathname = '/'
    this.baseURL = parsed
  }

  async list(input: { limit: number; page_cursor?: string }, signal: AbortSignal): Promise<unknown> {
    return await this.post('/api/v1/teams/list', input, signal)
  }

  async resolve(input: { items: Array<{ item_id: string; query: string; limit?: number; page_cursor?: string }> }, signal: AbortSignal): Promise<unknown> {
    return await this.post('/api/v1/teams/resolve', input, signal)
  }

  async listMembers(input: { team_ref: string; limit: number; page_cursor?: string }, signal: AbortSignal): Promise<unknown> {
    return await this.post('/api/v1/teams/members/list', input, signal)
  }

  async create(input: { items: Array<{ item_id: string; idempotency_key: string; name: string; jotmo_id: string }> }, signal: AbortSignal): Promise<unknown> {
    return await this.post('/api/v1/teams/create', input, signal)
  }

  async joinByJotmoID(input: { items: Array<{ item_id: string; jotmo_id: string }> }, signal: AbortSignal): Promise<unknown> {
    return await this.post('/api/v1/teams/join-by-jotmo-id', input, signal)
  }

  private async post(path: string, input: unknown, callerSignal: AbortSignal): Promise<unknown> {
    try {
      return await this.credentials.executeWithCredential(callerSignal, async (apiKey, lifecycleSignal) => {
        const endpoint = new URL(path, this.baseURL)
        let response: Response
        try {
          response = await this.fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey.reveal()}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(input),
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.any([lifecycleSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MILLIS)]),
          })
        } catch (error) {
          if (lifecycleSignal.aborted) throw lifecycleSignal.reason ?? error
          throw new OpenApiCapabilityError('unavailable', 'Arkme 开放平台暂时不可用', true)
        }
        if (response.status === 401) {
          try { await response.body?.cancel() } catch { /* credential rejection remains authoritative */ }
          throw new ManagedOpenApiCredentialRejectedError()
        }
        let raw: string
        try {
          raw = await readBoundedResponse(response)
        } catch {
          throw new OpenApiCapabilityError('invalid-response', 'Arkme 开放平台响应无效', true)
        }
        let envelope: unknown
        try {
          envelope = JSON.parse(raw)
        } catch {
          throw new OpenApiCapabilityError('invalid-response', 'Arkme 开放平台响应无效', true)
        }
        if (!response.ok) {
          if (response.status === 400) throw new OpenApiCapabilityError('invalid-input', '团队请求参数无效', false)
          const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500
          throw new OpenApiCapabilityError('unavailable', 'Arkme 开放平台暂时不可用', retryable)
        }
        if (!isObject(envelope) || envelope.code !== 200 || !Object.hasOwn(envelope, 'data')) {
          throw new OpenApiCapabilityError('invalid-response', 'Arkme 开放平台响应无效', true)
        }
        return envelope.data
      })
    } catch (error) {
      if (callerSignal.aborted) throw callerSignal.reason ?? error
      if (error instanceof OpenApiCapabilityError) throw error
      if (error instanceof ManagedOpenApiCredentialUnavailableError) {
        throw new OpenApiCapabilityError('login-required', '请先登录并等待 Arkme 开放平台连接就绪', true)
      }
      if (error instanceof ManagedOpenApiMcpExecutionSupersededError) {
        throw new OpenApiCapabilityError('account-changed', '账号已切换，请重试团队请求', true)
      }
      if (error instanceof ManagedOpenApiCredentialRejectedError) {
        throw new OpenApiCapabilityError('unavailable', 'Arkme 开放平台连接正在恢复，请稍后重试', true)
      }
      throw new OpenApiCapabilityError('unavailable', 'Arkme 开放平台暂时不可用', true)
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
