import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface OutgoingCallAssetHandlerOptions {
  routePrefix: string
  assetDirectory?: string
}

const ASSETS = {
  'index.html': { contentType: 'text/html; charset=utf-8', cacheControl: 'no-store' },
  'bundle.js': { contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  'call-linear-strong.svg': { contentType: 'image/svg+xml; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  'image_search.svg': { contentType: 'image/svg+xml; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  'image_search_grey.svg': { contentType: 'image/svg+xml; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  'icon_close_round_bold.svg': { contentType: 'image/svg+xml; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  'close.svg': { contentType: 'image/svg+xml; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  'arrow_left.svg': { contentType: 'image/svg+xml; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  'video_play_white.svg': { contentType: 'image/svg+xml; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  'jotmo-video-linear.svg': { contentType: 'image/svg+xml; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  'user-add-linear.svg': { contentType: 'image/svg+xml; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  'profile-circle-linear.svg': { contentType: 'image/svg+xml; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  'call-add-linear.svg': { contentType: 'image/svg+xml; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  'icon-scan-add-contact.svg': { contentType: 'image/svg+xml; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' },
  'avatar-lin-xiaoman.jpeg': { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
  'avatar-mother.jpg': { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
  'avatar-self.png': { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
  'call-demo-peer.png': { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
  'call-demo-self.png': { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
  'manifest.json': { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
} as const

const DOCUMENT_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "worker-src 'self' blob:",
  "connect-src 'self' https: wss: data:",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export function createOutgoingCallAssetHandler(options: OutgoingCallAssetHandlerOptions) {
  const routePrefix = options.routePrefix.replace(/\/$/, '')
  const assetDirectory = options.assetDirectory
    ?? fileURLToPath(new URL('../assets/desktop_call/', import.meta.url))

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const method = request.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }).end()
      return
    }

    let pathname: string
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    } catch {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end()
      return
    }
    const prefix = `${routePrefix}/`
    if (!pathname.startsWith(prefix)) {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end()
      return
    }
    const encodedName = pathname.slice(prefix.length)
    let name: string
    try {
      name = decodeURIComponent(encodedName)
    } catch {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end()
      return
    }
    if (!Object.hasOwn(ASSETS, name)) {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end()
      return
    }

    const asset = ASSETS[name as keyof typeof ASSETS]
    try {
      const body = await readFile(join(assetDirectory, name))
      const headers: Record<string, string | number> = {
        'Content-Type': asset.contentType,
        'Content-Length': body.byteLength,
        'Cache-Control': asset.cacheControl,
        'X-Content-Type-Options': 'nosniff',
      }
      if (name === 'index.html') headers['Content-Security-Policy'] = DOCUMENT_CSP
      response.writeHead(200, headers)
      response.end(method === 'HEAD' ? undefined : body)
    } catch {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end()
    }
  }
}
