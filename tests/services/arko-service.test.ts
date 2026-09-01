import { describe, expect, it } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ArkoService } from '../../src/services/arko-service.js'
import { LocalMessageActionCapabilityCodec } from '../../src/services/message-action-infrastructure.js'
import { MessageActionService } from '../../src/services/message-action-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

function messageActions(runtime: ServiceRuntime): MessageActionService {
  return new MessageActionService(
    {} as never,
    {} as never,
    new LocalMessageActionCapabilityCodec(async () => await runtime.stateStore.uniqueCode()),
  )
}

describe('ArkoService', () => {
  it('rejects an invalid model route before owner access', async () => {
    const sessions: ArkmeSessionStore = { async read() { return undefined }, async write() {}, async delete() {} }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const service = new ArkoService(runtime, new ProfileService(runtime))
    await expect(service.arkoActivateModel('../invalid')).rejects.toMatchObject({ code: 'arko-model-route-invalid' })
  })

  it('uses the client-compatible send time before the creation time for history activity', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    runtime.authenticatedIntelligentPost = async () => ({
      message_ls: [{
        id: 101,
        session_id: 88,
        role: 3,
        content: '最新回复',
        send_at: 1_786_000_100,
        created_at: 1_786_000_000,
        status: 1,
      }],
    })
    const service = new ArkoService(runtime, new ProfileService(runtime))

    await expect(service.arkoHistoryPage(10, 0)).resolves.toMatchObject({
      items: [{ text: '最新回复', createdAtMillis: 1_786_000_100_000 }],
    })
  })

  it('keeps empty history reads side-effect free even when no current Agent session is projected', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'arko-action-key' } } as StateStore)
    const paths: string[] = []
    runtime.authenticatedIntelligentPost = async path => {
      paths.push(path)
      return { message_ls: [] }
    }
    const actions = messageActions(runtime)
    const service = new ArkoService(runtime, new ProfileService(runtime), actions)

    await expect(service.arkoHistoryPage(10, 0)).resolves.toEqual({ items: [], hasMore: false })
    expect(paths).toEqual(['/api/v1/qa/message-list'])
  })

  it('does not bootstrap or cache a current session while projecting mixed historical Agent sessions', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'arko-action-key' } } as StateStore)
    const paths: string[] = []
    runtime.authenticatedIntelligentPost = async path => {
      paths.push(path)
      if (path.endsWith('/message-list')) return { message_ls: [
        { id: 90, session_id: 77, role: 3, content: '旧会话', send_at: 1_786_000_000, status: 1 },
        { id: 101, session_id: 88, role: 3, content: '当前会话', send_at: 1_786_000_100, status: 1 },
      ] }
      throw new Error(`unexpected path ${path}`)
    }
    const actions = messageActions(runtime)
    const service = new ArkoService(runtime, new ProfileService(runtime), actions)

    const page = await service.arkoHistoryPage(10, 0)

    expect(page.items.find(item => item.sessionId === 77)).toMatchObject({
      messageActionRef: expect.any(String),
      messageActionConversationRef: expect.stringContaining('arkme-agent-conversation-v2.'),
    })
    expect(page.items.find(item => item.sessionId === 88)).toMatchObject({
      messageActionRef: expect.any(String),
      messageActionConversationRef: expect.stringContaining('arkme-agent-conversation-v2.'),
    })
    expect(paths).toEqual(['/api/v1/qa/message-list'])
  })

  it('projects stable Agent action capabilities without reusing side-effect Record ids', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'arko-action-key' } } as StateStore)
    runtime.authenticatedIntelligentPost = async () => ({
      message_ls: [{
        id: 101, session_id: 88, role: 2, content: '用户问题', send_at: 1_786_000_100, status: 1,
        extra: { data: { entry_record_uid: 'entry-record' } },
        created_record_uids: ['side-effect-record'],
      }],
    })
    const actions = messageActions(runtime)
    const service = new ArkoService(runtime, new ProfileService(runtime), actions)

    await expect(service.arkoHistoryPage(10, 0)).resolves.toMatchObject({
      items: [{
        entryRecordUid: 'entry-record',
        createdRecordUids: ['side-effect-record'],
        messageActionRef: expect.any(String),
        messageActionCapabilities: { copyLink: true, forward: true },
      }],
    })
  })

  it('keeps each stable historical Agent message bound to its own owner session', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'arko-action-key' } } as StateStore)
    runtime.authenticatedIntelligentPost = async () => ({
      session_id: 88,
      message_ls: [
        { id: 90, session_id: 77, role: 3, content: '旧会话', send_at: 1_786_000_000, status: 1 },
        { id: 101, session_id: 88, role: 3, content: '当前会话', send_at: 1_786_000_100, status: 1 },
      ],
    })
    const actions = messageActions(runtime)
    const service = new ArkoService(runtime, new ProfileService(runtime), actions)
    const page = await service.arkoHistoryPage(10, 0)

    const oldSession = page.items.find(item => item.sessionId === 77)
    const currentSession = page.items.find(item => item.sessionId === 88)
    expect(oldSession).toMatchObject({
      messageActionRef: expect.any(String),
      messageActionConversationRef: expect.stringContaining('arkme-agent-conversation-v2.'),
    })
    expect(currentSession).toMatchObject({
      messageActionRef: expect.any(String),
      messageActionConversationRef: expect.stringContaining('arkme-agent-conversation-v2.'),
    })
    expect(oldSession?.messageActionConversationRef).not.toBe(currentSession?.messageActionConversationRef)
  })
})
