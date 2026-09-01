import { once } from 'node:events'
import { createServer } from 'node:http'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'
import { OpenApiMcpSettings, openApiMcpPresentation } from '../src/client/OpenApiMcpSettings.js'
import { registerOpenApiMcpStatusTool } from '../src/openapi-mcp/status-tool.js'
import type { OpenApiMcpStatus } from '../src/openapi-mcp/types.js'
import { ArkmeSdk } from '../src/sdk/index.js'

const ready: OpenApiMcpStatus = { state: 'ready', retryable: false, userAction: 'none', nextReconcileAtMillis: 1_800_000_000_000 }
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close()
    await once(server, 'close')
  }
})

describe('managed OpenAPI MCP Host, SDK, UI and Tool adapters', () => {
  it('dispatches every adapter to one credential-free controller facade', async () => {
    const controller = {
      status: vi.fn(() => ready), retry: vi.fn(async () => ready), reauthorize: vi.fn(async () => ready),
    }
    const args = [{}, 'openapi.mcp.status', {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, controller] as const
    await expect(dispatchArkmeHostOperation(...args as never)).resolves.toEqual(ready)
    await expect(dispatchArkmeHostOperation({} as never, 'openapi.mcp.retry', {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, controller)).resolves.toEqual(ready)
    await expect(dispatchArkmeHostOperation({} as never, 'openapi.mcp.reauthorize', {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, controller)).resolves.toEqual(ready)
    expect(controller.status).toHaveBeenCalledOnce()
    expect(controller.retry).toHaveBeenCalledOnce()
    expect(controller.reauthorize).toHaveBeenCalledOnce()
  })

  it('requires same-page Origin for retry and explicit reauthorization but not status', async () => {
    const controller = { status: () => ready, retry: async () => ready, reauthorize: async () => ready }
    const options = { expectedPort: 0, allowNonLoopback: false, openApiMcpController: controller }
    const server = createServer(createArkmeHostApi({} as never, options))
    servers.push(server)
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing address')
    options.expectedPort = address.port
    const endpoint = `http://127.0.0.1:${String(address.port)}`

    const status = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ operation: 'openapi.mcp.status' }) })
    expect(status.status).toBe(200)
    const blocked = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ operation: 'openapi.mcp.reauthorize' }) })
    expect(blocked.status).toBe(403)
    const allowed = await fetch(endpoint, {
      method: 'POST', headers: { Origin: endpoint }, body: JSON.stringify({ operation: 'openapi.mcp.reauthorize' }),
    })
    expect(allowed.status).toBe(200)
  })

  it('maps typed SDK methods without accepting credentials or identifiers', async () => {
    const requests: unknown[] = []
    const sdk = new ArkmeSdk({ fetchImpl: vi.fn(async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ ok: true, value: ready }), { status: 200 })
    }) })
    await sdk.openApiMcpStatus()
    await sdk.retryOpenApiMcp()
    await sdk.reauthorizeOpenApiMcp()
    expect(requests).toEqual([
      { operation: 'openapi.mcp.status' },
      { operation: 'openapi.mcp.retry' },
      { operation: 'openapi.mcp.reauthorize' },
    ])
  })

  it('renders safe lifecycle copy and requires an explicit reauthorization action', () => {
    expect(openApiMcpPresentation(ready)).toMatchObject({ description: expect.stringContaining('已连接') })
    expect(openApiMcpPresentation({ state: 'degraded', retryable: true, userAction: 'none' })).toMatchObject({ action: 'retry' })
    expect(openApiMcpPresentation({ state: 'reauthorization-required', retryable: false, userAction: 'reauthorize' }))
      .toMatchObject({ action: 'reauthorize' })
    const markup = renderToStaticMarkup(<OpenApiMcpSettings />)
    expect(markup).toContain('开放平台 MCP')
    expect(markup).toContain('正在同步可用工具')
    expect(markup).not.toContain('api_key')
    expect(markup).not.toContain('key_id')
  })

  it('registers a read-only status Tool that does not own retry or credentials', async () => {
    let definition: { name: string; execute(args: unknown, exec: unknown): Promise<unknown> } | undefined
    registerOpenApiMcpStatusTool({ tools: { register(value: typeof definition) { definition = value } } } as never, { status: () => ready })
    expect(definition?.name).toBe('arkme_openapi_mcp_status')
    await expect(definition?.execute({}, {})).resolves.toBe(JSON.stringify(ready))
    expect(JSON.stringify(await definition?.execute({}, {}))).not.toContain('apiKey')
  })
})
