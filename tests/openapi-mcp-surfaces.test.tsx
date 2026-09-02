import { once } from 'node:events'
import { createServer } from 'node:http'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'
import { OpenApiMcpSettings, openApiMcpPresentation } from '../src/client/OpenApiMcpSettings.js'
import { registerOpenApiMcpLifecycleTools } from '../src/openapi-mcp/status-tool.js'
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
      status: vi.fn(() => ready), retry: vi.fn(async () => ready),
    }
    const args = [{}, 'openapi.mcp.status', {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, controller] as const
    await expect(dispatchArkmeHostOperation(...args as never)).resolves.toEqual(ready)
    await expect(dispatchArkmeHostOperation({} as never, 'openapi.mcp.retry', {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, controller)).resolves.toEqual(ready)
    expect(controller.status).toHaveBeenCalledOnce()
    expect(controller.retry).toHaveBeenCalledOnce()
  })

  it('requires same-page Origin for retry but not status', async () => {
    const controller = { status: () => ready, retry: async () => ready }
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
    const blocked = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ operation: 'openapi.mcp.retry' }) })
    expect(blocked.status).toBe(403)
    const allowed = await fetch(endpoint, {
      method: 'POST', headers: { Origin: endpoint }, body: JSON.stringify({ operation: 'openapi.mcp.retry' }),
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
    expect(requests).toEqual([
      { operation: 'openapi.mcp.status' },
      { operation: 'openapi.mcp.retry' },
    ])
  })

  it('renders safe lifecycle copy with one retry action', () => {
    expect(openApiMcpPresentation(ready)).toMatchObject({ description: expect.stringContaining('已连接') })
    expect(openApiMcpPresentation({ state: 'degraded', retryable: true, userAction: 'none' })).toMatchObject({ action: 'retry' })
    const markup = renderToStaticMarkup(<OpenApiMcpSettings />)
    expect(markup).toContain('开放平台 MCP')
    expect(markup).toContain('正在同步可用工具')
    expect(markup).not.toContain('api_key')
    expect(markup).not.toContain('key_id')
  })

  it('registers credential-free lifecycle Tools against the same controller', async () => {
    const definitions: Array<{ name: string; execute(args: unknown, exec: unknown): Promise<unknown> }> = []
    const controller = { status: vi.fn(() => ready), retry: vi.fn(async () => ready) }
    registerOpenApiMcpLifecycleTools({ tools: { register(value: typeof definitions[number]) { definitions.push(value) } } } as never, controller)

    expect(definitions.map(definition => definition.name)).toEqual([
      'arkme_openapi_mcp_status', 'arkme_openapi_mcp_retry',
    ])
    await expect(definitions[0]?.execute({}, {})).resolves.toBe(JSON.stringify(ready))
    await expect(definitions[1]?.execute({}, {})).resolves.toBe(JSON.stringify(ready))
    expect(controller.status).toHaveBeenCalledOnce()
    expect(controller.retry).toHaveBeenCalledOnce()
    expect(JSON.stringify(await definitions[0]?.execute({}, {}))).not.toContain('apiKey')
  })
})
