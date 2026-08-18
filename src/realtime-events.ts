import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ArkmeService } from './arkme-service.js'
import type { ArkmeChatClientEvent } from './types.js'

const HEARTBEAT_MS = 20_000

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function dataLine(event: ArkmeChatClientEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export class ArkmeRealtimeEvents {
  private readonly connections = new Set<ServerResponse>()
  private readonly unsubscribe: () => void
  private readonly heartbeat: ReturnType<typeof setInterval>

  constructor(
    service: ArkmeService,
    private readonly options: { expectedPort: number; allowNonLoopback: boolean },
  ) {
    this.unsubscribe = service.subscribeChatRealtime(event => { this.broadcast(dataLine(event)) })
    this.heartbeat = setInterval(() => { this.broadcast(': heartbeat\n\n') }, HEARTBEAT_MS)
    this.heartbeat.unref()
    this.service = service
  }

  private readonly service: ArkmeService

  readonly handler = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!this.options.allowNonLoopback && !isLoopback(req.socket.remoteAddress)) {
      res.writeHead(403)
      res.end()
      return
    }
    const origin = req.headers.origin
    if (origin !== undefined) {
      try {
        const parsed = new URL(origin)
        const port = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port)
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || port !== this.options.expectedPort) {
          res.writeHead(403)
          res.end()
          return
        }
      } catch {
        res.writeHead(403)
        res.end()
        return
      }
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    })
    res.write('retry: 1000\n: connected\n\n')
    res.write(dataLine(this.service.chatRealtimeInitialEvent()))
    this.connections.add(res)
    res.on('close', () => { this.connections.delete(res) })
  }

  close(): void {
    this.unsubscribe()
    clearInterval(this.heartbeat)
    for (const response of this.connections) response.destroy()
    this.connections.clear()
  }

  private broadcast(frame: string): void {
    for (const response of [...this.connections]) {
      try { response.write(frame) }
      catch {
        response.destroy()
        this.connections.delete(response)
      }
    }
  }
}
