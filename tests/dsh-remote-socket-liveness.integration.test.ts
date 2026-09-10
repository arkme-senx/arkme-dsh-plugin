import { once } from 'node:events'
import WebSocket, { WebSocketServer } from 'ws'
import { expect, it } from 'vitest'
import { ArkmeRemoteRealtimeTransport, type DshRemoteSocketLike } from '../src/dsh-remote/realtime-transport.js'

it('detects a real silent OPEN socket and completes a replacement handshake without desktop conversation activity', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing test listener')
  server.on('connection', socket => {
    socket.on('message', data => {
      const frame = JSON.parse(data.toString())
      if (frame.type === 'connection.open') socket.send(JSON.stringify({ type: 'connection.ready', connection_generation: 1 }))
    })
  })
  const sockets: WebSocket[] = []
  const transport = new ArkmeRemoteRealtimeTransport(() => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}`)
    socket.on('error', () => undefined)
    sockets.push(socket)
    return Object.assign(socket, {
      subscribeHeartbeat(listener: () => void) {
        socket.on('ping', listener)
        return () => socket.off('ping', listener)
      },
    }) as unknown as DshRemoteSocketLike
  }, 1_000, { livenessTimeoutMillis: 1_000 })
  try {
    const disconnected = Promise.withResolvers<Error>()
    transport.subscribeDisconnect(disconnected.resolve)
    const input = { profileRef: 'test-profile', clientRef: 'test-host', signal: new AbortController().signal }
    await transport.connect(input)
    const error = await disconnected.promise
    expect(error).toMatchObject({ details: { reason: 'liveness_expired' } })
    await transport.connect(input)
    expect(sockets).toHaveLength(2)
    expect(sockets[0]!.readyState).not.toBe(WebSocket.OPEN)
    expect(sockets[1]!.readyState).toBe(WebSocket.OPEN)
  } finally {
    await transport.disconnect()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
