import { ArkmePluginError } from './services/service.js'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { RealtimeDictationService } from './services/realtime-dictation-service.js'
import { DICTATION_MAX_BUFFER_BYTES, DICTATION_MAX_FRAME_BYTES, type RealtimeDictationSnapshot } from './realtime-dictation-contract.js'

/** Same-origin local carrier. The upstream credential never reaches the browser. */
export class RealtimeDictationSocket {
  private server = new WebSocketServer({ noServer: true, maxPayload: DICTATION_MAX_FRAME_BYTES, perMessageDeflate: false })
  constructor(private owner: RealtimeDictationService, private port: number) {}
  readonly handler = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let allowed = false
    try {
      const origin = new URL(req.headers.origin ?? '')
      allowed = req.method === 'GET' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
        && ['http:', 'https:'].includes(origin.protocol) && ['127.0.0.1', 'localhost'].includes(origin.hostname)
        && origin.host === req.headers.host && Number(origin.port || (origin.protocol === 'https:' ? 443 : 80)) === this.port
    } catch { /* Missing and opaque origins cannot capture audio. */ }
    if (!allowed || this.server.clients.size >= 4) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    this.server.handleUpgrade(req, socket, head, client => {
      const controller = new AbortController()
      let ref: string | undefined, starting = false
      const admission = setTimeout(() => client.terminate(), 10_000); admission.unref()
      const send = (value: RealtimeDictationSnapshot) => {
        if (client.readyState !== WebSocket.OPEN) return
        const frame = JSON.stringify(value)
        if (client.bufferedAmount + Buffer.byteLength(frame) > DICTATION_MAX_BUFFER_BYTES) { client.terminate(); return }
        client.send(frame)
        if (value.phase === 'finished' || value.phase === 'failed') client.close()
      }
      client.on('error', () => client.terminate())
      client.on('close', () => { clearTimeout(admission); controller.abort(); if (ref) this.owner.cancel(ref) })
      client.on('message', (data, binary) => {
        if (binary) {
          try { if (!ref) throw new Error('Not ready'); this.owner.audio(ref, Buffer.from(data as Buffer)) }
          catch { client.close(1008, 'Invalid dictation audio') }
          return
        }
        try {
          const message = JSON.parse(data.toString()) as { action?: string; expectedUserId?: number }
          if (message.action === 'start' && !starting && !ref) {
            starting = true
            void this.owner.open(message.expectedUserId!, value => {
              ref = value.streamRef; clearTimeout(admission); send(value)
            }, controller.signal).then(value => { ref = value.streamRef }).catch(error => {
              if (!controller.signal.aborted && client.readyState === WebSocket.OPEN) { client.send(JSON.stringify({ error: error instanceof ArkmePluginError ? { code: error.code, message: error.message, retryable: error.retryable } : { code: 'dictation-connection', message: '实时听写连接失败，请重新开始', retryable: true } })); client.close() }
            })
          } else if (ref && message.action === 'finish') this.owner.finish(ref)
          else if (ref && message.action === 'cancel') { this.owner.cancel(ref); client.close() }
          else client.close(1008, 'Invalid dictation command')
        } catch { client.close(1008, 'Invalid dictation command') }
      })
    })
  }
  close() { for (const client of this.server.clients) client.terminate(); this.server.close() }
}
