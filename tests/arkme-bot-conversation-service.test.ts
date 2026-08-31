import { describe, expect, it } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'

class SessionStore {
  constructor(private session: ArkmeSessionCredentials | undefined) {}
  async read() { return this.session }
  async write(session: ArkmeSessionCredentials) { this.session = session }
  async delete() { this.session = undefined }
}

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890',
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('BotConversationService', () => {
  it('keeps every Chat-owned operation on the canonical Chat source instead of the private Bot surface', async () => {
    const calls: string[] = []
    const service = new ArkmeService(
      config,
      new SessionStore({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }),
      { async uniqueCode() { return 'bot-conversation-device' } } as never,
      async input => {
        const url = String(input)
        calls.push(url)
        if (url.endsWith('/api/v1/bot/list')) return json({ code: 200, data: { bots: [{
          bot_id: 'bot-chat-1', name: 'Chat Bot', provider: 'openclaw', status: 'online',
          subject_uid: '', chat_session_uid: 'chat-session-1', direct_chat_owner: 'jotmo-chat',
        }] } })
        throw new Error(`unexpected request ${url}`)
      },
    )
    const bot = (await service.listBots()).items[0]!

    for (const operation of [
      () => service.openBotPrivateChat(bot.botRef),
      () => service.refreshBotPrivateChat(bot.botRef),
      () => service.sendBotPrivateChatMessage(bot.botRef, 'hello'),
      () => service.botNotificationPreference(bot.botRef),
      () => service.updateBotNotificationPreference(bot.botRef, true),
      () => service.markBotPrivateChatRead(bot.botRef, 7),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        code: 'bot-conversation-standard-chat-required', retryable: false,
      })
    }
    expect(calls).toEqual(['https://bot.test/api/v1/bot/list'])
  })

  it('keeps the private Bot directory Subject-only without per-item conversation reads', async () => {
    const calls: string[] = []
    const service = new ArkmeService(
      config,
      new SessionStore({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }),
      { async uniqueCode() { return 'bot-directory-device' } } as never,
      async input => {
        const url = String(input)
        calls.push(url)
        if (url.endsWith('/api/v1/bot/list')) return json({ code: 200, data: { bots: [
          {
            bot_id: 'bot-chat-directory', name: 'Chat Bot', provider: 'openclaw', status: 'online',
            subject_uid: '', chat_session_uid: 'chat-session-directory', direct_chat_owner: 'jotmo-chat',
          },
          {
            bot_id: 'bot-subject-directory', name: 'Subject Bot', provider: 'openclaw', status: 'online',
            subject_uid: 'subject-directory', chat_session_uid: '', direct_chat_owner: 'jotmo-subject',
            latest_activity_at: 1788100000456,
          },
        ] } })
        throw new Error(`unexpected request ${url}`)
      },
    )

    await expect(service.listBotPrivateChatDirectory()).resolves.toMatchObject({
      items: [{
        name: 'Subject Bot', conversationProjection: 'record', latestActivityAtMillis: 1788100000456,
      }],
    })
    expect(calls).toEqual(['https://bot.test/api/v1/bot/list'])
  })

  it('keeps Subject-owned Bot conversation reads on the Subject adapter', async () => {
    const calls: string[] = []
    const service = new ArkmeService(
      config,
      new SessionStore({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }),
      { async uniqueCode() { return 'bot-conversation-device' } } as never,
      async input => {
        const url = String(input)
        calls.push(url)
        if (url.endsWith('/api/v1/bot/list')) return json({ code: 200, data: { bots: [{
          bot_id: 'bot-subject-1', name: 'Subject Bot', provider: 'openclaw', status: 'online',
          subject_uid: 'subject-1', chat_session_uid: '', direct_chat_owner: 'jotmo-subject',
        }] } })
        if (url.endsWith('/api/v1/bot/private-chat/open')) return json({ code: 200, data: { messages: [] } })
        throw new Error(`unexpected request ${url}`)
      },
    )
    const bot = (await service.listBots()).items[0]!

    await expect(service.openBotPrivateChat(bot.botRef)).resolves.toEqual({ messages: [] })
    await expect(service.markBotPrivateChatRead(bot.botRef, 1)).rejects.toMatchObject({
      code: 'bot-conversation-read-unsupported',
    })
    expect(calls).toEqual([
      'https://bot.test/api/v1/bot/list',
      'https://bot.test/api/v1/bot/private-chat/open',
    ])
  })
})
