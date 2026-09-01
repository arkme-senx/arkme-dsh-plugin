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
  it('projects Chat-owned Bot actions from canonical relation identity and reopens them only through Host', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(
      config,
      new SessionStore({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }),
      { async uniqueCode() { return 'bot-conversation-device' } } as never,
      async (input, init) => {
        const url = String(input)
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        calls.push({ url, body })
        if (url.endsWith('/api/v1/bot/list')) return json({ code: 200, data: { bots: [{
          bot_id: 'bot-chat-1', name: 'Chat Bot', provider: 'webhook', status: 'online',
          subject_uid: '', chat_session_uid: 'chat-session-1',
        }] } })
        if (url.endsWith('/api/v1/bot/private-chat/open')) return json({ code: 200, data: {
          chat_session_uid: 'chat-session-1', messages: [],
        } })
        if (url.endsWith('/api/v1/chat/timeline/page')) return json({ code: 200, data: {
          chat_session_uid: 'chat-session-1',
          items: [{
            relation: {
              rel_uid: 'relation-1', record_uid: 'record-1', seq: 7, sender_actor_kind: 2,
              sender_user_id: 0, sender_bot_uid: 'bot-chat-1', attach_at: 1_786_000_000_000,
            },
            record: { status: 1, payload: { record_uid: 'record-1', text_content: 'Chat Bot 回复' } },
          }],
        } })
        if (url.endsWith('/api/v1/chats/messages/copy-link/get-or-create')) return json({ code: 200, data: {
          sid: 'sid-chat', url: 'https://jotmo.example/s/sid-chat',
        } })
        throw new Error(`unexpected request ${url}`)
      },
    )
    const bot = (await service.listBots()).items[0]!
    const conversation = await service.openBotPrivateChat(bot.botRef)
    const actionRef = conversation.messages[0]?.messageActionRef ?? ''

    expect(conversation.messages[0]).toMatchObject({
      messageId: 'relation-1', recordUid: 'record-1', content: 'Chat Bot 回复',
      messageActionRef: expect.any(String), messageActionCapabilities: { copyLink: true, forward: true },
    })
    await expect(service.copyMessageActionsLink(bot.botRef, [actionRef])).resolves.toMatchObject({ sid: 'sid-chat' })
    expect(calls.find(call => call.url.endsWith('/api/v1/chats/messages/copy-link/get-or-create'))?.body).toEqual({
      sources: [{ kind: 'chat_relation', chat_session_uid: 'chat-session-1', relation_uid: 'relation-1' }],
    })
  })

  it('projects Subject-owned Bot actions only for stable messages with canonical Record identity', async () => {
    const service = new ArkmeService(
      config,
      new SessionStore({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }),
      { async uniqueCode() { return 'bot-conversation-device' } } as never,
      async (input, init) => {
        const url = String(input)
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (url.endsWith('/api/v1/bot/list')) return json({ code: 200, data: { bots: [{
          bot_id: 'bot-subject-1', name: 'Subject Bot', provider: 'openclaw', status: 'online',
          subject_uid: 'subject-1', chat_session_uid: '',
        }] } })
        if (url.endsWith('/api/v1/bot/private-chat/open')) return json({ code: 200, data: {
          messages: [
            { message_id: 'record-stable', role: 'assistant', content: '稳定回复', status: 'sent', created_at: 1_786_000_000 },
            { message_id: 'record-user', role: 'user', content: '我的问题', status: 'sent', created_at: 1_786_000_000 },
            { message_id: 'record-pending', role: 'assistant', content: '流式中', status: 'pending', created_at: 1_786_000_001 },
          ],
        } })
        if (url.endsWith('/api/v1/chats/messages/copy-link/get-or-create')) {
          expect(body).toEqual({ sources: [{ kind: 'record', record_owner_user_id: 42, record_uid: 'record-user' }] })
          return json({ code: 200, data: { sid: 'sid-subject', url: 'https://jotmo.example/s/sid-subject' } })
        }
        throw new Error(`unexpected request ${url}`)
      },
    )
    const bot = (await service.listBots()).items[0]!
    const conversation = await service.openBotPrivateChat(bot.botRef)

    expect(conversation.messages[0]).toMatchObject({
      recordUid: 'record-stable', messageActionRef: expect.any(String),
      messageActionCapabilities: { copyLink: false, forward: true },
    })
    expect(conversation.messages[1]).toMatchObject({
      recordUid: 'record-user', messageActionRef: expect.any(String),
      messageActionCapabilities: { copyLink: true, forward: true },
    })
    expect(conversation.messages[2]?.messageActionRef).toBeUndefined()
    await expect(service.copyMessageActionsLink(bot.botRef, [conversation.messages[1]?.messageActionRef ?? '']))
      .resolves.toMatchObject({ sid: 'sid-subject' })
  })

  it('routes Chat-owned Bot open, refresh, send, policy, and read through Chat only', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    let timelineReads = 0
    const service = new ArkmeService(
      config,
      new SessionStore({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }),
      { async uniqueCode() { return 'bot-conversation-device' } } as never,
      async (input, init) => {
        const url = String(input)
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        calls.push({ url, body })
        if (url.endsWith('/api/v1/bot/list')) return json({ code: 200, data: { bots: [{
          bot_id: 'bot-chat-1', name: 'Chat Bot', provider: 'webhook', status: 'online',
          subject_uid: '', chat_session_uid: 'chat-session-1',
        }] } })
        if (url.endsWith('/api/v1/bot/private-chat/open')) return json({ code: 200, data: {
          session_id: 'chat-session-1', chat_session_uid: 'chat-session-1', messages: [],
        } })
        if (url.endsWith('/api/v1/chat/timeline/page')) {
          timelineReads += 1
          return json({ code: 200, data: { chat_session_uid: 'chat-session-1', items: [] } })
        }
        if (url.endsWith('/api/v1/chats/records/send')) return json({ code: 200, data: {
          chat_session_uid: 'chat-session-1', record_uid: body.record_uid, rel_uid: body.rel_uid,
          seq: 7, audit_status: 1,
        } })
        if (url.endsWith('/api/v1/chats/policy/get')) return json({ code: 200, data: {
          chat_session_uid: 'chat-session-1', user_id: 42, show_in_home_state: 1, privacy_state: 1,
          mute_state: 1, pin_state: 2, notify_state: 1, status: 1, update_at: 100,
        } })
        if (url.endsWith('/api/v1/chats/policy/update')) return json({ code: 200, data: {
          chat_session_uid: 'chat-session-1', user_id: 42,
          show_in_home_state: body.show_in_home_state, privacy_state: body.privacy_state,
          mute_state: body.mute_state, pin_state: body.pin_state, notify_state: body.notify_state,
          status: body.status, update_at: body.update_at,
        } })
        if (url.endsWith('/api/v1/chats/cursor/update')) return json({ code: 200, data: {
          chat_session_uid: 'chat-session-1', user_id: 42, effective_read_seq: 7, read_at: 200,
          session_last_seq: 7, unread_count: 0,
        } })
        throw new Error(`unexpected request ${url}`)
      },
    )
    const bot = (await service.listBots()).items[0]!

    await expect(service.openBotPrivateChat(bot.botRef)).resolves.toEqual({ messages: [] })
    await expect(service.refreshBotPrivateChat(bot.botRef)).resolves.toEqual({ messages: [] })
    const sendResult = await service.sendBotPrivateChatMessage(bot.botRef, ' hello ')
    expect(sendResult).toMatchObject({
      userMessage: {
        messageId: expect.any(String), recordUid: expect.any(String), role: 'user', content: 'hello', status: 'sent',
      },
      botMessages: [],
      status: 'ok',
    })
    const sendCall = calls.find(call => call.url.endsWith('/api/v1/chats/records/send'))!
    expect(sendResult.userMessage.messageId).toBe(sendCall.body.rel_uid)
    expect(sendResult.userMessage.recordUid).toBe(sendCall.body.record_uid)
    await expect(service.botNotificationPreference(bot.botRef)).resolves.toEqual({ muted: false })
    await expect(service.updateBotNotificationPreference(bot.botRef, true)).resolves.toEqual({ muted: true })
    await expect(service.markBotPrivateChatRead(bot.botRef, 7)).resolves.toEqual({ effectiveReadSequence: 7, unreadCount: 0 })

    expect(timelineReads).toBe(2)
    expect(calls.filter(call => call.url.endsWith('/api/v1/bot/private-chat/open'))).toHaveLength(1)
    expect(calls.filter(call => call.url.endsWith('/api/v1/chats/records/send'))).toHaveLength(1)
    expect(calls.find(call => call.url.endsWith('/api/v1/chats/policy/update'))?.body).toMatchObject({
      chat_session_uid: 'chat-session-1', show_in_home_state: 1, privacy_state: 1,
      mute_state: 2, pin_state: 2, notify_state: 2, status: 1,
    })
    expect(calls.some(call => call.url.includes('subject.test'))).toBe(false)
    expect(calls.some(call => call.url.includes('record.test'))).toBe(false)
  })

  it('does not retry or fabricate a Chat message when the write outcome is unknown', async () => {
    let sendAttempts = 0
    const service = new ArkmeService(
      config,
      new SessionStore({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }),
      { async uniqueCode() { return 'bot-conversation-device' } } as never,
      async input => {
        const url = String(input)
        if (url.endsWith('/api/v1/bot/list')) return json({ code: 200, data: { bots: [{
          bot_id: 'bot-chat-1', name: 'Chat Bot', provider: 'webhook', status: 'online',
          subject_uid: '', chat_session_uid: 'chat-session-1',
        }] } })
        if (url.endsWith('/api/v1/chats/records/send')) {
          sendAttempts += 1
          throw new TypeError('connection reset')
        }
        throw new Error(`unexpected request ${url}`)
      },
    )
    const bot = (await service.listBots()).items[0]!

    await expect(service.sendBotPrivateChatMessage(bot.botRef, '只发送一次')).rejects.toMatchObject({
      code: 'bot-conversation-send-outcome-unknown', retryable: false,
    })
    expect(sendAttempts).toBe(1)
  })

  it('does not reinterpret a Subject Bot reply occurrence id as a Record identity', async () => {
    const service = new ArkmeService(
      config,
      new SessionStore({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }),
      { async uniqueCode() { return 'bot-conversation-device' } } as never,
      async input => {
        const url = String(input)
        if (url.endsWith('/api/v1/bot/list')) return json({ code: 200, data: { bots: [{
          bot_id: 'bot-subject-1', name: 'Subject Bot', provider: 'openclaw', status: 'online',
          subject_uid: 'subject-1', chat_session_uid: '',
        }] } })
        if (url.endsWith('/api/v1/bot/private-chat/message/send')) return json({ code: 200, data: {
          user_message: { message_id: 'user-record-uid', role: 'user', content: '问题', status: 'sent', created_at: 1_786_000_000 },
          bot_messages: [
            { message_id: 'reply-occurrence-only', role: 'assistant', content: '尚无 Record 身份', status: 'completed', created_at: 1_786_000_001 },
            { message_id: 'reply-record-uid', record_uid: 'reply-record-uid', role: 'assistant', content: '已落 Record', status: 'completed', created_at: 1_786_000_002 },
          ],
          status: 'ok',
        } })
        throw new Error(`unexpected request ${url}`)
      },
    )
    const bot = (await service.listBots()).items[0]!
    const result = await service.sendBotPrivateChatMessage(bot.botRef, '问题')

    expect(result.userMessage).toMatchObject({ recordUid: 'user-record-uid', messageActionRef: expect.any(String) })
    expect(result.botMessages[0]).toMatchObject({ messageId: 'reply-occurrence-only' })
    expect(result.botMessages[0]?.recordUid).toBeUndefined()
    expect(result.botMessages[0]?.messageActionRef).toBeUndefined()
    expect(result.botMessages[1]).toMatchObject({
      recordUid: 'reply-record-uid', messageActionRef: expect.any(String),
      messageActionCapabilities: { copyLink: false, forward: true },
    })
  })

  it('rejects a Chat read acknowledgement attributed to another user', async () => {
    const service = new ArkmeService(
      config,
      new SessionStore({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }),
      { async uniqueCode() { return 'bot-conversation-device' } } as never,
      async input => {
        const url = String(input)
        if (url.endsWith('/api/v1/bot/list')) return json({ code: 200, data: { bots: [{
          bot_id: 'bot-chat-1', name: 'Chat Bot', provider: 'webhook', status: 'online',
          subject_uid: '', chat_session_uid: 'chat-session-1',
        }] } })
        if (url.endsWith('/api/v1/chats/cursor/update')) return json({ code: 200, data: {
          chat_session_uid: 'chat-session-1', user_id: 99, effective_read_seq: 7, read_at: 200,
          session_last_seq: 7, unread_count: 0,
        } })
        throw new Error(`unexpected request ${url}`)
      },
    )
    const bot = (await service.listBots()).items[0]!

    await expect(service.markBotPrivateChatRead(bot.botRef, 7)).rejects.toMatchObject({
      code: 'source-read-ack-invalid',
    })
  })

  it('does not fabricate read acknowledgement support for a Subject-owned Bot', async () => {
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
          subject_uid: 'subject-1', chat_session_uid: '',
        }] } })
        throw new Error(`unexpected request ${url}`)
      },
    )
    const bot = (await service.listBots()).items[0]!

    await expect(service.markBotPrivateChatRead(bot.botRef, 1)).rejects.toMatchObject({
      code: 'bot-conversation-read-unsupported',
    })
    expect(calls.filter(url => !url.endsWith('/api/v1/bot/list'))).toEqual([])
  })
})
