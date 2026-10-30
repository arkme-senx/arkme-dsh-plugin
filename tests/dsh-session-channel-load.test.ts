import { expect, it, vi } from 'vitest'
import { appendFile } from 'node:fs/promises'
import { DshSessionChannelClient, DshSessionChannelHost } from '../src/dsh-remote/session-channel.js'
import type { DshRemoteRealtimeTransport, DshRemoteTrustedEventMetadata } from '../src/dsh-remote/types.js'

it.each([1, 2, 4, 8])('measures shared account fanout for %i observers', async observers => {
  const listeners = new Map<(value: any, metadata: DshRemoteTrustedEventMetadata) => void, string>()
  let publishedBytes = 0, deliveredBytes = 0, frames = 0, opened = 0
  const transport = (role: 'host' | 'controller') => ({
    connect: async () => {}, disconnect: async () => {}, revalidate() {},
    subscribeDisconnect: () => () => {}, registerHost: vi.fn(), unregisterHost: vi.fn(),
    subscribe: async ({ onEvent }: any) => { listeners.set(onEvent, role); return () => { listeners.delete(onEvent) } },
    publish: async ({ payload }: any) => {
      const bytes = Buffer.byteLength(JSON.stringify(payload))
      if (role === 'host') { publishedBytes += bytes; frames++ }
      for (const [receive, target] of listeners) {
        if (role === 'host' && target === 'controller') deliveredBytes += bytes
        receive(payload, { senderRole: role, runtimeRef: 'host', targetHostLeaseGeneration: 1, acceptedAtMillis: Date.now() })
      }
      return { sequence: frames }
    },
  } satisfies DshRemoteRealtimeTransport)
  const host = new DshSessionChannelHost({ transport: transport('host'),
    target: { runtimeRef: 'host', hostProfileRef: 'p', hostClientRef: 'c', hostLeaseGeneration: 1 },
    epoch: () => 1, failed: error => { throw error },
    native: async (_runtime, _session, body, signal) => {
      if (body.endpoint) {
        opened++
        return { items: [{ type: 'snapshot', cursor: 7, records: [{ text: 'content'.repeat(10_000) }] }] }
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        if (signal.aborted) reject(signal.reason)
      })
    },
  })
  await host.start()
  const clients = Array.from({ length: observers }, () => new DshSessionChannelClient(transport('controller'), async () => {}, vi.fn()))
  const signal = new AbortController().signal
  try {
    const replies = await Promise.all(clients.map((client, i) => client.request({ runtimeRef: 'host', sessionRef: 'session' },
      { mode: 'pull', streamRef: `stream-${i}`, endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'session' } } } } },
      `request-${i}`, signal)))
    expect(replies.every((reply: any) => reply.items[0].cursor === 7)).toBe(true)
    expect(opened).toBe(observers)
    expect(frames).toBe(3)
    const result = { kind: 'observers', observers, nativeOpens: opened, frames, publishedBytes, deliveredBytes }
    if (process.env.DSH_WORKLOAD_REPORT) await appendFile(process.env.DSH_WORKLOAD_REPORT, JSON.stringify(result) + '\n')
  } finally { clients.forEach(client => client.close()); host.close() }
})

it.each(['shared', 'legacy', 'different-content', 'different-session', 'control', 'ack-failed', 'fenced', 'closed'] as const)(
  'preserves independent read semantics while batching %s responses', async mode => {
    const frames: any[] = []
    let epoch = 1
    const transport = { publish: async ({ payload }: any) => {
      frames.push(payload)
      if (mode === 'ack-failed') throw new Error('ack lost')
      return { sequence: frames.length }
    } } as unknown as DshRemoteRealtimeTransport
    const host = new DshSessionChannelHost({ transport,
      target: { runtimeRef: 'host', hostProfileRef: 'p', hostClientRef: 'c', hostLeaseGeneration: 1 },
      epoch: () => epoch, native: vi.fn(), failed: vi.fn() })
    const reply = (host as any).respond.bind(host)
    const pending = [0, 1].map(i => reply({ kind: 'session.request', runtimeRef: 'host',
      sessionRef: mode === 'different-session' ? `session-${i}` : 'session', requestRef: `request-${i}`,
      sharedFollowResponses: mode !== 'legacy', body: { mode: 'pull', streamRef: `stream-${i}`,
        endpoint: mode === 'control' ? 'session/control' : 'session/follow' } }, 1,
      { items: [{ type: 'event', seq: mode === 'different-content' ? i : 1 }] }))
    const result = Promise.allSettled(pending)
    if (mode === 'fenced') epoch = 2
    if (mode === 'closed') host.close()
    try {
      const replies = await result
      if (['ack-failed', 'fenced', 'closed'].includes(mode)) expect(replies.every(r => r.status === 'rejected')).toBe(true)
      else expect(replies.every(r => r.status === 'fulfilled')).toBe(true)
      if (mode === 'fenced' || mode === 'closed') expect(frames).toHaveLength(0)
      else if (mode === 'shared' || mode === 'ack-failed') {
        expect(frames).toHaveLength(1)
        expect(frames[0].streamRefs).toEqual(['stream-0', 'stream-1'])
      } else {
        expect(frames).toHaveLength(2)
        expect(frames.every(frame => frame.streamRefs === undefined)).toBe(true)
      }
    } finally { host.close() }
  })
