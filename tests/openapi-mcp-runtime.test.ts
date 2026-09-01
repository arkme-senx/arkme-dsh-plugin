import { describe, expect, it, vi } from 'vitest'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { CordisOpenApiMcpRuntime } from '../src/openapi-mcp/mcp-runtime.js'
import { SecretValue } from '../src/secret-value.js'

describe('official OpenAPI MCP runtime adapter', () => {
  it('mounts the official client under the stable Arkme namespace and disposes its fiber', async () => {
    const dispose = vi.fn(async () => undefined)
    const plugin = vi.fn(() => ({ await: async () => undefined, dispose }))
    const runtime = new CordisOpenApiMcpRuntime(
      { plugin } as never, 'https://openapi.example.com/mcp', 30_000,
    )

    const mount = await runtime.mount(new SecretValue('managed-api-secret'), new AbortController().signal)

    expect(plugin).toHaveBeenCalledWith(McpClient, {
      transport: 'streamable-http', serverName: 'arkme', url: 'https://openapi.example.com/mcp',
      headers: { Authorization: 'Bearer managed-api-secret' }, toolCallTimeoutMs: 30_000,
      failOnStartupError: true,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    })
    await mount.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not create a client for an already superseded lifecycle', async () => {
    const plugin = vi.fn()
    const controller = new AbortController()
    controller.abort(new Error('superseded'))
    const runtime = new CordisOpenApiMcpRuntime(
      { plugin } as never, 'https://openapi.example.com/mcp', 30_000,
    )

    await expect(runtime.mount(new SecretValue('managed-api-secret'), controller.signal)).rejects.toThrow('superseded')
    expect(plugin).not.toHaveBeenCalled()
  })

  it('disposes an activating client and rejects when the lifecycle is superseded', async () => {
    let rejectActivation: ((error: unknown) => void) | undefined
    const activation = new Promise<void>((_resolve, reject) => { rejectActivation = reject })
    const dispose = vi.fn(async () => { rejectActivation?.(new Error('fiber disposed')) })
    const plugin = vi.fn(() => ({ await: async () => await activation, dispose }))
    const controller = new AbortController()
    const runtime = new CordisOpenApiMcpRuntime(
      { plugin } as never, 'https://openapi.example.com/mcp', 30_000,
    )

    const mounting = runtime.mount(new SecretValue('managed-api-secret'), controller.signal)
    controller.abort(new Error('superseded'))

    await expect(mounting).rejects.toThrow()
    expect(dispose).toHaveBeenCalled()
  })
})
