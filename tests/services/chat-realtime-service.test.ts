import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ChatRealtimeService } from '../../src/services/chat-realtime-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('ChatRealtimeService', () => {
  it('starts in a disconnected state without opening a connection', () => {
    const sessions: ArkmeSessionStore = { async read() { return undefined }, async write() {}, async delete() {} }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })

    expect(service.chatRealtimeState().connected).toBe(false)
    service.dispose()
  })

  it('recovers the Record projection on reconnect without reusing Chat projection semantics', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const invalidate = vi.spyOn(source, 'invalidateSourceListCache')
    vi.spyOn(service as unknown as { reconcileChatNotificationBaseline(generation: number): Promise<void> },
      'reconcileChatNotificationBaseline').mockResolvedValue()
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    service.handleChatRealtimeNotice({
      cause: 'reconcile',
      state: { revision: 1, connected: true, connectionGeneration: 1 },
    })

    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith(10001, 'send_to_self')
      expect(events).toContainEqual(expect.objectContaining({ type: 'projection-invalidated', projection: 'record' }))
    })
    service.dispose()
  })

  it('does not treat a Chat hint or another projection as a Record invalidation', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const invalidate = vi.spyOn(source, 'invalidateSourceListCache')

    service.handleChatRealtimeNotice({
      cause: 'projection-invalidation',
      state: { revision: 1, connected: true, connectionGeneration: 1 },
      projectionInvalidation: { eventUid: 'topic-1', projection: 'topic', eventAtMillis: 1 },
    })
    service.handleChatRealtimeNotice({
      cause: 'chat-hint',
      state: { revision: 2, connected: true, connectionGeneration: 1 },
      projectionInvalidation: { eventUid: 'record-1', projection: 'record', eventAtMillis: 2 },
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(invalidate).not.toHaveBeenCalled()
    service.dispose()
  })
})
