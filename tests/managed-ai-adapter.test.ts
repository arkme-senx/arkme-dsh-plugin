import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
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
import { SecretValue } from '../src/secret-value.js'

const MANAGED_CATALOG_ITEMS = [
  {
    provider: 'arkme-managed',
    public_model_code: 'deepseek-v4-flash',
    display_name: 'DeepSeek V4 Flash',
    context_window_tokens: '1000000',
    default_max_output_tokens: '256000',
    maximum_max_output_tokens: '384000',
  },
  {
    provider: 'arkme-managed',
    public_model_code: 'qwen3.8-max',
    display_name: 'Qwen3.8 Max',
    context_window_tokens: '1000000',
    default_max_output_tokens: '65536',
    maximum_max_output_tokens: '131072',
  },
  {
    provider: 'arkme-managed',
    public_model_code: 'glm-5.2',
    display_name: 'GLM-5.2',
    context_window_tokens: '1048576',
    default_max_output_tokens: '65536',
    maximum_max_output_tokens: '131072',
  },
  {
    provider: 'arkme-managed',
    public_model_code: 'deepseek-v4-flash-bailian',
    display_name: 'DeepSeek V4 Flash（百炼）',
    context_window_tokens: '1000000',
    default_max_output_tokens: '131072',
    maximum_max_output_tokens: '393216',
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

  it('keeps the last-good catalog when a later refresh is malformed', async () => {
    const catalogFetch = vi.fn()
      .mockResolvedValueOnce(managedCatalogResponse())
      .mockResolvedValueOnce(managedCatalogResponse([{ provider: 'arkme-managed' }]))
    const adapter = createManagedAiLlmAdapter({
      intelligentBaseUrl: 'https://intelligent.test',
      credentialOwner: {
        resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
      },
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      fetchImpl: catalogFetch,
    })

    const first = await adapter.listModels(ARKME_MANAGED_PROVIDER)
    const afterMalformedRefresh = await adapter.listModels(ARKME_MANAGED_PROVIDER)

    expect(afterMalformedRefresh).toEqual(first)
    expect(catalogFetch).toHaveBeenCalledTimes(2)
  })

  it('refreshes on each model listing without refreshing known model use', async () => {
    const catalogFetch = vi.fn(async () => managedCatalogResponse())
    const adapter = createManagedAiLlmAdapter({
      intelligentBaseUrl: 'https://intelligent.test',
      credentialOwner: {
        resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
      },
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      fetchImpl: catalogFetch,
    })

    await adapter.listModels(ARKME_MANAGED_PROVIDER)
    await adapter.resolveModel(ARKME_MANAGED_PROVIDER, 'qwen3.8-max')
    expect(catalogFetch).toHaveBeenCalledTimes(1)

    await adapter.listModels(ARKME_MANAGED_PROVIDER)
    expect(catalogFetch).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent model listings into one catalog request', async () => {
    let releaseCatalog!: (response: Response) => void
    const pendingCatalog = new Promise<Response>((resolve) => { releaseCatalog = resolve })
    const catalogFetch = vi.fn(() => pendingCatalog)
    const adapter = createManagedAiLlmAdapter({
      intelligentBaseUrl: 'https://intelligent.test',
      credentialOwner: {
        resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
      },
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
      fetchImpl: catalogFetch,
    })

    const first = adapter.listModels(ARKME_MANAGED_PROVIDER)
    const second = adapter.listModels(ARKME_MANAGED_PROVIDER)
    await vi.waitFor(() => { expect(catalogFetch).toHaveBeenCalledTimes(1) })
    releaseCatalog(managedCatalogResponse())

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(catalogFetch).toHaveBeenCalledTimes(1)
  })

  it('removes the legacy fallback when the backend publishes an empty active catalog', async () => {
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
    expect(credentialReads).toBe(1)
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
