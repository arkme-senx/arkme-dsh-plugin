import { describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ArkoService } from '../../src/services/arko-service.js'
import { BotService } from '../../src/services/bot-service.js'
import { ChatService, projectArkmeConversationMemberJoinEvents } from '../../src/services/chat-service.js'
import { GroupAiPolishService } from '../../src/services/group-ai-polish-service.js'
import { MediaService } from '../../src/services/media-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { RecordService } from '../../src/services/record-service.js'
import { ArkmePluginError, ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
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

function snapshotActionRef(input: Partial<Record<string, unknown>> = {}): string {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    sourceKind: 'chat_relation',
    userId: 42,
    sourceOwnerRef: 'chat-1',
    chatSessionUid: 'chat-1',
    relationUid: 'rel-snapshot-1',
    recordOwnerUserId: 42,
    recordUid: 'record-snapshot-1',
    senderUserId: 42,
    senderName: '测试用户',
    title: '',
    textContent: '',
    sendAtMillis: 1_786_000_003_000,
    sourceSequence: 9,
    templateKind: 1,
    displayKind: 0,
    imageCount: 0,
    voiceCount: 0,
    fileCount: 0,
    fileNames: [],
    ...input,
  })).toString('base64url')
  const signature = createHmac('sha256', 'snapshot-test-signing-key').update(payload).digest('base64url')
  return `arkme-message-action-v1.${payload}.${signature}`
}

describe('ChatService', () => {
  it('propagates rich-send cancellation into human mention resolution', async () => {
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const authenticatedChatPost = vi.fn(async (path: string) => path === '/api/v1/chats/members/list'
      ? { items: [{ user_id: 7, status: 1 }] }
      : { record_uid: 'record-mention', rel_uid: 'relation-mention', seq: 9, audit_status: 1 })
    const runtime = {
      config: { richMediaSendEnabled: true, maxTextLength: 20_000 },
      stateStore: { uniqueCode: vi.fn(async () => 'mention-signing-key') },
      requireSession: vi.fn(async () => session),
      authenticatedChatPost,
    }
    const source = {
      openSourceRef: vi.fn(async () => ({
        version: 1, userId: 42, kind: 'group_chat', ownerRef: 'group-1', displayName: '群聊',
      })),
    }
    const realtime = {
      emitChatClientEvent: vi.fn(), nextChatClientRevision: vi.fn(() => 1),
      scheduleChatSessionProjection: vi.fn(),
    }
    const chat = new ChatService(
      runtime as never, source as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, realtime,
    )
    const payload = Buffer.from(JSON.stringify({
      version: 1, viewerUserId: 42, chatSessionUid: 'group-1', targetUserId: 7,
      displayNameSnapshot: '小林',
    }), 'utf8').toString('base64url')
    const mentionRef = `arkme-chat-human-mention-v1.${payload}.${createHmac('sha256', 'mention-signing-key')
      .update(`arkme-chat-human-mention-v1.${payload}`).digest('base64url')}`
    const signal = new AbortController().signal

    await expect(chat.sendSourceRich('source-ref', {
      textContent: '@小林 附件',
      humanMentions: [{ mentionRef, startIndex: 0, length: 3 }],
    }, { recordUid: 'record-mention', relationUid: 'relation-mention', signal }))
      .resolves.toMatchObject({ itemUid: 'record-mention', sequence: 9 })

    expect(authenticatedChatPost).toHaveBeenNthCalledWith(
      1,
      '/api/v1/chats/members/list',
      { chat_session_uid: 'group-1', active_only: true },
      session,
      signal,
    )
  })

  it('delegates rich write outcome tracking to the transport and leaves preflight failures unmarked', async () => {
    const attemptedFailure = new ArkmePluginError('arkme-network-error', '发送结果未知', true, 502, {
      writeOutcomeUnknown: true,
    })
    const knownFailure = new ArkmePluginError('arkme-code-1001', '载荷不合法', false, 502)
    const runtime = {
      config: { richMediaSendEnabled: true, maxTextLength: 20_000 },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn()
        .mockRejectedValueOnce(attemptedFailure)
        .mockRejectedValueOnce(knownFailure),
    }
    const source = { openSourceRef: vi.fn(async () => ({
      version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '同事',
    })) }
    const chat = new ChatService(
      runtime as never, source as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.sendSourceRich('source-ref', { textContent: '发送图片' }, {
      recordUid: 'record-1', relationUid: 'relation-1',
    })).rejects.toMatchObject({ code: 'arkme-network-error', writeOutcomeUnknown: true })
    await expect(chat.sendSourceRich('source-ref', { textContent: '发送图片' }, {
      recordUid: 'record-2', relationUid: 'relation-2',
    })).rejects.toHaveProperty('writeOutcomeUnknown', undefined)
    await expect(chat.sendSourceRich('source-ref', {
      textContent: '@成员', humanMentions: [{ mentionRef: 'mention-ref', startIndex: 0, length: 3 }],
    })).rejects.toHaveProperty('writeOutcomeUnknown', undefined)
    expect(runtime.authenticatedChatPost).toHaveBeenCalledTimes(2)
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/records/send', expect.anything(), expect.anything(), undefined,
      { trackWriteOutcome: true },
    )
  })

  it('passes browser capture metadata into send-to-self and default-category text writes', async () => {
    const runtime = {
      config: { maxTextLength: 20_000 },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
    }
    const source = {
      openSourceRef: vi.fn(),
      invalidateSourceListCache: vi.fn(),
    }
    const record = {
      createTextForConversation: vi.fn(async (recordUid: string) => ({ recordUid, status: 1, localState: 'synced' })),
    }
    const realtime = { invalidateRecordProjection: vi.fn(async () => undefined) }
    const chat = new ChatService(
      runtime as never, source as never, {} as never, {} as never, record as never,
      {} as never, {} as never, {} as never, realtime as never,
    )
    const captureContext = {
      clientName: 'Google Chrome（DeepSeek Harness）', networkName: '网络已连接', electric: 100, charge: 1,
    }

    for (const kind of ['send_to_self', 'default_category'] as const) {
      source.openSourceRef.mockResolvedValueOnce({ kind, ownerRef: kind })
      await expect(chat.sendSourceText(`opaque-${kind}`, '浏览器纯文字', {
        recordUid: `record-${kind}`,
        recordDurationMillis: 2_700,
        captureContext,
      })).resolves.toMatchObject({ localState: 'synced' })
    }
    expect(record.createTextForConversation).toHaveBeenNthCalledWith(
      1, 'record-send_to_self', '浏览器纯文字', { recordDurationMillis: 2_700, captureContext },
    )
    expect(record.createTextForConversation).toHaveBeenNthCalledWith(
      2, 'record-default_category', '浏览器纯文字', { recordDurationMillis: 2_700, captureContext },
    )
    expect(realtime.invalidateRecordProjection).toHaveBeenCalledTimes(2)
  })

  it('writes an explicitly captured location for every supported conversation source', async () => {
    const authenticatedPost = vi.fn(async () => ({}))
    const runtime = {
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedPost,
    }
    const source = { openSourceRef: vi.fn() }
    const chat = new ChatService(
      runtime as never, source as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )
    const location = {
      latitude: 30.52, longitude: 114.31, accuracyMeters: 18, altitudeMeters: 42,
      speedMetersPerSecond: 0, capturedAtMillis: 1_786_000_000_000,
    }

    for (const kind of ['private_chat', 'group_chat', 'send_to_self', 'default_category', 'topic'] as const) {
      source.openSourceRef.mockResolvedValueOnce({ kind, ownerRef: kind })
      await expect(chat.saveMessageLocation(`opaque-${kind}`, `record-${kind}`, location, undefined)).resolves.toBeUndefined()
    }
    expect(authenticatedPost).toHaveBeenCalledTimes(5)
    expect(authenticatedPost).toHaveBeenLastCalledWith(
      '/api/v1/records/location/set',
      {
        record_uid: 'record-topic',
        location: {
          source_kind: 1, lat: 30.52, lon: 114.31, accuracy: 18, alt: 42, speed: 0,
          captured_at: 1_786_000_000_000,
        },
      },
      expect.anything(),
      undefined,
    )
  })

  it('uses the signed chat relation to load the complete mounted record snapshot', async () => {
    const runtime = {
      config: { maxTextLength: 20_000 },
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async () => ({ item: {
        relation: { rel_uid: 'rel-snapshot-1', record_uid: 'record-snapshot-1', record_owner_user_id: 42, seq: 9, attach_at: 1_786_000_003_000 },
        record: { record_uid: 'record-snapshot-1', status: 1, payload: {
          text_content: '来自聊天投影的文本', location: { lat: 1, lon: 2, altitude: 99 }, position_detail: { address: '过期聊天地址' },
        } },
      } })),
      authenticatedPost: vi.fn(async () => ({
        record_core: {
          record_uid: 'record-snapshot-1', text_content: '完整快记文本', record_duration_millis: 2_400,
          create_at: 1_786_000_000_000, send_at: 1_786_000_003_000, upload_at: 1_786_000_004_000, status: 1,
          content_payload: JSON.stringify({ network: 'WiFi（senguoyun_5G）' }),
        },
        // The real detail contract keeps these outside record_core. They must
        // survive the hydration merge just as they do in the Flutter parser.
        location: { lat: 30.1, lon: 120.2, altitude: 12, speed: 0 },
        position_detail: { address: '武汉市洪山区高新大道', weather: { temp: 30, condition_ch: 'Windy' } },
        record_extra: JSON.stringify({ capture_context: { client_name: 'ts\'s MacBook Pro', electric: 81, charge: 1 }, background_sound_amplitudes: [1, 2, 3] }),
      })),
    }
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'group_chat', ownerRef: 'chat-1' })) }
    const chat = new ChatService(runtime as never, source as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)

    await expect(chat.messageSnapshotDetail('opaque-source', snapshotActionRef())).resolves.toMatchObject({
      itemUid: 'record-snapshot-1', textContent: '完整快记文本', recordDurationMillis: 2_400,
      weather: '30° Windy', altitudeMeters: 12, movement: '静止', locationLabel: '武汉市洪山区高新大道',
      captureContext: { clientName: 'ts\'s MacBook Pro', networkName: 'WiFi（senguoyun_5G）', electric: 81, charge: 1 },
      backgroundSound: 'available', syncState: 'synced',
    })
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith('/api/v1/chats/records/detail', {
      chat_session_uid: 'chat-1', record_uid: 'record-snapshot-1', record_owner_user_id: 42, rel_uid: 'rel-snapshot-1', seq: 9,
    }, expect.anything(), undefined, expect.anything())
    expect(runtime.authenticatedPost).toHaveBeenCalledWith('/api/v1/records/detail', {
      record_uid: 'record-snapshot-1',
    }, expect.anything(), undefined, expect.anything())
  })

  it('uses Flutter record timestamps and location context when the detail core has no weather', async () => {
    const runtime = {
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async () => ({ item: {
        relation: { rel_uid: 'rel-snapshot-flutter', record_uid: 'record-snapshot-flutter', record_owner_user_id: 42, seq: 1, attach_at: 1_786_000_000_000 },
        record: { record_uid: 'record-snapshot-flutter', status: 1, payload: { text_content: '聊天消息' } },
      } })),
      authenticatedPost: vi.fn(async (path: string) => path === '/api/v1/records/detail'
        ? { record_core: {
            record_uid: 'record-snapshot-flutter', text_content: 'Flutter 发送的快记', status: 1,
            // Older records can expose only send_at. Flutter uses it as the
            // creation-time fallback, so the plugin must do the same.
            send_at: 1_786_000_000_000,
            update_time_stamp: 1_786_000_004_000,
            // A stale payload timestamp must never hide the record-core one.
            payload: { create_time_stamp: 0, location: { lat: 30.1, lon: 120.2, altitude: 0 } },
          } }
        : {
            record_uid: 'record-snapshot-flutter',
            position_detail: { address: '武汉市洪山区九峰街道', weather: { temp: 30, condition_ch: 'Windy' } },
          }),
    }
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'private_chat', ownerRef: 'chat-1' })) }
    const chat = new ChatService(runtime as never, source as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)

    await expect(chat.messageSnapshotDetail('opaque-source', snapshotActionRef({
      relationUid: 'rel-snapshot-flutter', recordUid: 'record-snapshot-flutter', sourceSequence: 1, sendAtMillis: 1_786_000_000_000,
    }))).resolves.toMatchObject({
      itemUid: 'record-snapshot-flutter',
      startAtMillis: 1_786_000_000_000,
      completeAtMillis: 1_786_000_004_000,
      syncState: 'synced',
      weather: '30° Windy',
      altitudeMeters: 0,
      locationCapture: { latitude: 30.1, longitude: 120.2, altitudeMeters: 0 },
    })
    expect(runtime.authenticatedPost).toHaveBeenCalledWith('/api/v1/records/location/context/get', {
      record_uid: 'record-snapshot-flutter',
    }, expect.anything(), undefined, expect.anything())
  })

  it('refuses another sender’s signed snapshot before any remote detail request', async () => {
    const runtime = {
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(),
      authenticatedPost: vi.fn(),
    }
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'group_chat', ownerRef: 'chat-1' })) }
    const chat = new ChatService(runtime as never, source as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)

    await expect(chat.messageSnapshotDetail('opaque-source', snapshotActionRef({
      senderUserId: 7,
      recordOwnerUserId: 7,
    }))).rejects.toMatchObject({ code: 'message-snapshot-not-owned' })
    expect(runtime.authenticatedChatPost).not.toHaveBeenCalled()
    expect(runtime.authenticatedPost).not.toHaveBeenCalled()
  })

  it('rejects an empty record-detail response instead of rendering sparse chat fields as a complete snapshot', async () => {
    const runtime = {
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async () => ({ item: {
        relation: { rel_uid: 'rel-snapshot-1', record_uid: 'record-snapshot-1', record_owner_user_id: 42, seq: 9 },
        record: { record_uid: 'record-snapshot-1', payload: { text_content: '仅聊天气泡里的文本' } },
      } })),
      authenticatedPost: vi.fn(async () => ({})),
    }
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'private_chat', ownerRef: 'chat-1' })) }
    const chat = new ChatService(runtime as never, source as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)

    await expect(chat.messageSnapshotDetail('opaque-source', snapshotActionRef()))
      .rejects.toMatchObject({ code: 'message-snapshot-detail-unavailable' })
  })

  it('loads a send-to-self record snapshot directly from its signed record reference', async () => {
    const runtime = {
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(),
      authenticatedPost: vi.fn(async (path: string) => path === '/api/v1/records/detail'
        ? { record_core: {
            record_uid: 'record-self-1', text_content: '发给自己的完整快记', status: 1,
            createdAt: 1_786_000_000_000, send_at: 1_786_000_003_000, upload_at: 1_786_000_004_000,
            payload: { createdAt: 0, capture_context: { client_name: 'Arkme Desktop', network_name: 'WiFi', electric: 100, charge: 2 } },
          } }
        : { record_uid: 'record-self-1', weather: { temp: 30, condition_ch: 'Windy' } }),
    }
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'send_to_self', ownerRef: 'self' })) }
    const chat = new ChatService(runtime as never, source as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)

    await expect(chat.messageSnapshotDetail('opaque-source', snapshotActionRef({
      sourceKind: 'record', sourceOwnerRef: 'self', chatSessionUid: '', relationUid: '',
      recordUid: 'record-self-1', recordOwnerUserId: 42, senderUserId: 42, sourceSequence: 0,
    }))).resolves.toMatchObject({
      itemUid: 'record-self-1', textContent: '发给自己的完整快记',
      captureContext: { clientName: 'Arkme Desktop', networkName: 'WiFi', electric: 100, charge: 2 },
      startAtMillis: 1_786_000_000_000, weather: '30° Windy',
      syncState: 'synced',
    })
    expect(runtime.authenticatedChatPost).not.toHaveBeenCalled()
    expect(runtime.authenticatedPost).toHaveBeenCalledWith('/api/v1/records/detail', { record_uid: 'record-self-1' }, expect.anything(), undefined, expect.anything())
    expect(runtime.authenticatedPost).toHaveBeenCalledWith('/api/v1/records/location/context/get', { record_uid: 'record-self-1' }, expect.anything(), undefined, expect.anything())
  })

  it('rejects a location-context response belonging to a different quick-memory record', async () => {
    const runtime = {
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async () => ({ item: {
        relation: { rel_uid: 'rel-snapshot-1', record_uid: 'record-snapshot-1', record_owner_user_id: 42, seq: 9 },
        record: { record_uid: 'record-snapshot-1', payload: { text_content: '消息' } },
      } })),
      authenticatedPost: vi.fn(async (path: string) => path === '/api/v1/records/detail'
        ? { record_core: { record_uid: 'record-snapshot-1', text_content: '消息', send_at: 1_786_000_000_000, status: 1 } }
        : { record_uid: 'another-record', weather: { temp: 30, condition_ch: 'Windy' } }),
    }
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'private_chat', ownerRef: 'chat-1' })) }
    const chat = new ChatService(runtime as never, source as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)

    await expect(chat.messageSnapshotDetail('opaque-source', snapshotActionRef()))
      .rejects.toMatchObject({ code: 'message-snapshot-detail-mismatch' })
  })

  it('keeps the location-context envelope identity when context fields are nested', async () => {
    const runtime = {
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async () => ({ item: {
        relation: { rel_uid: 'rel-snapshot-1', record_uid: 'record-snapshot-1', record_owner_user_id: 42, seq: 9 },
        record: { record_uid: 'record-snapshot-1', payload: { text_content: '消息' } },
      } })),
      authenticatedPost: vi.fn(async (path: string) => path === '/api/v1/records/detail'
        ? { record_core: { record_uid: 'record-snapshot-1', text_content: '消息', send_at: 1_786_000_000_000, status: 1 } }
        : { record_uid: 'another-record', data: { weather: { temp: 30, condition_ch: 'Windy' } } }),
    }
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'private_chat', ownerRef: 'chat-1' })) }
    const chat = new ChatService(runtime as never, source as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)

    await expect(chat.messageSnapshotDetail('opaque-source', snapshotActionRef()))
      .rejects.toMatchObject({ code: 'message-snapshot-detail-mismatch' })
  })

  it('attaches a usable snapshot reference to records shown in the send-to-self timeline', async () => {
    const runtime = {
      config: { maxTextLength: 20_000 },
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedPost: vi.fn(async (path: string) => path === '/api/v1/home/feed/query'
        ? { items: [{ record_uid: 'record-self-timeline', text_content: '发给自己的消息' }], has_more: false }
        : { record_core: { record_uid: 'record-self-timeline', text_content: '发给自己的消息', status: 1 } }),
    }
    const source = {
      openSourceRef: vi.fn(async () => ({ kind: 'send_to_self', ownerRef: 'self' })),
      sourceItem: vi.fn(async () => ({ sourceRef: 'opaque-source', kind: 'send_to_self', displayName: '发给自己', activeAtMillis: 0, unreadCount: 0 })),
    }
    const record = {
      recordUid: vi.fn((raw: { record_uid: string }) => raw.record_uid),
      recordTimelineItemFromRaw: vi.fn((raw: { record_uid: string; text_content: string }) => ({
        itemUid: raw.record_uid, senderName: '我', isMe: true, sendAtMillis: 1_786_000_003_000,
        title: '', textContent: raw.text_content, status: 1,
      })),
    }
    const media = { hydrateRecordMediaPage: vi.fn(async () => ({ displayItemsByRecordUid: new Map(), unavailableRecordUids: new Set() })) }
    const privacy = { lockedRecordUids: vi.fn(async () => new Set<string>()) }
    const chat = new ChatService(
      runtime as never, source as never, {} as never, media as never, record as never, {} as never, {} as never, {} as never, {} as never, privacy as never,
    )

    const page = await chat.readSource('opaque-source')
    const item = page.items[0]!
    expect(item.messageActionRef).toMatch(/^arkme-message-action-v1\./u)
    await expect(chat.messageSnapshotDetail('opaque-source', item.messageActionRef ?? '')).resolves.toMatchObject({ itemUid: 'record-self-timeline' })
  })

  it('keeps the authoritative relation owner and detail reference on realtime timeline items', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const runtime = {
      config: { maxTextLength: 20_000 },
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        requests.push({ path, body })
        return { item: {
          relation: { rel_uid: 'rel-realtime-1', record_uid: 'record-realtime-1', record_owner_user_id: 42, seq: 18, attach_at: 1_786_000_003_000 },
          record: { record_uid: 'record-realtime-1', status: 1, create_time_stamp: 1_786_000_000_000, send_time_stamp: 1_786_000_003_000, payload: { text_content: '实时消息' } },
        } }
      }),
      authenticatedPost: vi.fn(async () => ({ record_core: {
        record_uid: 'record-realtime-1', status: 1, create_time_stamp: 1_786_000_000_000,
        send_time_stamp: 1_786_000_003_000, payload: { text_content: '实时消息' },
      } })),
    }
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'group_chat', ownerRef: 'chat-1' })) }
    const profile = { sealProfileImageRef: vi.fn(async () => 'avatar-ref') }
    const media = { richContentBlocks: vi.fn(() => []), recordContentPayload: vi.fn(() => ({})) }
    const chat = new ChatService(
      runtime as never, source as never, profile as never, media as never, {} as never, {} as never,
      { currentUserAgentSourceFallback: vi.fn((_userId: number, agentSource: unknown) => agentSource) } as never,
      { timelineAiPolish: vi.fn(() => undefined) } as never, {} as never,
    )

    const [item] = await chat.chatTimelineItems({ items: [{
      relation: {
        rel_uid: 'rel-realtime-1', record_uid: 'record-realtime-1', record_owner_user_id: 42,
        sender_user_id: 42, display_name_snapshot: '测试用户', seq: 18, attach_at: 1_786_000_003_000,
      },
      // A copied payload may claim another user. The relation owner must win.
      record: { status: 1, user_id: 999, payload: { record_uid: 'record-realtime-1', text_content: '实时消息' } },
    }] }, { userId: 42, accessToken: 'access', refreshToken: 'refresh' }, 'chat-1')

    expect(item?.messageActionRef).toMatch(/^arkme-message-action-v1\./u)
    await expect(chat.messageSnapshotDetail('opaque-source', item?.messageActionRef ?? '')).resolves.toMatchObject({
      itemUid: 'record-realtime-1', startAtMillis: 1_786_000_000_000,
    })
    expect(requests).toEqual([{
      path: '/api/v1/chats/records/detail',
      body: {
        chat_session_uid: 'chat-1', record_uid: 'record-realtime-1', record_owner_user_id: 42,
        rel_uid: 'rel-realtime-1', seq: 18,
      },
    }])
  })

  it('projects a direct Bot timeline by canonical actor and sequence without human hydration', async () => {
    const runtime = {
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        expect(path).toBe('/api/v1/chat/timeline/page')
        expect(body).toEqual({ chat_session_uid: 'chat-bot-1', before_seq: 0, limit: 100 })
        return {
          chat_session_uid: 'chat-bot-1',
          items: [
            {
              relation: { rel_uid: 'rel-2', record_uid: 'record-2', seq: 2, sender_user_id: 9001, sender_actor_kind: 2, sender_bot_uid: 'bot-1', attach_at: 200 },
              record: { status: 1, payload: { record_uid: 'record-2', text_content: '回复', send_at: 200 } },
            },
            {
              relation: { rel_uid: 'rel-1', record_uid: 'record-1', seq: 1, sender_user_id: 42, sender_actor_kind: 1, attach_at: 100 },
              record: { status: 1, payload: { record_uid: 'record-1', text_content: '提问', send_at: 100 } },
            },
            {
              relation: { rel_uid: 'rel-2', record_uid: 'record-2', seq: 2, sender_user_id: 9001, sender_actor_kind: 2, sender_bot_uid: 'bot-1', attach_at: 201 },
              record: { status: 1, payload: { record_uid: 'record-2', text_content: '重复投影', send_at: 201 } },
            },
            {
              relation: { rel_uid: 'rel-3', record_uid: 'record-3', seq: 3, sender_user_id: 9001, sender_actor_kind: 2, sender_bot_uid: 'bot-1', attach_at: 300 },
              record: { status: 2, payload: { record_uid: 'record-3', text_content: '不可展示的 Record', send_at: 300 } },
            },
          ],
        }
      }),
    }
    const profile = { publicProfilesByUserIds: vi.fn(), sealProfileImageRef: vi.fn() }
    const media = { richContentBlocks: vi.fn((item: unknown) => {
      const recordUid = String(((item as { relation?: { record_uid?: string } }).relation?.record_uid ?? ''))
      return recordUid === 'record-2' ? [{
        kind: 'file', mediaRef: 'secret-media-ref', fileName: 'report.pdf', mimeType: 'application/pdf', size: 10, sortOrder: 0,
      }] : []
    }) }
    const chat = new ChatService(
      runtime as never, {} as never, profile as never, media as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.readDirectBotConversation('bot-1', 'chat-bot-1')).resolves.toEqual({
      messages: [
        {
          messageId: 'rel-1', recordUid: 'record-1', role: 'user', content: '提问', status: 'sent',
          createdAtMillis: 100, attachments: [],
        },
        {
          messageId: 'rel-2', recordUid: 'record-2', role: 'assistant', content: '回复', status: 'sent',
          createdAtMillis: 200,
          attachments: [{
            kind: 'file', fileName: 'report.pdf', mimeType: 'application/pdf', size: 10,
            durationMillis: 0, width: 0, height: 0, sortOrder: 0,
          }],
        },
      ],
      latestSequence: 3,
    })
    expect(profile.publicProfilesByUserIds).not.toHaveBeenCalled()
    expect(profile.sealProfileImageRef).not.toHaveBeenCalled()
  })

  it('keeps relation identity separate from owner-scoped Record identity', async () => {
    const runtime = {
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async () => ({
        chat_session_uid: 'chat-bot-1',
        items: [
          {
            relation: {
              rel_uid: 'rel-user', record_uid: 'shared-record', record_owner_user_id: 42,
              seq: 1, sender_user_id: 42, sender_actor_kind: 1, attach_at: 100,
            },
            record: { status: 1, payload: { record_uid: 'shared-record', text_content: '用户消息' } },
          },
          {
            relation: {
              rel_uid: 'rel-bot', record_uid: 'shared-record', record_owner_user_id: 9001,
              seq: 2, sender_user_id: 9001, sender_actor_kind: 2, sender_bot_uid: 'bot-1', attach_at: 200,
            },
            record: { status: 1, payload: { record_uid: 'shared-record', text_content: 'Bot 消息' } },
          },
        ],
      })),
    }
    const chat = new ChatService(
      runtime as never, {} as never, {} as never, { richContentBlocks: vi.fn(() => []) } as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.readDirectBotConversation('bot-1', 'chat-bot-1')).resolves.toMatchObject({
      messages: [
        { messageId: 'rel-user', recordUid: 'shared-record', role: 'user' },
        { messageId: 'rel-bot', recordUid: 'shared-record', role: 'assistant' },
      ],
    })
  })

  it('fails closed when relation and hydrated Record identities disagree', async () => {
    const runtime = {
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async () => ({ chat_session_uid: 'chat-bot-1', items: [{
        relation: {
          rel_uid: 'rel-1', record_uid: 'record-1', record_owner_user_id: 42,
          seq: 1, sender_user_id: 42, sender_actor_kind: 1, attach_at: 100,
        },
        record: { status: 1, payload: { record_uid: 'other-record', text_content: '错位消息' } },
      }] })),
    }
    const chat = new ChatService(
      runtime as never, {} as never, {} as never, { richContentBlocks: vi.fn(() => []) } as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.readDirectBotConversation('bot-1', 'chat-bot-1'))
      .rejects.toMatchObject({ code: 'bot-chat-timeline-contract-invalid' })
  })

  it('fails closed when a direct Bot timeline contains another actor', async () => {
    const runtime = {
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async () => ({ chat_session_uid: 'chat-bot-1', items: [{
        relation: { rel_uid: 'rel-1', record_uid: 'record-1', seq: 1, sender_user_id: 9002, sender_actor_kind: 2, sender_bot_uid: 'other-bot', attach_at: 100 },
        record: { status: 1, payload: { record_uid: 'record-1', text_content: '错误 actor' } },
      }] })),
    }
    const chat = new ChatService(
      runtime as never, {} as never, {} as never, { richContentBlocks: vi.fn(() => []) } as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.readDirectBotConversation('bot-1', 'chat-bot-1'))
      .rejects.toMatchObject({ code: 'bot-chat-timeline-contract-invalid' })
  })

  it('projects a realtime message action ref and resolves its related-note locator', async () => {
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const runtime = {
      requireSession: vi.fn(async () => session),
      stateStore: { async uniqueCode() { return 'device-secret' } },
      config: { maxTextLength: 20_000 },
    }
    const source = {
      openSourceRef: vi.fn(async () => ({
        version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '同事',
      })),
    }
    const profile = { sealProfileImageRef: vi.fn(async () => 'opaque-avatar') }
    const media = {
      recordContentPayload: vi.fn(() => ({})),
      richContentBlocks: vi.fn(() => []),
    }
    const arko = { currentUserAgentSourceFallback: vi.fn(() => undefined) }
    const aiPolish = { timelineAiPolish: vi.fn(() => undefined) }
    const chat = new ChatService(
      runtime as never, source as never, profile as never, media as never, {} as never,
      {} as never, arko as never, aiPolish as never, {} as never,
    )
    const items = await chat.chatTimelineItems({ items: [{
      relation: {
        record_uid: 'record-b', rel_uid: 'relation-b', sender_user_id: 13,
        record_owner_user_id: 13, display_name_snapshot: 'B 用户', attach_at: 1_710_000_000_000, seq: 8,
      },
      record: { status: 1, payload: { title: '', text_content: '问题不大', template_kind: 1, display_kind: 0 } },
    }] }, session, 'chat-1')

    expect(items[0]?.messageActionRef).toMatch(/^arkme-message-action-v1\./u)
    await expect(chat.relatedQuickNoteLocator('source-ref', items[0]?.messageActionRef ?? ''))
      .resolves.toEqual({
        viewerUserId: 42,
        sourceRef: 'source-ref',
        sourceOwnerRef: 'chat-1',
        contextType: 'chat',
        recordUid: 'record-b',
        recordOwnerUserId: 13,
        chatSessionUid: 'chat-1',
      })
  })

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
      invalidateRecordProjection: vi.fn(async () => undefined),
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
    expect(realtime.invalidateRecordProjection).toHaveBeenCalledOnce()
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

  it('projects shared recording memory cards from flat and split chat payloads', () => {
    const media = {
      recordContentPayload(raw: unknown): Record<string, unknown> {
        const root = raw as Record<string, unknown>
        const record = (root.record ?? {}) as Record<string, unknown>
        const rawRecordPayload = record.payload
        const recordPayload = typeof rawRecordPayload === 'string'
          ? JSON.parse(rawRecordPayload) as Record<string, unknown>
          : (rawRecordPayload ?? {}) as Record<string, unknown>
        const payload = root.content_payload ?? root.contentPayload
          ?? recordPayload.content_payload ?? recordPayload.contentPayload
          ?? record.content_payload ?? record.contentPayload
        return (payload !== null && typeof payload === 'object') ? payload as Record<string, unknown> : {}
      },
    }
    const chat = new ChatService(
      {} as ServiceRuntime, {} as SourceService, {} as ProfileService, media as MediaService,
      {} as RecordService, {} as BotService, {} as ArkoService, {} as GroupAiPolishService,
      { emitChatClientEvent() {}, nextChatClientRevision() { return 1 }, scheduleChatSessionProjection() {} },
    )

    const flat = chat.chatSharedRecordingPreview({ content_payload: {
      render_kind: 'shared_recording_memory',
      source_digest: 'digest-flat',
      shared_by_user_id: 42,
      shared_at: 1_782_299_000_000,
      display_at: 1_782_300_000_000,
      end_at: 1_782_303_000_000,
      time_range_text: '21:00 - 22:00',
      title: '产品复盘',
      summary: '讨论了共享方案，并明确了后续任务和风险控制。',
      transcript: '录音原文',
      participants: [
        { ref_user_id: 42, display_name: '小杨', role: 1 },
        { ref_user_id: 43, display_name: '老黄', role: 1 },
      ],
    } })
    expect(flat).toMatchObject({
      sourceDigest: 'digest-flat',
      sharedByUserId: 42,
      displayAtMillis: 1_782_300_000_000,
      endAtMillis: 1_782_303_000_000,
      timeRangeText: '21:00 - 22:00',
      title: '产品复盘',
      summary: '讨论了共享方案，并明确了后续任务和风险控制。',
      transcript: '录音原文',
      transcriptAvailable: true,
      participants: [
        { refUserId: 42, displayName: '小杨', role: 1 },
        { refUserId: 43, displayName: '老黄', role: 1 },
      ],
    })

    const split = chat.chatSharedRecordingPreview({
      relation: {
        render_content_payload: JSON.stringify({
          render_kind: 'shared_recording_memory',
          source_digest: 'digest-split',
          shared_by_user_id: 42,
          shared_at: 1_782_299_000_000,
          display_at: 1_782_300_000_000,
          end_at: 1_782_303_000_000,
        }),
      },
      record: {
        payload: JSON.stringify({
          content_payload: {
            shared_recording: {
              source_digest: 'digest-split',
              title: '线下同步',
              summary: '明确了下一步。',
              participants: [{ display_name: '小杨', role: 1 }],
            },
          },
        }),
      },
    })
    expect(split).toMatchObject({
      sourceDigest: 'digest-split',
      sharedByUserId: 42,
      displayAtMillis: 1_782_300_000_000,
      title: '线下同步',
      summary: '明确了下一步。',
      transcriptAvailable: false,
      participants: [{ displayName: '小杨' }],
    })

    const mobileShape = chat.chatSharedRecordingPreview({ content_payload: {
      render_kind: 'shared_recording_memory',
      source_digest: 'digest-mobile',
      display_at: '1782300000000',
      end_at: '1782300300000',
      title: '路线讨论',
      summary_text: '讨论回家路线。',
      participant_ls: [
        { ref_usr_id: '42', display_name: '我', role: 1 },
        { nick_name: '其他说话人', role: 1 },
      ],
      transcript_ls: [
        { speaker_name: '我', text: '光谷4日到the光。' },
        { speaker_name: '其他说话人', text_content: '嗯。' },
      ],
    } })
    expect(mobileShape).toMatchObject({
      sourceDigest: 'digest-mobile',
      displayAtMillis: 1_782_300_000_000,
      title: '路线讨论',
      summary: '讨论回家路线。',
      transcript: '我：光谷4日到the光。\n其他说话人：嗯。',
      transcriptAvailable: true,
      participants: [
        { refUserId: 42, displayName: '我', role: 1 },
        { displayName: '其他说话人', role: 1 },
      ],
    })

    expect(chat.chatSharedRecordingPreview({
      relation: {
        render_content_payload: { render_kind: 'shared_recording_memory', source_digest: 'digest-a', display_at: 1 },
      },
      record: {
        payload: { content_payload: { shared_recording: { source_digest: 'digest-b', title: '不匹配', summary: '不应展示' } } },
      },
    })).toBeUndefined()
  })

  it('opens shared recording details from an opaque chat-card reference', async () => {
    const detailRequests: { path: string; body: Record<string, unknown> }[] = []
    const runtime = {
      config: { maxTextLength: 20_000 },
      stateStore: { uniqueCode: vi.fn(async () => 'test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        detailRequests.push({ path, body })
        return { item: { content_payload: {
          render_kind: 'shared_recording_memory',
          source_digest: 'digest-detail',
          display_at: 1_782_300_000_000,
          end_at: 1_782_303_000_000,
          time_range_text: '22:48 - 23:01',
          title: '抵达光谷四路与回家路线讨论',
          summary: '详情摘要',
          transcript: '完整录音原文',
          participant_ls: [{ ref_usr_id: 7, display_name: '落日', role: 1 }],
        } } }
      }),
    }
    const media = {
      recordContentPayload(raw: unknown): Record<string, unknown> {
        const root = raw as Record<string, unknown>
        const direct = root.content_payload ?? root.contentPayload
        if (direct !== null && typeof direct === 'object') return direct as Record<string, unknown>
        const record = (root.record ?? {}) as Record<string, unknown>
        const payload = (record.payload ?? {}) as Record<string, unknown>
        const nested = payload.content_payload ?? payload.contentPayload
        return nested !== null && typeof nested === 'object' ? nested as Record<string, unknown> : {}
      },
      richContentBlocks: vi.fn(() => []),
    }
    const profile = { sealProfileImageRef: vi.fn(async () => 'avatar-ref') }
    const chat = new ChatService(
      runtime as never, {} as SourceService, profile as never, media as never,
      {} as RecordService, {} as BotService, {} as ArkoService,
      { timelineAiPolish: vi.fn(() => undefined) } as never,
      { emitChatClientEvent() {}, nextChatClientRevision() { return 1 }, scheduleChatSessionProjection() {} },
    )
    const items = await chat.chatTimelineItems({ items: [{
      relation: {
        rel_uid: 'rel-1',
        record_uid: 'record-1',
        sender_user_id: 7,
        display_name_snapshot: '落日',
        attach_at: 1_782_300_000_000,
        seq: 23,
      },
      record: {
        status: 1,
        record_owner_user_id: 7,
        payload: { content_payload: {
          render_kind: 'shared_recording_memory',
          source_digest: 'digest-detail',
          display_at: 1_782_300_000_000,
          end_at: 1_782_303_000_000,
          title: '抵达光谷四路与回家路线讨论',
          summary: '预览摘要',
        } },
      },
    }] }, { userId: 42, accessToken: 'access', refreshToken: 'refresh' }, 'chat-session-1')
    const detailRef = items[0]?.sharedRecording?.detailRef
    expect(detailRef).toMatch(/^arkme-shared-recording-detail-v1\./u)
    await expect(chat.sharedRecordingDetail(detailRef ?? '')).resolves.toMatchObject({
      sourceDigest: 'digest-detail',
      detailRef,
      summary: '详情摘要',
      transcript: '完整录音原文',
      transcriptAvailable: true,
      participants: [{ refUserId: 7, displayName: '落日' }],
    })
    expect(detailRequests).toEqual([{
      path: '/api/v1/chats/records/detail',
      body: {
        chat_session_uid: 'chat-session-1',
        record_uid: 'record-1',
        record_owner_user_id: 7,
        rel_uid: 'rel-1',
        seq: 23,
      },
    }])
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
