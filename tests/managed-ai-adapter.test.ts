import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import {
  ARKME_MANAGED_MODEL,
  ARKME_MANAGED_PROVIDER,
  createManagedAiLlmAdapter,
  registerManagedAiProvider,
} from '../src/managed-ai/adapter.js'
import { SecretValue } from '../src/secret-value.js'

describe('Arkme managed model adapter', () => {
  it('advertises only the backend-supported Arkme Flash route without automatic retries', async () => {
    const adapter = createManagedAiLlmAdapter({
      intelligentBaseUrl: 'https://intelligent.test',
      credentialOwner: {
        resolveManagedAccessCredential: async () => new SecretValue('arkme-access'),
      },
      resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
    })

    expect(adapter.providerInfo('arkme-managed')).toEqual({
      id: 'arkme-managed',
      name: 'Arkme',
    })
    await expect(adapter.listModels('arkme-managed')).resolves.toEqual([{
      provider: 'arkme-managed',
      id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
      description: '使用 Arkme 登录，无需 API Key',
      inputModalities: ['text'],
    }])
    await expect(adapter.resolveModel('arkme-managed', 'deepseek-v4-flash')).resolves.toMatchObject({
      provider: 'arkme-managed',
      id: 'deepseek-v4-flash',
      name: 'DeepSeek-V4-Flash',
      context: { contextWindow: 1_000_000 },
      defaultMaxTokens: 256_000,
    })
    await expect(adapter.resolveModel('arkme-managed', 'deepseek-v4-pro')).rejects.toMatchObject({
      code: 'UNKNOWN_MODEL',
    })
    expect(adapter.providerRetryPolicy('arkme-managed')).toMatchObject({
      mode: 'normal',
      maxRetries: 0,
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
        message: 'Arkme AI 余额不足，请充值后重试',
        failure: {
          code: 'INSUFFICIENT_BALANCE',
          message: 'Arkme AI 余额不足，请充值后重试',
          status: 402,
          requestId: 'mai_req_balance',
        },
      })
    } finally {
      await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    }
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
        failure: {
          code: 'TIMEOUT',
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
      })
      expect(ctx.llm.listProviders()).toContainEqual({
        id: ARKME_MANAGED_PROVIDER,
        name: 'Arkme',
      })
      const models = await ctx.llm.listModels(ARKME_MANAGED_PROVIDER)
      expect(models.map(model => [model.id, model.name])).toEqual([
        ['deepseek-v4-flash', 'DeepSeek-V4-Flash'],
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
        message: '请先登录 Arkme',
        failure: { code: 'AUTH', status: 401 },
      })
    },
  )

  it.each([
    {
      sourceCode: 'arkme-network-error',
      status: 502,
      message: '无法连接 Arkme 服务',
      expectedCode: 'TRANSPORT',
    },
    {
      sourceCode: 'arkme-http-error',
      status: 503,
      message: 'Arkme 服务暂不可用',
      expectedCode: 'SERVER',
    },
  ])('preserves $sourceCode credential failures as $expectedCode', async ({
    sourceCode, status, message, expectedCode,
  }) => {
    const sourceError = Object.assign(new Error(message), {
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
      message,
      failure: { code: expectedCode, status },
    })
  })

  it('rejects any model outside the single managed route before reading credentials', async () => {
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
    expect(credentialReads).toBe(0)
  })
})
