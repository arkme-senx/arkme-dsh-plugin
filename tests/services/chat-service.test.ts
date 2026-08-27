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
import { dispatchArkmeHostOperation } from '../../src/host-api.js'
import { createArkmeSdk } from '../../src/sdk/index.js'
import { createArkmeCoreToolDefinitions } from '../../src/tools/index.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('ChatService', () => {
  it('resolves normal message copy links using the Flutter source anchor field names', async () => {
    const runtime = {
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        expect(path).toBe('/api/v1/chats/messages/copy-link/resolve')
        expect(body).toEqual({ sid: 'U2HQgn1RhPJZaFmx' })
        return {
          sid: 'U2HQgn1RhPJZaFmx',
          display_title: '实习性的快记',
          generated_at: 1_787_733_600_000,
          access_mode: 'normal',
          source_context: {
            chat_session_uid: 'chat-session-1',
            anchors: [{
              rel_uid: 'rel-1',
              record_uid: 'record-1',
              record_owner_user_id: 42,
              seq: 18,
            }],
          },
          items: [{
            source_kind: 'record',
            sender_display_name: '实习性',
            title: '快记标题',
            text_content: '快记正文',
            send_at: 1_787_733_600_000,
            template_kind: 1,
            display_kind: 0,
            official_mark: 0,
            media_items: [],
          }],
          presentation: [{ kind: 'item', item_index: 0 }],
        }
      }),
    }
    const chat = new ChatService(
      runtime as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.resolveMessageCopyLink(' U2HQgn1RhPJZaFmx ')).resolves.toMatchObject({
      sid: 'U2HQgn1RhPJZaFmx',
      displayTitle: '实习性的快记',
      accessMode: 'normal',
      sourceSessionUid: 'chat-session-1',
      sourceAnchors: [{ relationUid: 'rel-1', recordUid: 'record-1', recordOwnerUserId: 42, sequence: 18 }],
    })
  })

  it('loads existing quick-note extensions through the Flutter public-record extend-list service contract', async () => {
    const worldPostBodies: Record<string, unknown>[] = []
    const runtime = {
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async () => ({
        sid: 'U2HQgn1RhPJZaFmx',
        display_title: '1D3E的快记',
        generated_at: 1_787_733_600_000,
        access_mode: 'normal',
        source_context: {
          chat_session_uid: 'chat-session-1',
          anchors: [{
            rel_uid: 'rel-1',
            record_uid: 'parent-record-1',
            record_owner_user_id: 42,
            seq: 18,
          }],
        },
        items: [{
          record_uid: 'public-parent-record-1',
          source_kind: 'record',
          sender_display_name: '1D3E',
          title: '',
          text_content: 'OK',
          send_at: 1_787_733_600,
          template_kind: 1,
          display_kind: 0,
          official_mark: 0,
          media_items: [],
        }],
        presentation: [{ kind: 'item', item_index: 0 }],
      })),
      authenticatedWorldPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        worldPostBodies.push({ path, body })
        return {
          list: [{
            record_uid: 'extension-record-1',
            user_id: 42,
            nick_name: '睡觉',
            avatar: 'avatar-ref-42',
            content: '1',
            parent_record_uid: 'public-parent-record-1',
            created_at: 1_787_735_200,
            published_at: 1_787_735_200,
          }],
          total: 1,
          has_more: false,
        }
      }),
    }
    const chat = new ChatService(
      runtime as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.resolveMessageCopyLink('U2HQgn1RhPJZaFmx')).resolves.toMatchObject({
      recordContext: {
        extensionCount: 1,
        extensions: [{
          recordUid: 'extension-record-1',
          senderDisplayName: '睡觉',
          senderAvatarUrl: 'avatar-ref-42',
          textContent: '1',
          sendAtMillis: 1_787_735_200_000,
        }],
      },
    })
    expect(worldPostBodies).toEqual([{
      path: '/api/v1/public-record/extend-list',
      body: { record_uid: 'public-parent-record-1', limit: 50, offset: 0 },
    }])
  })

  it('falls back to the copy-link source anchor when the resolve item does not expose a public record uid', async () => {
    const worldPostBodies: Record<string, unknown>[] = []
    const runtime = {
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async () => ({
        sid: 'U2HQgn1RhPJZaFmx',
        display_title: '1D3E的快记',
        generated_at: 1_787_733_600_000,
        access_mode: 'normal',
        source_context: {
          chat_session_uid: 'chat-session-1',
          anchors: [{
            rel_uid: 'rel-1',
            record_uid: 'anchor-record-1',
            record_owner_user_id: 42,
            seq: 18,
          }],
        },
        items: [{
          source_kind: 'record',
          sender_display_name: '1D3E',
          title: '',
          text_content: 'OK',
          send_at: 1_787_733_600_000,
          template_kind: 1,
          display_kind: 0,
          official_mark: 0,
          media_items: [],
        }],
        presentation: [{ kind: 'item', item_index: 0 }],
      })),
      authenticatedWorldPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        worldPostBodies.push({ path, body })
        return {
          list: [{
            record_uid: 'extension-record-1',
            nick_name: '睡觉',
            content: '1',
            parent_record_uid: 'anchor-record-1',
            created_at: 1_787_735_200,
          }],
          total: 1,
          has_more: false,
        }
      }),
    }
    const chat = new ChatService(
      runtime as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.resolveMessageCopyLink('U2HQgn1RhPJZaFmx')).resolves.toMatchObject({
      recordContext: {
        extensionCount: 1,
        extensions: [{ recordUid: 'extension-record-1', textContent: '1' }],
      },
    })
    expect(worldPostBodies).toEqual([{
      path: '/api/v1/public-record/extend-list',
      body: { record_uid: 'anchor-record-1', limit: 50, offset: 0 },
    }])
  })

  it('keeps the copied quick-note detail usable when the public extension list is unavailable', async () => {
    const runtime = {
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async () => ({
        sid: 'U2HQgn1RhPJZaFmx',
        display_title: '1D3E的快记',
        generated_at: 1_787_733_600_000,
        access_mode: 'normal',
        source_context: {
          chat_session_uid: 'chat-session-1',
          anchors: [{
            rel_uid: 'rel-1',
            record_uid: 'parent-record-1',
            record_owner_user_id: 42,
            seq: 18,
          }],
        },
        items: [{
          source_kind: 'record',
          sender_display_name: '1D3E',
          title: '',
          text_content: 'OK',
          send_at: 1_787_733_600_000,
          template_kind: 1,
          display_kind: 0,
          official_mark: 0,
          media_items: [],
        }],
        presentation: [{ kind: 'item', item_index: 0 }],
      })),
      authenticatedWorldPost: vi.fn(async () => { throw new Error('world unavailable') }),
    }
    const chat = new ChatService(
      runtime as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.resolveMessageCopyLink('U2HQgn1RhPJZaFmx')).resolves.toMatchObject({
      displayTitle: '1D3E的快记',
      items: [{ textContent: 'OK' }],
    })
  })

  it('extends a normal message copy link through the Flutter public-record publish owner', async () => {
    const chatPostBodies: Record<string, unknown>[] = []
    const worldPostBodies: Record<string, unknown>[] = []
    const runtime = {
      config,
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        chatPostBodies.push({ path, body })
        return {
          sid: 'U2HQgn1RhPJZaFmx',
          display_title: '1D3E的快记',
          generated_at: 1_787_733_600_000,
          access_mode: 'normal',
          source_context: {
            chat_session_uid: 'chat-session-1',
            anchors: [{
              rel_uid: 'rel-1',
              record_uid: 'parent-record-1',
              record_owner_user_id: 42,
              seq: 18,
            }],
          },
          items: [{
            record_uid: 'public-parent-record-1',
            source_kind: 'record',
            sender_display_name: '1D3E',
            title: '',
            text_content: 'bot相关接口有点问题，会优化下',
            send_at: 1_787_733_600_000,
            template_kind: 1,
            display_kind: 0,
            official_mark: 0,
            media_items: [],
          }],
          presentation: [{ kind: 'item', item_index: 0 }],
        }
      }),
      authenticatedWorldPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        worldPostBodies.push({ path, body })
        if (path === '/api/v1/public-record/extend-list') return { list: [], total: 0, has_more: false }
        return { record_uid: body.record_uid, check_status: 1 }
      }),
    }
    const source = { invalidateSourceListCache: vi.fn() }
    const profile = {
      refreshProfile: vi.fn(async () => ({
        profile: {
          userId: 42,
          displayName: '狗才',
          nickname: '狗才',
          avatarRef: 'profile-avatar-42',
          arkmeId: 'doge',
          accountType: 1,
          createdAt: 1,
          bindings: { apple: false, wechat: true, google: false },
          contact: { phoneMasked: '138****0000' },
        },
        cachedAtMillis: 1,
        revision: 1,
      })),
    }
    const record = {
      createTextForConversation: vi.fn(async (recordUid: string) => ({ recordUid, status: 1, localState: 'synced' })),
    }
    const realtime = {
      nextChatClientRevision: vi.fn(() => 5),
      emitChatClientEvent: vi.fn(),
      scheduleChatSessionProjection: vi.fn(),
    }
    const chat = new ChatService(
      runtime as never, source as never, profile as never, {} as never, record as never,
      {} as never, {} as never, {} as never, realtime as never,
    )

    await expect(chat.extendMessageCopyLink(
      ' U2HQgn1RhPJZaFmx ',
      0,
      ' 延展内容 ',
      '11111111-1111-4111-8111-111111111111',
    )).resolves.toMatchObject({
      sid: 'U2HQgn1RhPJZaFmx',
      recordUid: '11111111-1111-4111-8111-111111111111',
      parentRecordUid: 'public-parent-record-1',
      status: 1,
      localState: 'synced',
      extension: {
        recordUid: '11111111-1111-4111-8111-111111111111',
        senderDisplayName: '狗才',
        senderAvatarUrl: 'profile-avatar-42',
        textContent: '延展内容',
        templateKind: 1,
      },
    })
    expect(chatPostBodies).toEqual([{ path: '/api/v1/chats/messages/copy-link/resolve', body: { sid: 'U2HQgn1RhPJZaFmx' } }])
    expect(record.createTextForConversation).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', '延展内容')
    expect(worldPostBodies).toEqual([
      {
        path: '/api/v1/public-record/extend-list',
        body: { record_uid: 'public-parent-record-1', limit: 50, offset: 0 },
      },
      {
        path: '/api/v1/public-record/extend-list',
        body: { record_uid: 'parent-record-1', limit: 50, offset: 0 },
      },
      {
        path: '/api/v1/public-record/publish',
        body: {
          record_uid: '11111111-1111-4111-8111-111111111111',
          content: '延展内容',
          text_content: '延展内容',
          tags: [],
          original_topic_id: 0,
          created_at: expect.any(Number),
          nick_name: '狗才',
          avatar: 'profile-avatar-42',
          template_kind: 1,
          parent_record_uid: 'public-parent-record-1',
        },
      },
    ])
    expect(JSON.stringify(worldPostBodies)).not.toContain('parent_extend_record_uid')
    expect(source.invalidateSourceListCache).toHaveBeenCalledWith(42, 'send_to_self')
    expect(realtime.emitChatClientEvent).toHaveBeenCalledWith({ type: 'projection-invalidated', revision: 5, projection: 'record' })
  })

  it('moves and deletes favorite stickers while preserving only stable server fields', async () => {
    let items: Record<string, unknown>[] = [
      { file_asset_uid: 'asset-first-1234', file_name: 'first.png', mime_type: 'image/png', file_kind: 1, file_size: 10, signed_url: 'drop-me' },
      { file_asset_uid: 'asset-second-123', file_name: 'second.gif', mime_type: 'image/gif', file_kind: 1, file_size: 20, is_animated: true, signed_url: 'drop-me' },
    ]
    const setBodies: Record<string, unknown>[] = []
    const runtime = {
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        if (path.endsWith('/get')) return { items, updated_at_millis: 1 }
        setBodies.push(body)
        items = body.items as Record<string, unknown>[]
        return {}
      }),
    }
    const media = { favoriteStickerMediaRef: (raw: Record<string, unknown>) => `favorite:${String(raw.file_asset_uid)}` }
    const chat = new ChatService(
      runtime as never, {} as never, {} as never, media as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    const added = await chat.addFavoriteSticker({
      fileAssetUid: 'asset-new-12345', fileName: 'new.gif', mimeType: 'image/gif', fileKind: 1, size: 30,
    })
    expect(added.items.map(item => item.fileAssetUid)).toEqual(['asset-new-12345', 'asset-first-1234', 'asset-second-123'])
    expect(setBodies[0]).toMatchObject({ items: [
      { file_asset_uid: 'asset-new-12345', file_name: 'new.gif', mime_type: 'image/gif', file_kind: 1, file_size: 30, is_animated: true },
      { file_asset_uid: 'asset-first-1234' },
      { file_asset_uid: 'asset-second-123' },
    ] })
    expect(JSON.stringify(setBodies[0])).not.toContain('signed_url')

    const moved = await chat.manageFavoriteSticker('asset-second-123', 'move-to-front')
    expect(moved.items.map(item => item.fileAssetUid)).toEqual(['asset-second-123', 'asset-new-12345', 'asset-first-1234'])
    expect(setBodies[1]).toMatchObject({ items: [
      { file_asset_uid: 'asset-second-123', file_name: 'second.gif', mime_type: 'image/gif', file_kind: 1, file_size: 20, is_animated: true },
      { file_asset_uid: 'asset-new-12345', file_name: 'new.gif', mime_type: 'image/gif', file_kind: 1, file_size: 30, is_animated: true },
      { file_asset_uid: 'asset-first-1234', file_name: 'first.png', mime_type: 'image/png', file_kind: 1, file_size: 10 },
    ] })
    expect(JSON.stringify(setBodies[1])).not.toContain('signed_url')

    const deleted = await chat.manageFavoriteSticker('asset-first-1234', 'delete')
    expect(deleted.items.map(item => item.fileAssetUid)).toEqual(['asset-second-123', 'asset-new-12345'])
  })

  it('serializes concurrent favorite sticker mutations so additions cannot overwrite each other', async () => {
    let items: Record<string, unknown>[] = [
      { file_asset_uid: 'asset-existing-1', file_name: 'existing.png', mime_type: 'image/png', file_kind: 1, file_size: 10 },
    ]
    const runtime = {
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        if (path.endsWith('/get')) {
          await Promise.resolve()
          return { items, updated_at_millis: 1 }
        }
        await Promise.resolve()
        items = body.items as Record<string, unknown>[]
        return {}
      }),
    }
    const media = { favoriteStickerMediaRef: (raw: Record<string, unknown>) => `favorite:${String(raw.file_asset_uid)}` }
    const chat = new ChatService(
      runtime as never, {} as never, {} as never, media as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await Promise.all([
      chat.addFavoriteSticker({ fileAssetUid: 'asset-added-one', fileName: 'one.png', mimeType: 'image/png', fileKind: 1, size: 11 }),
      chat.addFavoriteSticker({ fileAssetUid: 'asset-added-two', fileName: 'two.png', mimeType: 'image/png', fileKind: 1, size: 12 }),
    ])

    expect(items.map(item => item.file_asset_uid)).toEqual(['asset-added-two', 'asset-added-one', 'asset-existing-1'])
  })

  it('preserves forwarded recording segments and safe media without leaking source identities', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, { async openWorldImageRef() { throw new Error('unused') } }, { recordUid() { return '' } })
    // This projection must not query the private source, even for playable attachments.
    const chat = new ChatService(runtime, {} as SourceService, profile, media, {} as RecordService, {} as BotService, {} as ArkoService, {} as GroupAiPolishService, {
      emitChatClientEvent() {}, nextChatClientRevision() { return 1 }, scheduleChatSessionProjection() {},
    })
    const result = await chat.chatForwardRecordsPreview({ content_payload: {
      render_kind: 'forward_records', title: '会议快记', created_at: 1700000000,
      items: [{
        source_type: 'long_recording_segments', source_chat_session_uid: 'private-source', record_uid: 'private-record',
        owner_name: '小林', send_at: 1700000000, text: '完整内容',
        long_recording_segments: [{ speaker_number: 2, speaker_label: '同事', text: '讨论内容', start_millis: 1230, end_millis: 4560 }],
        files: [{ type: 2, name: '会议.m4a', mime_type: 'audio/mp4', download_url: 'https://jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com/a.m4a?Signature=private-signature' }],
      }, {
        source_type: 'chat_record', owner_name: '小乙',
        call_record_snapshot: { transcript_segments: [{ speaker_name: '小乙', text: '通话内容', start_ms: 0, end_ms: 1500, audio_url: 'https://jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com/b.wav' }] },
      }],
    } }, 42, 1)
    expect(result).toMatchObject({ title: '会议快记', createdAtMillis: 1700000000000, items: [{
      sourceType: 'long_recording_segments', sendAtMillis: 1700000000000,
      segments: [{ speakerName: '同事', textContent: '讨论内容', startMillis: 1230, endMillis: 4560 }],
      contentBlocks: [{ kind: 'audio', fileName: '会议.m4a', mediaRef: expect.any(String) }],
    }, { segments: [{ speakerName: '小乙', textContent: '通话内容', contentBlocks: [{ kind: 'audio', mediaRef: expect.any(String) }] }] }] })
    expect(JSON.stringify(result)).not.toMatch(/private-source|private-record|private-signature|https:/)
    const readSource = vi.fn(async () => ({ source: { sourceRef: 'received-source' }, items: [{ forwardRecords: result }], hasMore: false }))
    const owner = { readSource }
    const hostResult = await dispatchArkmeHostOperation(owner as never, 'source.timeline', { sourceRef: 'received-source' })
    const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
      const { operation, params } = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, value: await dispatchArkmeHostOperation(owner as never, operation, params) }))
    } })
    expect(await sdk.readSource('received-source')).toEqual(hostResult)
    const tool = createArkmeCoreToolDefinitions(owner as never).find(tool => tool.name === 'arkme_source_read')!
    const toolResult = await tool.execute({ source_ref: 'received-source' }, { signal: new AbortController().signal } as never)
    expect(toolResult).toContain('讨论内容')
    expect(toolResult).toContain('"startMillis": 1230')
    expect(toolResult).not.toMatch(/private-source|private-record|private-signature|https:/)
    const legacy = await chat.chatForwardRecordsPreview({ content_payload: {
      renderKind: 'forward_records', title: '', summaryLines: ['原作者：旧快照'], items: [],
    } }, 42, 0)
    expect(legacy).toEqual({ title: '转发快记', createdAtMillis: 0, summaryLines: ['原作者：旧快照'], items: [] })
    const many = await chat.chatForwardRecordsPreview({ content_payload: {
      render_kind: 'forward_records', items: Array.from({ length: 101 }, (_, i) => ({
        owner_name: '作者', text: `条目${i}`, long_recording_segments: i === 0 ? Array.from({ length: 501 }, () => ({ text: '片段' })) : [],
      })),
    } }, 42, 0)
    expect(many?.items).toHaveLength(100)
    expect(many?.truncated).toBe(true)
    expect(many?.items[0]?.segments).toHaveLength(500)
    expect(many?.items[0]?.truncated).toBe(true)
    expect(many?.items[0]?.segments?.[0]?.contentBlocks).toBeUndefined()
  })
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

  it('keeps the group nickname when contact remark enrichment fails', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(
      config,
      sessions,
      { async uniqueCode() { return 'device-secret' } } as StateStore,
      async input => {
        const path = new URL(String(input)).pathname
        if (path === '/api/v1/chats/read-receipts/detail') {
          return new Response(JSON.stringify({ code: 200, data: {
            chat_session_uid: 'group-1', record_uid: 'record-1', seq: 9,
            items: [{
              user_id: 7, member_name: '群昵称', display_name: '用户昵称',
              read_status: 'unread', read_at: 0,
            }],
          } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (path === '/api/v1/auth/get-public-users-by-ids') {
          return new Response(JSON.stringify({ code: 200, data: {
            items: [{ user_id: 7, nick_name: '用户昵称' }],
          } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        throw new Error(`unexpected path: ${path}`)
      },
    )
    const profile = new ProfileService(runtime)
    const source = new SourceService(runtime, profile, {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    const remarkLookup = vi.spyOn(source, 'privateRemarksByUserIds')
      .mockRejectedValue(new Error('contacts unavailable'))
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
    const sourceRef = await source.sealSourceRef(42, 'group_chat', 'group-1', '项目群')

    await expect(chat.messageReadReceiptDetail(sourceRef, 'record-1', 9)).resolves.toMatchObject({
      items: [{ displayName: '群昵称', readStatus: 'unread' }],
    })
    expect(remarkLookup).toHaveBeenCalledWith([7], {})
  })
})
