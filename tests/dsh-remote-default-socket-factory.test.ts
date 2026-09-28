import { once } from 'node:events'
import WebSocket, { WebSocketServer } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultDshRemoteSocket, dshRemoteRealtimeEndpoint } from '../src/dsh-remote/default-socket-factory.js'

const fixture = vi.hoisted(() => ({ endpoint: '' }))
vi.mock('ws', async importOriginal => {
  const actual = await importOriginal<typeof import('ws')>()
  return {
    ...actual,
    default: class extends actual.default {
      constructor(_url: string, options: WebSocket.ClientOptions) {
        // Only redirect the test dial. All production constructor options and
        // the real ws compression/encoding implementation remain in use.
        super(fixture.endpoint, options)
      }
    },
  }
})

describe('DSH remote default socket factory', () => {
  it('derives the frozen websocket path without putting credentials in the URL', () => {
    expect(dshRemoteRealtimeEndpoint('https://jotmo-realtime.senguo.me/'))
      .toBe('wss://jotmo-realtime.senguo.me/api/v1/realtime/connect')
  })

  it.each([
    'http://jotmo-realtime.senguo.me/',
    'https://user:password@jotmo-realtime.senguo.me/',
    'https://jotmo-realtime.senguo.me/api',
    'https://jotmo-realtime.senguo.me/?token=unsafe',
  ])('rejects an unsafe service origin: %s', (origin) => {
    expect(() => dshRemoteRealtimeEndpoint(origin)).toThrow(/credential-free HTTPS service origin/)
  })

  it.each([true, false])('round-trips through a real server with compression=%s', async compressed => {
    const server = new WebSocketServer({
      host: '127.0.0.1', port: 0,
      perMessageDeflate: compressed ? { serverNoContextTakeover: true, clientNoContextTakeover: true } : false,
    })
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing fixture address')
    fixture.endpoint = `ws://127.0.0.1:${address.port}`
    const peerReady = once(server, 'connection')
    const socket = createDefaultDshRemoteSocket({
      realtimeBaseUrl: 'https://example.invalid/', accessToken: 'fixture-token', signal: new AbortController().signal,
    }) as unknown as WebSocket
    try {
      await once(socket, 'open')
      const [peer] = await peerReady as [WebSocket]
      expect(socket.extensions).toBe(compressed ? 'permessage-deflate' : '')
      expect(peer.extensions).toBe(socket.extensions)
      const payload = JSON.stringify({ message: '中文 round trip '.repeat(2048) })
      const received = once(peer, 'message')
      socket.send(payload)
      const [data, binary] = await received
      expect(binary).toBe(false)
      expect(data.toString()).toBe(payload)
      const echoed = once(socket, 'message')
      peer.send(data, { binary: false })
      expect((await echoed)[0].toString()).toBe(payload)
    } finally {
      socket.terminate()
      for (const peer of server.clients) peer.terminate()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
