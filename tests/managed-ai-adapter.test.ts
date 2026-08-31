import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import {
  ARKME_MANAGED_MODEL,
  ARKME_MANAGED_PROVIDER,
  createManagedAiLlmAdapter,
  localizeManagedAiError,
  registerManagedAiProvider,
} from '../src/managed-ai/adapter.js'
import { ManagedAiTransport, type ManagedModelCapability } from '../src/managed-ai/transport.js'
import { SecretValue } from '../src/secret-value.js'

const TEXT_CAPABILITY = {
  contract_version: 'text-chat-v1',
  input_modalities: ['text'],
  output_modalities: ['text'],
  materialization_mode: 'none-v1',
  usage_schema: 'cache-split-token-v1',
}

const MANAGED_CATALOG_ITEMS = [
  {
    provider: 'arkme-managed',
    public_model_code: 'deepseek-v4-flash',
    display_name: 'DeepSeek V4 Flash',
    context_window_tokens: '1000000',
    default_max_output_tokens: '256000',
    maximum_max_output_tokens: '384000',
    capability: TEXT_CAPABILITY,
  },
  {
    provider: 'arkme-managed',
    public_model_code: 'qwen3.8-max',
    display_name: 'Qwen3.8 Max',
    context_window_tokens: '1000000',
    default_max_output_tokens: '65536',
    maximum_max_output_tokens: '131072',
    capability: TEXT_CAPABILITY,
  },
  {
    provider: 'arkme-managed',
    public_model_code: 'glm-5.2',
    display_name: 'GLM-5.2',
    context_window_tokens: '1048576',
    default_max_output_tokens: '65536',
    maximum_max_output_tokens: '131072',
    capability: TEXT_CAPABILITY,
  },
  {
    provider: 'arkme-managed',
    public_model_code: 'deepseek-v4-flash-bailian',
    display_name: 'DeepSeek V4 Flash（百炼）',
    context_window_tokens: '1000000',
    default_max_output_tokens: '131072',
    maximum_max_output_tokens: '393216',
    capability: TEXT_CAPABILITY,
  },
]

function managedCatalogResponse(items: unknown = MANAGED_CATALOG_ITEMS): Response {
  return new Response(JSON.stringify({
    code: 200,
    message: '请求成功',
    data: { item_ls: items },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Arkme managed model adapter', () => {
  it('advertises every active backend catalog model without automatic retries', async () => {
    const catalogFetch = vi.fn(async () => managedCatalogResponse())
    const adapter = createManagedAiLlmAdapter({
      intelligentBaseUrl: 'https://intelligent.test',
      credentialOwner: {
        resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
      },
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      fetchImpl: catalogFetch,
    })

    expect(adapter.providerInfo('arkme-managed')).toEqual({
      id: 'arkme-managed',
      name: 'Arkme · 余额计费',
    })
    await expect(adapter.listModels('arkme-managed')).resolves.toEqual([
      {
        provider: 'arkme-managed',
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        inputModalities: ['text'],
      },
      {
        provider: 'arkme-managed',
        id: 'qwen3.8-max',
        name: 'Qwen3.8 Max',
        inputModalities: ['text'],
      },
      {
        provider: 'arkme-managed',
        id: 'glm-5.2',
        name: 'GLM-5.2',
        inputModalities: ['text'],
      },
      {
        provider: 'arkme-managed',
        id: 'deepseek-v4-flash-bailian',
        name: 'DeepSeek V4 Flash（百炼）',
        inputModalities: ['text'],
      },
    ])
    await expect(adapter.resolveModel('arkme-managed', 'qwen3.8-max')).resolves.toMatchObject({
      provider: 'arkme-managed',
      id: 'qwen3.8-max',
      name: 'Qwen3.8 Max',
      context: { contextWindow: 1_000_000 },
      defaultMaxTokens: 65_536,
    })
    const prepared = await (adapter as unknown as {
      prepareCall(provider: string, model: string): Promise<{ model: { id: string } }>
    }).prepareCall('arkme-managed', 'qwen3.8-max')
    expect(prepared.model.id).toBe('qwen3.8-max')
    await expect(adapter.resolveModel('arkme-managed', 'deepseek-v4-pro')).rejects.toMatchObject({
      code: 'UNKNOWN_MODEL',
    })
    expect(adapter.providerRetryPolicy('arkme-managed')).toMatchObject({
      mode: 'normal',
      maxRetries: 0,
    })
    expect(catalogFetch).toHaveBeenCalledTimes(1)
    expect(catalogFetch).toHaveBeenCalledWith(
      'https://intelligent.test/api/v1/managed-ai/models/query',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer arkme-access' }),
        body: '{}',
      }),
    )
  })

  it('uploads a DSH image directly, completes an ambiguous existing object, and sends only image_asset', async () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const attachment = {
      attachmentId: AttachmentId('sha256-managed-image'),
      mediaType: 'image/png' as const,
      bytes: imageBytes.byteLength,
      width: 1,
      height: 1,
      name: 'screen.png',
    }
    const imageCapability = {
      contract_version: 'deepseek-vision-exp-chat-v1',
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
      image: {
        allowed_media_types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        maximum_images: 600,
        maximum_bytes_per_image: 64 * 1024 * 1024,
        maximum_total_bytes: 200 * 1024 * 1024,
        maximum_width: 8192,
        maximum_height: 8192,
        count_dimension_limits: [{ minimum_images: 15, maximum_width: 4096, maximum_height: 4096 }],
        token_estimator: 'deepseek-upper-384-v1',
        evidence: {
          provider_reference_url: 'https://api-docs.deepseek.com/guides/vision/',
          verified_on: '2026-08-31',
          provider_documented_fields: [
            'allowed_media_types', 'maximum_images', 'maximum_bytes_per_image', 'maximum_total_bytes',
            'maximum_width', 'maximum_height', 'count_dimension_limits', 'token_estimator',
          ],
        },
      },
      materialization_mode: 'deepseek-files-v1',
      usage_schema: 'cache-split-token-v1',
    }
    const catalogItem = {
      ...MANAGED_CATALOG_ITEMS[0],
      public_model_code: 'deepseek-v4-flash-vision-exp',
      display_name: 'DeepSeek V4 Flash Vision Exp',
      capability: imageCapability,
    }
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      let body: unknown = init?.body
      if (typeof body === 'string' && (init?.headers as Record<string, string> | undefined)?.['Content-Type'] === 'application/json') {
        body = JSON.parse(body) as unknown
      }
      calls.push({ url, method, body })
      if (url.endsWith('/models/query')) return managedCatalogResponse([catalogItem])
      if (url.endsWith('/input-assets/uploads/prepare')) {
        return new Response(JSON.stringify({
          code: 200,
          message: '请求成功',
          data: {
            upload_uid: 'mai_upload_123',
            asset_ref: 'mai_asset_123',
            status: 'prepared',
            upload: {
              method: 'PUT',
              url: 'https://oss.test/managed/input.png?signature=secret',
              headers: { 'Content-Type': 'image/png' },
            },
            expires_at: Date.now() + 10 * 60_000,
            asset_expires_at: Date.now() + 7 * 24 * 60 * 60_000,
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      // A lost successful PUT response is retried against forbid-overwrite OSS
      // as 409; the adapter must validate it through complete, not abort it.
      if (url.startsWith('https://oss.test/managed/input.png')) return new Response(null, { status: 409 })
      if (url.endsWith('/input-assets/uploads/complete')) {
        return new Response(JSON.stringify({
          code: 200,
          message: '请求成功',
          data: {
            asset_ref: 'mai_asset_123',
            kind: 'image',
            sha256: '0'.repeat(64),
            media_type: 'image/png',
            size_bytes: imageBytes.byteLength,
            width: 1,
            height: 1,
            status: 'ready',
            expires_at: Date.now() + 7 * 24 * 60 * 60_000,
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/chat/completions')) {
        return new Response([
          'data: {"choices":[{"index":0,"delta":{"content":"看到了"},"finish_reason":null}]}',
          '',
          'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
          '',
          'data: [DONE]',
          '',
          '',
        ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      throw new Error(`unexpected request: ${method} ${url}`)
    })
    const adapter = createManagedAiLlmAdapter({
      intelligentBaseUrl: 'https://intelligent.test',
      credentialOwner: {
        resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
      },
      attachmentReader: {
        readImage: vi.fn(async () => ({ ref: attachment, data: imageBytes })),
      },
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      fetchImpl,
    })

    await expect(adapter.resolveModel(
      ARKME_MANAGED_PROVIDER,
      'deepseek-v4-flash-vision-exp',
    )).resolves.toMatchObject({ inputModalities: ['text', 'image'] })
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({
      provider: ARKME_MANAGED_PROVIDER,
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [
          { type: 'text', text: '这张图里有什么？' },
          { type: 'image', attachment },
        ],
        source: { kind: 'user' },
      })],
    })) chunks.push(chunk)

    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: '看到了' })
    const prepare = calls.find(call => call.url.endsWith('/input-assets/uploads/prepare'))
    expect(prepare?.body).toMatchObject({
      public_model_code: 'deepseek-v4-flash-vision-exp',
      capability_contract_version: 'deepseek-vision-exp-chat-v1',
      asset: {
        kind: 'image',
        media_type: 'image/png',
        size_bytes: imageBytes.byteLength,
        width: 1,
        height: 1,
      },
    })
    expect(prepare?.body).toMatchObject({ asset: { sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) } })
    const oss = calls.find(call => call.url.startsWith('https://oss.test/managed/input.png'))
    expect(oss?.method).toBe('PUT')
    expect(Buffer.from(oss?.body as Uint8Array)).toEqual(Buffer.from(imageBytes))
    const chat = calls.find(call => call.url.endsWith('/chat/completions'))
    expect(chat?.body).toMatchObject({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '这张图里有什么？' },
          { type: 'image_asset', asset_ref: 'mai_asset_123' },
        ],
      }],
    })
    expect(JSON.stringify(chat?.body)).not.toContain('signature=secret')
    expect(JSON.stringify(chat?.body)).not.toContain('iVBOR')
  })

  it('enforces Qwen source geometry without treating provider max_pixels as a raw-image limit', async () => {
    const capability = {
      contract_version: 'bailian-qwen38-image-chat-v1',
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
      image: {
        allowed_media_types: ['image/jpeg', 'image/png'],
        maximum_images: 2_048,
        maximum_bytes_per_image: 20 * 1024 * 1024,
        maximum_total_bytes: 1024 * 1024 * 1024,
        minimum_width: 11,
        minimum_height: 11,
        maximum_aspect_ratio: 200,
        provider_max_pixels: 2_621_440,
        token_estimator: 'qwen-32px-default-v1',
        evidence: {
          provider_reference_url: 'https://help.aliyun.com/zh/model-studio/vision',
          verified_on: '2026-08-31',
          provider_documented_fields: [
            'maximum_images', 'maximum_bytes_per_image', 'minimum_width', 'minimum_height',
            'maximum_aspect_ratio', 'provider_max_pixels', 'token_estimator',
          ],
          platform_guardrail_fields: ['allowed_media_types', 'maximum_total_bytes'],
        },
      },
      materialization_mode: 'oss-signed-url-v1',
      usage_schema: 'cache-split-token-v1',
    }
    const reader = vi.fn()
    const adapter = createManagedAiLlmAdapter({
      intelligentBaseUrl: 'https://intelligent.test',
      credentialOwner: { resolveManagedAccessCredential: async () => new SecretValue('arkme-access') },
      attachmentReader: { readImage: reader },
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      fetchImpl: async input => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/models/query')) {
          return managedCatalogResponse([{
            ...MANAGED_CATALOG_ITEMS[1],
            public_model_code: 'qwen3.8-max',
            capability,
          }])
        }
        throw new Error(`unexpected request: ${url}`)
      },
    })
    const attachment = {
      attachmentId: AttachmentId('qwen-too-small'),
      mediaType: 'image/png' as const,
      bytes: 8,
      width: 10,
      height: 10,
      name: 'small.png',
    }
    const stream = adapter.stream({
      provider: ARKME_MANAGED_PROVIDER,
      model: 'qwen3.8-max',
      messages: [createUserMessage({ content: [{ type: 'image', attachment }], source: { kind: 'user' } })],
    })
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(reader).not.toHaveBeenCalled()
  })

  it('keeps a shared image upload alive when only one concurrent caller aborts', async () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const attachment = {
      attachmentId: AttachmentId('shared-managed-image'),
      mediaType: 'image/png' as const,
      bytes: imageBytes.byteLength,
      width: 16,
      height: 16,
      name: 'shared.png',
    }
    const capability: ManagedModelCapability = {
      contractVersion: 'deepseek-vision-exp-chat-v1',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      image: {
        allowedMediaTypes: ['image/png'],
        maximumImages: 1,
        maximumBytesPerImage: 64 * 1024 * 1024,
        maximumWidth: 8192,
        maximumHeight: 8192,
        countDimensionLimits: [],
        evidence: {
          providerReferenceUrl: 'https://api-docs.deepseek.com/guides/vision/',
          verifiedOn: '2026-08-31',
          providerDocumentedFields: [
            'allowed_media_types', 'maximum_images', 'maximum_bytes_per_image',
            'maximum_width', 'maximum_height', 'token_estimator',
          ],
          platformGuardrailFields: [],
        },
      },
    }
    let releaseRead!: () => void
    let markReadStarted!: () => void
    const readStarted = new Promise<void>(resolve => { markReadStarted = resolve })
    const readGate = new Promise<void>(resolve => { releaseRead = resolve })
    const readImage = vi.fn(async (_ref, signal?: AbortSignal) => {
      markReadStarted()
      await readGate
      if (signal?.aborted === true) throw signal.reason
      return { ref: attachment, data: imageBytes }
    })
    let prepareCalls = 0
    let chatCalls = 0
    const transport = new ManagedAiTransport({
      baseUrl: 'https://intelligent.test/api/v1/managed-ai',
      attachmentReader: { readImage },
      fetchImpl: async input => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/input-assets/uploads/prepare')) {
          prepareCalls++
          return new Response(JSON.stringify({
            code: 200,
            data: {
              upload_uid: 'mai_upload_shared',
              asset_ref: 'mai_asset_shared',
              status: 'completed',
              expires_at: Date.now() + 10 * 60_000,
              asset_expires_at: Date.now() + 60 * 60_000,
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.endsWith('/chat/completions')) {
          chatCalls++
          return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
        throw new Error(`unexpected request: ${url}`)
      },
      resolveBearer: async () => 'arkme-access',
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
    })
    const collect = async (signal: AbortSignal) => {
      const chunks: StreamChunk[] = []
      for await (const chunk of transport.stream({
        provider: ARKME_MANAGED_PROVIDER,
        model: 'deepseek-v4-flash-vision-exp',
        signal,
        messages: [createUserMessage({ content: [{ type: 'image', attachment }], source: { kind: 'user' } })],
      }, capability)) chunks.push(chunk)
      return chunks
    }
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = collect(firstController.signal)
    const second = collect(secondController.signal)
    await readStarted
    await new Promise(resolve => setTimeout(resolve, 10))
    firstController.abort()
    releaseRead()

    await expect(first).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(second).resolves.toContainEqual({ type: 'text-delta', index: 0, text: 'ok' })
    expect(readImage).toHaveBeenCalledTimes(1)
    expect(prepareCalls).toBe(1)
    expect(chatCalls).toBe(1)
  })

  it('bounds direct-to-OSS preparation concurrency while preserving all image positions', async () => {
    const attachments = Array.from({ length: 5 }, (_, index) => ({
      attachmentId: AttachmentId(`bounded-managed-image-${String(index)}`),
      mediaType: 'image/png' as const,
      bytes: 1,
      width: 16,
      height: 16,
      name: `bounded-${String(index)}.png`,
    }))
    const capability: ManagedModelCapability = {
      contractVersion: 'test-bounded-image-v1',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      image: {
        allowedMediaTypes: ['image/png'],
        maximumImages: attachments.length,
        maximumBytesPerImage: 1,
        countDimensionLimits: [],
        evidence: {
          providerReferenceUrl: 'https://example.test/provider-contract',
          verifiedOn: '2026-08-31',
          providerDocumentedFields: ['allowed_media_types', 'maximum_images', 'maximum_bytes_per_image', 'token_estimator'],
          platformGuardrailFields: [],
        },
      },
    }
    let releaseReads!: () => void
    const readGate = new Promise<void>(resolve => { releaseReads = resolve })
    let markFourReads!: () => void
    const fourReadsStarted = new Promise<void>(resolve => { markFourReads = resolve })
    let activeReads = 0
    let maximumActiveReads = 0
    let startedReads = 0
    const readImage = vi.fn(async (ref) => {
      const index = attachments.findIndex(value => value.attachmentId === ref.attachmentId)
      activeReads++
      startedReads++
      maximumActiveReads = Math.max(maximumActiveReads, activeReads)
      if (startedReads === 4) markFourReads()
      await readGate
      activeReads--
      return { ref: attachments[index]!, data: Uint8Array.of(index + 1) }
    })
    let prepareCalls = 0
    let chatBody: Record<string, unknown> | undefined
    const transport = new ManagedAiTransport({
      baseUrl: 'https://intelligent.test/api/v1/managed-ai',
      attachmentReader: { readImage },
      fetchImpl: async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/input-assets/uploads/prepare')) {
          prepareCalls++
          return new Response(JSON.stringify({
            code: 200,
            data: {
              upload_uid: `mai_upload_${String(prepareCalls)}`,
              asset_ref: `mai_asset_${String(prepareCalls)}`,
              status: 'completed',
              expires_at: Date.now() + 10 * 60_000,
              asset_expires_at: Date.now() + 60 * 60_000,
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.endsWith('/chat/completions')) {
          chatBody = JSON.parse(String(init?.body)) as Record<string, unknown>
          return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
        throw new Error(`unexpected request: ${url}`)
      },
      resolveBearer: async () => 'arkme-access',
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
    })
    const completed = (async () => {
      const chunks: StreamChunk[] = []
      for await (const chunk of transport.stream({
        provider: ARKME_MANAGED_PROVIDER,
        model: 'bounded-images',
        messages: [createUserMessage({
          content: attachments.map(attachment => ({ type: 'image' as const, attachment })),
          source: { kind: 'user' },
        })],
      }, capability)) chunks.push(chunk)
      return chunks
    })()

    await fourReadsStarted
    await Promise.resolve()
    expect(startedReads).toBe(4)
    releaseReads()
    await expect(completed).resolves.toContainEqual({ type: 'text-delta', index: 0, text: 'ok' })
    expect(maximumActiveReads).toBe(4)
    expect(readImage).toHaveBeenCalledTimes(5)
    expect(prepareCalls).toBe(5)
    expect(JSON.stringify(chatBody)).toContain('mai_asset_5')
  })

  it('reuses the upload generation after an ambiguous prepare transport failure', async () => {
    const data = Uint8Array.of(1, 2, 3)
    const attachment = {
      attachmentId: AttachmentId('opaque-retry-image'),
      mediaType: 'image/png' as const,
      bytes: data.byteLength,
      width: 16,
      height: 16,
      name: 'retry.png',
    }
    const capability: ManagedModelCapability = {
      contractVersion: 'test-retry-image-v1',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      image: {
        allowedMediaTypes: ['image/png'],
        maximumImages: 1,
        maximumBytesPerImage: data.byteLength,
        countDimensionLimits: [],
        evidence: {
          providerReferenceUrl: 'https://example.test/provider-contract',
          verifiedOn: '2026-08-31',
          providerDocumentedFields: ['allowed_media_types', 'maximum_images', 'maximum_bytes_per_image', 'token_estimator'],
          platformGuardrailFields: [],
        },
      },
    }
    const attemptKeys: string[] = []
    let prepareCalls = 0
    const transport = new ManagedAiTransport({
      baseUrl: 'https://intelligent.test/api/v1/managed-ai',
      attachmentReader: { readImage: async () => ({ ref: attachment, data }) },
      fetchImpl: async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/input-assets/uploads/prepare')) {
          const body = JSON.parse(String(init?.body)) as { idempotency_key: string }
          attemptKeys.push(body.idempotency_key)
          prepareCalls++
          if (prepareCalls === 1) throw new TypeError('connection reset after request write')
          return new Response(JSON.stringify({
            code: 200,
            data: {
              upload_uid: 'mai_upload_resumed',
              asset_ref: 'mai_asset_resumed',
              status: 'completed',
              expires_at: Date.now() + 10 * 60_000,
              asset_expires_at: Date.now() + 60 * 60_000,
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.endsWith('/chat/completions')) {
          return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
        throw new Error(`unexpected request: ${url}`)
      },
      resolveBearer: async () => 'arkme-access',
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
    })
    const collect = async () => {
      const chunks: StreamChunk[] = []
      for await (const chunk of transport.stream({
        provider: ARKME_MANAGED_PROVIDER,
        model: 'retry-image',
        messages: [createUserMessage({ content: [{ type: 'image', attachment }], source: { kind: 'user' } })],
      }, capability)) chunks.push(chunk)
      return chunks
    }

    await expect(collect()).rejects.toMatchObject({ code: 'TRANSPORT' })
    await expect(collect()).resolves.toContainEqual({ type: 'text-delta', index: 0, text: 'ok' })
    expect(attemptKeys).toHaveLength(2)
    expect(attemptKeys[1]).toBe(attemptKeys[0])
  })

  it('rotates an expired server generation and resumes within the same DSH request', async () => {
    const data = Uint8Array.of(1, 2, 3)
    const attachment = {
      attachmentId: AttachmentId('expired-generation-image'),
      mediaType: 'image/png' as const,
      bytes: data.byteLength,
      width: 16,
      height: 16,
      name: 'expired.png',
    }
    const capability: ManagedModelCapability = {
      contractVersion: 'test-expired-generation-v1',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      image: {
        allowedMediaTypes: ['image/png'],
        maximumImages: 1,
        maximumBytesPerImage: data.byteLength,
        countDimensionLimits: [],
        evidence: {
          providerReferenceUrl: 'https://example.test/provider-contract',
          verifiedOn: '2026-08-31',
          providerDocumentedFields: ['allowed_media_types', 'maximum_images', 'maximum_bytes_per_image', 'token_estimator'],
          platformGuardrailFields: [],
        },
      },
    }
    const attemptKeys: string[] = []
    let prepareCalls = 0
    const transport = new ManagedAiTransport({
      baseUrl: 'https://intelligent.test/api/v1/managed-ai',
      attachmentReader: { readImage: async () => ({ ref: attachment, data }) },
      fetchImpl: async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/input-assets/uploads/prepare')) {
          const body = JSON.parse(String(init?.body)) as { idempotency_key: string }
          attemptKeys.push(body.idempotency_key)
          prepareCalls++
          if (prepareCalls === 1) {
            return new Response(JSON.stringify({
              code: 1001,
              message: '上传会话已过期',
              data: { error_code: 'input_asset_upload_conflict' },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } })
          }
          return new Response(JSON.stringify({
            code: 200,
            data: {
              upload_uid: 'mai_upload_rotated',
              asset_ref: 'mai_asset_rotated',
              status: 'completed',
              expires_at: Date.now() + 10 * 60_000,
              asset_expires_at: Date.now() + 60 * 60_000,
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.endsWith('/chat/completions')) {
          return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
        throw new Error(`unexpected request: ${url}`)
      },
      resolveBearer: async () => 'arkme-access',
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of transport.stream({
      provider: ARKME_MANAGED_PROVIDER,
      model: 'expired-generation-image',
      messages: [createUserMessage({ content: [{ type: 'image', attachment }], source: { kind: 'user' } })],
    }, capability)) chunks.push(chunk)

    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'ok' })
    expect(attemptKeys).toHaveLength(2)
    expect(attemptKeys[1]).not.toBe(attemptKeys[0])
  })

  it('uses the server upload expiry instead of a local session lifetime', async () => {
    const data = Uint8Array.of(4, 5, 6)
    const attachment = {
      attachmentId: AttachmentId('server-expiry-image'),
      mediaType: 'image/png' as const,
      bytes: data.byteLength,
      width: 16,
      height: 16,
      name: 'server-expiry.png',
    }
    const capability: ManagedModelCapability = {
      contractVersion: 'test-server-expiry-v1',
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      image: {
        allowedMediaTypes: ['image/png'],
        maximumImages: 1,
        maximumBytesPerImage: data.byteLength,
        countDimensionLimits: [],
        evidence: {
          providerReferenceUrl: 'https://example.test/provider-contract',
          verifiedOn: '2026-08-31',
          providerDocumentedFields: ['allowed_media_types', 'maximum_images', 'maximum_bytes_per_image', 'token_estimator'],
          platformGuardrailFields: [],
        },
      },
    }
    const attemptKeys: string[] = []
    let prepareCalls = 0
    const transport = new ManagedAiTransport({
      baseUrl: 'https://intelligent.test/api/v1/managed-ai',
      attachmentReader: { readImage: async () => ({ ref: attachment, data }) },
      fetchImpl: async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/input-assets/uploads/prepare')) {
          const body = JSON.parse(String(init?.body)) as { idempotency_key: string }
          attemptKeys.push(body.idempotency_key)
          prepareCalls++
          if (prepareCalls === 1) {
            return new Response(JSON.stringify({
              code: 200,
              data: {
                upload_uid: 'mai_upload_short',
                asset_ref: 'mai_asset_short',
                status: 'prepared',
                upload: { method: 'PUT', url: 'https://oss.test/short.png', headers: {} },
                expires_at: Date.now() + 5,
                asset_expires_at: Date.now() + 60 * 60_000,
              },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } })
          }
          return new Response(JSON.stringify({
            code: 200,
            data: {
              upload_uid: 'mai_upload_after_expiry',
              asset_ref: 'mai_asset_after_expiry',
              status: 'completed',
              expires_at: Date.now() + 10 * 60_000,
              asset_expires_at: Date.now() + 60 * 60_000,
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url === 'https://oss.test/short.png') throw new TypeError('lost PUT response')
        if (url.endsWith('/chat/completions')) {
          return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
        throw new Error(`unexpected request: ${url}`)
      },
      resolveBearer: async () => 'arkme-access',
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
    })
    const collect = async () => {
      const chunks: StreamChunk[] = []
      for await (const chunk of transport.stream({
        provider: ARKME_MANAGED_PROVIDER,
        model: 'server-expiry-image',
        messages: [createUserMessage({ content: [{ type: 'image', attachment }], source: { kind: 'user' } })],
      }, capability)) chunks.push(chunk)
      return chunks
    }

    await expect(collect()).rejects.toMatchObject({ code: 'TRANSPORT' })
    await new Promise(resolve => setTimeout(resolve, 15))
    await expect(collect()).resolves.toContainEqual({ type: 'text-delta', index: 0, text: 'ok' })
    expect(attemptKeys).toHaveLength(2)
    expect(attemptKeys[1]).not.toBe(attemptKeys[0])
  })

  it('uses a newly discovered Arkme model id on the managed chat route', async () => {
    let requestedModel: unknown
    const server = createServer(async (req, res) => {
      const body: Buffer[] = []
      for await (const chunk of req) body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      if (req.url === '/api/v1/managed-ai/models/query') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(await managedCatalogResponse().text())
        return
      }
      requestedModel = (JSON.parse(Buffer.concat(body).toString('utf8')) as Record<string, unknown>).model
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end([
        'data: {"choices":[{"index":0,"delta":{"content":"完成"},"finish_reason":null}]}',
        '',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n') + '\n')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address() as AddressInfo
      const adapter = createManagedAiLlmAdapter({
        intelligentBaseUrl: `http://127.0.0.1:${String(address.port)}`,
        credentialOwner: {
          resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
        },
        resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      })

      await adapter.listModels(ARKME_MANAGED_PROVIDER)
      const chunks: StreamChunk[] = []
      for await (const chunk of adapter.stream({
        provider: ARKME_MANAGED_PROVIDER,
        model: 'qwen3.8-max',
        messages: [createUserMessage({
          content: [{ type: 'text', text: '你好' }],
          source: { kind: 'user' },
        })],
      })) chunks.push(chunk)

      expect(requestedModel).toBe('qwen3.8-max')
      expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: '完成' })
    } finally {
      await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    }
  })

  it('keeps the first non-empty tool identity when later SSE deltas contain empty fields', async () => {
    const server = createServer(async (req, res) => {
      for await (const _chunk of req) { /* Drain the request before responding. */ }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end([
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_weather","type":"function","function":{"name":"web_search","arguments":""}}]},"finish_reason":null}]}',
        '',
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"","type":"function","function":{"name":"","arguments":"{\\"queries\\":[]}"}}]},"finish_reason":"tool_calls"}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n') + '\n')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address() as AddressInfo
      const adapter = createManagedAiLlmAdapter({
        intelligentBaseUrl: `http://127.0.0.1:${String(address.port)}`,
        credentialOwner: {
          resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
        },
        resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      })
      const chunks: StreamChunk[] = []
      for await (const chunk of adapter.stream({
        provider: ARKME_MANAGED_PROVIDER,
        model: ARKME_MANAGED_MODEL,
        messages: [createUserMessage({
          content: [{ type: 'text', text: '查天气' }],
          source: { kind: 'user' },
        })],
      })) chunks.push(chunk)

      expect(chunks.filter(chunk => chunk.type === 'tool-call-delta')).toEqual([
        {
          type: 'tool-call-delta', index: 0, id: 'call_weather', name: 'web_search', argumentsDelta: '',
        },
        {
          type: 'tool-call-delta', index: 0, id: 'call_weather', name: 'web_search', argumentsDelta: '{"queries":[]}',
        },
      ])
      expect(chunks).toContainEqual({
        type: 'block-end', index: 0,
        block: { type: 'tool-call', id: 'call_weather', name: 'web_search', arguments: '{"queries":[]}' },
      })
    } finally {
      await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    }
  })

  it('fails closed when the first catalog snapshot is unavailable', async () => {
    const adapter = createManagedAiLlmAdapter({
      intelligentBaseUrl: 'https://intelligent.test',
      credentialOwner: {
        resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
      },
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      fetchImpl: async () => { throw new Error('catalog unavailable') },
    })

    await expect(adapter.listModels(ARKME_MANAGED_PROVIDER)).rejects.toMatchObject({ code: 'TRANSPORT' })
    await expect(adapter.resolveModel(ARKME_MANAGED_PROVIDER, ARKME_MANAGED_MODEL)).rejects.toMatchObject({
      code: 'TRANSPORT',
    })
  })

  it('keeps the last-good catalog when a later refresh is malformed', async () => {
    let now = 10_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const catalogFetch = vi.fn()
      .mockResolvedValueOnce(managedCatalogResponse())
      .mockResolvedValueOnce(managedCatalogResponse([{ provider: 'arkme-managed' }]))
    try {
      const adapter = createManagedAiLlmAdapter({
        intelligentBaseUrl: 'https://intelligent.test',
        credentialOwner: {
          resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
        },
        resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
        fetchImpl: catalogFetch,
      })

      const first = await adapter.listModels(ARKME_MANAGED_PROVIDER)
      now += 60_001
      const afterMalformedRefresh = await adapter.listModels(ARKME_MANAGED_PROVIDER)

      expect(afterMalformedRefresh).toEqual(first)
      expect(catalogFetch).toHaveBeenCalledTimes(2)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('uses an empty active backend catalog as authoritative', async () => {
    const adapter = createManagedAiLlmAdapter({
      intelligentBaseUrl: 'https://intelligent.test',
      credentialOwner: {
        resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
      },
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      fetchImpl: async () => managedCatalogResponse([]),
    })

    await expect(adapter.listModels(ARKME_MANAGED_PROVIDER)).resolves.toEqual([])
    await expect(adapter.resolveModel(ARKME_MANAGED_PROVIDER, ARKME_MANAGED_MODEL)).rejects.toMatchObject({
      code: 'UNKNOWN_MODEL',
    })
  })

  it('streams through the managed endpoint with the current Arkme bearer', async () => {
    let credentialReads = 0
    let request: { url: string; authorization: string; body: Record<string, unknown> } | undefined
    const received = new Promise<void>((resolve, reject) => {
      const server = createServer(async (req, res) => {
        try {
          const body: Buffer[] = []
          for await (const chunk of req) body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          if (req.url === '/api/v1/managed-ai/models/query') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ code: 200, message: '请求成功', data: { item_ls: MANAGED_CATALOG_ITEMS } }))
            return
          }
          request = {
            url: req.url ?? '',
            authorization: req.headers.authorization ?? '',
            body: JSON.parse(Buffer.concat(body).toString('utf8')) as Record<string, unknown>,
          }
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          res.end([
            'data: {"choices":[{"index":0,"delta":{"content":"你好"},"finish_reason":null}]}',
            '',
            'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"completion_tokens":3,"prompt_cache_hit_tokens":5}}',
            '',
            'data: [DONE]',
            '',
          ].join('\n'))
          resolve()
        } catch (error) {
          reject(error)
        }
      })
      server.on('error', reject)
      server.listen(0, '127.0.0.1', async () => {
        try {
          const address = server.address() as AddressInfo
          const adapter = createManagedAiLlmAdapter({
            intelligentBaseUrl: `http://127.0.0.1:${String(address.port)}`,
            credentialOwner: {
              resolveManagedAccessCredential: async () => {
                credentialReads += 1
                return new SecretValue('arkme-access')
              },
            },
            resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
          })
          const chunks: StreamChunk[] = []
          for await (const chunk of adapter.stream({
            provider: ARKME_MANAGED_PROVIDER,
            model: ARKME_MANAGED_MODEL,
            messages: [createUserMessage({
              content: [{ type: 'text', text: '你好' }],
              source: { kind: 'user' },
            })],
          })) chunks.push(chunk)
          expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: '你好' })
          expect(chunks).toContainEqual({
            type: 'usage',
            usage: { inputTokens: 15, outputTokens: 3, cacheReadTokens: 5 },
          })
          expect(chunks).toContainEqual({ type: 'finish', reason: { kind: 'stop' } })
        } catch (error) {
          reject(error)
        } finally {
          server.close()
        }
      })
    })

    await received
    expect(credentialReads).toBe(2)
    expect(request).toMatchObject({
      url: '/api/v1/managed-ai/chat/completions',
      authorization: 'Bearer arkme-access',
      body: {
        model: ARKME_MANAGED_MODEL,
        stream: true,
        stream_options: { include_usage: true },
      },
    })
    expect(request?.body).not.toHaveProperty('user')
    expect(request?.body).not.toHaveProperty('user_id')
  })

  it('turns an explicit HTTP 402 into a stable Arkme recharge prompt', async () => {
    const server = createServer(async (req, res) => {
      for await (const _chunk of req) { /* Drain the request before responding. */ }
      res.writeHead(402, {
        'Content-Type': 'application/json',
        'X-Request-ID': 'mai_req_balance',
      })
      res.end(JSON.stringify({
        error: {
          message: 'insufficient AI balance',
          type: 'billing_error',
          code: 'insufficient_balance',
          param: null,
        },
      }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address() as AddressInfo
      const adapter = createManagedAiLlmAdapter({
        intelligentBaseUrl: `http://127.0.0.1:${String(address.port)}`,
        credentialOwner: {
          resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
        },
        resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      })
      const stream = adapter.stream({
        provider: ARKME_MANAGED_PROVIDER,
        model: ARKME_MANAGED_MODEL,
        messages: [createUserMessage({
          content: [{ type: 'text', text: '测试' }],
          source: { kind: 'user' },
        })],
      })

      await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        code: 'INSUFFICIENT_BALANCE',
        message: 'Arkme AI 余额不足，请前往 Arkme 设置中的余额充值后重试',
        failure: {
          code: 'INSUFFICIENT_BALANCE',
          message: 'Arkme AI 余额不足，请前往 Arkme 设置中的余额充值后重试',
          status: 402,
          requestId: 'mai_req_balance',
        },
      })
    } finally {
      await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    }
  })

  it.each([
    {
      code: 'QUOTA', status: 402,
      expectedCode: 'INSUFFICIENT_BALANCE',
      expectedMessage: 'Arkme AI 余额不足，请前往 Arkme 设置中的余额充值后重试',
    },
    {
      code: 'AUTH', status: 401,
      expectedCode: 'AUTH',
      expectedMessage: '请先登录或重新登录 Arkme 后再使用托管模型',
    },
    {
      code: 'RATE_LIMIT', status: 429,
      expectedCode: 'RATE_LIMIT',
      expectedMessage: 'Arkme AI 请求过于频繁，请稍后重试',
    },
    {
      code: 'TIMEOUT', status: 504,
      expectedCode: 'TIMEOUT',
      expectedMessage: 'Arkme AI 响应超时，请稍后重试',
    },
    {
      code: 'TRANSPORT',
      expectedCode: 'TRANSPORT',
      expectedMessage: '无法连接 Arkme AI 服务，请检查网络后重试',
    },
    {
      code: 'CONTEXT_WINDOW_EXCEEDED', status: 400,
      expectedCode: 'CONTEXT_WINDOW_EXCEEDED',
      expectedMessage: '对话内容过长，请新建对话或减少上下文后重试',
    },
    {
      code: 'INVALID_REQUEST', status: 400,
      expectedCode: 'INVALID_REQUEST',
      expectedMessage: '请求内容不符合 Arkme AI 要求，请调整后重试',
    },
    {
      code: 'UNKNOWN_MODEL',
      expectedCode: 'UNKNOWN_MODEL',
      expectedMessage: '当前 Arkme 模型不可用，请重新选择模型后重试',
    },
    {
      code: 'STREAM_CLOSED',
      expectedCode: 'STREAM_CLOSED',
      expectedMessage: 'Arkme AI 返回异常，请重新发送消息',
    },
    {
      code: 'SERVER', status: 503,
      expectedCode: 'SERVER',
      expectedMessage: 'Arkme AI 服务暂不可用，请稍后重试',
    },
    {
      code: 'UNEXPECTED_PROVIDER_ERROR',
      expectedCode: 'UNEXPECTED_PROVIDER_ERROR',
      expectedMessage: 'Arkme AI 请求失败，请稍后重试',
    },
  ])('localizes cross-module $code failures without relying on instanceof', ({
    code, status, expectedCode, expectedMessage,
  }) => {
    const localized = localizeManagedAiError({
      message: 'English provider error',
      code,
      failure: {
        message: 'English provider error',
        code,
        ...(status === undefined ? {} : { status }),
        requestId: 'managed_req_localize',
      },
    })

    expect(localized).toMatchObject({
      code: expectedCode,
      message: expectedMessage,
      failure: {
        code: expectedCode,
        message: expectedMessage,
        ...(status === undefined ? {} : { status }),
        requestId: 'managed_req_localize',
      },
    })
  })

  it('preserves the backend HTTP 504 timeout contract as a DSH timeout', async () => {
    const server = createServer(async (req, res) => {
      for await (const _chunk of req) { /* Drain the request before responding. */ }
      res.writeHead(504, {
        'Content-Type': 'application/json',
        'X-Request-ID': 'mai_req_timeout',
      })
      res.end(JSON.stringify({
        error: {
          message: 'Managed AI upstream timed out',
          type: 'server_error',
          code: 'upstream_timeout',
          param: null,
        },
      }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address() as AddressInfo
      const adapter = createManagedAiLlmAdapter({
        intelligentBaseUrl: `http://127.0.0.1:${String(address.port)}`,
        credentialOwner: {
          resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
        },
        resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      })
      const stream = adapter.stream({
        provider: ARKME_MANAGED_PROVIDER,
        model: ARKME_MANAGED_MODEL,
        messages: [createUserMessage({
          content: [{ type: 'text', text: '测试' }],
          source: { kind: 'user' },
        })],
      })

      await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        code: 'TIMEOUT',
        message: 'Arkme AI 响应超时，请稍后重试',
        failure: {
          code: 'TIMEOUT',
          message: 'Arkme AI 响应超时，请稍后重试',
          status: 504,
          requestId: 'mai_req_timeout',
        },
      })
    } finally {
      await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    }
  })

  it('registers the Arkme route in the public DSH model directory', async () => {
    const ctx = new Context()
    const llm = await ctx.plugin(LlmRuntime)
    try {
      registerManagedAiProvider(ctx, {
        intelligentBaseUrl: 'https://intelligent.test',
        credentialOwner: {
          resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
        },
        resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
        fetchImpl: async () => managedCatalogResponse(),
      })
      expect(ctx.llm.listProviders()).toContainEqual({
        id: ARKME_MANAGED_PROVIDER,
        name: 'Arkme · 余额计费',
      })
      const models = await ctx.llm.listModels(ARKME_MANAGED_PROVIDER)
      expect(models.map(model => [model.id, model.name])).toEqual([
        ['deepseek-v4-flash', 'DeepSeek V4 Flash'],
        ['qwen3.8-max', 'Qwen3.8 Max'],
        ['glm-5.2', 'GLM-5.2'],
        ['deepseek-v4-flash-bailian', 'DeepSeek V4 Flash（百炼）'],
      ])
    } finally {
      await llm.dispose()
    }
  })

  it.each(['login-required', 'login-expired'])(
    'reports %s as Arkme authentication instead of an API-key setup error',
    async (sourceCode) => {
      const loginError = Object.assign(new Error('请先登录 Arkme'), {
        code: sourceCode,
        httpStatus: 401,
      })
      const adapter = createManagedAiLlmAdapter({
        intelligentBaseUrl: 'https://intelligent.test',
        credentialOwner: {
          resolveManagedAccessCredential: async () => { throw loginError },
        },
        resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      })
      const stream = adapter.stream({
        provider: ARKME_MANAGED_PROVIDER,
        model: ARKME_MANAGED_MODEL,
        messages: [createUserMessage({
          content: [{ type: 'text', text: '你好' }],
          source: { kind: 'user' },
        })],
      })

      await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        code: 'AUTH',
        message: '请先登录或重新登录 Arkme 后再使用托管模型',
        failure: { code: 'AUTH', status: 401 },
      })
    },
  )

  it.each([
    {
      sourceCode: 'arkme-network-error',
      status: 502,
      sourceMessage: '无法连接 Arkme 服务',
      expectedMessage: '无法连接 Arkme AI 服务，请检查网络后重试',
      expectedCode: 'TRANSPORT',
    },
    {
      sourceCode: 'arkme-http-error',
      status: 503,
      sourceMessage: 'Arkme 服务暂不可用',
      expectedMessage: 'Arkme AI 服务暂不可用，请稍后重试',
      expectedCode: 'SERVER',
    },
  ])('preserves $sourceCode credential failures as $expectedCode', async ({
    sourceCode, status, sourceMessage, expectedMessage, expectedCode,
  }) => {
    const sourceError = Object.assign(new Error(sourceMessage), {
      code: sourceCode,
      httpStatus: status,
    })
    const adapter = createManagedAiLlmAdapter({
      intelligentBaseUrl: 'https://intelligent.test',
      credentialOwner: {
        resolveManagedAccessCredential: async () => { throw sourceError },
      },
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
    })
    const stream = adapter.stream({
      provider: ARKME_MANAGED_PROVIDER,
      model: ARKME_MANAGED_MODEL,
      messages: [createUserMessage({
        content: [{ type: 'text', text: '你好' }],
        source: { kind: 'user' },
      })],
    })

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: expectedCode,
      message: expectedMessage,
      failure: { code: expectedCode, status },
    })
  })

  it('rejects a model absent from the latest managed catalog after one owner refresh', async () => {
    let credentialReads = 0
    const adapter = createManagedAiLlmAdapter({
      intelligentBaseUrl: 'https://intelligent.test',
      credentialOwner: {
        resolveManagedAccessCredential: async () => {
          credentialReads += 1
          return new SecretValue('arkme-access')
        },
      },
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      fetchImpl: async () => managedCatalogResponse(),
    })

    await expect(adapter.resolveModel(ARKME_MANAGED_PROVIDER, 'other-model')).rejects.toMatchObject({
      code: 'UNKNOWN_MODEL',
    })
    const stream = adapter.stream({
      provider: ARKME_MANAGED_PROVIDER,
      model: 'other-model',
      messages: [createUserMessage({
        content: [{ type: 'text', text: '你好' }],
        source: { kind: 'user' },
      })],
    })
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'UNKNOWN_MODEL',
    })
    expect(credentialReads).toBe(1)
  })

  it('cancels unknown-model discovery before reading credentials when the caller is already aborted', async () => {
    let credentialReads = 0
    const adapter = createManagedAiLlmAdapter({
      intelligentBaseUrl: 'https://intelligent.test',
      credentialOwner: {
        resolveManagedAccessCredential: async () => {
          credentialReads += 1
          return new SecretValue('arkme-access')
        },
      },
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      fetchImpl: async () => managedCatalogResponse(),
    })
    const controller = new AbortController()
    controller.abort()

    await expect(adapter.resolveModel(
      ARKME_MANAGED_PROVIDER,
      'other-model',
      controller.signal,
    )).rejects.toMatchObject({ code: 'ABORTED' })
    expect(credentialReads).toBe(0)
  })
})
