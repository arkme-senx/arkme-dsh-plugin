import type { Context } from '@deepseek-ai/cordis'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { SecretValue } from '../secret-value.js'
import type { OpenApiMcpMount, OpenApiMcpRuntime } from './types.js'

export class CordisOpenApiMcpRuntime implements OpenApiMcpRuntime {
  constructor(
    private readonly ctx: Context,
    private readonly endpointUrl: string,
    private readonly toolCallTimeoutMs: number,
  ) {}

  async mount(apiKey: SecretValue, signal: AbortSignal): Promise<OpenApiMcpMount> {
    if (signal.aborted) throw signal.reason
    const fiber = this.ctx.plugin(McpClient, {
      transport: 'streamable-http',
      serverName: 'arkme',
      url: this.endpointUrl,
      headers: { Authorization: `Bearer ${apiKey.reveal()}` },
      toolCallTimeoutMs: this.toolCallTimeoutMs,
      failOnStartupError: true,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    })
    const abort = () => { void fiber.dispose().catch(() => undefined) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    try {
      await fiber.await()
      if (signal.aborted) {
        await fiber.dispose().catch(() => undefined)
        throw signal.reason
      }
    } catch (error) {
      await fiber.dispose().catch(() => undefined)
      throw error
    } finally {
      signal.removeEventListener('abort', abort)
    }
    return { dispose: async () => { await fiber.dispose() } }
  }
}
