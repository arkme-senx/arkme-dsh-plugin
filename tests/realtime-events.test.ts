import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeService } from '../src/arkme-service.js'
import { ArkmeRealtimeEvents } from '../src/realtime-events.js'
import type { ArkmeChatClientEvent } from '../src/types.js'

class FakeResponse extends EventEmitter {
  status = 0
  headers: Record<string, string> = {}
  chunks: string[] = []
  destroyed = false
  writeHead(status: number, headers: Record<string, string> = {}) {
    this.status = status
    this.headers = headers
    return this
  }
  write(chunk: string) { this.chunks.push(chunk); return true }
  end() { this.emit('close'); return this }
  destroy() { this.destroyed = true; this.emit('close'); return this }
}

describe('Arkme local realtime events', () => {
  it('fans Host Chat revisions out through one same-origin SSE stream', () => {
    let listener: ((event: ArkmeChatClientEvent) => void) | undefined
    const unsubscribe = vi.fn()
    const service = {
      subscribeChatRealtime(next: (event: ArkmeChatClientEvent) => void) {
        listener = next
        return unsubscribe
      },
      chatRealtimeInitialEvent: () => ({
        type: 'reconcile', revision: 1, connected: true, connectionGeneration: 1,
      }),
    } as unknown as ArkmeService
    const events = new ArkmeRealtimeEvents(service, { expectedPort: 3084, allowNonLoopback: false })
    const response = new FakeResponse()
    events.handler({
      method: 'GET',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { origin: 'http://127.0.0.1:3084' },
    } as IncomingMessage, response as unknown as ServerResponse)

    expect(response.status).toBe(200)
    expect(response.headers['Content-Type']).toContain('text/event-stream')
    expect(response.chunks.join('')).toContain('"revision":1')
    listener?.({
      type: 'sessions-delta', revision: 2,
      updates: [{
        source: {
          sourceRef: 'source-1', kind: 'private_chat', displayName: '联系人',
          activeAtMillis: 123, unreadCount: 1, latestSequence: 9,
        },
        timelineItems: [],
      }],
    })
    expect(response.chunks.join('')).toContain('"revision":2')
    listener?.({ type: 'projection-invalidated', revision: 3, projection: 'record' })
    expect(response.chunks.join('')).toContain('"projection":"record"')
    listener?.({
      type: 'read-receipts-invalidated', revision: 4,
      sourceKey: 'arkme-chat-source-v1.browser-safe', throughSequence: 12,
    })
    expect(response.chunks.join('')).toContain('"type":"read-receipts-invalidated"')
    expect(response.chunks.join('')).toContain('"throughSequence":12')
    expect(response.chunks.join('')).not.toContain('chat_session_uid')
    expect(response.chunks.join('')).not.toContain('reader_user_id')

    events.close()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(response.destroyed).toBe(true)
  })
})
