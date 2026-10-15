import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { dshRemoteRealtimeEndpoint } from '../dsh-remote/default-socket-factory.js'

/** Only account-scoped hints cross this transport; every hint triggers an owner snapshot read. */
export class DeviceControlRealtime {
  private socket: WebSocket | undefined
  private identity = ''
  private retryAt = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly origin: string | undefined, private readonly changed: () => void) {}
  connect(userId: number, sessionId: string, accessToken: string): void {
    if (!this.origin) return
    const identity = `${userId}:${sessionId}:${accessToken}`
    if (this.identity === identity && this.socket !== undefined || Date.now() < this.retryAt) return
    this.close(); this.identity = identity
    let socket: WebSocket
    try { socket = new WebSocket(dshRemoteRealtimeEndpoint(this.origin), {
      headers: { Authorization: `Bearer ${accessToken}` }, handshakeTimeout: 8000,
      maxPayload: 65536, perMessageDeflate: false, followRedirects: false,
    }) } catch { this.retryAt = Date.now() + 15000; return }
    this.socket = socket
    let stage = 'opening'
    const subscribeId = randomUUID(), registerId = randomUUID()
    const send = (frame: object) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame)) }
    const stop = () => {
      if (this.socket !== socket) return
      this.close(); this.retryAt = Date.now() + 5000; this.changed()
    }
    const touch = () => {
      if (this.socket !== socket) return
      clearTimeout(this.timer)
      this.timer = setTimeout(() => { socket.terminate(); stop() }, 45000); this.timer.unref()
    }
    socket.on('open', () => { touch(); send({ type: 'connection.open', profile_ref: 'device-control', client_ref: sessionId }) })
    socket.on('ping', touch); socket.on('pong', touch)
    socket.on('message', raw => {
      if (this.socket !== socket) return
      touch()
      try {
        const frame = JSON.parse(raw.toString()) as Record<string, unknown>
        if (frame.type === 'connection.ready' && stage === 'opening') {
          stage = 'subscribing'; send({ type: 'channel.subscribe', module: 'device_control', namespace: 'device_control', channel_ref: String(userId), request_id: subscribeId })
        } else if (frame.type === 'channel.subscribed' && frame.request_id === subscribeId && stage === 'subscribing') {
          stage = 'registering'; send({ type: 'service.register', module: 'device_control', namespace: 'device_control', service: 'device', protocol: 'jotmo.device-control', protocol_major: 1, descriptor: {}, request_id: registerId })
        } else if (frame.type === 'service.registered' && frame.request_id === registerId && stage === 'registering') {
          stage = 'active'; this.changed()
        } else if (frame.type === 'channel.event' && frame.module === 'device_control' && frame.namespace === 'device_control' && frame.channel_ref === String(userId)) {
          this.changed()
        } else if (frame.type === 'error' || frame.type === 'connection.replaced') { socket.terminate(); stop() }
      } catch { socket.terminate(); stop() }
    })
    socket.on('error', stop); socket.on('close', stop)
  }
  close(): void {
    const socket = this.socket; this.socket = undefined; this.identity = ''; clearTimeout(this.timer); this.timer = undefined
    if (socket !== undefined) { socket.on('error', () => undefined); socket.terminate() }
  }
}
