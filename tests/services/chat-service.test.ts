import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ArkoService } from '../../src/services/arko-service.js'
import { BotService } from '../../src/services/bot-service.js'
import { ChatService, projectArkmeConversationMemberJoinEvents } from '../../src/services/chat-service.js'
import { GroupAiPolishService } from '../../src/services/group-ai-polish-service.js'
import { MediaService } from '../../src/services/media-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { RecordService } from '../../src/services/record-service.js'
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

describe('ChatService', () => {
  it('projects, groups, and redacts group member join metadata', async () => {
    const events = await projectArkmeConversationMemberJoinEvents([
      {
        user_id: 2, status: 1, display_name_snapshot: '小乙', join_at: 1_700_000_000_000,
        extra: JSON.stringify({ inviter_user_id: 1, inviter_display_name: '群主', join_batch_at: 1_700_000_001_000 }),
      },
      {
        user_id: 3, status: 1, display_name_snapshot: '小丙', join_at: 1_700_000_000_000,
        extra: { inviter_user_id: 1, inviter_display_name: '群主', join_batch_at: 1_700_000_001_000 },
      },
      {
        user_id: 1, status: 1, display_name_snapshot: '群主', join_at: 1_600_000_000_000,
        extra: {},
      },
    ], {
      viewerUserId: 3,
      async memberRefForUserId(userId) { return `sealed-${String(userId)}` },
      async eventIdForStableKey(stableKey) { return `event-${stableKey.length}` },
    })

    expect(events).toEqual([{
      eventId: expect.stringMatching(/^event-/), action: 'invite', occurredAtMillis: 1_700_000_001_000,
      inviter: { memberRef: 'sealed-1', displayName: '群主', isSelf: false },
      invitees: [
        { memberRef: 'sealed-3', displayName: '小丙', isSelf: true },
        { memberRef: 'sealed-2', displayName: '小乙', isSelf: false },
      ],
    }])
    expect(JSON.stringify(events)).not.toContain('user_id')
    expect(JSON.stringify(events)).not.toContain('join_batch_at')
  })

  it('maps direct additions and normalizes second timestamps', async () => {
    const events = await projectArkmeConversationMemberJoinEvents([{
      user_id: 8,
      display_name_snapshot: '新成员',
      join_at: 1_700_000_000,
      extra: {
        join_source_type: 'direct_add',
        inviter: { user_id: 7, display_name: '管理员' },
      },
    }], {
      viewerUserId: 7,
      async memberRefForUserId(userId) { return `member-${String(userId)}` },
      async eventIdForStableKey() { return 'join-event' },
    })

    expect(events).toMatchObject([{
      eventId: 'join-event', action: 'direct_add', occurredAtMillis: 1_700_000_000_000,
      inviter: { displayName: '管理员', isSelf: true },
    }])
  })

  it('omits malformed join metadata without inventing an inviter', async () => {
    const events = await projectArkmeConversationMemberJoinEvents([
      { user_id: 2, display_name_snapshot: '成员', join_at: 1_700_000_000_000, extra: {} },
      { user_id: 3, display_name_snapshot: '成员三', join_at: 1_700_000_000_000, extra: { inviter_user_id: 0 } },
      { user_id: 4, join_at: 1_700_000_000_000, extra: { inviter_display_name: '群主' } },
    ], {
      viewerUserId: 1,
      async memberRefForUserId(userId) { return `member-${String(userId)}` },
      async eventIdForStableKey() { return 'unused' },
    })
    expect(events).toEqual([])
  })

  it('rejects opening a private chat with the current user', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore)
    const profile = new ProfileService(runtime)
    const source = new SourceService(runtime, profile, {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const media = new MediaService(runtime, profile, { async openWorldImageRef() { throw new Error('unused') } }, {
      recordUid() { return '' },
    })
    const record = new RecordService(runtime, media, source)
    const bot = new BotService(runtime, source)
    const arko = new ArkoService(runtime, profile)
    let chat!: ChatService
    const polish = new GroupAiPolishService(runtime, source, {
      async sendChatSourceTextRaw(...args) { return await chat.sendChatSourceTextRaw(...args) },
    })
    chat = new ChatService(runtime, source, profile, media, record, bot, arko, polish, {
      emitChatClientEvent() {}, nextChatClientRevision() { return 1 }, scheduleChatSessionProjection() {},
    })

    await expect(chat.openPrivateChatFromUser(42)).rejects.toMatchObject({ code: 'private-chat-self-invalid' })
  })

  it('schedules the authoritative chat projection after sending text', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(
      config,
      sessions,
      { async uniqueCode() { return 'device-secret' } } as StateStore,
      async () => new Response(JSON.stringify({
        code: 200,
        data: { record_uid: 'record-1', audit_status: 1, seq: 12 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const profile = new ProfileService(runtime)
    const source = new SourceService(runtime, profile, {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const media = new MediaService(runtime, profile, { async openWorldImageRef() { throw new Error('unused') } }, {
      recordUid() { return '' },
    })
    const record = new RecordService(runtime, media, source)
    const bot = new BotService(runtime, source)
    const arko = new ArkoService(runtime, profile)
    const scheduleChatSessionProjection = vi.fn()
    let chat!: ChatService
    const polish = new GroupAiPolishService(runtime, source, {
      async sendChatSourceTextRaw(...args) { return await chat.sendChatSourceTextRaw(...args) },
    })
    chat = new ChatService(runtime, source, profile, media, record, bot, arko, polish, {
      emitChatClientEvent() {}, nextChatClientRevision() { return 1 }, scheduleChatSessionProjection,
    })
    const sourceRef = await source.sealSourceRef(42, 'private_chat', 'chat-1', '同事')

    await expect(chat.sendSourceText(sourceRef, '测试', {
      recordUid: 'record-1', relationUid: 'relation-1',
    })).resolves.toMatchObject({ sequence: 12, localState: 'synced' })
    expect(scheduleChatSessionProjection).toHaveBeenCalledOnce()
    expect(scheduleChatSessionProjection).toHaveBeenCalledWith('chat-1', 12)
  })

  it('schedules the authoritative chat projection after sending rich content', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(
      config,
      sessions,
      { async uniqueCode() { return 'device-secret' } } as StateStore,
      async () => new Response(JSON.stringify({
        code: 200,
        data: { record_uid: 'record-2', audit_status: 1, seq: 18 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const profile = new ProfileService(runtime)
    const source = new SourceService(runtime, profile, {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const media = new MediaService(runtime, profile, { async openWorldImageRef() { throw new Error('unused') } }, {
      recordUid() { return '' },
    })
    const record = new RecordService(runtime, media, source)
    const bot = new BotService(runtime, source)
    const arko = new ArkoService(runtime, profile)
    const scheduleChatSessionProjection = vi.fn()
    let chat!: ChatService
    const polish = new GroupAiPolishService(runtime, source, {
      async sendChatSourceTextRaw(...args) { return await chat.sendChatSourceTextRaw(...args) },
    })
    chat = new ChatService(runtime, source, profile, media, record, bot, arko, polish, {
      emitChatClientEvent() {}, nextChatClientRevision() { return 1 }, scheduleChatSessionProjection,
    })
    const sourceRef = await source.sealSourceRef(42, 'private_chat', 'chat-2', '同事')

    await expect(chat.sendSourceRich(sourceRef, {
      textContent: '带附件的消息',
      assets: [{ fileAssetUid: 'asset-12345678', fileName: 'report.pdf', fileKind: 4, size: 128 }],
    }, { recordUid: 'record-2', relationUid: 'relation-2' }))
      .resolves.toMatchObject({ sequence: 18, localState: 'synced' })
    expect(scheduleChatSessionProjection).toHaveBeenCalledOnce()
    expect(scheduleChatSessionProjection).toHaveBeenCalledWith('chat-2', 18)
  })
})
