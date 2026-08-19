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

function groupSourceRef(userId: number, subjectUid: string, displayName: string): string {
  const payload = Buffer.from(JSON.stringify({
    version: 1, userId, kind: 'group_chat', ownerRef: subjectUid, displayName,
  })).toString('base64url')
  const signature = createHmac('sha256', 'dsh-bot-test-device').update(payload).digest('base64url')
  return `arkme-source-v1.${payload}.${signature}`
}

describe('ArkmeService Bot owner adapter', () => {
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
        botRef: expect.stringMatching(/^arkme-bot-v1\./),
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

    const result = await service.createBot({ name: ' 八卦雷达 ', description: ' 高亮八卦 ' })

    expect(requests).toEqual([{ body: {
      name: '八卦雷达', provider: 'openclaw', description: '高亮八卦', avatar: '',
    } }])
    expect(result.bot).toMatchObject({
      botRef: expect.stringMatching(/^arkme-bot-v1\./),
      name: '八卦雷达',
      provider: 'openclaw',
    })
    expect(result.secret.reveal()).toBe('jbot_full_secret')
    expect(JSON.stringify(result.secret)).toBe('{}')
    expect(JSON.stringify(result.bot)).not.toContain('jbot_')
    expect(JSON.stringify(result.bot)).not.toContain('bot-owner-id-2')
  })

  it('does not retry Bot creation when the remote outcome is unknown', async () => {
    let attempts = 0
    const sessions = new BotTestSessionStore({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' })
    const service = new ArkmeService(config, sessions, stateStore, async () => {
      attempts += 1
      throw new TypeError('connection reset')
    })

    await expect(service.createBot({ name: '只创建一次' })).rejects.toMatchObject({
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
    await expect(service.revealBotSecret(botRef)).rejects.toMatchObject({ code: 'bot-ref-invalid' })
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
          bot_id: 'bot-owner-id-5', name: '群聊总结', provider: 'openclaw', description: '总结', status: 'offline',
          subject_uid: 'direct-5', chat_session_uid: '',
        }] } })
      }
      if (url.endsWith('/group/list')) {
        return json({ code: 200, data: {
          subject_uid: 'group-session-1', subject_title: '研发群', can_current_user_add_bots: true,
          bots: [{
            bot_id: 'bot-owner-id-5', name: '群聊总结', provider: 'openclaw', description: '总结', status: 'offline',
            installed,
          }],
        } })
      }
      if (url.endsWith('/group/add')) installed = true
      if (url.endsWith('/group/remove')) installed = false
      return json({ code: 200, data: null })
    })
    const botRef = (await service.listBots()).items[0]!.botRef
    const sourceRef = groupSourceRef(10001, 'group-session-1', '研发群')

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
      { url: 'https://bot.test/api/v1/bot/group/list', body: { subject_uid: 'group-session-1' } },
      { url: 'https://bot.test/api/v1/bot/group/add', body: {
        bot_id: 'bot-owner-id-5', subject_uid: 'group-session-1', subject_title: '研发群',
      } },
      { url: 'https://bot.test/api/v1/bot/group/list', body: { subject_uid: 'group-session-1' } },
      { url: 'https://bot.test/api/v1/bot/group/remove', body: {
        bot_id: 'bot-owner-id-5', subject_uid: 'group-session-1',
      } },
      { url: 'https://bot.test/api/v1/bot/group/list', body: { subject_uid: 'group-session-1' } },
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
    const groupRef = groupSourceRef(10001, 'group-session-2', '讨论群')

    const result = await service.sendSourceText(groupRef, '请总结', {
      recordUid: 'record-mention-1', relationUid: 'relation-mention-1',
      botRefs: [bots.items[0]!.botRef, bots.items[1]!.botRef],
    })

    expect(result).toMatchObject({ itemUid: 'record-mention-1', sequence: 12, localState: 'synced' })
    const sent = requests.at(-1)!.body
    expect(sent).toEqual({
      chat_session_uid: 'group-session-2', record_uid: 'record-mention-1', rel_uid: 'relation-mention-1',
      template_kind: 1,
      text_content: '@总结 @🚀助手 请总结',
      content_payload: {
        payload_kind: 2,
        schema_version: 1,
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
