import { describe, expect, it } from 'vitest'
import { dshRemoteRealtimeEndpoint } from '../src/dsh-remote/default-socket-factory.js'

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
})
