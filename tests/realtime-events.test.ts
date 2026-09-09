import { once } from 'node:events'
import { createServer } from 'node:http'
import { WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeService } from '../src/arkme-service.js'
import { ArkmeRealtimeEvents } from '../src/realtime-events.js'
import type { ArkmeChatClientEvent } from '../src/types.js'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  let publish!: (event: ArkmeChatClientEvent) => void
  const unsubscribe = vi.fn()
  const service = {
    subscribeChatRealtime(next: typeof publish) { publish = next; return unsubscribe },
    chatRealtimeInitialEvent: () => ({ type: 'reconcile', revision: 1, connected: true, connectionGeneration: 1 }),
  } as unknown as ArkmeService
  const server = createServer((_req, res) => { res.end('readable') })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const events = new ArkmeRealtimeEvents(service, { expectedPort: port, allowNonLoopback: false })
  server.on('upgrade', events.handler)
  cleanups.push(async () => { events.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return { events, publish, unsubscribe, url: `ws://127.0.0.1:${port}/events`, origin: `http://127.0.0.1:${port}` }
}

describe('Arkme local realtime events', () => {
  it('fans the unchanged safe Host event contract out and closes on disposal', async () => {
    const f = await fixture()
    const client = new WebSocket(f.url, { origin: f.origin })
    const messages: string[] = []
    client.on('message', data => messages.push(data.toString()))
    await once(client, 'open')
    await vi.waitFor(() => expect(messages).toHaveLength(1))
    expect(JSON.parse(messages[0]!)).toMatchObject({ type: 'reconcile', revision: 1 })
    f.publish({ type: 'sessions-delta', revision: 2, updates: [{
      source: { sourceRef: 'source-1', kind: 'private_chat', displayName: '联系人', activeAtMillis: 123 }, timelineItems: [],
    }] })
    f.publish({ type: 'projection-invalidated', revision: 3, projection: 'record' })
    f.publish({ type: 'read-receipts-invalidated', revision: 4, sourceKey: 'opaque-key', throughSequence: 12 })
    f.publish({ type: 'timeline-changed', revision: 5, sourceKey: 'opaque-key', timelineItemKey: 'opaque-item', changeKind: 'deleted', changeVersion: 123, relationTerminal: true })
    await vi.waitFor(() => expect(messages).toHaveLength(5))
    expect(messages.map(m => JSON.parse(m).revision)).toEqual([1, 2, 3, 4, 5])
    for (const forbidden of ['chat_session_uid', 'reader_user_id', 'rel_uid']) expect(messages.join('')).not.toContain(forbidden)
    const closed = once(client, 'close')
    f.events.close()
    await closed
    expect(f.unsubscribe).toHaveBeenCalledOnce()
  })

  it.each(['https://evil.example', 'http://127.0.0.1:1', 'null', 'file://localhost'])('rejects cross-origin subscription %s', async origin => {
    const f = await fixture()
    const client = new WebSocket(f.url, { origin })
    const [error] = await once(client, 'error')
    expect(error.message).toContain('403')
  })

  it('does not accept inbound business messages', async () => {
    const f = await fixture()
    const client = new WebSocket(f.url, { origin: f.origin })
    await once(client, 'open')
    const closed = once(client, 'close')
    client.send('{"operation":"send"}')
    const [code] = await closed
    expect(code).toBe(1008)
  })
})
