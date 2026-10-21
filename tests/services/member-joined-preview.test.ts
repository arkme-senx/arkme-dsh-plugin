import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatRealtimeService } from '../../src/services/chat-realtime-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { SourceService } from '../../src/services/source-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { joinedBundle } from '../fixtures/member-joined.js'
import type { ArkmeChatClientEvent } from '../../src/types.js'

const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(stop => stop()); vi.useRealTimers() })
function setup() {
  let userId = 1
  const session = () => ({ userId, accessToken: 'fixture', refreshToken: 'fixture' })
  const runtime = new ServiceRuntime({ requestTimeoutMs: 5000 } as ArkmeServiceConfig,
    { read: async () => session(), write: async () => {}, delete: async () => {} },
    { uniqueCode: async () => 'fixture' } as StateStore)
  vi.spyOn(runtime, 'requireSession').mockImplementation(async () => session())
  const post = vi.spyOn(runtime, 'authenticatedChatPost').mockResolvedValue(joinedBundle())
  const source = new SourceService(runtime, {} as ProfileService, {} as never)
  const timeline = vi.fn(async () => [])
  const service = new ChatRealtimeService(runtime, source, { chatTimelineItems: timeline })
  vi.spyOn(service, 'refreshAttentionSummary').mockResolvedValue()
  const events: ArkmeChatClientEvent[] = []
  service.subscribeChatRealtime(event => { events.push(event) })
  const hint = (id = 'join', at = 200) => service.handleChatRealtimeNotice({
    cause: 'chat-hint', state: { revision: 1, connected: true, connectionGeneration: 1 }, connectionUserId: userId,
    memberJoined: { eventUid: id, chatSessionUid: 'group', eventAtMillis: at + 10, joinAtMillis: at },
  })
  cleanup.push(() => { service.dispose(); runtime.dispose() })
  return { service, source, runtime, timeline, post, events, hint, changeAccount: () => { userId = 2 } }
}

describe('member join directory refresh', () => {
  it('refreshes only the authoritative preview, once per event, without reading messages or changing unread', async () => {
    const test = setup()
    test.hint(); test.hint()
    await vi.waitFor(() => expect(test.events.some(event => event.type === 'sessions-delta')).toBe(true))
    expect(test.post).toHaveBeenCalledOnce()
    expect(test.post.mock.calls[0]?.[0]).toBe('/api/v1/chats/detail')
    expect(test.timeline).not.toHaveBeenCalled()
    const deltas = test.events.filter(event => event.type === 'sessions-delta')
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.updates[0]?.source).toMatchObject({ latestPreview: '你 添加 李四 加入群聊',
      latestActivityAtMillis: 200, latestSequence: 7, unreadCount: 0 })
    expect(test.events.filter(event => event.type === 'members-invalidated')).toHaveLength(1)
    expect(test.events.some(event => event.type === 'notification')).toBe(false)
  })
  it('rejects a snapshot that has not covered the join and recovers through the bounded existing retry', async () => {
    vi.useFakeTimers()
    const test = setup()
    test.post.mockResolvedValueOnce({ ...joinedBundle(), latest_activity: { kind: 2, activity_uid: 'old', activity_at: 100 } })
    test.hint()
    await vi.advanceTimersByTimeAsync(0)
    expect(test.post).toHaveBeenCalledOnce()
    expect(test.events.some(event => event.type === 'sessions-delta')).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(test.post).toHaveBeenCalledTimes(2)
    expect(test.events.some(event => event.type === 'sessions-delta')).toBe(true)
    expect(test.timeline).not.toHaveBeenCalled()
  })
  it('merges joins arriving during a read and keeps the newer coverage requirement on retries', async () => {
    const test = setup()
    const gate = Promise.withResolvers<Record<string, unknown>>()
    test.post.mockReturnValueOnce(gate.promise)
    test.hint('first', 190)
    await vi.waitFor(() => expect(test.post).toHaveBeenCalledOnce())
    test.hint('second', 200)
    gate.resolve({ ...joinedBundle(), latest_activity: { kind: 2, activity_uid: 'previous', activity_at: 190 } })
    await vi.waitFor(() => expect(test.post).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(test.source.cachedChatSource(1, 'group')?.latestActivityAtMillis).toBe(200))
    expect(test.timeline).not.toHaveBeenCalled()
  })
  it.each(['account', 'dispose'] as const)('drops a completed request after %s changes', async scenario => {
    const test = setup()
    const gate = Promise.withResolvers<Record<string, unknown>>()
    test.post.mockReturnValueOnce(gate.promise)
    test.hint()
    await vi.waitFor(() => expect(test.post).toHaveBeenCalledOnce())
    if (scenario === 'account') test.changeAccount()
    else test.service.dispose()
    gate.resolve(joinedBundle())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(test.events.some(event => event.type === 'sessions-delta')).toBe(false)
    expect(test.source.cachedChatSource(1, 'group')).toBeUndefined()
  })
  it('stops retrying after the existing retry budget and clears work on dispose', async () => {
    vi.useFakeTimers()
    const test = setup()
    test.post.mockRejectedValue(new Error('offline'))
    test.hint()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(test.post).toHaveBeenCalledTimes(6)
    expect(test.events.some(event => event.type === 'sessions-delta')).toBe(false)
    test.service.dispose()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(test.post).toHaveBeenCalledTimes(6)
  })
})
