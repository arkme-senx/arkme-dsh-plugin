import { createHash, randomUUID } from 'node:crypto'
import {
  attributionHeaders,
  EMPTY_RESPONSE_CODE,
  LlmError,
  ProviderRequestId,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  FinishReason,
  GenerateOptions,
  Message,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type {
  ImageAttachmentRef,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'

const STREAM_IDLE_TIMEOUT_MS = 300_000
const MAX_SSE_EVENT_CHARS = 4 << 20
const ASSET_EXPIRY_SAFETY_MS = 60_000
// This only bounds local recovery memory when prepare may have committed but
// its response was lost. Once prepare succeeds, the server-issued upload
// expiry replaces it and is the sole session-lifetime authority.
const INPUT_ASSET_ATTEMPT_RECOVERY_RETENTION_MS = 60 * 60_000
const MAX_CACHED_INPUT_ASSETS = 4_096
const MAX_RETAINED_INPUT_ASSET_ATTEMPTS = 4_096
const MAX_CONCURRENT_INPUT_ASSET_UPLOADS = 4

type DshToolCallId = Extract<StreamChunk, { type: 'tool-call-delta' }>['id']

function dshToolCallId(value: string): DshToolCallId {
  return value as DshToolCallId
}

export interface ManagedImageCapability {
  allowedMediaTypes: readonly string[]
  maximumImages: number
  maximumBytesPerImage: number
  maximumTotalBytes?: number
  maximumPixels?: number
  minimumWidth?: number
  minimumHeight?: number
  maximumWidth?: number
  maximumHeight?: number
  maximumAspectRatio?: number
  providerMaxPixels?: number
  countDimensionLimits: ReadonlyArray<{
    minimumImages: number
    maximumWidth: number
    maximumHeight: number
  }>
  evidence: {
    providerReferenceUrl: string
    verifiedOn: string
    providerDocumentedFields: readonly string[]
    platformGuardrailFields: readonly string[]
  }
}

export interface ManagedModelCapability {
  contractVersion: string
  inputModalities: readonly ('text' | 'image')[]
  outputModalities: readonly ('text' | 'image')[]
  image?: ManagedImageCapability
}

export interface ManagedImageAttachmentReader {
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>
}

export interface ManagedAiTransportOptions {
  baseUrl: string
  attachmentReader?: ManagedImageAttachmentReader
  fetchImpl: typeof fetch
  resolveBearer: () => Promise<string>
  resolveAnonymousUserId: () => AnonymousUserId
}

interface CachedInputAsset {
  assetRef: string
  expiresAt: number
}

interface InFlightInputAsset {
  promise: Promise<CachedInputAsset>
  controller: AbortController
  waiters: number
  settled: boolean
}

interface InputAssetAttempt {
  idempotencyKey: string
  expiresAt: number
}

interface ManagedEnvelope {
  code: number
  message?: string
  data?: unknown
}

class ManagedAiApplicationError extends LlmError {
  readonly applicationCode: string

  constructor(message: string, code: 'INVALID_REQUEST' | 'SERVER', applicationCode: string) {
    super(message, code)
    this.applicationCode = applicationCode
  }
}

interface PreparedUpload {
  uploadUid: string
  assetRef: string
  status: 'prepared' | 'completed'
  uploadExpiresAt: number
  upload?: {
    method: 'PUT'
    url: string
    headers: Record<string, string>
  }
  assetExpiresAt: number
}

interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type WireContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_asset'; asset_ref: string }

type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | WireContentPart[] }
  | { role: 'assistant'; content: string; reasoning_content?: string; tool_calls?: WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

interface WireRequest {
  model: string
  messages: WireMessage[]
  stream: true
  stream_options: { include_usage: true }
  thinking?: { type: 'enabled' | 'disabled' }
  reasoning_effort?: 'high' | 'max'
  tools?: Array<{
    type: 'function'
    function: { name: string; description: string; parameters: Record<string, unknown> }
  }>
  temperature?: number
  max_tokens?: number
  stop?: string[]
}

interface WireUsage {
  prompt_tokens: number
  completion_tokens: number
  prompt_cache_hit_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

interface WireChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: WireUsage | null
}

interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  callId?: string
  name?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function requiredString(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LlmError('Arkme AI 返回了无效的资产响应', 'MALFORMED_RESPONSE')
  }
  return value.trim()
}

function requiredPositiveInteger(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new LlmError('Arkme AI 返回了无效的资产响应', 'MALFORMED_RESPONSE')
  }
  return value
}

function requiredHTTPSURL(source: Record<string, unknown>, key: string): string {
  const value = requiredString(source, key)
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new LlmError('Arkme AI 返回了无效的上传地址', 'MALFORMED_RESPONSE')
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.hostname === '') {
    throw new LlmError('Arkme AI 返回了无效的上传地址', 'MALFORMED_RESPONSE')
  }
  return value
}

function optionalHeaders(value: unknown): Record<string, string> {
  const source = asRecord(value)
  if (source === undefined) throw new LlmError('Arkme AI 返回了无效的上传参数', 'MALFORMED_RESPONSE')
  const headers: Record<string, string> = {}
  for (const [key, item] of Object.entries(source)) {
    if (key.trim() === '' || typeof item !== 'string' || /[\r\n]/u.test(key) || /[\r\n]/u.test(item)) {
      throw new LlmError('Arkme AI 返回了无效的上传参数', 'MALFORMED_RESPONSE')
    }
    headers[key] = item
  }
  return headers
}

async function waitForPromiseWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(
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

function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined
  if (/^\d+$/u.test(value)) {
    const delay = Number(value) * 1_000
    return Number.isFinite(delay) && delay > 0 ? delay : undefined
  }
  const delay = Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

function responseRequestId(headers: Headers): ReturnType<typeof ProviderRequestId> | undefined {
  const value = headers.get('x-request-id') ?? headers.get('x-deepseek-request-id')
  return value === null || value.trim() === '' ? undefined : ProviderRequestId(value.trim())
}

function errorCode(status: number, body: unknown): string {
  const source = asRecord(body)
  const providerError = asRecord(source?.error)
  const providerCode = typeof providerError?.code === 'string' ? providerError.code.toLowerCase() : ''
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 402 || providerCode.includes('balance') || providerCode.includes('quota')) return 'QUOTA'
  if (status === 408 || status === 504) return 'TIMEOUT'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400 || status === 413 || status === 422) return 'INVALID_REQUEST'
  if (status >= 500) return 'SERVER'
  return 'MANAGED_AI_FAILED'
}

async function parseHttpError(response: Response): Promise<LlmError> {
  let body: unknown
  try { body = await response.json() } catch { /* The HTTP status remains authoritative. */ }
  const providerError = asRecord(asRecord(body)?.error)
  const message = typeof providerError?.message === 'string' && providerError.message.trim() !== ''
    ? providerError.message.trim()
    : `Arkme AI HTTP ${response.status}`
  const delay = retryAfterMs(response.headers.get('retry-after'))
  const requestId = responseRequestId(response.headers)
  return new LlmError(message, errorCode(response.status, body), {
    status: response.status,
    ...(delay === undefined ? {} : { providerRetryAfterMs: delay }),
    ...(requestId === undefined ? {} : { requestId }),
  })
}

function assertAttachmentWithinCapability(
  attachment: ImageAttachmentRef,
  capability: ManagedImageCapability,
): void {
  const pixels = attachment.width * attachment.height
  if (!capability.allowedMediaTypes.includes(attachment.mediaType)
    || !Number.isSafeInteger(attachment.bytes) || attachment.bytes <= 0
    || !Number.isSafeInteger(attachment.width) || attachment.width <= 0
    || !Number.isSafeInteger(attachment.height) || attachment.height <= 0
    || attachment.bytes > capability.maximumBytesPerImage
    || !Number.isSafeInteger(pixels) || pixels <= 0
    || (capability.maximumPixels !== undefined && pixels > capability.maximumPixels)
    || (capability.minimumWidth !== undefined && attachment.width < capability.minimumWidth)
    || (capability.minimumHeight !== undefined && attachment.height < capability.minimumHeight)
    || (capability.maximumWidth !== undefined && attachment.width > capability.maximumWidth)
    || (capability.maximumHeight !== undefined && attachment.height > capability.maximumHeight)
    || (capability.maximumAspectRatio !== undefined
      && Math.max(attachment.width, attachment.height) > Math.min(attachment.width, attachment.height) * capability.maximumAspectRatio)) {
    throw new LlmError('图片不符合当前 Arkme 模型的输入限制', 'INVALID_REQUEST')
  }
}

function requestImageAttachments(options: GenerateOptions): ImageAttachmentRef[] {
  const result: ImageAttachmentRef[] = []
  for (const message of options.messages) {
    if (message.role !== 'user') continue
    for (const block of message.content) {
      if (block.type === 'image') result.push(block.attachment)
    }
  }
  return result
}

function assertImageRequestWithinCapability(
  attachments: readonly ImageAttachmentRef[],
  capability: ManagedModelCapability,
): void {
  if (attachments.length === 0) return
  const image = capability.image
  if (!capability.inputModalities.includes('image') || image === undefined) {
    throw new LlmError('当前 Arkme 模型不支持图片输入', 'UNSUPPORTED_CONTENT')
  }
  if (attachments.length > image.maximumImages) {
    throw new LlmError('图片数量超过当前 Arkme 模型的输入上限', 'INVALID_REQUEST')
  }
  let maximumWidth = image.maximumWidth
  let maximumHeight = image.maximumHeight
  for (const limit of image.countDimensionLimits) {
    if (attachments.length >= limit.minimumImages) {
      maximumWidth = limit.maximumWidth
      maximumHeight = limit.maximumHeight
    }
  }
  let totalBytes = 0
  for (const attachment of attachments) {
    assertAttachmentWithinCapability(attachment, image)
    if ((maximumWidth !== undefined && attachment.width > maximumWidth)
      || (maximumHeight !== undefined && attachment.height > maximumHeight)) {
      throw new LlmError('当前图片数量下的图片边长超过模型上限', 'INVALID_REQUEST')
    }
    totalBytes += attachment.bytes
    if (!Number.isSafeInteger(totalBytes)) throw new LlmError('图片总大小无效', 'INVALID_REQUEST')
  }
  if (image.maximumTotalBytes !== undefined && totalBytes > image.maximumTotalBytes) {
    throw new LlmError('图片总大小超过当前 Arkme 模型的输入上限', 'INVALID_REQUEST')
  }
}

function assertStoredAttachment(expected: ImageAttachmentRef, stored: StoredImageAttachment): void {
  if (String(stored.ref.attachmentId) !== String(expected.attachmentId)
    || stored.ref.mediaType !== expected.mediaType
    || stored.ref.bytes !== expected.bytes
    || stored.ref.width !== expected.width
    || stored.ref.height !== expected.height
    || stored.data.byteLength !== expected.bytes) {
    throw new LlmError('DSH 图片附件校验失败', 'INVALID_REQUEST')
  }
}

function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks.filter(block => block.type === 'text').map(block => block.text).join('')
}

function assertTextOnly(blocks: readonly ContentBlock[], location: string): void {
  for (const block of blocks) {
    if (block.type !== 'text') throw new LlmError(`${location}不支持内容类型“${block.type}”`, 'UNSUPPORTED_CONTENT')
  }
}

function assertAssistantBlocks(blocks: readonly ContentBlock[]): void {
  for (const block of blocks) {
    if (block.type !== 'text' && block.type !== 'reasoning' && block.type !== 'tool-call') {
      throw new LlmError(`助手消息不支持内容类型“${block.type}”`, 'UNSUPPORTED_CONTENT')
    }
  }
}

function assertUserBlocks(blocks: readonly ContentBlock[]): void {
  for (const block of blocks) {
    if (block.type === 'text' || block.type === 'image') continue
    if (block.type === 'tool-result') {
      assertTextOnly(block.content, '工具结果')
      continue
    }
    throw new LlmError(`用户消息不支持内容类型“${block.type}”`, 'UNSUPPORTED_CONTENT')
  }
}

function limitConcurrency<Argument, Result>(
  maximum: number,
  operation: (argument: Argument) => Promise<Result>,
): (argument: Argument) => Promise<Result> {
  let active = 0
  const pending: Array<() => void> = []
  const release = () => {
    active--
    pending.shift()?.()
  }
  return async (argument) => {
    if (active >= maximum) await new Promise<void>(resolve => pending.push(resolve))
    active++
    try {
      return await operation(argument)
    } finally {
      release()
    }
  }
}

function serializeAssistant(message: Message): WireMessage {
  assertAssistantBlocks(message.content)
  const content = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: String(block.id),
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))
  return {
    role: 'assistant',
    content,
    ...(toolCalls.length > 0 && reasoning.length > 0 ? { reasoning_content: reasoning } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }
}

async function serializeMessages(
  messages: readonly Message[],
  resolveImage: (attachment: ImageAttachmentRef) => Promise<string>,
): Promise<WireMessage[]> {
  // Validate the entire request before beginning any direct-to-OSS work.
  for (const message of messages) {
    if (message.role === 'system') assertTextOnly(message.content, '系统消息')
    else if (message.role === 'assistant') assertAssistantBlocks(message.content)
    else assertUserBlocks(message.content)
  }
  const resolveImageLimited = limitConcurrency(MAX_CONCURRENT_INPUT_ASSET_UPLOADS, resolveImage)
  const groups = await Promise.all(messages.map(async (message): Promise<WireMessage[]> => {
    if (message.role === 'system') {
      return [{ role: 'system', content: flattenText(message.content) }]
    }
    if (message.role === 'assistant') {
      return [serializeAssistant(message)]
    }
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const parts = (await Promise.all(message.content.map(async (block): Promise<WireContentPart | undefined> => {
      if (block.type === 'text') {
        return block.text.trim() === '' ? undefined : { type: 'text', text: block.text }
      }
      if (block.type === 'image') {
        return { type: 'image_asset', asset_ref: await resolveImageLimited(block.attachment) }
      }
      return undefined
    }))).filter((part): part is WireContentPart => part !== undefined)
    const wire: WireMessage[] = []
    if (parts.length > 0 || toolResults.length === 0) {
      if (parts.length === 0) wire.push({ role: 'user', content: '' })
      else if (parts.every(part => part.type === 'text')) {
        wire.push({ role: 'user', content: parts.map(part => part.type === 'text' ? part.text : '').join('') })
      } else {
        wire.push({ role: 'user', content: parts })
      }
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: String(result.toolCallId),
        content: flattenText(result.content) || '(no output)',
      })
    }
    return wire
  }))
  return groups.flat()
}

async function serializeRequest(
  options: GenerateOptions,
  resolveImage: (attachment: ImageAttachmentRef) => Promise<string>,
): Promise<WireRequest> {
  const messages: WireMessage[] = []
  if (options.system !== undefined) messages.push({ role: 'system', content: options.system })
  messages.push(...await serializeMessages(options.messages, resolveImage))
  const effort = options.reasoningEffort === undefined ? 'high' : String(options.reasoningEffort)
  if (!['off', 'high', 'max'].includes(effort)) {
    throw new LlmError(`Arkme AI 不支持推理强度“${effort}”`, 'UNSUPPORTED_REASONING_EFFORT')
  }
  const titleRequest = options.purpose === 'session-title'
  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: titleRequest || effort === 'off' ? 'disabled' : 'enabled' },
    ...titleRequest || effort === 'off' ? {} : { reasoning_effort: effort as 'high' | 'max' },
    ...options.tools === undefined || options.tools.length === 0 ? {} : {
      tools: options.tools.map(tool => ({
        type: 'function' as const,
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
    },
    ...options.temperature === undefined ? {} : { temperature: options.temperature },
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop === undefined ? {} : { stop: options.stop },
  }
}

function mapUsage(usage: WireUsage): TokenUsage {
  const validTokenCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
  if (!validTokenCount(usage.prompt_tokens) || !validTokenCount(usage.completion_tokens)) {
    throw new LlmError('Arkme AI 返回了无效的用量', 'MALFORMED_RESPONSE')
  }
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  if ((cacheRead !== undefined && (!validTokenCount(cacheRead) || cacheRead > usage.prompt_tokens))
    || (reasoning !== undefined && (!validTokenCount(reasoning) || reasoning > usage.completion_tokens))) {
    throw new LlmError('Arkme AI 返回了无效的用量', 'MALFORMED_RESPONSE')
  }
  return {
    inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens,
    ...(cacheRead === undefined ? {} : { cacheReadTokens: cacheRead }),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
  }
}

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop': return { kind: 'stop' }
    case 'tool_calls': return { kind: 'tool-calls' }
    case 'length': return { kind: 'max-tokens' }
    default: return {
      kind: 'error',
      failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() },
    }
  }
}

function closeBlock(block: OpenBlock): ContentBlock {
  if (block.kind === 'text') return { type: 'text', text: block.text }
  if (block.kind === 'reasoning') return { type: 'reasoning', text: block.text }
  return {
    type: 'tool-call',
    id: dshToolCallId(block.callId ?? ''),
    name: block.name ?? '',
    arguments: block.text,
  }
}

async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textBlock: OpenBlock | undefined
  let reasoningBlock: OpenBlock | undefined
  const toolBlocks = new Map<number, OpenBlock>()
  const order: OpenBlock[] = []
  let pendingFinish: FinishReason | undefined
  let pendingUsage: TokenUsage | undefined
  const open = (kind: OpenBlock['kind']): OpenBlock => {
    const block: OpenBlock = { index: nextIndex++, kind, text: '' }
    order.push(block)
    return block
  }

  for await (const payload of payloads) {
    if (payload === '[DONE]') {
      for (const block of order) yield { type: 'block-end', index: block.index, block: closeBlock(block) }
      if (pendingUsage !== undefined) yield { type: 'usage', usage: pendingUsage }
      const reason = pendingFinish ?? { kind: 'stop' as const }
      yield {
        type: 'finish',
        reason: reason.kind === 'stop' && order.length === 0
          ? { kind: 'error', failure: { message: 'model returned no content', code: EMPTY_RESPONSE_CODE } }
          : reason,
      }
      return
    }
    let chunk: WireChunk
    try { chunk = JSON.parse(payload) as WireChunk } catch {
      throw new LlmError(`malformed Arkme AI SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }
    for (const choice of chunk.choices ?? []) {
      const reasoning = choice.delta?.reasoning_content
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        if (reasoningBlock === undefined) {
          reasoningBlock = open('reasoning')
          yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
        }
        reasoningBlock.text += reasoning
        yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning }
      }
      const content = choice.delta?.content
      if (typeof content === 'string' && content.length > 0) {
        if (textBlock === undefined) {
          textBlock = open('text')
          yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
        }
        textBlock.text += content
        yield { type: 'text-delta', index: textBlock.index, text: content }
      }
      for (const call of choice.delta?.tool_calls ?? []) {
        let block = toolBlocks.get(call.index)
        if (block === undefined) {
          block = open('tool-call')
          toolBlocks.set(call.index, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        if (call.id !== undefined) block.callId = call.id
        if (call.function?.name !== undefined) block.name = call.function.name
        const fragment = call.function?.arguments ?? ''
        block.text += fragment
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: dshToolCallId(block.callId ?? ''),
          ...(block.name === undefined ? {} : { name: block.name }),
          argumentsDelta: fragment,
        }
      }
      if (typeof choice.finish_reason === 'string') pendingFinish = mapFinishReason(choice.finish_reason)
    }
    if (chunk.usage !== undefined && chunk.usage !== null) pendingUsage = mapUsage(chunk.usage)
  }
  throw new LlmError('Arkme AI SSE stream ended without [DONE]', 'STREAM_CLOSED')
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: AbortController,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new LlmError(`Arkme AI stream idle timeout after ${STREAM_IDLE_TIMEOUT_MS}ms`, 'TIMEOUT')
          controller.abort(error)
          reject(error)
        }, STREAM_IDLE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function* parseSse(
  stream: ReadableStream<Uint8Array>,
  controller: AbortController,
): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let firstLine = true
  let dataLines: string[] = []
  let done = false
  try {
    while (true) {
      const result = await readWithIdleTimeout(reader, controller)
      if (result.done) break
      text += decoder.decode(result.value, { stream: true })
      if (text.length > MAX_SSE_EVENT_CHARS) throw new LlmError('Arkme AI SSE event is too large', 'MALFORMED_RESPONSE')
      while (true) {
        const newline = text.indexOf('\n')
        if (newline < 0) break
        let line = text.slice(0, newline)
        text = text.slice(newline + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (firstLine) {
          firstLine = false
          if (line.startsWith('\uFEFF')) line = line.slice(1)
        }
        if (line === '') {
          if (dataLines.length === 0) continue
          const payload = dataLines.join('\n')
          dataLines = []
          yield payload
          if (payload === '[DONE]') {
            done = true
            return
          }
          continue
        }
        if (line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        let value = colon < 0 ? '' : line.slice(colon + 1)
        if (value.startsWith(' ')) value = value.slice(1)
        if (field === 'data') dataLines.push(value)
      }
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  if (!done) throw new LlmError('Arkme AI SSE stream ended without [DONE]', 'STREAM_CLOSED')
}

export class ManagedAiTransport {
  private readonly assetCache = new Map<string, CachedInputAsset>()
  private readonly assetUploads = new Map<string, InFlightInputAsset>()
  private readonly assetAttemptKeys = new Map<string, InputAssetAttempt>()

  constructor(private readonly options: ManagedAiTransportOptions) {}

  async * stream(
    request: GenerateOptions,
    capability: ManagedModelCapability,
  ): AsyncIterable<StreamChunk> {
    const callerSignal = request.signal
    const consumer = new AbortController()
    const signal = callerSignal === undefined
      ? consumer.signal
      : AbortSignal.any([callerSignal, consumer.signal])
    try {
      assertImageRequestWithinCapability(requestImageAttachments(request), capability)
      const bearer = await this.options.resolveBearer()
      const imageCapability = capability.image
      const body = await serializeRequest(request, async (attachment) => {
        if (!capability.inputModalities.includes('image') || imageCapability === undefined) {
          throw new LlmError('当前 Arkme 模型不支持图片输入', 'UNSUPPORTED_CONTENT')
        }
        const uploaded = await this.resolveInputAsset(
          request.model,
          capability.contractVersion,
          attachment,
          imageCapability,
          bearer,
          signal,
        )
        return uploaded.assetRef
      })
      if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      const response = await this.options.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          ...attributionHeaders(),
          'X-DeepSeek-Harness-User-ID': String(this.options.resolveAnonymousUserId()),
          ...(request.sessionId === undefined ? {} : { 'X-DeepSeek-Harness-Session-ID': String(request.sessionId) }),
          ...(request.purpose === 'compaction' ? { 'X-DeepSeek-Harness-Compact': '1' } : {}),
        },
        body: JSON.stringify(body),
        signal,
      })
      if (!response.ok) throw await parseHttpError(response)
      if (response.body === null) throw new LlmError('Arkme AI returned no response body', 'EMPTY_RESPONSE')
      yield* translate(parseSse(response.body, consumer))
    } catch (error) {
      if (callerSignal?.aborted === true) {
        throw new LlmError('Arkme AI request aborted by caller', 'ABORTED', { cause: error })
      }
      if (error instanceof LlmError) throw error
      throw new LlmError('Arkme AI transport failed', 'TRANSPORT', { cause: error })
    } finally {
      consumer.abort('Arkme AI stream consumer stopped')
    }
  }

  private async resolveInputAsset(
    model: string,
    contractVersion: string,
    attachment: ImageAttachmentRef,
    capability: ManagedImageCapability,
    bearer: string,
    signal: AbortSignal,
  ): Promise<CachedInputAsset> {
    // A plugin process can survive logout/login. Scope every local asset handle
    // to an irreversible credential fingerprint so one account never reuses
    // another account's opaque asset_ref or upload generation.
    const ownerScope = createHash('sha256').update(bearer).digest('hex').slice(0, 24)
    const key = `${ownerScope}\u0000${String(attachment.attachmentId)}`
    const cached = this.assetCache.get(key)
    if (cached !== undefined && cached.expiresAt - ASSET_EXPIRY_SAFETY_MS > Date.now()) return cached
    if (cached !== undefined) this.assetCache.delete(key)
    const uploadKey = `${key}\u0000${model}\u0000${contractVersion}`
    let inFlight = this.assetUploads.get(uploadKey)
    if (inFlight === undefined) {
      const controller = new AbortController()
      let entry!: InFlightInputAsset
      const promise = this.uploadInputAsset(model, contractVersion, attachment, capability, bearer, controller.signal)
        .then((asset) => {
          this.rememberInputAsset(key, asset)
          return asset
        })
        .finally(() => {
          entry.settled = true
          if (this.assetUploads.get(uploadKey) === entry) this.assetUploads.delete(uploadKey)
        })
      entry = { controller, promise, waiters: 0, settled: false }
      this.assetUploads.set(uploadKey, entry)
      inFlight = entry
    }
    inFlight.waiters++
    try {
      return await waitForPromiseWithSignal(inFlight.promise, signal)
    } finally {
      inFlight.waiters--
      if (inFlight.waiters === 0 && !inFlight.settled) {
        inFlight.controller.abort(new DOMException('No managed image upload waiters remain', 'AbortError'))
      }
    }
  }

  private async uploadInputAsset(
    model: string,
    contractVersion: string,
    attachment: ImageAttachmentRef,
    capability: ManagedImageCapability,
    bearer: string,
    signal: AbortSignal,
  ): Promise<CachedInputAsset> {
    const reader = this.options.attachmentReader
    if (reader === undefined) throw new LlmError('DSH 图片附件服务不可用', 'UNSUPPORTED_CONTENT')
    const stored = await reader.readImage(attachment, signal)
    assertStoredAttachment(attachment, stored)
    assertAttachmentWithinCapability(stored.ref, capability)
    const sha256 = createHash('sha256').update(stored.data).digest('hex')
    const ownerScope = createHash('sha256').update(bearer).digest('hex').slice(0, 24)
    const attemptIdentity = `${ownerScope}\u0000${String(attachment.attachmentId)}\u0000${model}\u0000${contractVersion}`
    const now = Date.now()
    const retainedAttempt = this.assetAttemptKeys.get(attemptIdentity)
    if (retainedAttempt !== undefined && retainedAttempt.expiresAt <= now) {
      this.assetAttemptKeys.delete(attemptIdentity)
    }
    let idempotencyKey = retainedAttempt !== undefined && retainedAttempt.expiresAt > now
      ? retainedAttempt.idempotencyKey
      : `dsh-${sha256.slice(0, 24)}-${randomUUID()}`
    if (retainedAttempt === undefined || retainedAttempt.expiresAt <= now) {
      this.rememberInputAssetAttempt(attemptIdentity, idempotencyKey, now + INPUT_ASSET_ATTEMPT_RECOVERY_RETENTION_MS)
    }
    let prepared: PreparedUpload
    for (let prepareAttempt = 0; ; prepareAttempt++) {
      try {
        prepared = await this.prepareUpload(model, contractVersion, stored, sha256, idempotencyKey, bearer, signal)
        break
      } catch (error) {
        // The server reports this code only when the retained idempotency
        // generation is terminal (most commonly its 15-minute session expired).
        // Rotate once inside the same DSH request so a recoverable upload does
        // not surface as a user-visible model failure.
        if (error instanceof ManagedAiApplicationError
          && error.applicationCode === 'input_asset_upload_conflict'
          && prepareAttempt === 0) {
          idempotencyKey = `dsh-${sha256.slice(0, 24)}-${randomUUID()}`
          this.rememberInputAssetAttempt(
            attemptIdentity,
            idempotencyKey,
            Date.now() + INPUT_ASSET_ATTEMPT_RECOVERY_RETENTION_MS,
          )
          continue
        }
        // A transport/server/malformed-response failure may have committed
        // prepare before its response was lost, so retain the attempt key. An
        // explicit application rejection proves this generation cannot resume.
        if (error instanceof ManagedAiApplicationError && error.code === 'INVALID_REQUEST') {
          this.assetAttemptKeys.delete(attemptIdentity)
        }
        throw error
      }
    }
    if (prepared.status === 'completed') {
      this.assetAttemptKeys.delete(attemptIdentity)
      return { assetRef: prepared.assetRef, expiresAt: prepared.assetExpiresAt }
    }
    this.rememberInputAssetAttempt(attemptIdentity, idempotencyKey, prepared.uploadExpiresAt)
    if (prepared.upload === undefined) throw new LlmError('Arkme AI 未返回上传参数', 'MALFORMED_RESPONSE')
    try {
      const response = await this.options.fetchImpl(prepared.upload.url, {
        method: prepared.upload.method,
        headers: prepared.upload.headers,
        body: stored.data.buffer instanceof ArrayBuffer
          ? stored.data.buffer.slice(stored.data.byteOffset, stored.data.byteOffset + stored.data.byteLength)
          : Uint8Array.from(stored.data).buffer,
        signal,
      })
      if (!response.ok && response.status !== 409 && response.status !== 412) {
        throw new LlmError(`图片上传失败 (HTTP ${response.status})`, 'TRANSPORT')
      }
      const completed = await this.completeUpload(prepared.uploadUid, bearer, signal)
      this.assetAttemptKeys.delete(attemptIdentity)
      return completed
    } catch (error) {
      // PUT and complete are both ambiguous across cancellation or transport
      // loss. Keep the generation so the next prepare can re-sign the PUT or
      // return its already-completed asset. A server INVALID_REQUEST is the
      // only proof that this upload generation is terminal.
      if (error instanceof LlmError && error.code === 'INVALID_REQUEST') {
        this.assetAttemptKeys.delete(attemptIdentity)
      }
      throw error
    }
  }

  private rememberInputAsset(key: string, asset: CachedInputAsset): void {
    const now = Date.now()
    for (const [candidateKey, candidate] of this.assetCache) {
      if (candidate.expiresAt - ASSET_EXPIRY_SAFETY_MS <= now) this.assetCache.delete(candidateKey)
    }
    while (this.assetCache.size >= MAX_CACHED_INPUT_ASSETS) {
      const oldest = this.assetCache.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.assetCache.delete(oldest)
    }
    this.assetCache.set(key, asset)
  }

  private rememberInputAssetAttempt(identity: string, idempotencyKey: string, expiresAt: number): void {
    const now = Date.now()
    for (const [candidateIdentity, attempt] of this.assetAttemptKeys) {
      if (attempt.expiresAt <= now) this.assetAttemptKeys.delete(candidateIdentity)
    }
    this.assetAttemptKeys.delete(identity)
    while (this.assetAttemptKeys.size >= MAX_RETAINED_INPUT_ASSET_ATTEMPTS) {
      const oldest = this.assetAttemptKeys.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.assetAttemptKeys.delete(oldest)
    }
    this.assetAttemptKeys.set(identity, { idempotencyKey, expiresAt })
  }

  private async prepareUpload(
    model: string,
    contractVersion: string,
    stored: StoredImageAttachment,
    sha256: string,
    idempotencyKey: string,
    bearer: string,
    signal: AbortSignal,
  ): Promise<PreparedUpload> {
    const data = await this.postEnvelope('/input-assets/uploads/prepare', {
      idempotency_key: idempotencyKey,
      public_model_code: model,
      capability_contract_version: contractVersion,
      asset: {
        kind: 'image',
        sha256,
        media_type: stored.ref.mediaType,
        size_bytes: stored.ref.bytes,
        width: stored.ref.width,
        height: stored.ref.height,
      },
    }, bearer, signal)
    const source = asRecord(data)
    if (source === undefined) throw new LlmError('Arkme AI 返回了无效的资产响应', 'MALFORMED_RESPONSE')
    const status = requiredString(source, 'status')
    if (status !== 'prepared' && status !== 'completed') {
      throw new LlmError('Arkme AI 返回了无效的资产状态', 'MALFORMED_RESPONSE')
    }
    const result: PreparedUpload = {
      uploadUid: requiredString(source, 'upload_uid'),
      assetRef: requiredString(source, 'asset_ref'),
      status,
      uploadExpiresAt: requiredPositiveInteger(source, 'expires_at'),
      assetExpiresAt: requiredPositiveInteger(source, 'asset_expires_at'),
    }
    if (status === 'prepared') {
      const upload = asRecord(source.upload)
      if (upload === undefined || requiredString(upload, 'method') !== 'PUT') {
        throw new LlmError('Arkme AI 返回了无效的上传参数', 'MALFORMED_RESPONSE')
      }
      result.upload = {
        method: 'PUT',
        url: requiredHTTPSURL(upload, 'url'),
        headers: optionalHeaders(upload.headers),
      }
    }
    return result
  }

  private async completeUpload(
    uploadUid: string,
    bearer: string,
    signal: AbortSignal,
  ): Promise<CachedInputAsset> {
    const data = await this.postEnvelope('/input-assets/uploads/complete', {
      upload_uid: uploadUid,
    }, bearer, signal)
    const source = asRecord(data)
    if (source === undefined || requiredString(source, 'status') !== 'ready') {
      throw new LlmError('Arkme AI 图片资产未就绪', 'MALFORMED_RESPONSE')
    }
    return {
      assetRef: requiredString(source, 'asset_ref'),
      expiresAt: requiredPositiveInteger(source, 'expires_at'),
    }
  }

  private async postEnvelope(
    path: string,
    body: Record<string, unknown>,
    bearer: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await this.options.fetchImpl(`${this.options.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) throw await parseHttpError(response)
    let payload: unknown
    try { payload = await response.json() } catch (error) {
      throw new LlmError('Arkme AI 返回了无效的资产响应', 'MALFORMED_RESPONSE', { cause: error })
    }
    const envelope = asRecord(payload) as ManagedEnvelope | undefined
    if (envelope === undefined || envelope.code !== 200) {
      const details = asRecord(envelope?.data)
      const code = typeof details?.error_code === 'string' ? details.error_code : 'MANAGED_AI_FAILED'
      const invalid = code.startsWith('invalid_') || code.includes('expired') || code.includes('not_found')
        || code.includes('conflict') || code.includes('quota_exceeded')
      throw new ManagedAiApplicationError(
        envelope?.message ?? 'Arkme AI 资产请求失败',
        invalid ? 'INVALID_REQUEST' : 'SERVER',
        code,
      )
    }
    return envelope.data
  }
}
