import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'

class BotTestSessionStore {
  constructor(public session: ArkmeSessionCredentials | undefined) {}
  async read() { return this.session }
  async write(session: ArkmeSessionCredentials) { this.session = session }
  async delete() { this.session = undefined }
}

const stateStore = {
  async uniqueCode() { return 'dsh-bot-test-device' },
} as never

const config: ArkmeServiceConfig = {
  environment: 'test',
  authBaseUrl: 'https://auth.test',
  subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test',
  chatBaseUrl: 'https://chat.test',
  botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test',
  webrtcBaseUrl: 'https://webrtc.test',
  worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test',
  intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api',
  audioBaseUrl: 'https://audio.test',
  requestTimeoutMs: 5000,
  maxTextLength: 20000,
  geetestCaptchaId: 'captcha-test-id-1234567890',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function groupSourceRef(
  userId: number,
  subjectUid: string,
  displayName: string,
  botGroupTarget?: { rmSubjectId?: number; subjectUid?: string },
): string {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    userId,
    kind: 'group_chat',
    ownerRef: subjectUid,
    displayName,
    ...(botGroupTarget === undefined ? {} : { botGroupTarget }),
  })).toString('base64url')
  const signature = createHmac('sha256', 'dsh-bot-test-device').update(payload).digest('base64url')
  return `arkme-source-v1.${payload}.${signature}`
}

describe('ArkmeService Bot owner adapter', () => {
  it('invalidates Provider-held Bot handles on logout before the same account can reuse them', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      if (String(input).endsWith('/api/v1/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'logout-private-bot', name: '退出测试', provider: 'webhook', status: 'online',
      }] } })
      throw new Error(`unexpected request ${String(input)}`)
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    await service.logout()
    sessions.session = { userId: 10001, accessToken: 'next-access', refreshToken: 'next-refresh' }

    await expect(service.openBotChat(botRef)).rejects.toMatchObject({ code: 'bot-ref-expired' })
  })

  it('lists owner Bots as account-bound opaque references without exposing owner IDs or token previews', async () => {
    const requests: Array<{ url: string; authorization: string; body: unknown }> = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('Authorization') ?? '',
        body: JSON.parse(String(init?.body)) as unknown,
      })
      return json({
        code: 200,
        data: {
          bots: [{
            bot_id: 'bot-owner-id-1', name: '群聊总结', provider: 'openclaw', description: '总结群聊',
            avatar: '', status: 'offline', subject_uid: 'subject-1', chat_session_uid: '', token_preview: 'jbot_***',
          }],
        },
      })
    })

    const result = await service.listBots()

    expect(requests).toEqual([{
      url: 'https://bot.test/api/v1/bot/list',
      authorization: 'Bearer access',
      body: {},
    }])
    expect(result).toEqual({
      items: [{
        botRef: expect.stringMatching(/^arkme-bot-v2\./),
        directoryKey: expect.stringMatching(/^arkme-bot-directory-v1\./),
        name: '群聊总结',
        provider: 'openclaw',
        description: '总结群聊',
        status: 'offline',
        directChatAvailable: true,
        privateChatOutboundEnabled: true,
        refreshOnRecordChanges: true,
        conversationProjection: 'record',
      }],
    })
    expect(JSON.stringify(result)).not.toContain('bot-owner-id-1')
    expect(JSON.stringify(result)).not.toContain('jbot_')
  })

  it('keeps the Bot creation time in the browser-safe list projection', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async () => json({
      code: 200,
      data: { bots: [{
        bot_id: 'bot-owner-id-created-at', name: '按时间排序', provider: 'openclaw', description: '', status: 'offline',
        subject_uid: 'subject-created-at', chat_session_uid: '', created_at: 1_788_000_000_000_000,
      }] },
    }))

    const result = await service.listBots()

    expect(result.items[0]).toMatchObject({ name: '按时间排序', createdAtMillis: 1_788_000_000_000 })
  })

  it('hydrates the Bot conversation directory with each latest private-chat message', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      const url = String(input)
      if (url.endsWith('/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'bot-owner-id-directory', name: '目录 Bot', provider: 'openclaw', description: '', status: 'offline',
        subject_uid: 'subject-directory', chat_session_uid: '', created_at: 1_788_000_000_000_000,
      }] } })
      if (url.endsWith('/private-chat/open')) return json({ code: 200, data: { messages: [
        { role: 'assistant', content: '较早消息', created_at: 1_788_000_100_000_000 },
        { role: 'user', content: '最新消息', created_at: 1_788_000_200_000_000 },
      ] } })
      throw new Error(`unexpected request ${url}`)
    })

    const result = await service.listBotPrivateChatDirectory()

    expect(result.items[0]).toMatchObject({
      name: '目录 Bot', createdAtMillis: 1_788_000_000_000,
      latestMessageAtMillis: 1_788_000_200_000, latestMessagePreview: '最新消息',
    })
  })

  it('projects owned OpenClaw and Webhook Bots without exposing raw IDs', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async () => json({
      code: 200,
      data: {
        bots: [
          {
            bot_id: 'openclaw-raw-1', name: '本地助手', provider: 'openclaw', description: '',
            status: 'online', subject_uid: 'subject-openclaw', chat_session_uid: '',
          },
          {
            bot_id: 'webhook-raw-1', name: '回调测试', provider: 'webhook', description: '',
            status: 'default', subject_uid: 'subject-webhook', chat_session_uid: '',
          },
        ],
      },
    }))

    const result = await service.listBots()

    expect(result.items.map(item => [
      item.name, item.provider, item.status, item.privateChatOutboundEnabled, item.conversationProjection,
    ])).toEqual([
      ['本地助手', 'openclaw', 'online', true, 'record'],
      ['回调测试', 'webhook', 'unknown', false, 'record'],
    ])
    expect(JSON.stringify(result)).not.toContain('openclaw-raw-1')
    expect(JSON.stringify(result)).not.toContain('webhook-raw-1')
  })

  it('classifies Subject and Chat owners only from mutually exclusive owner evidence', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async () => json({
      code: 200,
      data: { bots: [
        { bot_id: 'subject', name: 'Subject', provider: 'webhook', subject_uid: 'subject-1', chat_session_uid: '' },
        { bot_id: 'chat', name: 'Chat', provider: 'webhook', subject_uid: '', chat_session_uid: 'chat-1' },
        { bot_id: 'conflict', name: 'Conflict', provider: 'openclaw', subject_uid: 'subject-2', chat_session_uid: 'chat-2' },
        { bot_id: 'missing', name: 'Missing', provider: 'openclaw', subject_uid: '', chat_session_uid: '' },
      ] },
    }))

    const result = await service.listBots()

    expect(result.items.map(item => [
      item.name, item.directChatAvailable, item.privateChatOutboundEnabled, item.conversationProjection,
    ])).toEqual([
      ['Subject', true, false, 'record'],
      ['Chat', true, true, 'chat'],
      ['Conflict', false, false, 'none'],
      ['Missing', false, false, 'none'],
    ])
    expect(result.items[1]).toMatchObject({ chatSourceKey: expect.stringMatching(/^arkme-chat-source-v1\./) })
    expect(result.items[0]).not.toHaveProperty('chatSourceKey')
    expect(JSON.stringify(result)).not.toContain('jotmo-subject')
    expect(JSON.stringify(result)).not.toContain('jotmo-chat')
    expect(JSON.stringify(result)).not.toContain('conversationOwner')
  })

  it('fails closed only the Bots that share one Chat target', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async () => json({
      code: 200,
      data: { bots: [
        { bot_id: 'chat-a', name: 'Chat A', provider: 'webhook', subject_uid: '', chat_session_uid: 'shared-chat' },
        { bot_id: 'chat-b', name: 'Chat B', provider: 'webhook', subject_uid: '', chat_session_uid: 'shared-chat' },
        { bot_id: 'chat-c', name: 'Chat C', provider: 'webhook', subject_uid: '', chat_session_uid: 'shared-with-malformed' },
        { bot_id: 'malformed-chat', name: '', provider: 'webhook', subject_uid: '', chat_session_uid: 'shared-with-malformed' },
        { bot_id: 'subject', name: 'Subject', provider: 'openclaw', subject_uid: 'subject-1', chat_session_uid: '' },
      ] },
    }))

    const result = await service.listBots()

    expect(result.items.map(item => [item.name, item.directChatAvailable, item.conversationProjection])).toEqual([
      ['Chat A', false, 'none'],
      ['Chat B', false, 'none'],
      ['Chat C', false, 'none'],
      ['Subject', true, 'record'],
    ])
    expect(result.items.every(item => item.chatSourceKey === undefined)).toBe(true)
  })

  it('ignores non-canonical Chat owner aliases instead of guessing a target', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async () => json({
      code: 200,
      data: { bots: [{
        bot_id: 'alias-chat', name: 'Alias Chat', provider: 'webhook', subject_uid: '', chatSessionUid: 'chat-alias',
      }] },
    }))

    await expect(service.listBots()).resolves.toMatchObject({
      items: [{ directChatAvailable: false, conversationProjection: 'none' }],
    })
  })

  it('fails closed before opening a Bot whose owner evidence conflicts', async () => {
    const requests: string[] = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      requests.push(String(input))
      return json({ code: 200, data: { bots: [{
        bot_id: 'conflict', name: 'Conflict', provider: 'openclaw', subject_uid: 'subject-1', chat_session_uid: 'chat-1',
      }] } })
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    await expect(service.openBotPrivateChat(botRef)).rejects.toMatchObject({ code: 'bot-conversation-owner-unavailable' })
    expect(requests.every(url => url.endsWith('/api/v1/bot/list'))).toBe(true)
  })

  it('creates only an OpenClaw Bot and keeps the returned token behind a non-serializable secret boundary', async () => {
    const requests: Array<{ body: unknown }> = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (_input, init) => {
      requests.push({ body: JSON.parse(String(init?.body)) as unknown })
      return json({
        code: 200,
        data: {
          bot: {
            bot_id: 'bot-owner-id-2', name: '八卦雷达', provider: 'openclaw', description: '高亮八卦',
            avatar: '', status: 'offline', subject_uid: 'subject-2', chat_session_uid: '', token_preview: 'jbot_***',
          },
          token_info: { token: 'jbot_full_secret', token_preview: 'jbot_***', issued_at: 123 },
          gateway_url: 'wss://bot.test/api/v1/bot/gateway',
        },
      })
    })

    const result = await service.createBot({
      name: ' 八卦雷达 ', provider: 'openclaw', description: ' 高亮八卦 ', avatar: 'file_asset://avatar-asset-1',
    })

    expect(requests).toEqual([{ body: {
      name: '八卦雷达', provider: 'openclaw', description: '高亮八卦', avatar: 'file_asset://avatar-asset-1',
    } }])
    expect(result.bot).toMatchObject({
      botRef: expect.stringMatching(/^arkme-bot-v2\./),
      name: '八卦雷达',
      provider: 'openclaw',
    })
    expect(result.secret.reveal()).toBe('jbot_full_secret')
    expect(JSON.stringify(result.secret)).toBe('{}')
    expect(JSON.stringify(result.bot)).not.toContain('jbot_')
    expect(JSON.stringify(result.bot)).not.toContain('bot-owner-id-2')
  })

  it('rejects a non-file-asset Bot avatar before making a remote request', async () => {
    const requests: string[] = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      requests.push(String(input))
      return json({ code: 200, data: {} })
    })

    await expect(service.createBot({
      name: '错误头像', provider: 'openclaw', avatar: 'https://untrusted.example/avatar.png',
    })).rejects.toMatchObject({ code: 'bot-avatar-invalid' })
    expect(requests).toEqual([])
  })

  it('creates a Webhook Bot without exposing its raw ID, token, or Webhook URL', async () => {
    const requests: Array<{ body: unknown }> = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (_input, init) => {
      requests.push({ body: JSON.parse(String(init?.body)) as unknown })
      return json({
        code: 200,
        data: {
          bot: {
            bot_id: 'webhook-owner-id-1', name: '回调测试', provider: 'webhook', description: '验证回调',
            avatar: '', status: 'default', subject_uid: 'subject-webhook', chat_session_uid: '', token_preview: 'jbot_***',
          },
          token_info: { token: 'jbot_webhook_secret', token_preview: 'jbot_***', issued_at: 123 },
          webhook_url: 'https://bot.test/api/public/v1/bot/webhook/webhook-owner-id-1',
        },
      })
    })

    const result = await service.createBot({
      name: ' 回调测试 ', provider: 'webhook', description: ' 验证回调 ',
    })

    expect(requests).toEqual([{ body: {
      name: '回调测试', provider: 'webhook', description: '验证回调', avatar: '',
    } }])
    expect(result.bot).toMatchObject({
      botRef: expect.stringMatching(/^arkme-bot-v2\./),
      name: '回调测试',
      provider: 'webhook',
    })
    expect(result.secret.reveal()).toBe('jbot_webhook_secret')
    expect(JSON.stringify(result.secret)).toBe('{}')
    expect(JSON.stringify(result.bot)).not.toContain('webhook-owner-id-1')
    expect(JSON.stringify(result.bot)).not.toContain('jbot_')
    expect(JSON.stringify(result.bot)).not.toContain('webhook_url')
  })

  it('does not retry Bot creation when the remote outcome is unknown', async () => {
    let attempts = 0
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async () => {
      attempts += 1
      throw new TypeError('connection reset')
    })

    await expect(service.createBot({ name: '只创建一次', provider: 'openclaw' })).rejects.toMatchObject({
      code: 'bot-create-outcome-unknown',
      retryable: false,
    })
    expect(attempts).toBe(1)
  })

  it('rejects tampered and cross-account Bot references before revealing a secret', async () => {
    const requests: string[] = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      requests.push(String(input))
      if (String(input).endsWith('/list')) {
        return json({ code: 200, data: { bots: [{
          bot_id: 'bot-owner-id-3', name: '总结', provider: 'openclaw', description: '', status: 'offline',
          subject_uid: 'subject-3', chat_session_uid: '',
        }] } })
      }
      return json({ code: 200, data: { token: 'jbot_revealed_secret', token_preview: 'jbot_***', issued_at: 123 } })
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    await expect(service.revealBotSecret(`${botRef.slice(0, -1)}x`)).rejects.toMatchObject({
      code: 'bot-ref-invalid',
    })
    sessions.session = { userId: 20002, accessToken: 'other-access', refreshToken: 'other-refresh' }
    await expect(service.revealBotSecret(botRef)).rejects.toMatchObject({ code: 'bot-ref-account-mismatch' })
    expect(requests).toHaveLength(1)
  })

  it('reveals an owner Bot token only as SecretValue', async () => {
    const requestBodies: unknown[] = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input, init) => {
      const body = JSON.parse(String(init?.body)) as unknown
      requestBodies.push(body)
      if (String(input).endsWith('/list')) {
        return json({ code: 200, data: { bots: [{
          bot_id: 'bot-owner-id-4', name: '总结', provider: 'openclaw', description: '', status: 'offline',
          subject_uid: 'subject-4', chat_session_uid: '',
        }] } })
      }
      return json({ code: 200, data: { token: 'jbot_revealed_secret', token_preview: 'jbot_***', issued_at: 123 } })
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    const secret = await service.revealBotSecret(botRef)

    expect(requestBodies).toEqual([{}, { bot_id: 'bot-owner-id-4' }])
    expect(secret.reveal()).toBe('jbot_revealed_secret')
    expect(JSON.stringify(secret)).toBe('{}')
  })

  it('manages Bot profile, notification preference, credential reveal, and deletion through owner-only endpoints', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    let name = '管理 Bot'
    let description = '旧简介'
    let ablePush = true
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'bot-manage-owner-id', name, provider: 'webhook', description, status: 'online', subject_uid: 'bot-subject-id',
      }] } })
      if (url.endsWith('/bot/profile')) return json({ code: 200, data: {
        gateway_url: 'wss://bot.test/gateway', webhook_url: 'https://bot.test/webhook', token_reveal_enabled: true,
        joined_groups: [{ subject_title: '产品群', installed_at: 1_788_000_100_000_000 }],
        bot: {
          bot_id: 'bot-manage-owner-id', name, provider: 'webhook', description, status: 'online', subject_uid: 'bot-subject-id',
          token_preview: 'jbot_***abcd', can_reveal_token: true, record_count: 12,
          webhook_security: { keyword_enabled: true, keyword: 'arkme', token_enabled: true, ip_whitelist_enabled: true, ip_whitelist: ['127.0.0.1'] },
        },
      } })
      if (url.endsWith('/bot/update')) {
        name = String(body.name); description = String(body.description)
        return json({ code: 200, data: {} })
      }
      if (url.endsWith('/token/reveal')) return json({ code: 200, data: { token: 'jbot_managed_secret' } })
      if (url.endsWith('/subject/get-able-push-status')) return json({ code: 200, data: { able_push: ablePush } })
      if (url.endsWith('/subject/set-able-push-status')) { ablePush = body.able_push === true; return json({ code: 200, data: {} }) }
      if (url.endsWith('/bot/delete')) return json({ code: 200, data: {} })
      throw new Error(`unexpected request ${url}`)
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    await expect(service.manageBotProfile(botRef)).resolves.toMatchObject({
      name: '管理 Bot', gatewayUrl: 'wss://bot.test/gateway', webhookUrl: 'https://bot.test/webhook',
      recordCount: 12, joinedGroups: [{ title: '产品群', installedAtMillis: 1_788_000_100_000 }],
      webhookSecurity: { keywordEnabled: true, keyword: 'arkme', tokenEnabled: true, ipWhitelistEnabled: true, ipWhitelist: ['127.0.0.1'] },
    })
    await expect(service.updateManagedBot(botRef, {
      name: '更新后的 Bot', description: '新简介', webhookSecurity: {
        keywordEnabled: false, keyword: '', tokenEnabled: false, ipWhitelistEnabled: false, ipWhitelist: [],
      },
    })).resolves.toMatchObject({ name: '更新后的 Bot', description: '新简介' })
    await expect(service.botNotificationPreference(botRef)).resolves.toEqual({ muted: false })
    await expect(service.updateBotNotificationPreference(botRef, true)).resolves.toEqual({ muted: true })
    await expect(service.revealManagedBotToken(botRef)).resolves.toEqual({ token: 'jbot_managed_secret' })
    await expect(service.deleteManagedBot(botRef, '更新后的 Bot')).resolves.toBeUndefined()
    expect(requests).toContainEqual({
      url: 'https://bot.test/api/v1/bot/update',
      body: {
        bot_id: 'bot-manage-owner-id', name: '更新后的 Bot', description: '新简介', avatar: '',
        webhook_security: { keyword_enabled: false, keyword: '', token_enabled: false, ip_whitelist_enabled: false, ip_whitelist: [] },
      },
    })
    expect(requests).toContainEqual({
      url: 'https://subject.test/api/v1/subject/set-able-push-status',
      body: { subject_uid: 'bot-subject-id', able_push: false },
    })
    expect(requests).toContainEqual({ url: 'https://bot.test/api/v1/bot/delete', body: { bot_id: 'bot-manage-owner-id' } })
  })

  it('preserves the canonical Chat target when profile and update projections omit owner fields', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    let name = 'Chat Bot'
    const service = new ArkmeService(config, sessions, stateStore, async (input, init) => {
      const url = String(input)
      if (url.endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'chat-profile-bot', name, provider: 'webhook', description: '', status: 'online',
        subject_uid: '', chat_session_uid: 'chat-profile-session',
      }] } })
      if (url.endsWith('/bot/profile')) return json({ code: 200, data: { bot: {
        bot_id: 'chat-profile-bot', name, provider: 'webhook', description: '', status: 'online',
      } } })
      if (url.endsWith('/bot/update')) {
        name = String((JSON.parse(String(init?.body)) as Record<string, unknown>).name)
        return json({ code: 200, data: {} })
      }
      throw new Error(`unexpected request ${url}`)
    })
    const listed = (await service.listBots()).items[0]!

    const managed = await service.manageBotProfile(listed.botRef)
    const updated = await service.updateManagedBot(listed.botRef, { name: '更新后的 Chat Bot', description: '' })

    for (const item of [managed, updated]) {
      expect(item).toMatchObject({
        botRef: listed.botRef,
        directChatAvailable: true,
        privateChatOutboundEnabled: true,
        conversationProjection: 'chat',
        chatSourceKey: listed.chatSourceKey,
      })
    }
    await expect(service.openBotRef(listed.botRef, 10001)).resolves.toMatchObject({
      target: { kind: 'chat', chatSessionUid: 'chat-profile-session' },
    })
  })

  it('validates Bot ownership before delegating the local OpenClaw connection', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      if (String(input).endsWith('/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'bot-owner-id-connect', name: '总结', provider: 'openclaw', description: '', status: 'offline',
        subject_uid: 'subject-connect', chat_session_uid: '',
      }] } })
      if (String(input).endsWith('/profile')) return json({ code: 200, data: { gateway_url: 'wss://bot.test/ws/v1/bot/gateway', bot: { token_preview: 'jbot_co...cret' } } })
      return json({ code: 200, data: { token: 'jbot_connect_secret' } })
    })
    const botRef = (await service.listBots()).items[0]!.botRef
    let revealed = ''
    service.attachOpenClawProvisioner({
      async reconcile(input: { botRef: string; allowGatewayRestart?: boolean; resolveConnectionMetadata: () => Promise<{ gatewayUrl: string; tokenPreview: string }>; revealSecret: () => Promise<{ reveal(): string }> }) {
        revealed = (await input.revealSecret()).reveal()
        expect(await input.resolveConnectionMetadata()).toEqual({ gatewayUrl: 'wss://bot.test/ws/v1/bot/gateway', tokenPreview: 'jbot_co...cret' })
        expect(input).toMatchObject({ botRef, allowGatewayRestart: true })
        return { status: 'connected_unverified', resource_ref: 'openclaw.bot.v1.test' } as const
      },
    } as never)

    await expect(service.connectOpenClawBot(botRef)).resolves.toEqual({
      status: 'connected_unverified', resource_ref: 'openclaw.bot.v1.test',
    })
    expect(revealed).toBe('jbot_connect_secret')
    await expect(service.connectOpenClawBot('arkme-bot-v1.not-owned')).rejects.toMatchObject({ code: 'bot-ref-not-owned' })
  })

  it('rejects a Webhook Bot before accessing the OpenClaw provisioner or profile', async () => {
    const requests: string[] = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      requests.push(String(input))
      return json({ code: 200, data: { bots: [{
        bot_id: 'webhook-connect-id', name: '回调测试', provider: 'webhook', description: '', status: 'default',
        subject_uid: 'subject-webhook', chat_session_uid: '',
      }] } })
    })
    const botRef = (await service.listBots()).items[0]!.botRef
    const reconcile = async () => {
      throw new Error('Webhook Bot must not enter OpenClaw reconciliation')
    }
    service.attachOpenClawProvisioner({ reconcile } as never)

    await expect(service.connectOpenClawBot(botRef)).rejects.toMatchObject({
      code: 'bot-provider-mismatch',
      retryable: false,
    })
    expect(requests).toEqual([
      'https://bot.test/api/v1/bot/list',
      'https://bot.test/api/v1/bot/list',
    ])
  })

  it('opens a Chat-owned Bot private session as a reusable opaque source', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as unknown
      calls.push({ url, body })
      if (url.endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'bot-owner-id-chat', name: '总结 Bot', provider: 'openclaw', description: '', status: 'offline',
        subject_uid: '', chat_session_uid: 'chat-session-owner-id',
      }] } })
      return json({ code: 200, data: { session_id: 'chat-session-owner-id', chat_session_uid: 'chat-session-owner-id', messages: [] } })
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    const source = await service.openBotChat(botRef)

    expect(calls.at(-1)).toEqual({
      url: 'https://bot.test/api/v1/bot/private-chat/open',
      body: { bot_id: 'bot-owner-id-chat' },
    })
    expect(source).toMatchObject({
      sourceRef: expect.stringMatching(/^arkme-source-v1\./),
      kind: 'private_chat',
      displayName: '总结 Bot',
      activeAtMillis: 0,
      unreadCount: 0,
    })
    expect(JSON.stringify(source)).not.toContain('chat-session-owner-id')
    expect(JSON.stringify(source)).not.toContain('bot-owner-id-chat')
  })

  it('rejects a legacy Bot session id instead of resolving a compatibility route', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as unknown
      calls.push({ url, body })
      if (url.endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'bot-owner-id-legacy-chat', name: '旧协议 Bot', provider: 'openclaw', description: '', status: 'offline',
        subject_uid: '', chat_session_uid: 'chat-session-owner-id-legacy',
      }] } })
      if (url.endsWith('/bot/private-chat/open')) return json({ code: 200, data: {
        session_id: 'chat-session-owner-id-legacy', messages: [],
      } })
      if (url.endsWith('/api/v1/chats/list')) return json({ code: 200, data: { items: [{
        session: { chat_session_uid: 'chat-session-owner-id-legacy', session_kind: 1 },
        private_counterpart: { display_name_snapshot: '旧协议 Bot' },
        unread_snapshot: { unread_count: 0 },
      }], has_more: false } })
      throw new Error(`unexpected request ${url}`)
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    await expect(service.openBotChat(botRef)).rejects.toMatchObject({ code: 'bot-chat-source-unavailable' })

    expect(calls.map(call => call.url)).toEqual([
      'https://bot.test/api/v1/bot/list',
      'https://bot.test/api/v1/bot/list',
      'https://bot.test/api/v1/bot/private-chat/open',
    ])
  })

  it('rejects nested Chat session aliases from the Bot ensure response', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input) => {
      if (String(input).endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'bot-owner-id-nested-chat', name: '嵌套会话 Bot', provider: 'openclaw', description: '', status: 'online',
        subject_uid: '', chat_session_uid: 'chat-session-owner-id-nested',
      }] } })
      return json({ code: 200, data: {
        private_chat_session: { uid: 'chat-session-owner-id-nested' }, messages: [],
      } })
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    await expect(service.openBotChat(botRef)).rejects.toMatchObject({ code: 'bot-chat-source-unavailable' })
  })

  it('fails closed when legacy Bot private chat cannot use generic source read/send', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      if (String(input).endsWith('/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'bot-owner-id-legacy', name: 'Legacy Bot', provider: 'openclaw', description: '', status: 'offline',
      }] } })
      return json({ code: 200, data: { session_id: 'bot-owner-id-legacy', messages: [] } })
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    await expect(service.openBotChat(botRef)).rejects.toMatchObject({ code: 'bot-chat-source-unavailable' })
  })

  it('uses the Subject Bot message contract, preserves safe message metadata, and invalidates Record projection', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'bot-owner-id-direct', name: '直连 Bot', provider: 'openclaw', description: '', status: 'online',
        subject_uid: 'subject-direct', chat_session_uid: '',
      }] } })
      if (url.endsWith('/private-chat/open')) {
        const message = {
          message_id: 'message-1', record_uid: 'record-1', role: 'assistant', content: ' 你好 ', created_at: 1,
          attachments: [{
            kind: 'audio', file_id: 'private-file-id', file_name: 'reply.m4a', mime_type: 'audio/mp4',
            size: 12, duration_ms: 3200, width: 0, height: 0, order: 2,
          }, { file_id: 'private-file-only-id' }],
        }
        return json({ code: 200, data: { session_id: 'legacy-session-private', messages: [message, message] } })
      }
      if (url.endsWith('/private-chat/message/send')) return json({ code: 200, data: {
        session_id: 'legacy-session-private', status: 'ok',
        user_message: { message_id: 'message-2', role: 'user', content: '测试', created_at: 2 },
        bot_message: { message_id: 'message-3', role: 'assistant', content: '收到', created_at: 3 },
      } })
      throw new Error(`unexpected request ${url}`)
    })
    const botRef = (await service.listBots()).items[0]!.botRef
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    const conversation = await service.openBotPrivateChat(botRef)
    const sent = await service.sendBotPrivateChatMessage(botRef, ' 测试 ')

    expect(conversation).toMatchObject({ messages: [{
      messageId: 'message-1', recordUid: 'record-1', role: 'assistant', content: ' 你好 ', createdAtMillis: 1000,
      attachments: [{
        kind: 'audio', fileName: 'reply.m4a', mimeType: 'audio/mp4', size: 12,
        durationMillis: 3200, width: 0, height: 0, sortOrder: 2,
      }, {
        kind: 'file', fileName: '', mimeType: '', size: 0,
        durationMillis: 0, width: 0, height: 0, sortOrder: 0,
      }],
    }] })
    expect(sent).toMatchObject({
      status: 'ok',
      userMessage: { messageId: 'message-2', role: 'user', content: '测试', createdAtMillis: 2000 },
      botMessages: [{ messageId: 'message-3', role: 'assistant', content: '收到', createdAtMillis: 3000 }],
    })
    expect(requests.at(-1)).toEqual({
      url: 'https://bot.test/api/v1/bot/private-chat/message/send',
      body: { bot_id: 'bot-owner-id-direct', content: '测试' },
    })
    expect(requests.map(request => request.url)).toEqual([
      'https://bot.test/api/v1/bot/list',
      'https://bot.test/api/v1/bot/private-chat/open',
      'https://bot.test/api/v1/bot/private-chat/message/send',
    ])
    expect(JSON.stringify({ conversation, sent })).not.toContain('bot-owner-id-direct')
    expect(JSON.stringify({ conversation, sent })).not.toContain('legacy-session-private')
    expect(JSON.stringify({ conversation, sent })).not.toContain('private-file-id')
    expect(JSON.stringify({ conversation, sent })).not.toContain('private-file-only-id')
    expect(JSON.stringify({ conversation, sent })).not.toContain('conversationOwner')
    expect(events).toEqual([expect.objectContaining({ type: 'projection-invalidated', projection: 'record' })])
  })

  it('deduplicates the singular Bot reply projection against the Bot reply list by message identity', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      if (String(input).endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'subject-bot', name: 'Subject Bot', provider: 'openclaw', subject_uid: 'subject-1', chat_session_uid: '',
      }] } })
      const reply = { message_id: 'reply-1', role: 'assistant', content: '唯一回复', created_at: 3 }
      return json({ code: 200, data: {
        status: 'ok',
        user_message: { message_id: 'message-1', role: 'user', content: '测试', created_at: 2 },
        bot_messages: [reply],
        bot_message: reply,
      } })
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    const sent = await service.sendBotPrivateChatMessage(botRef, '测试')

    expect(sent.botMessages.map(message => message.messageId)).toEqual(['reply-1'])
  })

  it('does not collapse distinct history entries when the upstream omitted message identity', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      if (String(input).endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'subject-bot', name: 'Subject Bot', provider: 'openclaw', subject_uid: 'subject-1', chat_session_uid: '',
      }] } })
      return json({ code: 200, data: { messages: [
        { role: 'assistant', content: '同一时刻的两条消息', created_at: 3 },
        { role: 'assistant', content: '同一时刻的两条消息', created_at: 3 },
      ] } })
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    const conversation = await service.openBotPrivateChat(botRef)

    expect(conversation.messages).toHaveLength(2)
  })

  it('does not emit a Subject Record invalidation for a Chat-owned Bot send', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input, init) => {
      if (String(input).endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'chat-bot', name: 'Chat Bot', provider: 'webhook', subject_uid: '', chat_session_uid: 'chat-1',
      }] } })
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return json({ code: 200, data: {
        chat_session_uid: 'chat-1', record_uid: body.record_uid, rel_uid: body.rel_uid, seq: 1, audit_status: 1,
      } })
    })
    const botRef = (await service.listBots()).items[0]!.botRef
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    const sent = await service.sendBotPrivateChatMessage(botRef, '测试')
    expect(sent).not.toHaveProperty('conversationOwner')
    expect(events).toEqual([])
  })

  it('rejects an outbound Subject Webhook message before calling the write endpoint', async () => {
    const requests: string[] = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      requests.push(String(input))
      if (String(input).endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'subject-webhook', name: 'Webhook', provider: 'webhook', subject_uid: 'subject-1', chat_session_uid: '',
      }] } })
      return json({ code: 200, data: {
        status: 'ok', user_message: { message_id: 'message-1', role: 'user', content: '测试', created_at: 2 },
      } })
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    await expect(service.sendBotPrivateChatMessage(botRef, '测试')).rejects.toMatchObject({
      code: 'bot-conversation-send-unsupported', retryable: false,
    })
    expect(requests.filter(url => url.endsWith('/private-chat/message/send'))).toHaveLength(0)
  })

  it('reports an unknown Subject send outcome without retrying the write', async () => {
    const requests: string[] = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      requests.push(String(input))
      if (String(input).endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'subject-bot', name: 'Subject Bot', provider: 'openclaw', subject_uid: 'subject-1', chat_session_uid: '',
      }] } })
      throw new TypeError('connection reset after request write')
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    await expect(service.sendBotPrivateChatMessage(botRef, '测试')).rejects.toMatchObject({
      code: 'bot-conversation-send-outcome-unknown', retryable: false,
    })
    expect(requests.filter(url => url.endsWith('/private-chat/message/send'))).toHaveLength(1)
  })

  it('treats a retryable server failure as an unknown send outcome without retrying', async () => {
    const requests: string[] = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      requests.push(String(input))
      if (String(input).endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'subject-bot', name: 'Subject Bot', provider: 'openclaw', subject_uid: 'subject-1', chat_session_uid: '',
      }] } })
      return json({ code: 500, message: 'temporary failure' }, 500)
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    await expect(service.sendBotPrivateChatMessage(botRef, '测试')).rejects.toMatchObject({
      code: 'bot-conversation-send-outcome-unknown', retryable: false,
    })
    expect(requests.filter(url => url.endsWith('/private-chat/message/send'))).toHaveLength(1)
  })

  it('keeps the existing Chat-owned send failure contract outside the Subject adapter', async () => {
    const requests: string[] = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      requests.push(String(input))
      if (String(input).endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'chat-bot', name: 'Chat Bot', provider: 'webhook', subject_uid: '', chat_session_uid: 'chat-1',
      }] } })
      throw new TypeError('chat transport failed')
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    await expect(service.sendBotPrivateChatMessage(botRef, '测试')).rejects.toMatchObject({
      code: 'bot-conversation-send-outcome-unknown', retryable: false,
    })
    expect(requests.filter(url => url.endsWith('/chats/records/send'))).toHaveLength(1)
  })

  it('does not fabricate a confirmed Subject message when the write response has no message identity', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      if (String(input).endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'subject-bot', name: 'Subject Bot', provider: 'openclaw', subject_uid: 'subject-1', chat_session_uid: '',
      }] } })
      return json({ code: 200, data: { status: 'ok' } })
    })
    const botRef = (await service.listBots()).items[0]!.botRef
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    await expect(service.sendBotPrivateChatMessage(botRef, '测试')).rejects.toMatchObject({
      code: 'bot-conversation-send-outcome-unknown', retryable: false,
    })
    expect(events).toEqual([])
  })

  it('does not let a group-list projection overwrite the direct conversation owner', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      const url = String(input)
      if (url.endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'shared-bot', name: '共享 Bot', provider: 'openclaw', subject_uid: 'subject-direct', chat_session_uid: '',
      }] } })
      if (url.endsWith('/group/list')) return json({ code: 200, data: {
        subject_uid: 'group-1', subject_title: '群聊', can_current_user_add_bots: true,
        bots: [{ bot_id: 'shared-bot', name: '共享 Bot', provider: 'openclaw', installed: true }],
      } })
      if (url.endsWith('/private-chat/message/send')) return json({ code: 200, data: {
        status: 'ok', user_message: { message_id: 'message-1', role: 'user', content: '测试', created_at: 2 },
      } })
      throw new Error(`unexpected request ${url}`)
    })
    const botRef = (await service.listBots()).items[0]!.botRef

    await service.listGroupBots(groupSourceRef(10001, 'group-1', '群聊', { rmSubjectId: 88001 }))

    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    const sent = await service.sendBotPrivateChatMessage(botRef, '测试')

    expect(sent).not.toHaveProperty('conversationOwner')
    expect(events).toEqual([expect.objectContaining({ type: 'projection-invalidated', projection: 'record' })])
  })

  it('hydrates owner evidence before opening Chat when the Bot reference came from a group projection', async () => {
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      const url = String(input)
      if (url.endsWith('/group/list')) return json({ code: 200, data: {
        subject_uid: 'group-1', subject_title: '群聊', can_current_user_add_bots: true,
        bots: [{ bot_id: 'chat-bot', name: 'Chat Bot', provider: 'openclaw', installed: true }],
      } })
      if (url.endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'chat-bot', name: 'Chat Bot', provider: 'openclaw', subject_uid: '', chat_session_uid: 'chat-1',
      }] } })
      if (url.endsWith('/private-chat/open')) return json({ code: 200, data: {
        chat_session_uid: 'chat-1', messages: [],
      } })
      throw new Error(`unexpected request ${url}`)
    })
    const group = await service.listGroupBots(groupSourceRef(10001, 'group-1', '群聊', { rmSubjectId: 88001 }))

    const source = await service.openBotChat(group.items[0]!.botRef)

    expect(source).toMatchObject({ kind: 'private_chat', displayName: 'Chat Bot' })
  })

  it('lists, installs, and removes a Bot using only opaque Bot and group references', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    let installed = false
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as unknown
      calls.push({ url, body })
      if (url.endsWith('/bot/list')) {
        return json({ code: 200, data: { bots: [{
          bot_id: 'bot-owner-id-5', name: '群聊总结', provider: 'OpenClaw', description: '总结', status: 'offline',
          subject_uid: 'direct-5', chat_session_uid: '',
        }] } })
      }
      if (url.endsWith('/group/list')) {
        return json({ code: 200, data: {
          subject_uid: 'group-session-1', subject_title: '研发群', can_current_user_add_bots: true,
          bots: [{
            bot_id: 'bot-owner-id-5', name: '群聊总结', provider: 'OpenClaw', description: '总结', status: 'offline',
            installed,
          }],
        } })
      }
      if (url.endsWith('/group/add')) installed = true
      if (url.endsWith('/group/remove')) installed = false
      return json({ code: 200, data: null })
    })
    const botRef = (await service.listBots()).items[0]!.botRef
    const sourceRef = groupSourceRef(10001, 'group-session-1', '研发群', { rmSubjectId: 88001 })

    const listed = await service.listGroupBots(sourceRef)
    const added = await service.addGroupBot(sourceRef, botRef)
    const removed = await service.removeGroupBot(sourceRef, botRef)

    expect(listed).toEqual({
      groupSourceRef: sourceRef,
      displayName: '研发群',
      canAddBots: true,
      items: [{
        botRef,
        directoryKey: expect.stringMatching(/^arkme-bot-directory-v1\./),
        name: '群聊总结',
        provider: 'openclaw',
        description: '总结',
        status: 'offline',
        installed: false,
      }],
    })
    expect(added).toEqual({ botRef, groupSourceRef: sourceRef, installed: true })
    expect(removed).toEqual({ botRef, groupSourceRef: sourceRef, installed: false })
    expect(calls.slice(1)).toEqual([
      { url: 'https://bot.test/api/v1/bot/group/list', body: { rm_subject_id: 88001 } },
      { url: 'https://bot.test/api/v1/bot/group/add', body: {
        bot_id: 'bot-owner-id-5', rm_subject_id: 88001, subject_title: '研发群',
      } },
      { url: 'https://bot.test/api/v1/bot/group/list', body: { rm_subject_id: 88001 } },
      { url: 'https://bot.test/api/v1/bot/group/remove', body: {
        bot_id: 'bot-owner-id-5', rm_subject_id: 88001,
      } },
      { url: 'https://bot.test/api/v1/bot/group/list', body: { rm_subject_id: 88001 } },
    ])
  })

  it('projects and reads a group Bot avatar without exposing the signed URL to the browser', async () => {
    const avatarUrl = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/bots/avatar.png?x-oss-signature=test'
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async input => {
      const url = String(input)
      if (url.endsWith('/bot/group/list')) return json({ code: 200, data: {
        subject_title: '研发群',
        bots: [{
          bot_id: 'bot-avatar-1', name: '头像 Bot', provider: 'openclaw', description: '', status: 'online',
          avatar_url: avatarUrl, installed: true,
        }],
      } })
      if (url === avatarUrl) {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      }
      throw new Error(`unexpected request ${url}`)
    })
    const sourceRef = groupSourceRef(10001, 'group-session-avatar', '研发群', { rmSubjectId: 88004 })

    const listed = await service.listGroupBots(sourceRef)
    const avatarRef = listed.items[0]!.avatarRef

    expect(avatarRef).toMatch(/^arkme-bot-image-v1\./)
    expect(JSON.stringify(listed)).not.toContain(avatarUrl)
    await expect(service.readImage(avatarRef!)).resolves.toMatchObject({ mediaType: 'image/png', bytes: 8 })
  })

  it('resolves legacy group references through chat detail before listing installed Bots', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as unknown
      calls.push({ url, body })
      if (url.endsWith('/api/v1/chats/detail')) {
        return json({ code: 200, data: {
          session: { chat_session_uid: 'group-session-legacy', session_kind: 2, title: '老群', rm_subject_id: 88003 },
        } })
      }
      if (url.endsWith('/bot/group/list')) {
        return json({ code: 200, data: {
          subject_title: '老群', can_current_user_add_bots: false,
          bots: [{
            bot_id: 'bot-owner-id-legacy', name: '群助手', provider: 'openclaw', description: '', status: 'online',
            installed: true,
          }],
        } })
      }
      throw new Error(`unexpected request ${url}`)
    })
    const sourceRef = groupSourceRef(10001, 'group-session-legacy', '老群')

    await expect(service.listGroupBots(sourceRef)).resolves.toMatchObject({
      items: [{ name: '群助手', installed: true }],
    })
    expect(calls).toEqual([
      { url: 'https://chat.test/api/v1/chats/detail', body: { chat_session_uid: 'group-session-legacy' } },
      { url: 'https://bot.test/api/v1/bot/group/list', body: { rm_subject_id: 88003 } },
    ])
  })

  it('keeps the legacy group owner as subject uid when chat detail is unavailable', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as unknown
      calls.push({ url, body })
      if (url.endsWith('/api/v1/chats/detail')) throw new Error('legacy detail unavailable')
      if (url.endsWith('/bot/group/list')) {
        return json({ code: 200, data: {
          subject_title: '老群',
          bots: [{
            bot_id: 'bot-owner-id-legacy-suffix', name: 'Purge', provider: 'openclaw', description: '', status: 'online',
            installed: true,
          }],
        } })
      }
      throw new Error(`unexpected request ${url}`)
    })
    const sourceRef = groupSourceRef(10001, '1770971781019_34077', '老群')

    await expect(service.listGroupBots(sourceRef)).resolves.toMatchObject({
      items: [{ name: 'Purge', installed: true }],
    })
    expect(calls).toEqual([
      { url: 'https://chat.test/api/v1/chats/detail', body: { chat_session_uid: '1770971781019_34077' } },
      { url: 'https://bot.test/api/v1/bot/group/list', body: { subject_uid: '1770971781019_34077' } },
    ])
  })

  it('sends installed Bot mentions with client-compatible visible offsets and content payload', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/bot/list')) return json({ code: 200, data: { bots: [
        { bot_id: 'bot-summary', name: '总结', provider: 'openclaw', description: '', status: 'online', subject_uid: 'direct-1' },
        { bot_id: 'bot-rocket', name: '🚀助手', provider: 'openclaw', description: '', status: 'online', subject_uid: 'direct-2' },
      ] } })
      if (url.endsWith('/bot/group/list')) return json({ code: 200, data: {
        subject_uid: 'group-session-2', subject_title: '讨论群', can_current_user_add_bots: true,
        bots: [
          { bot_id: 'bot-summary', name: '总结', provider: 'openclaw', description: '', status: 'online', installed: true },
          { bot_id: 'bot-rocket', name: '🚀助手', provider: 'openclaw', description: '', status: 'online', installed: true },
        ],
      } })
      if (url.endsWith('/api/v1/chats/records/send')) return json({ code: 200, data: {
        record_uid: body.record_uid, rel_uid: body.rel_uid, seq: 12, audit_status: 1,
      } })
      throw new Error(`unexpected ${url}`)
    })
    const bots = await service.listBots()
    const groupRef = groupSourceRef(10001, 'group-session-2', '讨论群', { rmSubjectId: 88002 })

    const result = await service.sendSourceText(groupRef, '请总结', {
      recordUid: 'record-mention-1', relationUid: 'relation-mention-1',
      botRefs: [bots.items[0]!.botRef, bots.items[1]!.botRef],
    })

    expect(result).toMatchObject({ itemUid: 'record-mention-1', sequence: 12, localState: 'synced' })
    expect(requests.find(request => request.url.endsWith('/bot/group/list'))?.body)
      .toEqual({ rm_subject_id: 88002 })
    const sent = requests.at(-1)!.body
    expect(sent).toEqual({
      chat_session_uid: 'group-session-2', record_uid: 'record-mention-1', rel_uid: 'relation-mention-1',
      template_kind: 1,
      text_content: '@总结 @🚀助手 请总结',
      content_payload: {
        payload_kind: 1,
        schema_version: 1,
        text_state: 1,
        mention_metadata: {
          schema_version: 1,
          source_checksum: '5a0d9a5890dec9b3d84777d74b1aa2e7e260f13adced19f490bcc36f790ab9ef',
          bot_mentions: [
            { bot_uid: 'bot-summary', display_name_snapshot: '总结', start_index: 0, length: 3 },
            { bot_uid: 'bot-rocket', display_name_snapshot: '🚀助手', start_index: 4, length: 5 },
          ],
        },
      },
      send_at: expect.any(Number),
    })
    expect(requests.some(request => request.url.includes('/ai-polish/'))).toBe(false)
  })

  it('sends structured Bot mentions at the selected inline ranges', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/bot/list')) return json({ code: 200, data: { bots: [
        { bot_id: 'bot-summary', name: '总结', provider: 'openclaw', description: '', status: 'online', subject_uid: 'direct-1' },
        { bot_id: 'bot-rocket', name: '🚀助手', provider: 'openclaw', description: '', status: 'online', subject_uid: 'direct-2' },
      ] } })
      if (url.endsWith('/bot/group/list')) return json({ code: 200, data: {
        subject_uid: 'group-session-2', subject_title: '讨论群', can_current_user_add_bots: true,
        bots: [
          { bot_id: 'bot-summary', name: '总结', provider: 'openclaw', description: '', status: 'online', installed: true },
          { bot_id: 'bot-rocket', name: '🚀助手', provider: 'openclaw', description: '', status: 'online', installed: true },
        ],
      } })
      if (url.endsWith('/api/v1/chats/records/send')) return json({ code: 200, data: {
        record_uid: body.record_uid, rel_uid: body.rel_uid, seq: 13, audit_status: 1,
      } })
      throw new Error(`unexpected ${url}`)
    })
    const bots = await service.listBots()
    const groupRef = groupSourceRef(10001, 'group-session-2', '讨论群', { rmSubjectId: 88002 })

    const result = await service.sendSourceText(groupRef, '@总结 和 @🚀助手 看看', {
      recordUid: 'record-structured-bot-mention', relationUid: 'relation-structured-bot-mention',
      botMentions: [
        { botRef: bots.items[0]!.botRef, startIndex: 0, length: 3 },
        { botRef: bots.items[1]!.botRef, startIndex: 6, length: 5 },
      ],
    })

    expect(result).toMatchObject({ itemUid: 'record-structured-bot-mention', sequence: 13, localState: 'synced' })
    expect(requests.find(request => request.url.endsWith('/bot/group/list'))?.body)
      .toEqual({ rm_subject_id: 88002 })
    expect(requests.at(-1)?.body).toMatchObject({
      chat_session_uid: 'group-session-2',
      text_content: '@总结 和 @🚀助手 看看',
      content_payload: {
        mention_metadata: {
          bot_mentions: [
            { bot_uid: 'bot-summary', display_name_snapshot: '总结', start_index: 0, length: 3 },
            { bot_uid: 'bot-rocket', display_name_snapshot: '🚀助手', start_index: 6, length: 5 },
          ],
        },
      },
    })
  })

  it('fails closed for duplicate or uninstalled Bot mentions before sending chat text', async () => {
    const urls: string[] = []
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async (input) => {
      const url = String(input)
      urls.push(url)
      if (url.endsWith('/bot/list')) return json({ code: 200, data: { bots: [{
        bot_id: 'bot-uninstalled', name: '未安装', provider: 'openclaw', description: '', status: 'offline', subject_uid: 'direct-3',
      }] } })
      if (url.endsWith('/bot/group/list')) return json({ code: 200, data: {
        subject_uid: 'group-session-3', subject_title: '讨论群', bots: [{
          bot_id: 'bot-uninstalled', name: '未安装', provider: 'openclaw', description: '', status: 'offline', installed: false,
        }],
      } })
      throw new Error(`unexpected ${url}`)
    })
    const botRef = (await service.listBots()).items[0]!.botRef
    const sourceRef = groupSourceRef(10001, 'group-session-3', '讨论群')

    await expect(service.sendSourceText(sourceRef, '消息', { botRefs: [botRef, botRef] }))
      .rejects.toMatchObject({ code: 'bot-mention-ref-invalid' })
    await expect(service.sendSourceText(sourceRef, '消息', { botRefs: [botRef] }))
      .rejects.toMatchObject({ code: 'bot-mention-not-installed' })
    expect(urls.filter(url => url.endsWith('/api/v1/chats/records/send'))).toEqual([])
  })
})
