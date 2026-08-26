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

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
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
        name: '群聊总结',
        provider: 'openclaw',
        description: '总结群聊',
        status: 'offline',
        directChatAvailable: true,
      }],
    })
    expect(JSON.stringify(result)).not.toContain('bot-owner-id-1')
    expect(JSON.stringify(result)).not.toContain('jbot_')
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

    expect(result.items.map(item => [item.name, item.provider, item.status])).toEqual([
      ['本地助手', 'openclaw', 'online'],
      ['回调测试', 'webhook', 'unknown'],
    ])
    expect(JSON.stringify(result)).not.toContain('openclaw-raw-1')
    expect(JSON.stringify(result)).not.toContain('webhook-raw-1')
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
        subject_uid: '', chat_session_uid: '',
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
