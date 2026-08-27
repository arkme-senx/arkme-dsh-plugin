import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmError, ProviderRequestId } from '@deepseek-ai/dsh-llm'
import type {
  AdapterRegistrationHandle,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { SecretValue } from '../secret-value.js'

export const ARKME_MANAGED_PROVIDER = 'arkme-managed'
export const ARKME_MANAGED_MODEL = 'deepseek-v4-flash'

const ARKME_MANAGED_PROVIDER_NAME = 'Arkme'
const ARKME_MANAGED_MODEL_DESCRIPTION = '使用 Arkme 登录，无需 API Key'
const ARKME_INSUFFICIENT_BALANCE_MESSAGE = 'Arkme AI 余额不足，请前往 Arkme 设置中的余额充值后重试'
const ARKME_LOGIN_MESSAGE = '请先登录或重新登录 Arkme 后再使用托管模型'
const ARKME_MANAGED_MODELS = new Set([ARKME_MANAGED_MODEL])
const ARKME_AUTH_FAILURE_CODES = new Set([
  'login-required',
  'login-expired',
  'auth-http-401',
  'auth-http-403',
])

export interface ManagedAccessCredentialOwner {
  resolveManagedAccessCredential(): Promise<SecretValue>
}

export interface ManagedAiLlmAdapterOptions {
  intelligentBaseUrl: string
  credentialOwner: ManagedAccessCredentialOwner
  resolveAnonymousUserId?: () => AnonymousUserId
}

function managedAiBaseUrl(intelligentBaseUrl: string): string {
  return `${intelligentBaseUrl.replace(/\/+$/, '')}/api/v1/managed-ai`
}

interface ManagedAiFailureFacts {
  code: string
  status?: number
  providerRetryAfterMs?: number
  requestId?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function validHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function managedAiFailureFacts(error: unknown): ManagedAiFailureFacts {
  const source = asRecord(error)
  const failure = asRecord(source?.failure)
  const code = typeof failure?.code === 'string' && failure.code !== ''
    ? failure.code
    : typeof source?.code === 'string' && source.code !== '' ? source.code : 'MANAGED_AI_FAILED'
  const status = validHttpStatus(failure?.status) ?? validHttpStatus(source?.status) ?? validHttpStatus(source?.httpStatus)
  const providerRetryAfterMs = positiveNumber(failure?.providerRetryAfterMs)
    ?? positiveNumber(source?.providerRetryAfterMs)
    ?? positiveNumber(source?.retryAfterMillis)
  const requestId = typeof failure?.requestId === 'string' && failure.requestId !== ''
    ? failure.requestId
    : typeof source?.requestId === 'string' && source.requestId !== '' ? source.requestId : undefined
  return {
    code,
    ...(status === undefined ? {} : { status }),
    ...(providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs }),
    ...(requestId === undefined ? {} : { requestId }),
  }
}

function managedAiLocalizedFailure(facts: ManagedAiFailureFacts): { code: string; message: string } {
  if (facts.status === 402 || ['QUOTA', 'INSUFFICIENT_BALANCE'].includes(facts.code)) {
    return { code: 'INSUFFICIENT_BALANCE', message: ARKME_INSUFFICIENT_BALANCE_MESSAGE }
  }
  if (facts.status === 401 || facts.status === 403 || ['AUTH', 'CREDENTIAL_UNAVAILABLE'].includes(facts.code)) {
    return { code: 'AUTH', message: ARKME_LOGIN_MESSAGE }
  }
  if (facts.status === 429 || facts.code === 'RATE_LIMIT') {
    return { code: 'RATE_LIMIT', message: 'Arkme AI 请求过于频繁，请稍后重试' }
  }
  if ([408, 504].includes(facts.status ?? 0) || facts.code === 'TIMEOUT') {
    return { code: 'TIMEOUT', message: 'Arkme AI 响应超时，请稍后重试' }
  }
  if (facts.code === 'TRANSPORT') {
    return { code: 'TRANSPORT', message: '无法连接 Arkme AI 服务，请检查网络后重试' }
  }
  if (facts.code === 'CONTEXT_WINDOW_EXCEEDED') {
    return { code: facts.code, message: '对话内容过长，请新建对话或减少上下文后重试' }
  }
  if (['UNKNOWN_MODEL', 'NO_ADAPTER'].includes(facts.code)) {
    return { code: facts.code, message: '当前 Arkme 模型不可用，请重新选择模型后重试' }
  }
  if (facts.status === 400 || facts.status === 413 || facts.code === 'INVALID_REQUEST') {
    return { code: 'INVALID_REQUEST', message: '请求内容不符合 Arkme AI 要求，请调整后重试' }
  }
  if (facts.code === 'ABORTED') {
    return { code: facts.code, message: '本轮运行已取消' }
  }
  if (['EMPTY_RESPONSE', 'MALFORMED_RESPONSE', 'STREAM_CLOSED'].includes(facts.code)) {
    return { code: facts.code, message: 'Arkme AI 返回异常，请重新发送消息' }
  }
  if ((facts.status !== undefined && facts.status >= 500) || facts.code === 'SERVER') {
    return { code: 'SERVER', message: 'Arkme AI 服务暂不可用，请稍后重试' }
  }
  return { code: facts.code, message: 'Arkme AI 请求失败，请稍后重试' }
}

/** Convert provider and cross-module structured failures into stable Chinese user copy. */
export function localizeManagedAiError(error: unknown): LlmError {
  const facts = managedAiFailureFacts(error)
  const localized = managedAiLocalizedFailure(facts)
  return new LlmError(localized.message, localized.code, {
    cause: error,
    ...(facts.status === undefined ? {} : { status: facts.status }),
    ...(facts.providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: facts.providerRetryAfterMs }),
    ...(facts.requestId === undefined ? {} : { requestId: ProviderRequestId(facts.requestId) }),
  })
}

function assertManagedRoute(provider: string, model?: string): void {
  if (provider !== ARKME_MANAGED_PROVIDER) {
    throw new LlmError(`当前 Arkme 托管模型不支持提供商“${provider}”`, 'NO_ADAPTER')
  }
  if (model !== undefined && !ARKME_MANAGED_MODELS.has(model)) {
    throw new LlmError(`当前 Arkme 托管服务不支持模型“${model}”，请重新选择模型`, 'UNKNOWN_MODEL')
  }
}

async function resolveBearer(owner: ManagedAccessCredentialOwner): Promise<string> {
  try {
    const bearer = (await owner.resolveManagedAccessCredential()).reveal()
    if (bearer !== '') return bearer
  } catch (error) {
    const source = error as {
      code?: unknown
      httpStatus?: unknown
      message?: unknown
      retryAfterMillis?: unknown
    }
    const sourceCode = typeof source.code === 'string' ? source.code : ''
    const status = typeof source.httpStatus === 'number'
      && Number.isInteger(source.httpStatus)
      && source.httpStatus >= 100
      && source.httpStatus <= 599
      ? source.httpStatus
      : undefined
    const code = ARKME_AUTH_FAILURE_CODES.has(sourceCode)
      ? 'AUTH'
      : sourceCode === 'arkme-network-error'
        ? 'TRANSPORT'
        : sourceCode === 'arkme-timeout' || status === 504
          ? 'TIMEOUT'
          : status === 429
            ? 'RATE_LIMIT'
            : status !== undefined && status >= 500
              ? 'SERVER'
              : 'CREDENTIAL_UNAVAILABLE'
    const providerRetryAfterMs = typeof source.retryAfterMillis === 'number'
      && Number.isFinite(source.retryAfterMillis)
      && source.retryAfterMillis > 0
      ? source.retryAfterMillis
      : undefined
    throw localizeManagedAiError(new LlmError('Arkme 托管模型凭据不可用', code, {
      cause: error,
      ...(status === undefined ? {} : { status }),
      ...(providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs }),
    }))
  }
  throw new LlmError(ARKME_LOGIN_MESSAGE, 'AUTH')
}

class ManagedAiLlmAdapter extends LlmAdapter {
  constructor(private readonly delegate: DeepSeekAdapter) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: ARKME_MANAGED_PROVIDER_NAME }
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.delegate.providerRetryPolicy(provider)
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    assertManagedRoute(provider)
    return this.delegate.listModels(provider)
  }

  override async resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    assertManagedRoute(provider, model)
    return await this.delegate.resolveModel(provider, model, signal)
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    assertManagedRoute(options.provider, options.model)
    try {
      yield* this.delegate.stream(options)
    } catch (error) {
      throw localizeManagedAiError(error)
    }
  }
}

export function createManagedAiLlmAdapter(options: ManagedAiLlmAdapterOptions): LlmAdapter {
  const connection = resolveAdapterOptions({
    baseURL: managedAiBaseUrl(options.intelligentBaseUrl),
    thinking: 'enabled',
    reasoningEffort: 'high',
    maxTokens: 256_000,
    defaultContextWindow: 1_000_000,
    models: [
      {
        id: ARKME_MANAGED_MODEL,
        name: 'DeepSeek-V4-Flash',
        description: ARKME_MANAGED_MODEL_DESCRIPTION,
        contextWindow: 1_000_000,
        maxTokens: 256_000,
      },
    ],
    retryPolicy: { mode: 'normal', maxRetries: 0 },
  })
  const delegate = new DeepSeekAdapter({
    options: () => connection,
    resolveApiKey: async () => await resolveBearer(options.credentialOwner),
    resolveUserId: options.resolveAnonymousUserId ?? getOrCreateAnonymousUserId,
  })
  return new ManagedAiLlmAdapter(delegate)
}

export function registerManagedAiProvider(
  ctx: Context,
  options: ManagedAiLlmAdapterOptions,
): AdapterRegistrationHandle {
  return ctx.llm.registerAdapter([ARKME_MANAGED_PROVIDER], createManagedAiLlmAdapter(options))
}
