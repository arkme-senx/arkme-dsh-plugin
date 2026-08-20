import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
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
const ARKME_INSUFFICIENT_BALANCE_MESSAGE = 'Arkme AI 余额不足，请充值后重试'
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

function assertManagedRoute(provider: string, model?: string): void {
  if (provider !== ARKME_MANAGED_PROVIDER) {
    throw new LlmError(`Arkme managed adapter does not own provider "${provider}"`, 'NO_ADAPTER')
  }
  if (model !== undefined && !ARKME_MANAGED_MODELS.has(model)) {
    throw new LlmError(`Arkme managed provider does not support model "${model}"`, 'UNKNOWN_MODEL')
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
    const message = typeof source.message === 'string' && source.message !== ''
      ? source.message
      : '请先登录 Arkme'
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
    throw new LlmError(message, code, {
      cause: error,
      ...(status === undefined ? {} : { status }),
      ...(providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs }),
    })
  }
  throw new LlmError('请先登录 Arkme', 'AUTH')
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
      if (error instanceof LlmError && error.failure.status === 402) {
        throw new LlmError(ARKME_INSUFFICIENT_BALANCE_MESSAGE, 'INSUFFICIENT_BALANCE', {
          cause: error,
          status: 402,
          ...(error.failure.requestId === undefined ? {} : { requestId: error.failure.requestId }),
        })
      }
      if (error instanceof LlmError && error.failure.status === 504) {
        throw new LlmError(error.message, 'TIMEOUT', {
          cause: error,
          status: 504,
          ...(error.failure.requestId === undefined ? {} : { requestId: error.failure.requestId }),
        })
      }
      throw error
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
