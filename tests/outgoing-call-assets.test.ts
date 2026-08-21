import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createOutgoingCallAssetHandler } from '../src/outgoing-call-assets.js'

const assetDirectory = join(import.meta.dirname, '..', 'assets', 'desktop_call')

async function request(path: string, method = 'GET') {
  let status = 0
  let headers: Record<string, string | number | readonly string[]> = {}
  const chunks: Buffer[] = []
  const req = { method, url: path } as IncomingMessage
  const res = {
    writeHead(nextStatus: number, nextHeaders: Record<string, string | number | readonly string[]>) {
      status = nextStatus
      headers = nextHeaders
      return this
    },
    end(chunk?: string | Uint8Array) {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk))
      return this
    },
  } as unknown as ServerResponse
  await createOutgoingCallAssetHandler({
    routePrefix: '/arkme-self/api/call',
    assetDirectory,
  })(req, res)
  return { status, headers, body: Buffer.concat(chunks) }
}

describe('outgoing call assets', () => {
  it('serves the iframe document with the script policy required by the pinned CallEngine bundle', async () => {
    const response = await request('/arkme-self/api/call/index.html')

    expect(response.status).toBe(200)
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8')
    expect(response.headers['Cache-Control']).toBe('no-store')
    expect(response.headers['X-Content-Type-Options']).toBe('nosniff')
    expect(response.headers['Content-Security-Policy']).toContain("script-src 'self' 'unsafe-inline'")
    expect(response.headers['Content-Security-Policy']).toContain("'unsafe-eval'")
    expect(response.headers['Content-Security-Policy']).toContain("connect-src 'self' https: wss: data:")
    expect(response.headers['Content-Security-Policy']).toContain("media-src 'self' blob: https:")
    expect(response.headers['Content-Security-Policy']).toContain("frame-ancestors 'self'")
    const document = response.body.toString('utf8')
    expect(document).toContain('<div id="app"></div>')
    expect(document).toContain('channel: "jotmo-desktop-call"')
    expect(document).toContain('import("./bundle.js")')
    expect(document).toContain('message: error instanceof Error ? error.message : "呼叫界面加载失败"')
    expect(document).not.toContain('payload: { message: error')
  })

  it('serves the bundle, icon, and manifest with exact content types', async () => {
    const bundle = await request('/arkme-self/api/call/bundle.js')
    const icon = await request('/arkme-self/api/call/call-linear-strong.svg')
    const manifest = await request('/arkme-self/api/call/manifest.json')

    expect(bundle).toMatchObject({ status: 200, headers: expect.objectContaining({
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    }) })
    expect(icon).toMatchObject({ status: 200, headers: expect.objectContaining({
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    }) })
    expect(manifest).toMatchObject({ status: 200, headers: expect.objectContaining({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }) })
    const searchClose = await request('/arkme-self/api/call/close.svg')
    const searchBack = await request('/arkme-self/api/call/arrow_left.svg')
    expect(searchClose.status).toBe(200)
    expect(searchBack.status).toBe(200)
  })

  it('supports HEAD and rejects methods, unknown files, and traversal', async () => {
    const head = await request('/arkme-self/api/call/bundle.js', 'HEAD')
    expect(head.status).toBe(200)
    expect(head.body).toHaveLength(0)
    expect((await request('/arkme-self/api/call/bundle.js', 'POST')).status).toBe(405)
    expect((await request('/arkme-self/api/call')).status).toBe(404)
    expect((await request('/arkme-self/api/call/unknown.js')).status).toBe(404)
    expect((await request('/arkme-self/api/call/../package.json')).status).toBe(404)
    expect((await request('/arkme-self/api/call/%2e%2e%2fpackage.json')).status).toBe(404)
  })

  it('pins the upstream frontend and verifies the outgoing-only derived bundle', async () => {
    const manifest = JSON.parse(await readFile(join(assetDirectory, 'manifest.json'), 'utf8')) as Record<string, unknown>
    const bundle = await readFile(join(assetDirectory, 'bundle.js'))
    const icon = await readFile(join(assetDirectory, 'call-linear-strong.svg'))

    expect(manifest).toMatchObject({
      upstreamRepository: 'jotmo_frontend',
      upstreamCommit: 'b8c3e8b4b5bfa346561193dce31d195970b8c3fa',
      callEnginePackage: '@trtc/call-engine-lite-js',
      callEngineRange: '^3.5.9',
      upstreamBundleSha256: '6ff59d3eb9ce4d7556ba4054bac0df22ae279a7bccc56ccbf5712b6f475c95ce',
      iconSha256: '0a49fa403980fdf5d2dfb06eb0cda673798ab3b7733c6bd9e728419ca221dfc3',
      outgoingOnly: true,
    })
    expect(createHash('sha256').update(bundle).digest('hex')).toBe(manifest.bundleSha256)
    expect(createHash('sha256').update(icon).digest('hex')).toBe(manifest.iconSha256)
    expect(bundle.toString('utf8')).toContain('payload.outgoingOnly !== true')
  })
})
