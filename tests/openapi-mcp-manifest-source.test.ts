import { describe, expect, it, vi } from 'vitest'
import { HttpOpenApiMcpManifestSource } from '../src/openapi-mcp/manifest-source.js'

const revision = `sha256:${'b'.repeat(64)}`

function success(data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, message: '请求成功', data }), { status: 200 })
}

describe('OpenAPI MCP manifest source', () => {
  it('uses a credential-free GET and validates the managed endpoint contract', async () => {
    const requests: Array<{ url: string; method: string | undefined; authorization: string | null }> = []
    const source = new HttpOpenApiMcpManifestSource('https://openapi.example.com/', vi.fn(async (input, init) => {
      requests.push({
        url: String(input), method: init?.method, authorization: new Headers(init?.headers).get('authorization'),
      })
      return success({
        catalog_revision: revision,
        runtime_revision: 'mcp-runtime-v2',
        endpoint_path: '/mcp/managed',
        poll_after_seconds: 300,
      })
    }), 5_000)

    await expect(source.read(new AbortController().signal)).resolves.toEqual({
      catalogRevision: revision,
      runtimeRevision: 'mcp-runtime-v2',
      endpointPath: '/mcp/managed',
      pollAfterSeconds: 300,
    })
    expect(requests).toEqual([{
      url: 'https://openapi.example.com/api/public/v1/mcp/manifest', method: 'GET', authorization: null,
    }])
  })

  it('rejects cross-protocol paths, invalid revisions and unbounded polling', async () => {
    for (const data of [
      { catalog_revision: revision, runtime_revision: 'mcp-runtime-v1', endpoint_path: 'https://evil.example/mcp', poll_after_seconds: 300 },
      { catalog_revision: 'latest', runtime_revision: 'mcp-runtime-v1', endpoint_path: '/mcp/managed', poll_after_seconds: 300 },
      { catalog_revision: revision, runtime_revision: 'mcp-runtime-v1', endpoint_path: '/mcp/managed', poll_after_seconds: 59 },
    ]) {
      const source = new HttpOpenApiMcpManifestSource(
        'https://openapi.example.com', vi.fn(async () => success(data)), 5_000,
      )
      await expect(source.read(new AbortController().signal)).rejects.toMatchObject({ kind: 'contract' })
    }
  })

  it('separates temporary availability from malformed responses and bounds response bytes', async () => {
    const unavailable = new HttpOpenApiMcpManifestSource(
      'https://openapi.example.com', vi.fn(async () => new Response('', { status: 503 })), 5_000,
    )
    await expect(unavailable.read(new AbortController().signal)).rejects.toMatchObject({ kind: 'transient' })

    const oversized = new HttpOpenApiMcpManifestSource(
      'https://openapi.example.com', vi.fn(async () => new Response('x'.repeat(64 * 1024 + 1))), 5_000,
    )
    await expect(oversized.read(new AbortController().signal)).rejects.toMatchObject({ kind: 'contract' })
  })
})
