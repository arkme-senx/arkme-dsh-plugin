import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { DshAccountSessions } from './account-sessions.js'
import { DshRemoteError, asDshRemoteError } from './errors.js'
import { nativeRecord } from './native-transport.js'
import { DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES } from './types.js'

/** Multiplex native subscription pulls outside the browser's HTTP/1 connection pool. */
export class DshNativeSocket {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false })
  private readonly waiting = new Set<WebSocket>()
  private readonly heartbeat: ReturnType<typeof setInterval>
  private pending = 0
  constructor(private readonly directory: () => DshAccountSessions | undefined, private readonly port: number, private readonly allowNonLoopback = false) {
    this.heartbeat = setInterval(() => {
      for (const socket of this.server.clients) {
        if (this.waiting.has(socket)) socket.terminate()
        else { this.waiting.add(socket); socket.ping() }
      }
    }, 20_000)
    this.heartbeat.unref()
  }
  readonly handler = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let allowed = false
    try {
      const origin = new URL(req.headers.origin ?? '')
      allowed = req.method === 'GET' && (this.allowNonLoopback || ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? ''))
        && ['http:', 'https:'].includes(origin.protocol) && ['127.0.0.1', 'localhost'].includes(origin.hostname)
        && Number(origin.port || (origin.protocol === 'https:' ? 443 : 80)) === this.port
    } catch { /* Missing and opaque origins cannot open a native carrier. */ }
    if (!allowed || this.server.clients.size >= 64) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    this.server.handleUpgrade(req, socket, head, client => {
      const requests = new Map<string, AbortController>()
      client.on('error', () => client.terminate())
      client.on('pong', () => this.waiting.delete(client))
      client.on('close', () => { this.waiting.delete(client); for (const request of requests.values()) request.abort() })
      const send = (value: unknown) => {
        if (client.readyState !== WebSocket.OPEN) return
        const frame = JSON.stringify(value)
        if (client.bufferedAmount + Buffer.byteLength(frame) > DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES) client.close(1009, 'Native response limit')
        else client.send(frame)
      }
      client.on('message', async data => {
        let id: string | undefined, controller: AbortController | undefined
        try {
          const message = nativeRecord(JSON.parse(data.toString()))
          if (typeof message.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(message.id)) throw new Error('请求标识无效')
          id = message.id
          if (message.cancel === true) { requests.get(id)?.abort(); return }
          if (requests.has(id)) { client.close(1008, 'Duplicate native request'); return }
          if (this.pending >= 64) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '原生订阅请求数量超限')
          const params = nativeRecord(message.params), body = nativeRecord(params.body)
          if (body.mode !== 'pull' && body.mode !== 'close') throw new DshRemoteError('REMOTE_REQUEST_INVALID', '订阅通道不接受普通调用')
          const directory = this.directory()
          if (!directory) throw new DshRemoteError('REMOTE_LOGIN_REQUIRED', '请先登录')
          controller = new AbortController(); requests.set(id, controller); this.pending++
          const value = await directory.native(params, controller.signal)
          if (!controller.signal.aborted) send({ id, ok: true, value })
        } catch (error) {
          if (!id) client.close(1008, 'Invalid native request')
          else if (!controller?.signal.aborted) { const e = asDshRemoteError(error); send({ id, ok: false, error: { code: e.code, message: e.message, retryable: e.retryable } }) }
        } finally {
          if (controller) { requests.delete(id!); this.pending-- }
        }
      })
    })
  }
  close(): void {
    clearInterval(this.heartbeat)
    for (const client of this.server.clients) client.terminate()
    this.waiting.clear(); this.server.close()
  }
}
