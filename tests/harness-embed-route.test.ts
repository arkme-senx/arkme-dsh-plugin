import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  createHarnessEmbedRouteHandler,
  dshRootDocumentHeaders,
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

type DshBootAssignmentFormat =
  | 'dsh-v0.1.0-rc.8'
  | 'dsh-v0.1.1-rc.2'
  | 'dsh-v0.1.2-alpha.1'

const DSH_V012_BOOT_READY = '<script>(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()</script>'

function bootAssignment(value: DshWebBootGraph, format: DshBootAssignmentFormat): string {
  const json = JSON.stringify(value).replaceAll('<', '\\u003c')
  return format === 'dsh-v0.1.0-rc.8'
    ? `window.__DSH_BOOT__ = ${json}`
    : `globalThis["__DSH_BOOT__"] = ${json}`
}

function htmlWithGraph(
  value: DshWebBootGraph,
  format: DshBootAssignmentFormat = 'dsh-v0.1.1-rc.2',
): string {
  const ready = format === 'dsh-v0.1.2-alpha.1' ? DSH_V012_BOOT_READY : ''
  return `<html><head><script>${bootAssignment(value, format)}</script></head><body>${ready}</body></html>`
}

describe('core-only DeepSeek Harness iframe route', () => {
  it('forwards only the same-origin browser cookie when reading an authenticated DSH root', () => {
    expect(dshRootDocumentHeaders({ headers: {} } as IncomingMessage)).toEqual({ Accept: 'text/html' })
    expect(dshRootDocumentHeaders({
      headers: {
        authorization: 'Bearer must-not-forward',
        cookie: 'dsh_session=authority-bound',
        origin: 'https://must-not-forward.example',
      },
    } as IncomingMessage)).toEqual({
      Accept: 'text/html',
      Cookie: 'dsh_session=authority-bound',
    })
  })

  it('removes Arkme, HMR, and every extension-store package while preserving DSH core', () => {
    const projected = projectHarnessBootGraph(graph(), ['@arkme-local/weather'])

    expect(projected.entries.map(entry => entry.id)).toEqual([
      '@deepseek-ai/dsh-client-modules',
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-core-ui',
    ])
    expect(projected.rev).toMatch(/^[a-f0-9]{12}$/)
  })

  it('accepts the current DSH client-connection runtime capability without a legacy runtime entry', () => {
    const value = graph()
    value.entries = value.entries.map(entry => entry.id === '@deepseek-ai/dsh-client-runtime'
      ? { ...entry, id: '@deepseek-ai/dsh-client-connection' }
      : entry)

    const projected = projectHarnessBootGraph(value, ['@arkme-local/weather'])

    expect(projected.entries.map(entry => entry.id)).toEqual([
      '@deepseek-ai/dsh-client-modules',
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-core-ui',
    ])
  })

  it('projects current DSH initial-load batches onto the retained core graph', () => {
    const value = graph()
    value.entries = value.entries.map(entry => entry.id === '@deepseek-ai/dsh-client-runtime'
      ? { ...entry, id: '@deepseek-ai/dsh-client-connection' }
      : entry)
    value.batches = [
      {
        phase: 'bootstrap',
        url: '/plugins/bootstrap.js',
        rev: 'bootstrap',
        entries: ['@deepseek-ai/dsh-client-modules'],
      },
      {
        phase: 'application',
        url: '/plugins/application.js',
        rev: 'application',
        entries: [
          '@deepseek-ai/dsh-client-connection',
          '@deepseek-ai/dsh-core-ui',
          '@deepseek-ai/dsh-client-hmr',
          '@senguoyun/dsh-arkme',
          '@arkme-local/weather',
        ],
      },
    ]

    const projected = projectHarnessBootGraph(value, ['@arkme-local/weather'])

    expect(projected.batches).toEqual([
      {
        phase: 'bootstrap',
        url: '/plugins/bootstrap.js',
        rev: 'bootstrap',
        entries: ['@deepseek-ai/dsh-client-modules'],
      },
      {
        phase: 'application',
        url: '/plugins/application.js',
        rev: 'application',
        entries: ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-core-ui'],
      },
    ])
  })

  it('removes optional profile clients that depend on removed extensions', () => {
    const value = graph()
    value.entries[2] = {
      ...value.entries[2]!,
      external: ['@arkme-local/weather/client'],
    }

    const projected = projectHarnessBootGraph(value, ['@arkme-local/weather'])

    expect(projected.entries.map(entry => entry.id)).toEqual([
      '@deepseek-ai/dsh-client-modules',
      '@deepseek-ai/dsh-client-runtime',
    ])
  })

  it('removes profile clients that depend on Arkme even when extension-store does not list them', () => {
    const value = graph()
    value.entries.push(
      {
        id: 'jotmo-time-ledger',
        url: '/time-ledger.js',
        rev: 'time-ledger',
        inject: ['@deepseek-ai/dsh-client-ui-slots', '@senguoyun/dsh-arkme'],
      },
      {
        id: 'jotmo-time-ledger-panel',
        url: '/time-ledger-panel.js',
        rev: 'time-ledger-panel',
        inject: ['jotmo-time-ledger'],
      },
      {
        id: '@deepseek-ai/dsh-client-ui-slots',
        url: '/slots.js',
        rev: 'slots',
      },
    )

    const projected = projectHarnessBootGraph(value, ['@arkme-local/weather'])

    expect(projected.entries.map(entry => entry.id)).toEqual([
      '@deepseek-ai/dsh-client-modules',
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-core-ui',
      '@deepseek-ai/dsh-client-ui-slots',
    ])
  })

  it('fails closed when a required DSH boot client depends on a removed extension', () => {
    const value = graph()
    value.entries[1] = {
      ...value.entries[1]!,
      inject: ['@senguoyun/dsh-arkme'],
    }

    expect(() => projectHarnessBootGraph(value, []))
      .toThrow('required package @deepseek-ai/dsh-client-runtime depends on removed package @senguoyun/dsh-arkme')
  })

  it('fails closed when a required boot capability is missing', () => {
    const value = graph()
    value.entries = value.entries.filter(entry => entry.id !== '@deepseek-ai/dsh-client-runtime')

    expect(() => projectHarnessBootGraph(value, [])).toThrow('required client connection runtime is missing')
  })

  it.each([
    'dsh-v0.1.0-rc.8',
    'dsh-v0.1.1-rc.2',
    'dsh-v0.1.2-alpha.1',
  ] as const)('replaces exactly the %s boot assignment without changing its format', format => {
    const full = graph()
    const projected = projectHarnessBootGraph(full, ['@arkme-local/weather'])
    const html = replaceHarnessBootGraph(htmlWithGraph(full, format), full, projected)

    expect(html).toContain(bootAssignment(projected, format))
    expect(html).not.toContain('/arkme.js')
    if (format === 'dsh-v0.1.2-alpha.1') expect(html).toContain(DSH_V012_BOOT_READY)
  })

  it('fails closed when the boot assignment is absent, duplicated, or ambiguous across DSH formats', () => {
    const full = graph()
    const projected = projectHarnessBootGraph(full, ['@arkme-local/weather'])
    const legacy = bootAssignment(full, 'dsh-v0.1.0-rc.8')
    const structured = bootAssignment(full, 'dsh-v0.1.1-rc.2')

    expect(() => replaceHarnessBootGraph('<html></html>', full, projected)).toThrow('expected exactly one')
    expect(() => replaceHarnessBootGraph(`<script>${legacy}</script><script>${legacy}</script>`, full, projected))
      .toThrow('expected exactly one')
    expect(() => replaceHarnessBootGraph(`<script>${legacy}</script><script>${structured}</script>`, full, projected))
      .toThrow('expected exactly one')
  })

  it('serves GET/HEAD without caching and never returns the full graph on projection failure', async () => {
    const full = graph()
    const errors: unknown[] = []
    const request = {
      method: 'GET',
      headers: { cookie: 'dsh_session=authority-bound' },
    } as IncomingMessage
    const handler = createHarnessEmbedRouteHandler({
      getGraph: () => full,
      installedPackageNames: () => ['@arkme-local/weather'],
      readRootHtml: async receivedRequest => {
        expect(receivedRequest).toBe(request)
        return htmlWithGraph(full)
      },
      onError: error => { errors.push(error) },
    })
    const response = responseDouble()
    await handler(request, response.value)

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
