import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export const DEFAULT_EXTENSION_SHARE_DISCOVERY_PORT = 3080

export type ArkmeExtensionShareDiscoveryMode = 'stopped' | 'disabled' | 'direct' | 'relay' | 'unavailable'

export interface ArkmeExtensionShareDiscoveryStatus {
  mode: ArkmeExtensionShareDiscoveryMode
  actualPort: number
  discoveryPort: number
}

interface ArkmeExtensionShareDiscoveryLogger {
  info(message: string): void
  warn(message: string): void
}

export interface ArkmeExtensionShareDiscoveryRelayOptions {
  actualPort: number
  discoveryPort?: number
  enabled?: boolean
  logger: ArkmeExtensionShareDiscoveryLogger
}

function validPort(port: number): boolean {
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535
}

function trustedHost(request: IncomingMessage, discoveryPort: number): boolean {
  const host = request.headers.host
  if (host === undefined) return false
  try {
    const url = new URL(`http://${host}`)
    return url.hostname === '127.0.0.1' && Number(url.port || 80) === discoveryPort
  } catch {
    return false
  }
}

function discoveryPage(actualPort: number, nonce: string): string {
  const target = JSON.stringify(`http://127.0.0.1:${String(actualPort)}/`)
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>打开 DSH</title></head>
<body><p id="status">正在连接当前运行的 DSH…</p><script nonce="${nonce}">
const hash = window.location.hash;
if (/^#\\/arkme\\/extensions\\/share\\/extshare_[0-9a-f]{32}$/.test(hash)) {
  window.location.replace(${target} + hash);
} else {
  document.getElementById('status').textContent = '分享链接无效。';
}
</script></body>
</html>`
}

export function createArkmeExtensionShareDiscoveryHandler(actualPort: number, discoveryPort: number) {
  if (!validPort(actualPort) || !validPort(discoveryPort)) throw new TypeError('invalid extension share discovery port')
  return (request: IncomingMessage, response: ServerResponse): void => {
    if (!trustedHost(request, discoveryPort)) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Forbidden')
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }).end()
      return
    }
    let target: URL
    try { target = new URL(request.url ?? '', `http://127.0.0.1:${String(discoveryPort)}`) }
    catch {
      response.writeHead(400, { 'Cache-Control': 'no-store' }).end()
      return
    }
    if (target.origin !== `http://127.0.0.1:${String(discoveryPort)}` || target.pathname !== '/' || target.search !== '') {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end()
      return
    }
    const nonce = randomBytes(18).toString('base64url')
    const body = discoveryPage(actualPort, nonce)
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Opener-Policy': 'same-origin',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  }
}

export class ArkmeExtensionShareDiscoveryRelay {
  private readonly actualPort: number
  private readonly discoveryPort: number
  private readonly enabled: boolean
  private readonly logger: ArkmeExtensionShareDiscoveryLogger
  private server: Server | undefined
  private mode: ArkmeExtensionShareDiscoveryMode = 'stopped'

  constructor(options: ArkmeExtensionShareDiscoveryRelayOptions) {
    const discoveryPort = options.discoveryPort ?? DEFAULT_EXTENSION_SHARE_DISCOVERY_PORT
    if (!validPort(options.actualPort) || !validPort(discoveryPort)) throw new TypeError('invalid extension share discovery port')
    this.actualPort = options.actualPort
    this.discoveryPort = discoveryPort
    this.enabled = options.enabled !== false
    this.logger = options.logger
  }

  status(): ArkmeExtensionShareDiscoveryStatus {
    return { mode: this.mode, actualPort: this.actualPort, discoveryPort: this.discoveryPort }
  }

  async start(): Promise<void> {
    if (this.mode !== 'stopped') return
    if (!this.enabled) {
      this.mode = 'disabled'
      return
    }
    if (this.actualPort === this.discoveryPort) {
      this.mode = 'direct'
      this.logger.info(`dsh-arkme: extension share discovery uses DSH port ${String(this.actualPort)} directly`)
      return
    }
    const server = createServer(createArkmeExtensionShareDiscoveryHandler(this.actualPort, this.discoveryPort))
    server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n') })
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { server.off('listening', onListening); reject(error) }
        const onListening = () => { server.off('error', onError); resolve() }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(this.discoveryPort, '127.0.0.1')
      })
    } catch (error) {
      this.mode = 'unavailable'
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EADDRINUSE') {
        this.logger.warn(`dsh-arkme: extension share discovery port ${String(this.discoveryPort)} is already in use; manual port fallback remains available`)
        return
      }
      this.logger.warn(`dsh-arkme: extension share discovery relay failed to start: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    this.server = server
    this.mode = 'relay'
    this.logger.info(`dsh-arkme: extension share discovery relays ${String(this.discoveryPort)} to DSH port ${String(this.actualPort)}`)
  }

  async dispose(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.mode = 'stopped'
    if (server === undefined || !server.listening) return
    await new Promise<void>((resolve, reject) => {
      server.close(error => { if (error === undefined) resolve(); else reject(error) })
    })
  }
}
