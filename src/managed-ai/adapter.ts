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
import type { ManagedAccessCredentialProvider } from '../managed-access-credential.js'
import type { SecretValue } from '../secret-value.js'
import {
  ManagedAiTransport,
  type ManagedImageAttachmentReader,
  type ManagedImageCapability,
  type ManagedModelCapability,
} from './transport.js'

export const ARKME_MANAGED_PROVIDER = 'arkme-managed'
export const ARKME_MANAGED_MODEL = 'deepseek-v4-flash'

const ARKME_MANAGED_PROVIDER_NAME = 'Arkme · 余额计费'
const ARKME_MANAGED_CATALOG_TTL_MS = 60_000
const ARKME_MANAGED_CATALOG_TIMEOUT_MS = 10_000
const ARKME_MANAGED_MAXIMUM_IMAGE_PIXELS = 40_000_000
const ARKME_MANAGED_MAXIMUM_REQUEST_IMAGE_BYTES = 1 << 30
const ARKME_INSUFFICIENT_BALANCE_MESSAGE = 'Arkme AI 余额不足，请前往 Arkme 设置中的余额充值后重试'
const ARKME_LOGIN_MESSAGE = '请先登录或重新登录 Arkme 后再使用托管模型'
const ARKME_AUTH_FAILURE_CODES = new Set([
  'login-required',
  'login-expired',
  'auth-http-401',
  'auth-http-403',
])

export interface ManagedAiLlmAdapterOptions {
  intelligentBaseUrl: string
  credentialOwner: ManagedAccessCredentialProvider
  /** Resolves DSH's current durable attachment owner only when an image request needs it. */
  resolveAttachmentReader?: () => ManagedImageAttachmentReader | undefined
  resolveAnonymousUserId?: () => AnonymousUserId
  /** Test/runtime seam shared by catalog, direct OSS upload, and managed model transport. */
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
  if (facts.code === 'ATTACHMENT_UNAVAILABLE') {
    return { code: facts.code, message: '历史图片已不可用，请重新附加后继续' }
  }
  if (facts.code === 'ATTACHMENT_READ_FAILED') {
    return { code: facts.code, message: '无法读取历史图片，请检查本地附件存储后重试' }
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

type ToolCallDeltaChunk = Extract<StreamChunk, { type: 'tool-call-delta' }>

async function* keepToolCallIdentity(
  chunks: AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  const calls = new Map<number, {
    id?: ToolCallDeltaChunk['id']
    name?: string
    pendingArguments: string
    started: boolean
  }>()
  const ids = new Set<string>()

  for await (const chunk of chunks) {
    if (chunk.type === 'block-start' && chunk.blockType === 'tool-call') {
      if (calls.has(chunk.index)) {
        throw new LlmError('Arkme AI 返回了重复的工具调用起始帧', 'MALFORMED_RESPONSE')
      }
      calls.set(chunk.index, { pendingArguments: '', started: false })
      continue
    }

    if (chunk.type === 'tool-call-delta') {
      const call = calls.get(chunk.index)
      if (call === undefined) {
        throw new LlmError('Arkme AI 返回了缺少起始帧的工具调用', 'MALFORMED_RESPONSE')
      }
      if (String(chunk.id).trim() !== '') {
        if (call.id !== undefined && call.id !== chunk.id) {
          throw new LlmError('Arkme AI 在同一工具调用中更改了调用 ID', 'MALFORMED_RESPONSE')
        }
        call.id = chunk.id
      }
      if (chunk.name !== undefined && chunk.name.trim() !== '') {
        if (call.name !== undefined && call.name !== chunk.name) {
          throw new LlmError('Arkme AI 在同一工具调用中更改了工具名', 'MALFORMED_RESPONSE')
        }
        call.name = chunk.name
      }
      call.pendingArguments += chunk.argumentsDelta
      if (!call.started && call.id !== undefined && call.name !== undefined) {
        if (ids.has(call.id)) {
          throw new LlmError('Arkme AI 返回了重复的工具调用 ID', 'MALFORMED_RESPONSE')
        }
        ids.add(call.id)
        call.started = true
        yield { type: 'block-start', index: chunk.index, blockType: 'tool-call' }
        yield {
          type: 'tool-call-delta',
          index: chunk.index,
          id: call.id,
          name: call.name,
          argumentsDelta: call.pendingArguments,
        }
        call.pendingArguments = ''
      } else if (call.started) {
        yield {
          type: 'tool-call-delta',
          index: chunk.index,
          id: call.id!,
          name: call.name!,
          argumentsDelta: call.pendingArguments,
        }
        call.pendingArguments = ''
      }
      continue
    }

    if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
      const call = calls.get(chunk.index)
      if (call?.started !== true || call.id === undefined || call.name === undefined) {
        throw new LlmError('Arkme AI 返回了缺少调用 ID 或工具名的工具调用', 'MALFORMED_RESPONSE')
      }
      calls.delete(chunk.index)
      yield {
        ...chunk,
        block: { ...chunk.block, id: call.id, name: call.name },
      }
      continue
    }

    if (chunk.type === 'finish' && calls.size > 0) {
      throw new LlmError('Arkme AI 返回了未结束的工具调用', 'MALFORMED_RESPONSE')
    }
    yield chunk
  }
}

async function resolveBearer(owner: ManagedAccessCredentialProvider): Promise<string> {
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
  return resolveAdapterOptions({
    baseURL: baseUrl,
    thinking: 'enabled',
    reasoningEffort: 'high',
    maxTokens: defaults?.maxTokens ?? 256_000,
    defaultContextWindow: defaults?.contextWindow ?? 1_000_000,
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

function requiredCapabilityText(
  source: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '' || value.length > 128 || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw new LlmError(`Arkme 模型目录中的${label}无效`, 'MALFORMED_RESPONSE')
  }
  return value.trim()
}

function requiredCapabilityInteger(
  source: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new LlmError(`Arkme 模型目录中的${label}无效`, 'MALFORMED_RESPONSE')
  }
  return value
}

function optionalCapabilityInteger(
  source: Record<string, unknown>,
  key: string,
  label: string,
): number | undefined {
  if (source[key] === undefined) return undefined
  return requiredCapabilityInteger(source, key, label)
}

function parseModalities(value: unknown, label: string): Array<'text' | 'image'> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new LlmError(`Arkme 模型目录中的${label}无效`, 'MALFORMED_RESPONSE')
  }
  const result: Array<'text' | 'image'> = []
  for (const item of value) {
    if (item !== 'text' && item !== 'image') {
      throw new LlmError(`Arkme 模型目录中的${label}无效`, 'MALFORMED_RESPONSE')
    }
    if (result.includes(item)) {
      throw new LlmError(`Arkme 模型目录中的${label}包含重复值`, 'MALFORMED_RESPONSE')
    }
    result.push(item)
  }
  return result
}

function parseImageCapability(value: unknown): ManagedImageCapability {
  const source = asRecord(value)
  if (source === undefined) throw new LlmError('Arkme 模型目录中的图片能力无效', 'MALFORMED_RESPONSE')
  const allowed = source.allowed_media_types
  if (!Array.isArray(allowed) || allowed.length === 0 || allowed.length > 4) {
    throw new LlmError('Arkme 模型目录中的图片格式无效', 'MALFORMED_RESPONSE')
  }
  const supported = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  const allowedMediaTypes: string[] = []
  for (const item of allowed) {
    if (typeof item !== 'string' || !supported.has(item) || allowedMediaTypes.includes(item)) {
      throw new LlmError('Arkme 模型目录中的图片格式无效', 'MALFORMED_RESPONSE')
    }
    allowedMediaTypes.push(item)
  }
  const maximumImages = requiredCapabilityInteger(source, 'maximum_images', '图片数量上限')
  const maximumBytesPerImage = requiredCapabilityInteger(source, 'maximum_bytes_per_image', '单图大小上限')
  const maximumTotalBytes = optionalCapabilityInteger(source, 'maximum_total_bytes', '图片总大小上限')
  const maximumPixels = optionalCapabilityInteger(source, 'maximum_pixels', '图片像素上限')
  const minimumWidth = optionalCapabilityInteger(source, 'minimum_width', '图片宽度下限')
  const minimumHeight = optionalCapabilityInteger(source, 'minimum_height', '图片高度下限')
  const maximumWidth = optionalCapabilityInteger(source, 'maximum_width', '图片宽度上限')
  const maximumHeight = optionalCapabilityInteger(source, 'maximum_height', '图片高度上限')
  const maximumAspectRatio = optionalCapabilityInteger(source, 'maximum_aspect_ratio', '图片宽高比上限')
  const providerMaxPixels = optionalCapabilityInteger(source, 'provider_max_pixels', '供应商图片处理像素')
  const effectiveMaximumTotalBytes = maximumTotalBytes ?? maximumImages * maximumBytesPerImage
  if ((minimumWidth === undefined) !== (minimumHeight === undefined)
    || (maximumWidth === undefined) !== (maximumHeight === undefined)
    || (minimumWidth !== undefined && maximumWidth !== undefined
      && (minimumWidth > maximumWidth || minimumHeight! > maximumHeight!))
    || (maximumAspectRatio !== undefined && maximumAspectRatio > 10_000)
    || maximumImages > 2_048 || maximumBytesPerImage > 64 << 20
    || maximumPixels === undefined || maximumPixels > ARKME_MANAGED_MAXIMUM_IMAGE_PIXELS
    || effectiveMaximumTotalBytes > ARKME_MANAGED_MAXIMUM_REQUEST_IMAGE_BYTES
    || (maximumTotalBytes !== undefined && maximumTotalBytes < maximumBytesPerImage)) {
    throw new LlmError('Arkme 模型目录中的图片能力超出客户端安全边界', 'MALFORMED_RESPONSE')
  }
  const rawCountLimits = source.count_dimension_limits
  if (rawCountLimits !== undefined && !Array.isArray(rawCountLimits)) {
    throw new LlmError('Arkme 模型目录中的图片数量维度规则无效', 'MALFORMED_RESPONSE')
  }
  let previousMinimum = 0
  const countDimensionLimits = (rawCountLimits ?? []).map((value) => {
    const limit = asRecord(value)
    if (limit === undefined) throw new LlmError('Arkme 模型目录中的图片数量维度规则无效', 'MALFORMED_RESPONSE')
    const minimumImages = requiredCapabilityInteger(limit, 'minimum_images', '图片数量维度阈值')
    const maximumLimitWidth = requiredCapabilityInteger(limit, 'maximum_width', '图片数量维度宽度')
    const maximumLimitHeight = requiredCapabilityInteger(limit, 'maximum_height', '图片数量维度高度')
    if (minimumImages <= 1 || minimumImages > maximumImages || minimumImages <= previousMinimum
      || (maximumWidth !== undefined && maximumLimitWidth > maximumWidth)
      || (maximumHeight !== undefined && maximumLimitHeight > maximumHeight)) {
      throw new LlmError('Arkme 模型目录中的图片数量维度规则无效', 'MALFORMED_RESPONSE')
    }
    previousMinimum = minimumImages
    return { minimumImages, maximumWidth: maximumLimitWidth, maximumHeight: maximumLimitHeight }
  })
  requiredCapabilityText(source, 'token_estimator', '图片 Token 估算器')
  const evidence = asRecord(source.evidence)
  if (evidence === undefined) throw new LlmError('Arkme 模型目录中的图片能力证据无效', 'MALFORMED_RESPONSE')
  const expectedEvidenceFields = new Set([
    'allowed_media_types', 'maximum_images', 'maximum_bytes_per_image', 'token_estimator',
    ...(maximumPixels === undefined ? [] : ['maximum_pixels']),
    ...(minimumWidth === undefined ? [] : ['minimum_width', 'minimum_height']),
    ...(maximumTotalBytes === undefined ? [] : ['maximum_total_bytes']),
    ...(maximumWidth === undefined ? [] : ['maximum_width', 'maximum_height']),
    ...(maximumAspectRatio === undefined ? [] : ['maximum_aspect_ratio']),
    ...(countDimensionLimits.length === 0 ? [] : ['count_dimension_limits']),
    ...(providerMaxPixels === undefined ? [] : ['provider_max_pixels']),
  ])
  const parseEvidenceFields = (key: string, required: boolean): string[] => {
    const value = evidence[key]
    if (value === undefined && !required) return []
    if (!Array.isArray(value) || (required && value.length === 0)) {
      throw new LlmError('Arkme 模型目录中的图片能力证据无效', 'MALFORMED_RESPONSE')
    }
    const fields: string[] = []
    for (const item of value) {
      if (typeof item !== 'string' || !expectedEvidenceFields.has(item) || fields.includes(item)) {
        throw new LlmError('Arkme 模型目录中的图片能力证据无效', 'MALFORMED_RESPONSE')
      }
      fields.push(item)
    }
    return fields
  }
  const providerDocumentedFields = parseEvidenceFields('provider_documented_fields', true)
  const platformGuardrailFields = parseEvidenceFields('platform_guardrail_fields', false)
  const classified = new Set([...providerDocumentedFields, ...platformGuardrailFields])
  if (classified.size !== providerDocumentedFields.length + platformGuardrailFields.length
    || classified.size !== expectedEvidenceFields.size) {
    throw new LlmError('Arkme 模型目录中的图片能力证据不完整', 'MALFORMED_RESPONSE')
  }
  return {
    allowedMediaTypes,
    maximumImages,
    maximumBytesPerImage,
    ...(maximumTotalBytes === undefined ? {} : { maximumTotalBytes }),
    ...(maximumPixels === undefined ? {} : { maximumPixels }),
    ...(minimumWidth === undefined ? {} : { minimumWidth }),
    ...(minimumHeight === undefined ? {} : { minimumHeight }),
    ...(maximumWidth === undefined ? {} : { maximumWidth }),
    ...(maximumHeight === undefined ? {} : { maximumHeight }),
    ...(maximumAspectRatio === undefined ? {} : { maximumAspectRatio }),
    ...(providerMaxPixels === undefined ? {} : { providerMaxPixels }),
    countDimensionLimits,
    evidence: {
      providerReferenceUrl: requiredCapabilityText(evidence, 'provider_reference_url', '图片能力官方来源'),
      verifiedOn: requiredCapabilityText(evidence, 'verified_on', '图片能力核对日期'),
      providerDocumentedFields,
      platformGuardrailFields,
    },
  }
}

function parseCapability(value: unknown): ManagedModelCapability {
  const source = asRecord(value)
  if (source === undefined) throw new LlmError('Arkme 模型目录中的能力声明无效', 'MALFORMED_RESPONSE')
  const contractVersion = requiredCapabilityText(source, 'contract_version', '能力合同版本')
  const inputModalities = parseModalities(source.input_modalities, '输入模态')
  const outputModalities = parseModalities(source.output_modalities, '输出模态')
  if (!inputModalities.includes('text')) {
    throw new LlmError('Arkme 模型目录中的输入模态缺少文本', 'MALFORMED_RESPONSE')
  }
  requiredCapabilityText(source, 'materialization_mode', '媒体物化模式')
  requiredCapabilityText(source, 'usage_schema', '用量合同')
  const hasImage = inputModalities.includes('image')
  if (!hasImage && source.image !== undefined) {
    throw new LlmError('Arkme 模型目录中的图片能力与输入模态不一致', 'MALFORMED_RESPONSE')
  }
  return {
    contractVersion,
    inputModalities,
    outputModalities,
    ...(hasImage ? { image: parseImageCapability(source.image) } : {}),
  }
}

interface ManagedCatalogSnapshot {
  models: DeepSeekCatalogModel[]
  capabilities: Map<string, ManagedModelCapability>
}

function parseManagedCatalog(payload: unknown): ManagedCatalogSnapshot {
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
  const capabilities = new Map<string, ManagedModelCapability>()
  const models = items.map((value) => {
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
    capabilities.set(id, parseCapability(item.capability))
    return {
      id,
      name: requiredCatalogText(item, 'display_name', '显示名称'),
      contextWindow,
      maxTokens: defaultMaxTokens,
    }
  })
  return { models, capabilities }
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
  private modelIds = new Set<string>()
  private capabilitySnapshot = new Map<string, ManagedModelCapability>()
  private hasRemoteSnapshot = false
  private refreshedAt = 0
  private refreshPromise: Promise<void> | undefined

  constructor(
    intelligentBaseUrl: string,
    private readonly credentialOwner: ManagedAccessCredentialProvider,
    fetchImpl: typeof fetch,
  ) {
    this.baseUrl = managedAiBaseUrl(intelligentBaseUrl)
    this.fetchImpl = fetchImpl
    this.connectionSnapshot = managedConnection(this.baseUrl, [])
  }

  connection(): DeepSeekConnectionOptions {
    return this.connectionSnapshot
  }

  capability(model: string): ManagedModelCapability {
    const capability = this.capabilitySnapshot.get(model)
    if (capability === undefined) {
      throw new LlmError(`当前 Arkme 托管服务不支持模型“${model}”，请重新选择模型`, 'UNKNOWN_MODEL')
    }
    return capability
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
      const snapshot = parseManagedCatalog(payload)
      this.connectionSnapshot = managedConnection(this.baseUrl, snapshot.models)
      this.modelIds = new Set(snapshot.models.map(model => model.id))
      this.capabilitySnapshot = snapshot.capabilities
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
    } catch (error) {
      if (!this.hasRemoteSnapshot) throw error
    }
  }

  async ensureModel(model: string, signal?: AbortSignal): Promise<void> {
    const known = this.modelIds.has(model)
    if (this.isFresh()) return
    try {
      await this.refresh(signal)
    } catch (error) {
      if (signal?.aborted === true || !this.hasRemoteSnapshot || !known) throw error
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
    private readonly transport: ManagedAiTransport,
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
    const models = await this.delegate.listModels(provider)
    return models.map(model => ({
      ...model,
      inputModalities: this.catalog.capability(model.id).inputModalities,
    }))
  }

  override async resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    assertManagedProvider(provider)
    await this.catalog.ensureModel(model, signal)
    this.catalog.assertModel(model)
    const resolved = await this.delegate.resolveModel(provider, model, signal)
    return { ...resolved, inputModalities: this.catalog.capability(model).inputModalities }
  }

  async prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<{
      model: LlmResolvedModelInfo
      stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>
    }> {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: options => this.stream(options),
    }
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    try {
      assertManagedProvider(options.provider)
      await this.catalog.ensureModel(options.model, options.signal)
      this.catalog.assertModel(options.model)
      yield* keepToolCallIdentity(this.transport.stream(options, this.catalog.capability(options.model)))
    } catch (error) {
      throw localizeManagedAiError(error)
    }
  }
}

export function createManagedAiLlmAdapter(options: ManagedAiLlmAdapterOptions): LlmAdapter {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const resolveAnonymousUserId = options.resolveAnonymousUserId ?? getOrCreateAnonymousUserId
  const catalog = new ManagedModelCatalog(
    options.intelligentBaseUrl,
    options.credentialOwner,
    fetchImpl,
  )
  const delegate = new DeepSeekAdapter({
    options: () => catalog.connection(),
    resolveApiKey: async () => await resolveBearer(options.credentialOwner),
    resolveUserId: resolveAnonymousUserId,
  })
  const transport = new ManagedAiTransport({
    baseUrl: managedAiBaseUrl(options.intelligentBaseUrl),
    resolveAttachmentReader: options.resolveAttachmentReader ?? (() => undefined),
    fetchImpl,
    resolveBearer: async () => await resolveBearer(options.credentialOwner),
    resolveAnonymousUserId,
  })
  return new ManagedAiLlmAdapter(delegate, catalog, transport)
}

export function registerManagedAiProvider(
  ctx: Context,
  options: ManagedAiLlmAdapterOptions,
): AdapterRegistrationHandle {
  return ctx.llm.registerAdapter([ARKME_MANAGED_PROVIDER], createManagedAiLlmAdapter(options))
}
