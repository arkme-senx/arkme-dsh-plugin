import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  createHarnessEmbedRouteHandler,
  projectHarnessBootGraph,
  replaceHarnessBootGraph,
  type DshWebBootGraph,
} from '../src/harness-embed-route.js'

function graph(): DshWebBootGraph {
  return {
    rev: 'full-graph',
    entries: [
      { id: '@deepseek-ai/dsh-client-modules', url: '/modules.js', rev: 'modules' },
      { id: '@deepseek-ai/dsh-client-runtime', url: '/runtime.js', rev: 'runtime' },
      { id: '@deepseek-ai/dsh-core-ui', url: '/core.js', rev: 'core' },
      { id: '@deepseek-ai/dsh-client-hmr', url: '/hmr.js', rev: 'hmr' },
      { id: '@senguoyun/dsh-arkme', url: '/arkme.js', rev: 'arkme' },
      { id: '@arkme-local/weather', url: '/weather.js', rev: 'weather' },
    ],
  }
}

function htmlWithGraph(value: DshWebBootGraph): string {
  return `<html><head><script>window.__DSH_BOOT__ = ${JSON.stringify(value)}</script></head><body></body></html>`
}

describe('core-only DeepSeek Harness iframe route', () => {
  it('removes Arkme, HMR, and every extension-store package while preserving DSH core', () => {
    const projected = projectHarnessBootGraph(graph(), ['@arkme-local/weather'])

    expect(projected.entries.map(entry => entry.id)).toEqual([
      '@deepseek-ai/dsh-client-modules',
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-core-ui',
    ])
    expect(projected.rev).toMatch(/^[a-f0-9]{12}$/)
  })

  it('fails closed when a retained client depends on a removed extension', () => {
    const value = graph()
    value.entries[2] = {
      ...value.entries[2]!,
      external: ['@arkme-local/weather/client'],
    }

    expect(() => projectHarnessBootGraph(value, ['@arkme-local/weather']))
      .toThrow('depends on removed package @arkme-local/weather')
  })

  it('fails closed when either parser preload is missing', () => {
    const value = graph()
    value.entries = value.entries.filter(entry => entry.id !== '@deepseek-ai/dsh-client-runtime')

    expect(() => projectHarnessBootGraph(value, [])).toThrow('required package @deepseek-ai/dsh-client-runtime is missing')
  })

  it('replaces exactly the current DSH boot assignment', () => {
    const full = graph()
    const projected = projectHarnessBootGraph(full, ['@arkme-local/weather'])
    const html = replaceHarnessBootGraph(htmlWithGraph(full), full, projected)

    expect(html).toContain(`window.__DSH_BOOT__ = ${JSON.stringify(projected)}`)
    expect(html).not.toContain('/arkme.js')
    expect(() => replaceHarnessBootGraph('<html></html>', full, projected)).toThrow('expected exactly one')
  })

  it('serves GET/HEAD without caching and never returns the full graph on projection failure', async () => {
    const full = graph()
    const errors: unknown[] = []
    const handler = createHarnessEmbedRouteHandler({
      getGraph: () => full,
      installedPackageNames: () => ['@arkme-local/weather'],
      readRootHtml: async () => htmlWithGraph(full),
      onError: error => { errors.push(error) },
    })
    const response = responseDouble()
    await handler({ method: 'GET' } as IncomingMessage, response.value)

    expect(response.status()).toBe(200)
    expect(response.headers()).toMatchObject({ 'Cache-Control': 'no-store' })
    expect(response.body()).not.toContain('/arkme.js')

    const failedResponse = responseDouble()
    await createHarnessEmbedRouteHandler({
      getGraph: () => full,
      installedPackageNames: () => [],
      readRootHtml: async () => '<html>changed DSH manifest</html>',
      onError: error => { errors.push(error) },
    })({ method: 'GET' } as IncomingMessage, failedResponse.value)

    expect(failedResponse.status()).toBe(503)
    expect(failedResponse.body()).not.toContain('full-graph')
    expect(errors).toHaveLength(1)
  })

  it('rejects mutating methods', async () => {
    const response = responseDouble()
    await createHarnessEmbedRouteHandler({
      getGraph: vi.fn(),
      installedPackageNames: vi.fn(),
      readRootHtml: vi.fn(),
    })({ method: 'POST' } as IncomingMessage, response.value)

    expect(response.status()).toBe(405)
    expect(response.headers()).toMatchObject({ Allow: 'GET, HEAD' })
  })
})

function responseDouble() {
  let responseStatus = 0
  let responseHeaders: Record<string, string | number> = {}
  let responseBody = ''
  const value = {
    writeHead(status: number, headers: Record<string, string | number>) {
      responseStatus = status
      responseHeaders = headers
      return value
    },
    end(body?: string | Buffer) {
      responseBody = body?.toString() ?? ''
      return value
    },
  } as unknown as ServerResponse
  return {
    value,
    status: () => responseStatus,
    headers: () => responseHeaders,
    body: () => responseBody,
  }
}
