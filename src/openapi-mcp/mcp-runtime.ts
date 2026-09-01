import type { Context } from '@deepseek-ai/cordis'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { SecretValue } from '../secret-value.js'
import type { OpenApiMcpMount, OpenApiMcpRuntime } from './types.js'

const MANAGED_TOOL_PREFIX = 'mcp__arkme__'

export class CordisOpenApiMcpRuntime implements OpenApiMcpRuntime {
  constructor(
    private readonly ctx: Context,
    private readonly endpointUrl: string,
    private readonly toolCallTimeoutMs: number,
  ) {}

  mount(apiKey: SecretValue, signal: AbortSignal, onUnavailable: () => void): OpenApiMcpMount {
    if (signal.aborted) throw signal.reason
    const existingManagedTools = this.managedToolNames()
    const fiber = this.ctx.plugin(McpClient, {
      transport: 'streamable-http',
      serverName: 'arkme',
      url: this.endpointUrl,
      headers: { Authorization: `Bearer ${apiKey.reveal()}` },
      toolCallTimeoutMs: this.toolCallTimeoutMs,
      failOnStartupError: true,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    })
    let disposed = false
    let observing = false
    let off: (() => boolean) | undefined
    const ready = this.activate(fiber, signal, existingManagedTools, () => {
      observing = true
      off = this.observeAvailability(existingManagedTools, onUnavailable, () => disposed)
    })
    return {
      ready: async () => { await ready },
      dispose: async () => {
        if (disposed) return
        if (observing) {
          observing = false
          off?.()
          off = undefined
        }
        await fiber.dispose()
        disposed = true
      },
    }
  }

  private async activate(
    fiber: ReturnType<Context['plugin']>,
    signal: AbortSignal,
    existingManagedTools: ReadonlySet<string>,
    observe: () => void,
  ): Promise<void> {
    let rejectAbort: ((reason?: unknown) => void) | undefined
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    const abort = () => {
      rejectAbort?.(signal.reason ?? new Error('OpenAPI MCP activation superseded'))
      void fiber.dispose().catch(() => undefined)
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    try {
      await Promise.race([fiber.await(), aborted])
      if (signal.aborted) throw signal.reason
      if (!this.hasMountedManagedTools(existingManagedTools)) {
        throw new Error('OpenAPI MCP client mounted without any Arkme tools')
      }
      observe()
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  private observeAvailability(
    existingManagedTools: ReadonlySet<string>,
    onUnavailable: () => void,
    disposed: () => boolean,
  ): () => boolean {
    let checkScheduled = false
    let unavailableReported = false
    return this.ctx.on('tools/change', () => {
      if (disposed() || checkScheduled || unavailableReported) return
      checkScheduled = true
      queueMicrotask(() => {
        checkScheduled = false
        if (disposed() || unavailableReported || this.hasMountedManagedTools(existingManagedTools)) return
        unavailableReported = true
        onUnavailable()
      })
    })
  }

  private managedToolNames(): Set<string> {
    return new Set(this.ctx.tools.schemas()
      .map(tool => tool.name)
      .filter(name => name.startsWith(MANAGED_TOOL_PREFIX)))
  }

  private hasMountedManagedTools(existingManagedTools: ReadonlySet<string>): boolean {
    return [...this.managedToolNames()].some(name => !existingManagedTools.has(name))
  }
}
