import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { ArkmeService } from './arkme-service.js'

const HEARTBEAT_MS = 20_000

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Host-owned, receive-only event transport; no business commands or credentials. */
export class ArkmeRealtimeEvents {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false })
  private readonly awaitingPong = new Set<WebSocket>()
  private readonly unsubscribe: () => void
  private readonly heartbeat: ReturnType<typeof setInterval>
  private closed = false

  constructor(
    private readonly service: ArkmeService,
    private readonly options: { expectedPort: number; allowNonLoopback: boolean },
  ) {
    this.unsubscribe = service.subscribeChatRealtime(event => {
      const frame = JSON.stringify(event)
      for (const client of this.server.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(frame)
      }
    })
    this.heartbeat = setInterval(() => {
      for (const client of this.server.clients) {
        if (this.awaitingPong.has(client)) { client.terminate(); continue }
        this.awaitingPong.add(client)
        client.ping()
      }
    }, HEARTBEAT_MS)
    this.heartbeat.unref()
  }

  readonly handler = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (req.method !== 'GET' || !this.allowed(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    this.server.handleUpgrade(req, socket, head, client => {
      client.on('error', () => { client.terminate() })
      client.on('pong', () => { this.awaitingPong.delete(client) })
      client.on('close', () => { this.awaitingPong.delete(client) })
      client.on('message', () => { client.close(1008, 'Receive-only channel') })
      client.send(JSON.stringify(this.service.chatRealtimeInitialEvent()))
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribe()
    clearInterval(this.heartbeat)
    for (const client of this.server.clients) client.terminate()
    this.awaitingPong.clear()
    this.server.close()
  }

  private allowed(req: IncomingMessage): boolean {
    if (!this.options.allowNonLoopback && !isLoopback(req.socket.remoteAddress)) return false
    const origin = req.headers.origin
    if (origin === undefined) return true
    try {
      const parsed = new URL(origin)
      const port = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port)
      return ['http:', 'https:'].includes(parsed.protocol)
        && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
        && port === this.options.expectedPort
    } catch { return false }
  }
}
