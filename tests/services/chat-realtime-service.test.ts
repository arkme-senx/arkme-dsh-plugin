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

  it('projects another member cursor advance to an account-bound browser invalidation', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    service.handleChatRealtimeNotice({
      cause: 'hint',
      state: { revision: 2, connected: true, connectionGeneration: 1 },
      readCursorAdvanced: {
        eventUid: 'read-event-1', chatSessionUid: 'raw-chat-session', readerUserId: 20002,
        readSequence: 9, readAtMillis: 123456, eventAtMillis: 123457,
      },
    })

    await vi.waitFor(() => { expect(events).toHaveLength(1) })
    expect(events[0]).toMatchObject({
      type: 'read-receipts-invalidated', revision: 1, throughSequence: 9,
      sourceKey: expect.stringMatching(/^arkme-chat-source-v1\./),
    })
    expect(JSON.stringify(events[0])).not.toContain('raw-chat-session')
    expect(JSON.stringify(events[0])).not.toContain('20002')
    expect(JSON.stringify(events[0])).not.toContain('read-event-1')
    service.dispose()
  })

  it('refreshes the unread directory instead of emitting receipt data for the current user cursor', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const schedule = vi.spyOn(service, 'scheduleChatSessionProjection').mockImplementation(() => undefined)
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    service.handleChatRealtimeNotice({
      cause: 'hint',
      state: { revision: 2, connected: true, connectionGeneration: 1 },
      readCursorAdvanced: {
        eventUid: 'read-event-self', chatSessionUid: 'chat-self', readerUserId: 10001,
        readSequence: 12, readAtMillis: 123456, eventAtMillis: 123457,
      },
    })

    await vi.waitFor(() => { expect(schedule).toHaveBeenCalledWith('chat-self', 12) })
    expect(events).toEqual([])
    service.dispose()
  })
})
