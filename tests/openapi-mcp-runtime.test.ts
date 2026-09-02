import { describe, expect, it, vi } from 'vitest'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { CordisOpenApiMcpRuntime } from '../src/openapi-mcp/mcp-runtime.js'
import { SecretValue } from '../src/secret-value.js'

const manifest = {
  catalogRevision: `sha256:${'a'.repeat(64)}`,
  runtimeRevision: 'mcp-runtime-v1',
  endpointPath: '/mcp/managed',
  pollAfterSeconds: 300,
}

function runtimeContext(plugin: ReturnType<typeof vi.fn>) {
  let names: string[] = []
  let listener: (() => void) | undefined
  return {
    ctx: {
      plugin,
      tools: { schemas: () => names.map(name => ({ name })) },
      on: vi.fn((_event: string, callback: () => void) => {
        listener = callback
        return () => { listener = undefined; return true }
      }),
    },
    setNames(next: string[]) { names = next },
    emitChange() { listener?.() },
  }
}

describe('official OpenAPI MCP runtime adapter', () => {
  it('mounts the official client under the stable Arkme namespace and disposes its fiber', async () => {
    const dispose = vi.fn(async () => undefined)
    const plugin = vi.fn()
    const context = runtimeContext(plugin)
    plugin.mockImplementation(() => ({
      await: async () => { context.setNames(['mcp__arkme__profile_get']) },
      dispose,
    }))
    const runtime = new CordisOpenApiMcpRuntime(
      context.ctx as never, 'https://openapi.example.com', 30_000,
    )

    const mount = runtime.mount(
      new SecretValue('managed-api-secret'), manifest, new AbortController().signal, vi.fn(),
    )
    await mount.ready()

    expect(plugin).toHaveBeenCalledWith(McpClient, {
      transport: 'streamable-http', serverName: 'arkme', url: 'https://openapi.example.com/mcp/managed',
      headers: {
        Authorization: 'Bearer managed-api-secret',
        'X-Arkme-MCP-Catalog-Revision': manifest.catalogRevision,
        'X-Arkme-MCP-Runtime-Revision': manifest.runtimeRevision,
      },
      toolCallTimeoutMs: 30_000,
      failOnStartupError: true,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    })
    await mount.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not create a client for an already superseded lifecycle', async () => {
    const plugin = vi.fn()
    const context = runtimeContext(plugin)
    const controller = new AbortController()
    controller.abort(new Error('superseded'))
    const runtime = new CordisOpenApiMcpRuntime(
      context.ctx as never, 'https://openapi.example.com', 30_000,
    )

    expect(() => runtime.mount(new SecretValue('managed-api-secret'), manifest, controller.signal, vi.fn())).toThrow('superseded')
    expect(plugin).not.toHaveBeenCalled()
  })

  it('disposes an activating client and rejects when the lifecycle is superseded', async () => {
    let rejectActivation: ((error: unknown) => void) | undefined
    const activation = new Promise<void>((_resolve, reject) => { rejectActivation = reject })
    const dispose = vi.fn(async () => { rejectActivation?.(new Error('fiber disposed')) })
    const plugin = vi.fn(() => ({ await: async () => await activation, dispose }))
    const context = runtimeContext(plugin)
    const controller = new AbortController()
    const runtime = new CordisOpenApiMcpRuntime(
      context.ctx as never, 'https://openapi.example.com', 30_000,
    )

    const mount = runtime.mount(new SecretValue('managed-api-secret'), manifest, controller.signal, vi.fn())
    const mounting = mount.ready()
    controller.abort(new Error('superseded'))

    await expect(mounting).rejects.toThrow()
    expect(dispose).toHaveBeenCalled()
  })

  it('reports terminal MCP tool loss once and stops observing after disposal', async () => {
    const dispose = vi.fn(async () => undefined)
    const plugin = vi.fn()
    const context = runtimeContext(plugin)
    context.setNames(['mcp__arkme__foreign_tool'])
    plugin.mockImplementation(() => ({
      await: async () => { context.setNames(['mcp__arkme__foreign_tool', 'mcp__arkme__profile_get']) },
      dispose,
    }))
    const unavailable = vi.fn()
    const runtime = new CordisOpenApiMcpRuntime(
      context.ctx as never, 'https://openapi.example.com', 30_000,
    )
    const mount = runtime.mount(
      new SecretValue('managed-api-secret'), manifest, new AbortController().signal, unavailable,
    )
    await mount.ready()

    context.setNames(['mcp__arkme__foreign_tool'])
    context.emitChange()
    context.emitChange()
    await vi.waitFor(() => { expect(unavailable).toHaveBeenCalledOnce() })

    await mount.dispose()
    context.emitChange()
    expect(unavailable).toHaveBeenCalledOnce()
  })

  it('does not release runtime ownership until a failed fiber disposal is retried successfully', async () => {
    const dispose = vi.fn()
      .mockRejectedValueOnce(new Error('fiber disposal failed'))
      .mockResolvedValueOnce(undefined)
    const plugin = vi.fn()
    const context = runtimeContext(plugin)
    plugin.mockImplementation(() => ({
      await: async () => { context.setNames(['mcp__arkme__profile_get']) },
      dispose,
    }))
    const runtime = new CordisOpenApiMcpRuntime(
      context.ctx as never, 'https://openapi.example.com', 30_000,
    )
    const mount = runtime.mount(
      new SecretValue('managed-api-secret'), manifest, new AbortController().signal, vi.fn(),
    )
    await mount.ready()

    await expect(mount.dispose()).rejects.toThrow('fiber disposal failed')
    await expect(mount.dispose()).resolves.toBeUndefined()
    await expect(mount.dispose()).resolves.toBeUndefined()
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it('fails activation when the server exposes no managed tools', async () => {
    const dispose = vi.fn(async () => undefined)
    const plugin = vi.fn(() => ({ await: async () => undefined, dispose }))
    const context = runtimeContext(plugin)
    context.setNames([])
    const runtime = new CordisOpenApiMcpRuntime(
      context.ctx as never, 'https://openapi.example.com', 30_000,
    )

    const mount = runtime.mount(
      new SecretValue('managed-api-secret'), manifest, new AbortController().signal, vi.fn(),
    )
    await expect(mount.ready()).rejects.toThrow('without any Arkme tools')
    await mount.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not mistake a pre-existing foreign Arkme namespace for tools owned by this mount', async () => {
    const dispose = vi.fn(async () => undefined)
    const plugin = vi.fn(() => ({ await: async () => undefined, dispose }))
    const context = runtimeContext(plugin)
    context.setNames(['mcp__arkme__foreign_tool'])
    const runtime = new CordisOpenApiMcpRuntime(
      context.ctx as never, 'https://openapi.example.com', 30_000,
    )

    const mount = runtime.mount(
      new SecretValue('managed-api-secret'), manifest, new AbortController().signal, vi.fn(),
    )
    await expect(mount.ready()).rejects.toThrow('without any Arkme tools')
    await mount.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
