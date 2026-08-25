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
    const demoPeer = await request('/arkme-self/api/call/call-demo-peer.png')
    const demoSelf = await request('/arkme-self/api/call/call-demo-self.png')
    const demoVideoIcon = await request('/arkme-self/api/call/arkme-video-linear.svg')

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
    expect(demoPeer).toMatchObject({ status: 200, headers: expect.objectContaining({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    }) })
    expect(demoSelf).toMatchObject({ status: 200, headers: expect.objectContaining({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    }) })
    expect(demoVideoIcon).toMatchObject({ status: 200, headers: expect.objectContaining({
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    }) })
    expect(demoVideoIcon.body.toString('utf8')).toContain('M12.53 20.4201H6.21')
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
      iconSha256: '583d7dbd34069c5b50ca294a071637bbd3beed913cecdb91a202c001004eed45',
      outgoingOnly: true,
    })
    expect(createHash('sha256').update(bundle).digest('hex')).toBe(manifest.bundleSha256)
    expect(createHash('sha256').update(icon).digest('hex')).toBe(manifest.iconSha256)
    expect(bundle.toString('utf8')).toContain('payload.outgoingOnly !== true')
  })

  it('keeps the local hangup fallback that closes the host overlay when the SDK omits ON_CALL_END', async () => {
    const bundle = await readFile(join(assetDirectory, 'bundle.js'), 'utf8')
    const hangup = bundle.slice(bundle.indexOf('async function hangupCall()'), bundle.indexOf('async function requestToggleFullscreen()'))

    expect(hangup).toContain('const engine = state.engine;')
    expect(hangup).toContain('postLocalTerminalToWebHost("end", "\\u901A\\u8BDD\\u5DF2\\u7ED3\\u675F");')
    expect(hangup).toContain('void engine.hangup().catch(() => {')
    expect(hangup).toContain('state.pendingLocalTerminalAction = "";')
    expect(hangup).toContain('await finalizeTerminalState("end", {}, "\\u901A\\u8BDD\\u5DF2\\u7ED3\\u675F");')
    expect(hangup.indexOf('postLocalTerminalToWebHost("end"')).toBeLessThan(hangup.indexOf('void engine.hangup()'))
  })

  it('posts terminal events to the DSH web iframe parent when native bridges are unavailable', async () => {
    const bundle = await readFile(join(assetDirectory, 'bundle.js'), 'utf8')
    const bridge = bundle.slice(bundle.indexOf('function resolveWebHostCallRequestId()'), bundle.indexOf('function escapeHtml(value)'))
    const post = bundle.slice(bundle.indexOf('function postToFlutter(type, extra = {})'), bundle.indexOf('function setStatusText(text)'))

    expect(bridge).toContain('JSON.parse(String(window.name || "{}"))')
    expect(bridge).toContain('channel: "jotmo-desktop-call"')
    expect(bridge).toContain('window.parent.postMessage')
    expect(post).toContain('const postedToWebHost = postToWebHostBridge(payload);')
    expect(post).toContain('if (postedToWebHost) {')
    expect(post).toContain('return true;')
  })

  it('sends a web host terminal hint before video SDK cleanup can block hangup close', async () => {
    const bundle = await readFile(join(assetDirectory, 'bundle.js'), 'utf8')
    const hint = bundle.slice(bundle.indexOf('function postLocalTerminalToWebHost(type, message)'), bundle.indexOf('function setStatusText(text)'))

    expect(hint).toContain('phase: CALL_PHASE.ending')
    expect(hint).toContain('hasActiveCall: false')
    expect(hint).toContain('elapsedLabel: state.elapsedLabel')
    expect(hint).toContain('reason: "local_hangup_hint"')
    expect(hint).toContain('const posted = postToWebHostBridge(payload);')
    expect(hint).toContain('diagLog("local_terminal_web_host_hint"')
    expect(bundle).not.toContain('getElapsedLabel')
  })
})
