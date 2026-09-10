import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { DSH_REMOTE_MAX_FRAME_BYTES } from './types.js'
import type { DshRemoteSocketLike } from './realtime-transport.js'

export function dshRemoteRealtimeEndpoint(realtimeBaseUrl: string): string {
  const endpoint = new URL(realtimeBaseUrl)
  if (endpoint.protocol !== 'https:' || endpoint.username !== '' || endpoint.password !== ''
    || endpoint.pathname !== '/' || endpoint.search !== '' || endpoint.hash !== '') {
    throw new TypeError('DSH remote Realtime requires a credential-free HTTPS service origin')
  }
  endpoint.protocol = 'wss:'
  endpoint.pathname = '/api/v1/realtime/connect'
  return endpoint.toString()
}

export function createDefaultDshRemoteSocket(input: {
  realtimeBaseUrl: string
  accessToken: string
  signal: AbortSignal
}): DshRemoteSocketLike {
  const accessToken = input.accessToken.trim()
  if (accessToken === '') throw new TypeError('DSH remote Realtime access token is required')
  if (input.signal.aborted) throw input.signal.reason
  const diagnosticRequestId = randomUUID()
  const socket = new WebSocket(dshRemoteRealtimeEndpoint(input.realtimeBaseUrl), {
    headers: { Authorization: `Bearer ${accessToken}`, 'X-Request-ID': diagnosticRequestId },
    handshakeTimeout: 10_000,
    maxPayload: DSH_REMOTE_MAX_FRAME_BYTES,
    perMessageDeflate: false,
    followRedirects: false,
  })
  // ws may emit a final error while an aborted CONNECTING socket is closing.
  // The Transport observes active errors; teardown must not crash the Host.
  socket.on('error', () => undefined)
  const closeOnAbort = () => { socket.close(1000, 'aborted') }
  input.signal.addEventListener('abort', closeOnAbort, { once: true })
  socket.addEventListener('close', () => {
    input.signal.removeEventListener('abort', closeOnAbort)
  }, { once: true })
  return Object.assign(socket, {
    diagnosticRequestId,
    subscribeHeartbeat(listener: () => void): () => void {
      socket.on('ping', listener)
      socket.on('pong', listener)
      return () => { socket.off('ping', listener); socket.off('pong', listener) }
    },
  }) as unknown as DshRemoteSocketLike
}
