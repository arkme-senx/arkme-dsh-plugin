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
import type { DeepSeekCatalogModel, DeepSeekConnectionOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { SecretValue } from '../secret-value.js'

export const ARKME_MANAGED_PROVIDER = 'arkme-managed'
export const ARKME_MANAGED_MODEL = 'deepseek-v4-flash'

const ARKME_MANAGED_PROVIDER_NAME = 'Arkme · 余额计费'
const ARKME_MANAGED_CATALOG_TTL_MS = 60_000
const ARKME_MANAGED_CATALOG_TIMEOUT_MS = 10_000
const ARKME_INSUFFICIENT_BALANCE_MESSAGE = 'Arkme AI 余额不足，请前往 Arkme 设置中的余额充值后重试'
const ARKME_LOGIN_MESSAGE = '请先登录或重新登录 Arkme 后再使用托管模型'
const ARKME_MANAGED_FALLBACK_MODEL: DeepSeekCatalogModel = {
  id: ARKME_MANAGED_MODEL,
  name: 'DeepSeek-V4-Flash',
  contextWindow: 1_000_000,
  maxTokens: 256_000,
}
const ARKME_MANAGED_FALLBACK_MODELS: readonly DeepSeekCatalogModel[] = [ARKME_MANAGED_FALLBACK_MODEL]
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
  /** Test/runtime seam for the authenticated Arkme model-directory request. */
  fetchImpl?: typeof fetch
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

function assertManagedProvider(provider: string): void {
  if (provider !== ARKME_MANAGED_PROVIDER) {
    throw new LlmError(`当前 Arkme 托管模型不支持提供商“${provider}”`, 'NO_ADAPTER')
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

function managedConnection(
  baseUrl: string,
  models: readonly DeepSeekCatalogModel[],
): DeepSeekConnectionOptions {
  const defaults = models.find(model => model.id === ARKME_MANAGED_MODEL)
    ?? models[0]
    ?? ARKME_MANAGED_FALLBACK_MODEL
  return resolveAdapterOptions({
    baseURL: baseUrl,
    thinking: 'enabled',
    reasoningEffort: 'high',
    maxTokens: defaults.maxTokens ?? 256_000,
    defaultContextWindow: defaults.contextWindow ?? 1_000_000,
    models: [...models],
    retryPolicy: { mode: 'normal', maxRetries: 0 },
  })
}

function requiredCatalogText(
  source: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = source[key]
  if (typeof value !== 'string') {
    throw new LlmError(`Arkme 模型目录中的${label}无效`, 'MALFORMED_RESPONSE')
  }
  const normalized = value.trim()
  if (normalized === '' || normalized.length > 256) {
    throw new LlmError(`Arkme 模型目录中的${label}无效`, 'MALFORMED_RESPONSE')
  }
  return normalized
}

function requiredCatalogModelId(source: Record<string, unknown>): string {
  const model = requiredCatalogText(source, 'public_model_code', '模型 ID')
  if (!/^[^\s\u0000-\u001F\u007F]+$/u.test(model)) {
    throw new LlmError('Arkme 模型目录中的模型 ID 无效', 'MALFORMED_RESPONSE')
  }
  return model
}

function requiredCatalogTokens(
  source: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = source[key]
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) {
    throw new LlmError(`Arkme 模型目录中的${label}无效`, 'MALFORMED_RESPONSE')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new LlmError(`Arkme 模型目录中的${label}无效`, 'MALFORMED_RESPONSE')
  }
  return parsed
}

function parseManagedCatalog(payload: unknown): DeepSeekCatalogModel[] {
  const envelope = asRecord(payload)
  if (envelope?.code !== 200) {
    const status = validHttpStatus(envelope?.code)
    const message = typeof envelope?.message === 'string' ? envelope.message : 'Arkme 模型目录请求失败'
    throw localizeManagedAiError(new LlmError(message, 'MANAGED_MODEL_CATALOG', {
      ...(status === undefined ? {} : { status }),
    }))
  }
  const data = asRecord(envelope.data)
  const items = data?.item_ls
  if (!Array.isArray(items) || items.length > 256) {
    throw new LlmError('Arkme 模型目录返回异常', 'MALFORMED_RESPONSE')
  }

  const seen = new Set<string>()
  return items.map((value) => {
    const item = asRecord(value)
    if (item?.provider !== ARKME_MANAGED_PROVIDER) {
      throw new LlmError('Arkme 模型目录包含无效提供商', 'MALFORMED_RESPONSE')
    }
    const id = requiredCatalogModelId(item)
    if (seen.has(id)) {
      throw new LlmError(`Arkme 模型目录包含重复模型“${id}”`, 'MALFORMED_RESPONSE')
    }
    seen.add(id)
    const contextWindow = requiredCatalogTokens(item, 'context_window_tokens', '上下文窗口')
    const defaultMaxTokens = requiredCatalogTokens(item, 'default_max_output_tokens', '默认输出上限')
    const maximumMaxTokens = requiredCatalogTokens(item, 'maximum_max_output_tokens', '最大输出上限')
    if (defaultMaxTokens > maximumMaxTokens || maximumMaxTokens > contextWindow) {
      throw new LlmError(`Arkme 模型“${id}”的 Token 上限无效`, 'MALFORMED_RESPONSE')
    }
    return {
      id,
      name: requiredCatalogText(item, 'display_name', '显示名称'),
      contextWindow,
      maxTokens: defaultMaxTokens,
    }
  })
}

function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

class ManagedModelCatalog {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private connectionSnapshot: DeepSeekConnectionOptions
  private modelIds = new Set<string>(ARKME_MANAGED_FALLBACK_MODELS.map(model => model.id))
  private hasRemoteSnapshot = false
  private refreshedAt = 0
  private refreshPromise: Promise<void> | undefined

  constructor(
    intelligentBaseUrl: string,
    private readonly credentialOwner: ManagedAccessCredentialOwner,
    fetchImpl: typeof fetch,
  ) {
    this.baseUrl = managedAiBaseUrl(intelligentBaseUrl)
    this.fetchImpl = fetchImpl
    this.connectionSnapshot = managedConnection(this.baseUrl, ARKME_MANAGED_FALLBACK_MODELS)
  }

  connection(): DeepSeekConnectionOptions {
    return this.connectionSnapshot
  }

  private isFresh(): boolean {
    return this.hasRemoteSnapshot && Date.now() - this.refreshedAt < ARKME_MANAGED_CATALOG_TTL_MS
  }

  private async fetchCatalog(signal?: AbortSignal): Promise<void> {
    const controller = new AbortController()
    let timedOut = false
    const abortFromCaller = (): void => { controller.abort(signal?.reason) }
    if (signal?.aborted === true) abortFromCaller()
    else signal?.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, ARKME_MANAGED_CATALOG_TIMEOUT_MS)

    try {
      if (controller.signal.aborted) {
        throw controller.signal.reason ?? new DOMException('Aborted', 'AbortError')
      }
      const bearer = await waitForSignal(resolveBearer(this.credentialOwner), controller.signal)
      const response = await this.fetchImpl(`${this.baseUrl}/models/query`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: controller.signal,
      })
      if (!response.ok) {
        const requestId = response.headers.get('x-request-id')
        throw localizeManagedAiError(new LlmError('Arkme 模型目录请求失败', 'MANAGED_MODEL_CATALOG', {
          status: response.status,
          ...(requestId === null || requestId === '' ? {} : { requestId: ProviderRequestId(requestId) }),
        }))
      }
      let payload: unknown
      try {
        payload = await response.json()
      } catch (error) {
        if (controller.signal.aborted) throw error
        throw new LlmError('Arkme 模型目录返回异常', 'MALFORMED_RESPONSE', { cause: error })
      }
      const models = parseManagedCatalog(payload)
      this.connectionSnapshot = managedConnection(this.baseUrl, models)
      this.modelIds = new Set(models.map(model => model.id))
      this.hasRemoteSnapshot = true
      this.refreshedAt = Date.now()
    } catch (error) {
      if (signal?.aborted === true) {
        throw localizeManagedAiError(new LlmError('Arkme 模型目录请求已取消', 'ABORTED', { cause: error }))
      }
      if (timedOut) {
        throw localizeManagedAiError(new LlmError('Arkme 模型目录请求超时', 'TIMEOUT', { cause: error }))
      }
      if (error instanceof LlmError) throw error
      throw localizeManagedAiError(new LlmError('无法连接 Arkme 模型目录', 'TRANSPORT', { cause: error }))
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  private refresh(signal?: AbortSignal): Promise<void> {
    if (signal !== undefined) return this.fetchCatalog(signal)
    if (this.refreshPromise !== undefined) return this.refreshPromise
    const refresh = this.fetchCatalog(signal).finally(() => {
      if (this.refreshPromise === refresh) this.refreshPromise = undefined
    })
    this.refreshPromise = refresh
    return refresh
  }

  async refreshForListing(): Promise<void> {
    if (this.isFresh()) return
    try {
      await this.refresh()
    } catch {
      // Keep the last-good snapshot. Before the first successful refresh this is the legacy Flash route.
    }
  }

  async ensureModel(model: string, signal?: AbortSignal): Promise<void> {
    const known = this.modelIds.has(model)
    if ((known && !this.hasRemoteSnapshot) || this.isFresh()) return
    try {
      await this.refresh(signal)
    } catch (error) {
      if (signal?.aborted === true) throw error
      if (!known) throw error
    }
  }

  assertModel(model: string): void {
    if (!this.modelIds.has(model)) {
      throw new LlmError(`当前 Arkme 托管服务不支持模型“${model}”，请重新选择模型`, 'UNKNOWN_MODEL')
    }
  }
}

class ManagedAiLlmAdapter extends LlmAdapter {
  constructor(
    private readonly delegate: DeepSeekAdapter,
    private readonly catalog: ManagedModelCatalog,
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: ARKME_MANAGED_PROVIDER_NAME }
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.delegate.providerRetryPolicy(provider)
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    assertManagedProvider(provider)
    await this.catalog.refreshForListing()
    return await this.delegate.listModels(provider)
  }

  override async resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    assertManagedProvider(provider)
    await this.catalog.ensureModel(model, signal)
    this.catalog.assertModel(model)
    return await this.delegate.resolveModel(provider, model, signal)
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    try {
      assertManagedProvider(options.provider)
      await this.catalog.ensureModel(options.model, options.signal)
      this.catalog.assertModel(options.model)
      yield* this.delegate.stream(options)
    } catch (error) {
      throw localizeManagedAiError(error)
    }
  }
}

export function createManagedAiLlmAdapter(options: ManagedAiLlmAdapterOptions): LlmAdapter {
  const catalog = new ManagedModelCatalog(
    options.intelligentBaseUrl,
    options.credentialOwner,
    options.fetchImpl ?? globalThis.fetch,
  )
  const delegate = new DeepSeekAdapter({
    options: () => catalog.connection(),
    resolveApiKey: async () => await resolveBearer(options.credentialOwner),
    resolveUserId: options.resolveAnonymousUserId ?? getOrCreateAnonymousUserId,
  })
  return new ManagedAiLlmAdapter(delegate, catalog)
}

export function registerManagedAiProvider(
  ctx: Context,
  options: ManagedAiLlmAdapterOptions,
): AdapterRegistrationHandle {
  return ctx.llm.registerAdapter([ARKME_MANAGED_PROVIDER], createManagedAiLlmAdapter(options))
}
