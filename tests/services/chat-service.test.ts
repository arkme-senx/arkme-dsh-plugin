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

function messageActionPayload(actionRef: string): Record<string, unknown> {
  const [, payload = ''] = actionRef.split('.')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
}

function chatMemberRef(
  viewerUserId: number,
  chatSessionUid: string,
  targetUserId: number,
  signingKey = 'member-signing-key',
): string {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    viewerUserId,
    chatSessionUid,
    targetUserId,
  }), 'utf8').toString('base64url')
  const signature = createHmac('sha256', signingKey).update(payload).digest('base64url')
  return `arkme-chat-member-v1.${payload}.${signature}`
}

describe('ChatService', () => {
  it('projects a private-chat extension child with the desktop parent preview contract', async () => {
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const sourceItem = {
      sourceRef: 'source-private', sourceKey: 'chat:private', kind: 'private_chat' as const,
      displayName: '同事', activeAtMillis: 0, unreadCount: 0,
    }
    const runtime = {
      config: { maxTextLength: 20_000 },
      requireSession: vi.fn(async () => session),
      stateStore: { uniqueCode: vi.fn(async () => 'timeline-extension-signing-key') },
      authenticatedChatPost: vi.fn(async () => ({
        items: [{
          relation: {
            chat_session_uid: 'chat-private', rel_uid: 'relation-child', record_uid: 'record-child',
            record_owner_user_id: 42, sender_user_id: 42, display_name_snapshot: '我', seq: 12,
            attach_at: 1_786_000_010_000,
          },
          record: { status: 1, payload: {
            record_uid: 'record-child', title: '', text_content: '延展正文', template_kind: 1, display_kind: 0,
          } },
          extension_edge: {
            parent_record_uid: 'record-parent', parent_record_owner_user_id: 7,
            root_record_uid: 'record-parent', root_record_owner_user_id: 7,
          },
          extension_parent_preview: {
            relation: {
              chat_session_uid: 'chat-private', rel_uid: 'relation-parent', record_uid: 'record-parent',
              record_owner_user_id: 7, sender_user_id: 7, display_name_snapshot: '同事', seq: 11,
              attach_at: 1_786_000_000_000,
            },
            record: { status: 1, payload: {
              record_uid: 'record-parent', title: '', text_content: '原消息内容', template_kind: 2, display_kind: 0,
            } },
          },
        }],
        has_more: false,
      })),
    }
    const source = {
      openSourceRef: vi.fn(async () => ({
        version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-private', displayName: '同事',
      })),
      sourceItem: vi.fn(async () => sourceItem),
    }
    const media = {
      recordContentPayload: vi.fn(() => ({})),
      richContentBlocks: vi.fn((raw: unknown) => {
        const relation = (raw as { relation?: { record_uid?: string } }).relation
        return relation?.record_uid === 'record-parent' ? [{
          kind: 'image', mediaRef: 'parent-image-ref', fileName: 'parent.png', mimeType: 'image/png', size: 12, sortOrder: 0,
        }] : []
      }),
    }
    const chat = new ChatService(
      runtime as never, source as never, { publicProfilesByUserIds: vi.fn(async () => new Map()) } as never,
      media as never, {} as never, {} as never,
      { currentUserAgentSourceFallback: vi.fn(() => undefined) } as never,
      { timelineAiPolish: vi.fn(() => undefined) } as never, {} as never,
    )

    const page = await chat.readSource('source-private')

    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      itemUid: 'record-child', textContent: '延展正文', extensionParentRecordUid: 'record-parent',
      extensionParent: {
        itemUid: 'record-parent', senderName: '同事', textContent: '原消息内容',
        recordOwnerUserId: 7, sequence: 11, sendAtMillis: 1_786_000_000_000,
        contentBlocks: [{ kind: 'image', mediaRef: 'parent-image-ref', fileName: 'parent.png' }],
      },
    })
  })

  it('loads a continuous chat window around an extension parent for exact cross-page location', async () => {
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const sourceItem = {
      sourceRef: 'source-private', sourceKey: 'chat:private', kind: 'private_chat' as const,
      displayName: '同事', activeAtMillis: 0, unreadCount: 0,
    }
    const runtime = {
      config: { maxTextLength: 20_000 },
      requireSession: vi.fn(async () => session),
      stateStore: { uniqueCode: vi.fn(async () => 'timeline-around-signing-key') },
      authenticatedChatPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        expect(path).toBe('/api/v1/chat/timeline/around')
        expect(body).toEqual({
          chat_session_uid: 'chat-private', record_uid: 'record-parent', record_owner_user_id: 7,
          before_limit: 20, after_limit: 20,
        })
        return {
          chat_session_uid: 'chat-private', anchor_seq: 11, anchor_index: 1,
          items: [
            { relation: { rel_uid: 'rel-10', record_uid: 'record-10', record_owner_user_id: 7, sender_user_id: 7, display_name_snapshot: '同事', seq: 10, attach_at: 1000 }, record: { status: 1, payload: { record_uid: 'record-10', text_content: 'before' } } },
            { relation: { rel_uid: 'rel-parent', record_uid: 'record-parent', record_owner_user_id: 7, sender_user_id: 7, display_name_snapshot: '同事', seq: 11, attach_at: 1100 }, record: { status: 1, payload: { record_uid: 'record-parent', text_content: 'anchor' } } },
            { relation: { rel_uid: 'rel-12', record_uid: 'record-12', record_owner_user_id: 42, sender_user_id: 42, display_name_snapshot: '我', seq: 12, attach_at: 1200 }, record: { status: 1, payload: { record_uid: 'record-12', text_content: 'after' } } },
          ],
          older_has_more: true, older_cursor_seq: 10,
          newer_has_more: true, newer_cursor_seq: 12, latest_known_seq: 30,
        }
      }),
    }
    const source = {
      openSourceRef: vi.fn(async () => ({ version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-private', displayName: '同事' })),
      sourceItem: vi.fn(async () => sourceItem),
    }
    const chat = new ChatService(
      runtime as never, source as never,
      { publicProfilesByUserIds: vi.fn(async () => new Map()), sealProfileImageRef: vi.fn(async () => 'avatar-ref') } as never,
      { richContentBlocks: vi.fn(() => []), recordContentPayload: vi.fn(() => ({})) } as never, {} as never, {} as never,
      { currentUserAgentSourceFallback: vi.fn(() => undefined) } as never,
      { timelineAiPolish: vi.fn(() => undefined) } as never, {} as never,
    )

    const page = await chat.readSourceAround('source-private', 'record-parent', 7, { beforeLimit: 20, afterLimit: 20 })

    expect(page).toMatchObject({
      source: sourceItem, anchorItemUid: 'record-parent', anchorSequence: 11, anchorIndex: 1,
      olderHasMore: true, olderCursor: { beforeSequence: 10 },
      newerHasMore: true, newerCursor: { afterSequence: 12 }, latestKnownSequence: 30,
    })
    expect(page.items.map(item => item.itemUid)).toEqual(['record-10', 'record-parent', 'record-12'])
  })

  it('continues an around window until the tail cursor stops advancing without a has_more field', async () => {
    const runtime = {
      config: { maxTextLength: 20_000 },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      stateStore: { uniqueCode: vi.fn(async () => 'timeline-tail-signing-key') },
      authenticatedChatPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        expect(path).toBe('/api/v1/chat/timeline/tail')
        expect(body).toMatchObject({ chat_session_uid: 'chat-private', limit: 20 })
        if (body.after_seq === 13) return { items: [], next_after_seq: 13 }
        expect(body.after_seq).toBe(12)
        return {
          items: [{
            relation: { rel_uid: 'rel-13', record_uid: 'record-13', record_owner_user_id: 42, sender_user_id: 42, display_name_snapshot: '我', seq: 13, attach_at: 1300 },
            record: { status: 1, payload: { record_uid: 'record-13', text_content: 'newer' } },
          }],
          next_after_seq: 13,
        }
      }),
    }
    const source = {
      openSourceRef: vi.fn(async () => ({ version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-private', displayName: '同事' })),
      sourceItem: vi.fn(async () => ({ sourceRef: 'source-private', kind: 'private_chat', displayName: '同事', activeAtMillis: 0, unreadCount: 0 })),
    }
    const chat = new ChatService(
      runtime as never, source as never,
      { publicProfilesByUserIds: vi.fn(async () => new Map()), sealProfileImageRef: vi.fn(async () => 'avatar-ref') } as never,
      { richContentBlocks: vi.fn(() => []), recordContentPayload: vi.fn(() => ({})) } as never,
      {} as never, {} as never,
      { currentUserAgentSourceFallback: vi.fn(() => undefined) } as never,
      { timelineAiPolish: vi.fn(() => undefined) } as never, {} as never,
    )

    const firstPage = await chat.readSource('source-private', { cursor: { afterSequence: 12 }, limit: 20 })
    const exhaustedPage = await chat.readSource('source-private', { cursor: { afterSequence: 13 }, limit: 20 })

    expect(firstPage).toMatchObject({ hasMore: true, nextCursor: { afterSequence: 13 } })
    expect(firstPage.items.map(item => item.itemUid)).toEqual(['record-13'])
    expect(exhaustedPage).toMatchObject({ hasMore: false })
    expect(exhaustedPage.nextCursor).toBeUndefined()
  })

  it('hydrates a send-to-self extension parent from the same refreshed timeline page', async () => {
    const runtime = {
      config: { maxTextLength: 20_000 },
      stateStore: { uniqueCode: vi.fn(async () => 'record-extension-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedPost: vi.fn(async () => ({
        items: [
          { record_uid: 'record-child', text_content: '延展正文', parent_record_uid: 'record-parent' },
          { record_uid: 'record-parent', text_content: '原快记内容' },
        ],
        has_more: false,
      })),
    }
    const sourceItem = {
      sourceRef: 'source-self', kind: 'send_to_self' as const, displayName: '发给自己',
      activeAtMillis: 0, unreadCount: 0,
    }
    const source = {
      openSourceRef: vi.fn(async () => ({
        version: 1, userId: 42, kind: 'send_to_self', ownerRef: 'all', displayName: '发给自己',
      })),
      sourceItem: vi.fn(async () => sourceItem),
    }
    const record = {
      recordUid: vi.fn((raw: { record_uid: string }) => raw.record_uid),
      recordTimelineItemFromRaw: vi.fn((raw: {
        record_uid: string
        text_content: string
        parent_record_uid?: string
      }) => ({
        itemUid: raw.record_uid,
        senderName: '我',
        isMe: true,
        sendAtMillis: raw.record_uid === 'record-child' ? 2 : 1,
        title: '',
        textContent: raw.text_content,
        status: 1,
        ...(raw.parent_record_uid === undefined ? {} : { extensionParentRecordUid: raw.parent_record_uid }),
      })),
    }
    const media = {
      hydrateRecordMediaPage: vi.fn(async () => ({
        displayItemsByRecordUid: new Map(), unavailableRecordUids: new Set(),
      })),
    }
    const privacy = { lockedRecordUids: vi.fn(async () => new Set<string>()) }
    const chat = new ChatService(
      runtime as never, source as never, {} as never, media as never, record as never,
      {} as never, {} as never, {} as never, {} as never, privacy as never,
    )

    const page = await chat.readSource('source-self')

    expect(page.items[0]).toMatchObject({
      itemUid: 'record-child',
      extensionParentRecordUid: 'record-parent',
      extensionParent: {
        itemUid: 'record-parent', senderName: '我', title: '', textContent: '原快记内容',
      },
    })
  })

  it('resolves exactly one active peer from an account-bound private-chat source', async () => {
    const session = { userId: 7, accessToken: 'access', refreshToken: 'refresh' }
    const runtime = {
      requireSession: vi.fn(async () => session),
      authenticatedChatPost: vi.fn(async () => ({ items: [{ user_id: 7 }, { user_id: 42 }] })),
    }
    const source = {
      openSourceRef: vi.fn(async () => ({ kind: 'private_chat', ownerRef: 'chat-1', displayName: '何' })),
    }
    const chat = new ChatService(
      runtime as never, source as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )
    const signal = new AbortController().signal

    await expect(chat.resolvePrivateChatPeer('source-ref', signal))
      .resolves.toEqual({ userId: 42, displayName: '何' })
    expect(source.openSourceRef).toHaveBeenCalledWith('source-ref', 7)
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/members/list', { chat_session_uid: 'chat-1', active_only: true }, session, signal,
    )
  })

  it('rejects non-private or ambiguous sources before a user-ban target can be chosen', async () => {
    const runtime = {
      requireSession: vi.fn(async () => ({ userId: 7, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async () => ({ items: [{ user_id: 42 }, { user_id: 43 }] })),
    }
    const source = { openSourceRef: vi.fn() }
    const chat = new ChatService(
      runtime as never, source as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    source.openSourceRef.mockResolvedValueOnce({ kind: 'group_chat', ownerRef: 'group-1', displayName: '群聊' })
    await expect(chat.resolvePrivateChatPeer('group-ref')).rejects.toMatchObject({ code: 'user-ban-private-chat-required' })
    expect(runtime.authenticatedChatPost).not.toHaveBeenCalled()

    source.openSourceRef.mockResolvedValueOnce({ kind: 'private_chat', ownerRef: 'chat-1', displayName: '异常私聊' })
    await expect(chat.resolvePrivateChatPeer('ambiguous-ref')).rejects.toMatchObject({ code: 'user-ban-peer-invalid' })
  })

  it('returns a source-bound signed action reference immediately for every text and rich send source', async () => {
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const sourceKinds = ['private_chat', 'group_chat', 'send_to_self', 'default_category', 'topic'] as const
    const sourcePayloads = new Map<string, { version: 1; userId: number; kind: typeof sourceKinds[number]; ownerRef: string; displayName: string }>()
    for (const kind of sourceKinds) {
      sourcePayloads.set(`source-${kind}`, { version: 1, userId: 42, kind, ownerRef: `owner-${kind}`, displayName: kind })
      sourcePayloads.set(`wrong-${kind}`, { version: 1, userId: 42, kind, ownerRef: `wrong-owner-${kind}`, displayName: kind })
    }
    const source = {
      openSourceRef: vi.fn(async (sourceRef: string) => sourcePayloads.get(sourceRef)),
      invalidateSourceListCache: vi.fn(),
    }
    const runtime = {
      config: { richMediaSendEnabled: true, maxTextLength: 20_000 },
      stateStore: { uniqueCode: vi.fn(async () => 'send-action-signing-key') },
      requireSession: vi.fn(async () => session),
      authenticatedPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        if (path === '/api/v1/records/detail') {
          return { record_core: { record_uid: body.record_uid, text_content: '权威快记详情', status: 1 } }
        }
        if (path === '/api/v1/records/location/context/get') return { record_uid: body.record_uid }
        return { record_uid: body.record_uid, status: 1 }
      }),
      authenticatedChatPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
        if (path === '/api/v1/chats/records/detail') {
          return { item: {
            relation: {
              record_uid: body.record_uid,
              rel_uid: body.rel_uid,
              record_owner_user_id: 42,
              sender_user_id: 42,
              seq: body.seq ?? 17,
            },
            record: { status: 1, payload: { record_uid: body.record_uid, text_content: '权威聊天详情' } },
          } }
        }
        return { record_uid: body.record_uid, rel_uid: body.rel_uid, audit_status: 1, seq: 17 }
      }),
    }
    const record = {
      createTextForConversation: vi.fn(async (recordUid: string) => ({ recordUid, status: 1, localState: 'synced' })),
    }
    const realtime = {
      emitChatClientEvent: vi.fn(), nextChatClientRevision: vi.fn(() => 1),
      scheduleChatSessionProjection: vi.fn(),
      invalidateRecordProjection: vi.fn(async () => {}),
    }
    let chat!: ChatService
    const aiPolish = {
      sendGroupSourceTextWithAiPolish: vi.fn(async (
        ...args: Parameters<GroupAiPolishService['sendGroupSourceTextWithAiPolish']>
      ) => {
        const [sourceRef, chatSessionUid, text, recordUid, relationUid, currentSession, options = {}] = args
        return await chat.sendChatSourceTextRaw(
          sourceRef, chatSessionUid, text, recordUid, relationUid, currentSession,
          undefined, undefined, options.signal, options,
        )
      }),
    }
    chat = new ChatService(
      runtime as never, source as never, {} as never, {} as never, record as never,
      {} as never, {} as never, aiPolish as never, realtime,
    )

    for (const mode of ['text', 'rich'] as const) {
      for (const kind of sourceKinds) {
        const sourceRef = `source-${kind}`
        const recordUid = `record-${mode}-${kind}`
        const relationUid = `relation-${mode}-${kind}`
        const result = mode === 'text'
          ? await chat.sendSourceText(sourceRef, `正文-${kind}`, { recordUid, relationUid })
          : await chat.sendSourceRich(sourceRef, {
              title: `标题-${kind}`,
              textContent: `正文-${kind}`,
              assets: [
                { fileAssetUid: 'asset-file-12345', fileName: 'report.pdf', mimeType: 'application/pdf', size: 12, fileKind: 4 },
                { fileAssetUid: 'asset-image-1234', fileName: 'photo.png', mimeType: 'image/png', size: 34, fileKind: 1 },
              ],
            }, { recordUid, relationUid })
        expect(result).toMatchObject({ itemUid: recordUid, localState: 'synced' })
        expect(result.messageActionRef).toMatch(/^arkme-message-action-v1\./u)

        const payload = messageActionPayload(result.messageActionRef ?? '')
        expect(payload).toMatchObject({
          userId: 42,
          sourceOwnerRef: `owner-${kind}`,
          recordOwnerUserId: 42,
          recordUid,
          senderUserId: 42,
          sourceKind: kind === 'private_chat' || kind === 'group_chat' ? 'chat_relation' : 'record',
          relationUid: kind === 'private_chat' || kind === 'group_chat' ? relationUid : '',
          chatSessionUid: kind === 'private_chat' || kind === 'group_chat' ? `owner-${kind}` : '',
          textContent: `正文-${kind}`,
          templateKind: mode === 'rich' ? 2 : 1,
          imageCount: mode === 'rich' ? 1 : 0,
          fileCount: mode === 'rich' ? 1 : 0,
          fileNames: mode === 'rich' ? ['report.pdf'] : [],
        })
        await expect(chat.relatedQuickNoteLocator(sourceRef, result.messageActionRef ?? ''))
          .resolves.toMatchObject({ recordUid, recordOwnerUserId: 42 })
        await expect(chat.messageSnapshotDetail(sourceRef, result.messageActionRef ?? ''))
          .resolves.toMatchObject({ itemUid: recordUid, syncState: 'synced' })
        await expect(chat.relatedQuickNoteLocator(`wrong-${kind}`, result.messageActionRef ?? ''))
          .rejects.toMatchObject({ code: 'message-action-ref-invalid' })
      }
    }
  })

  it('never turns a confirmed send into a failed promise when action-ref signing fails', async () => {
    const uniqueCode = vi.fn(async () => { throw new Error('local key store unavailable') })
    const runtime = {
      config: { maxTextLength: 20_000 },
      stateStore: { uniqueCode },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
    }
    const source = {
      openSourceRef: vi.fn(async () => ({ kind: 'send_to_self', ownerRef: 'self-owner' })),
      invalidateSourceListCache: vi.fn(),
    }
    const record = {
      createTextForConversation: vi.fn(async () => ({ recordUid: 'record-confirmed', status: 1, localState: 'synced' })),
    }
    const chat = new ChatService(
      runtime as never, source as never, {} as never, {} as never, record as never,
      {} as never, {} as never, {} as never,
      { invalidateRecordProjection: vi.fn(async () => {}) } as never,
    )

    await expect(chat.sendSourceText('source-self', '已经写入', { recordUid: 'record-confirmed' }))
      .resolves.toEqual({ sourceRef: 'source-self', itemUid: 'record-confirmed', status: 1, localState: 'synced' })
    expect(record.createTextForConversation).toHaveBeenCalledOnce()
    expect(uniqueCode).toHaveBeenCalledOnce()
  })

  it('does not sign or expose message actions for a failed local record send', async () => {
    const uniqueCode = vi.fn(async () => 'unused-key')
    const runtime = {
      config: { maxTextLength: 20_000 },
      stateStore: { uniqueCode },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
    }
    const source = {
      openSourceRef: vi.fn(async () => ({ kind: 'send_to_self', ownerRef: 'self-owner' })),
      invalidateSourceListCache: vi.fn(),
    }
    const record = {
      createTextForConversation: vi.fn(async () => ({
        recordUid: 'record-failed', status: 0, localState: 'failed', error: '未写入',
      })),
    }
    const chat = new ChatService(
      runtime as never, source as never, {} as never, {} as never, record as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.sendSourceText('source-self', '未写入', { recordUid: 'record-failed' })).resolves.toEqual({
      sourceRef: 'source-self', itemUid: 'record-failed', status: 0, localState: 'failed', error: '未写入',
    })
    expect(uniqueCode).not.toHaveBeenCalled()
  })

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
      1, 'record-send_to_self', '浏览器纯文字', { expectedUserId: 42, recordDurationMillis: 2_700, captureContext },
    )
    expect(record.createTextForConversation).toHaveBeenNthCalledWith(
      2, 'record-default_category', '浏览器纯文字', { expectedUserId: 42, recordDurationMillis: 2_700, captureContext },
    )
    expect(realtime.invalidateRecordProjection).toHaveBeenCalledTimes(2)
  })

  it('rejects a composer send after its captured account has changed', async () => {
    const runtime = {
      config: { maxTextLength: 20_000 },
      requireSession: vi.fn(async () => ({ userId: 43, accessToken: 'access', refreshToken: 'refresh' })),
    }
    const source = { openSourceRef: vi.fn() }
    const record = { createTextForConversation: vi.fn() }
    const chat = new ChatService(
      runtime as never, source as never, {} as never, {} as never, record as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.sendSourceText('source-a', '发送内容', { expectedUserId: 42 }))
      .rejects.toMatchObject({ code: 'file-account-changed' })
    expect(source.openSourceRef).not.toHaveBeenCalled()
    expect(record.createTextForConversation).not.toHaveBeenCalled()
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
          // Accuracy remains browser/UI metadata. The strict record owner does
          // not accept an `accuracy` field on its location fact write.
          source_kind: 1, lat: 30.52, lon: 114.31, alt: 42, speed: 0,
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
          // The user's day boundary can assign an after-midnight record to the previous day.
          belong_date: '2026-08-30',
          create_at: 1_786_000_000_000, send_at: 1_786_000_003_000, upload_at: 1_786_000_004_000, status: 1,
          content_payload: JSON.stringify({
            network: 'WiFi（senguoyun_5G）',
            media_refs: [
              { file_asset_uid: 'asset-background-b', content_file_role: 4, sort_order: 2 },
              { file_asset_uid: 'asset-ordinary-voice', content_file_role: 1, sort_order: 0 },
              { file_asset_uid: 'asset-background-a', binding_type: 4, sort_order: 1 },
            ],
          }),
        },
        // The real detail contract keeps these outside record_core. They must
        // survive the hydration merge just as they do in the Flutter parser.
        location: { lat: 30.1, lon: 120.2, altitude: 12, speed: 0 },
        position_detail: { address: '武汉市洪山区高新大道', weather: { temp: 30, condition_ch: 'Windy' } },
        record_extra: JSON.stringify({ capture_context: { client_name: 'ts\'s MacBook Pro', electric: 81, charge: 1 }, background_sound_amplitudes: [1, 2, 3] }),
      })),
    }
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'group_chat', ownerRef: 'chat-1' })) }
    const media = { issueSearchAudioMedia: vi.fn(async () => new Map([
      ['record-snapshot-1\0asset-background-a', { mediaRef: 'arkme-media-v1.background-a', durationSeconds: 1.25 }],
      ['record-snapshot-1\0asset-background-b', { mediaRef: 'arkme-media-v1.background-b' }],
    ])) }
    const chat = new ChatService(runtime as never, source as never, {} as never, media as never, {} as never, {} as never, {} as never, {} as never, {} as never)

    await expect(chat.messageSnapshotDetail('opaque-source', snapshotActionRef())).resolves.toMatchObject({
      itemUid: 'record-snapshot-1', textContent: '完整快记文本', recordDurationMillis: 2_400,
      weather: '30° Windy', altitudeMeters: 12, movement: '静止', locationLabel: '武汉市洪山区高新大道',
      captureContext: { clientName: 'ts\'s MacBook Pro', networkName: 'WiFi（senguoyun_5G）', electric: 81, charge: 1 },
      backgroundSound: 'available', syncState: 'synced',
      backgroundSoundPlayback: {
        mediaRefs: ['arkme-media-v1.background-a', 'arkme-media-v1.background-b'],
        amplitudes: [1, 1, 1],
        durationSeconds: 2.4,
      },
    })
    expect(media.issueSearchAudioMedia).toHaveBeenCalledWith([
      { recordUid: 'record-snapshot-1', fileAssetUid: 'asset-background-a' },
      { recordUid: 'record-snapshot-1', fileAssetUid: 'asset-background-b' },
    ], undefined)
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith('/api/v1/chats/records/detail', {
      chat_session_uid: 'chat-1', record_uid: 'record-snapshot-1', record_owner_user_id: 42, rel_uid: 'rel-snapshot-1', seq: 9,
    }, expect.anything(), undefined, expect.anything())
    expect(runtime.authenticatedPost).toHaveBeenCalledWith('/api/v1/records/detail', {
      record_uid: 'record-snapshot-1',
    }, expect.anything(), undefined, expect.anything())
  })

  it('does not expose a truncated background player when any recorded segment is unavailable', async () => {
    const runtime = {
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: vi.fn(async () => ({ item: {
        relation: { rel_uid: 'rel-snapshot-1', record_uid: 'record-snapshot-1', record_owner_user_id: 42, seq: 9 },
        record: { record_uid: 'record-snapshot-1', payload: { text_content: '消息' } },
      } })),
      authenticatedPost: vi.fn(async (path: string) => path === '/api/v1/records/detail'
        ? { record_core: {
            record_uid: 'record-snapshot-1', text_content: '消息', status: 1,
            content_payload: JSON.stringify({ media_refs: [
              { file_asset_uid: 'background-a', content_file_role: 4, sort_order: 1 },
              { file_asset_uid: 'background-b', content_file_role: 4, sort_order: 2 },
            ] }),
          } }
        : { record_uid: 'record-snapshot-1' }),
    }
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'group_chat', ownerRef: 'chat-1' })) }
    const media = { issueSearchAudioMedia: vi.fn(async () => new Map([
      ['record-snapshot-1\0background-a', { mediaRef: 'arkme-media-v1.background-a' }],
    ])) }
    const chat = new ChatService(
      runtime as never, source as never, {} as never, media as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    const detail = await chat.messageSnapshotDetail('opaque-source', snapshotActionRef())

    expect(detail.backgroundSound).toBe('available')
    expect(detail.backgroundSoundPlayback).toBeUndefined()
    expect(media.issueSearchAudioMedia).toHaveBeenCalledWith([
      { recordUid: 'record-snapshot-1', fileAssetUid: 'background-a' },
      { recordUid: 'record-snapshot-1', fileAssetUid: 'background-b' },
    ], undefined)
  })

  it('uses Flutter record timestamps and location context when the detail core has no weather', async () => {
    const legacyBelongDateMillis = Date.UTC(2026, 7, 29, 12)
    const sendBelongDateLabel = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(1_786_000_000_000))
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
            belong_date: legacyBelongDateMillis,
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
      belongDate: sendBelongDateLabel,
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

  it('loads quick-note extensions from the durable chat tree identity without creating a copy link', async () => {
    const worldPost = vi.fn(async () => { throw new Error('chat detail must not use the public-record extension list') })
    const chatPost = vi.fn(async (path: string, body: Record<string, unknown>) => {
      if (path !== '/api/v1/chats/extensions/tree/page') throw new Error(`unexpected chat path: ${path}`)
      return {
        chat_session_uid: 'chat-1',
        parent: {
          relation: {
            chat_session_uid: 'chat-1', rel_uid: 'rel-snapshot-1', record_uid: 'record-snapshot-1',
            record_owner_user_id: 42, sender_user_id: 42, display_name_snapshot: '测试用户', seq: 9,
            attach_at: 1_787_735_000_000,
          },
          record: { status: 1, payload: { record_uid: 'record-snapshot-1', text_content: '原快记' } },
        },
        children: [{
          edge: {
            chat_session_uid: 'chat-1', parent_record_owner_user_id: 42, parent_record_uid: 'record-snapshot-1',
            child_record_owner_user_id: 17, child_record_uid: 'extension-record-1',
            root_record_owner_user_id: 42, root_record_uid: 'record-snapshot-1', source_mode: 1,
            created_at: 1_787_735_200_000, updated_at: 1_787_735_200_000,
          },
          item: {
            relation: {
              chat_session_uid: 'chat-1', rel_uid: 'rel-extension-1', record_uid: 'extension-record-1',
              record_owner_user_id: 7, sender_user_id: 7, display_name_snapshot: '延展者', seq: 10,
              attach_at: 1_787_735_200_000,
            },
            record: { status: 1, payload: {
              record_uid: 'extension-record-1', text_content: '补充信息', template_kind: 2, display_kind: 0,
              content_payload: { media_refs: [
                { file_asset_uid: 'asset-image-1234', file_name: '补充截图.png', file_kind: 1, mime_type: 'image/png', size: 12, sort_order: 0 },
                { file_asset_uid: 'asset-file-12345', file_name: '补充方案.pdf', file_kind: 4, mime_type: 'application/pdf', size: 34, sort_order: 1 },
              ] },
            } },
          },
        }],
        has_more: false,
        next_after_cursor: null,
      }
    })
    const runtime = {
      config: { maxTextLength: 20_000 },
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedWorldPost: worldPost,
      authenticatedChatPost: chatPost,
    }
    const source = { openSourceRef: vi.fn(async () => ({
      version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '同事',
    })) }
    const contentBlocks = [
      { kind: 'image', mediaRef: 'extension-image-ref', originalRef: 'extension-image-original-ref', fileAssetUid: 'asset-image-1234', fileName: '补充截图.png', mimeType: 'image/png', size: 12, sortOrder: 0 },
      { kind: 'file', mediaRef: 'extension-file-ref', originalRef: 'extension-file-original-ref', fileAssetUid: 'asset-file-12345', fileName: '补充方案.pdf', mimeType: 'application/pdf', size: 34, sortOrder: 1 },
    ]
    const media = {
      hydrateRecordMediaPage: vi.fn(async () => ({
        displayItemsByRecordUid: new Map([['extension-record-1', [
          { file_asset_uid: 'asset-image-1234', preview_url: 'https://record.test/preview.png', download_url: 'https://record.test/image.png' },
          { file_asset_uid: 'asset-file-12345', download_url: 'https://record.test/brief.pdf' },
        ]]]),
        unavailableRecordUids: new Set<string>(),
      })),
      richContentBlocks: vi.fn((_raw: unknown, _viewerUserId: number, displayItems: unknown[] = []) => displayItems.length === 0 ? [] : contentBlocks),
    }
    const chat = new ChatService(
      runtime as never, source as never, {} as never, media as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect((chat as unknown as {
      sourceMessageExtensionContext(sourceRef: string, actionRef: string): Promise<unknown>
    }).sourceMessageExtensionContext('opaque-source', snapshotActionRef())).resolves.toEqual({
      parentRecordUid: 'record-snapshot-1',
      extensionCount: 1,
      extensions: [expect.objectContaining({
        recordUid: 'extension-record-1', textContent: '补充信息',
        parentRecordUid: 'record-snapshot-1', recordOwnerUserId: 17, level: 2,
        contentBlocks,
      })],
    })
    expect(media.hydrateRecordMediaPage).toHaveBeenCalledOnce()
    expect(media.richContentBlocks).toHaveBeenCalledWith(
      expect.objectContaining({ record_uid: 'extension-record-1' }),
      42,
      expect.any(Array),
    )
    expect(chatPost).toHaveBeenCalledWith(
      '/api/v1/chats/extensions/tree/page',
      {
        chat_session_uid: 'chat-1', parent_record_owner_user_id: 42,
        parent_record_uid: 'record-snapshot-1', limit: 100,
      },
      expect.anything(), undefined,
    )
    expect(worldPost).not.toHaveBeenCalled()
  })

  it('creates a private-chat extension child through the desktop chat contract', async () => {
    const childRecordUid = '11111111-1111-4111-8111-111111111111'
    const childRelationUid = '22222222-2222-4222-8222-222222222222'
    const worldPost = vi.fn(async () => { throw new Error('private chat extension must not use the public-record API') })
    const chatPost = vi.fn(async (path: string, body: Record<string, unknown>) => {
      if (path !== '/api/v1/chats/extensions/children/create') throw new Error(`unexpected chat path: ${path}`)
      return {
        chat_session_uid: body.chat_session_uid,
        parent_record_owner_user_id: body.parent_record_owner_user_id,
        parent_record_uid: body.parent_record_uid,
        child_record_uid: body.child_record_uid,
        child_rel_uid: body.child_rel_uid,
        root_record_owner_user_id: 42,
        root_record_uid: 'record-snapshot-1',
        seq: 10,
      }
    })
    const runtime = {
      config,
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedWorldPost: worldPost,
      authenticatedChatPost: chatPost,
    }
    const source = {
      openSourceRef: vi.fn(async () => ({
        version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '同事',
      })),
      invalidateSourceListCache: vi.fn(),
    }
    const profile = { refreshProfile: vi.fn(async () => ({ profile: {
      userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: 'profile-avatar-42',
      arkmeId: 'doge', accountType: 1, createdAt: 1,
      bindings: { apple: false, wechat: true, google: false }, contact: { phoneMasked: '138****0000' },
    }, cachedAtMillis: 1, revision: 1 })) }
    const assets = [
      { fileAssetUid: 'asset-image-1234', fileName: 'photo.png', mimeType: 'image/png', size: 12, fileKind: 1 as const },
      { fileAssetUid: 'asset-file-12345', fileName: 'brief.pdf', mimeType: 'application/pdf', size: 34, fileKind: 4 as const },
    ]
    const record = { createFileAssetsForConversation: vi.fn(), createTextForConversation: vi.fn() }
    const contentBlocks = [
      { kind: 'image', mediaRef: 'sent-image-ref', originalRef: 'sent-image-original-ref', fileAssetUid: 'asset-image-1234', fileName: 'photo.png', mimeType: 'image/png', size: 12, sortOrder: 0 },
      { kind: 'file', mediaRef: 'sent-file-ref', originalRef: 'sent-file-original-ref', fileAssetUid: 'asset-file-12345', fileName: 'brief.pdf', mimeType: 'application/pdf', size: 34, sortOrder: 1 },
    ]
    const media = { richContentBlocks: vi.fn(() => contentBlocks) }
    const realtime = {
      nextChatClientRevision: vi.fn(() => 6),
      emitChatClientEvent: vi.fn(),
      scheduleChatSessionProjection: vi.fn(),
    }
    const chat = new ChatService(
      runtime as never, source as never, profile as never, media as never, record as never,
      {} as never, {} as never, {} as never, realtime as never,
    )

    await expect((chat as unknown as {
      extendSourceMessage(
        sourceRef: string,
        actionRef: string,
        text: string,
        recordUid: string,
        assets: typeof assets,
        options: { relationUid: string },
      ): Promise<unknown>
    }).extendSourceMessage(
      'opaque-source', snapshotActionRef(), ' 附件延展 ',
      childRecordUid, assets, { relationUid: childRelationUid },
    )).resolves.toMatchObject({
      recordUid: childRecordUid,
      parentRecordUid: 'record-snapshot-1',
      status: 1,
      localState: 'synced',
      extension: { textContent: '附件延展', templateKind: 2, contentBlocks },
    })
    expect(media.richContentBlocks).toHaveBeenCalledWith(
      expect.objectContaining({ record_uid: childRecordUid }),
      42,
    )
    expect(chatPost).toHaveBeenCalledWith(
      '/api/v1/chats/extensions/children/create',
      {
        chat_session_uid: 'chat-1',
        parent_record_owner_user_id: 42,
        parent_record_uid: 'record-snapshot-1',
        child_record_uid: childRecordUid,
        child_rel_uid: childRelationUid,
        template_kind: 2,
        sender_avatar_url: 'profile-avatar-42',
        text_content: '附件延展',
        content_payload: {
          payload_kind: 2,
          schema_version: 1,
          text_state: 1,
          media_refs: [
            {
              file_asset_uid: 'asset-image-1234', content_file_role: 1, render_role: 1, sort_order: 0,
              file_name: 'photo.png', file_kind: 1, mime_type: 'image/png', size: 12,
            },
            {
              file_asset_uid: 'asset-file-12345', content_file_role: 1, render_role: 1, sort_order: 1,
              file_name: 'brief.pdf', file_kind: 4, mime_type: 'application/pdf', size: 34,
            },
          ],
        },
        create_at: expect.any(Number),
      },
      expect.anything(),
      undefined,
    )
    expect(worldPost).not.toHaveBeenCalled()
    expect(record.createTextForConversation).not.toHaveBeenCalled()
    expect(record.createFileAssetsForConversation).not.toHaveBeenCalled()
    expect(realtime.scheduleChatSessionProjection).toHaveBeenCalledWith('chat-1', 10)
  })

  it('validates and extends a selected descendant quick note in the current chat', async () => {
    const childRecordUid = '11111111-1111-4111-8111-111111111111'
    const childRelationUid = '22222222-2222-4222-8222-222222222222'
    const worldPost = vi.fn(async () => { throw new Error('chat descendant must not use the public-record extension list') })
    const chatPost = vi.fn(async (path: string, body: Record<string, unknown>) => {
      if (path === '/api/v1/chats/extensions/tree/page') return {
        chat_session_uid: 'chat-1',
        parent: {
          relation: {
            chat_session_uid: 'chat-1', rel_uid: 'rel-snapshot-1', record_uid: 'record-snapshot-1',
            record_owner_user_id: 42, sender_user_id: 42, display_name_snapshot: '测试用户', seq: 9,
            attach_at: 1_787_735_000_000,
          },
          record: { status: 1, payload: { record_uid: 'record-snapshot-1', text_content: '原快记' } },
        },
        children: [{
          edge: {
            chat_session_uid: 'chat-1', parent_record_owner_user_id: 42, parent_record_uid: 'record-snapshot-1',
            child_record_owner_user_id: 17, child_record_uid: 'extension-level-two',
            root_record_owner_user_id: 42, root_record_uid: 'record-snapshot-1', source_mode: 1,
            created_at: 1_787_735_200_000, updated_at: 1_787_735_200_000,
          },
          item: {
            relation: {
              chat_session_uid: 'chat-1', rel_uid: 'rel-extension-1', record_uid: 'extension-level-two',
              record_owner_user_id: 7, sender_user_id: 7, display_name_snapshot: '延展者', seq: 10,
              attach_at: 1_787_735_200_000,
            },
            record: { status: 1, payload: {
              record_uid: 'extension-level-two', text_content: '二级延展', template_kind: 1, display_kind: 0,
            } },
          },
        }],
        has_more: false,
        next_after_cursor: null,
      }
      if (path === '/api/v1/chats/extensions/children/create') return {
        child_record_uid: body.child_record_uid,
        child_rel_uid: body.child_rel_uid,
        seq: 20,
      }
      throw new Error(`unexpected chat path: ${path}`)
    })
    const runtime = {
      config,
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedWorldPost: worldPost,
      authenticatedChatPost: chatPost,
    }
    const source = { openSourceRef: vi.fn(async () => ({
      version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '同事',
    })) }
    const profile = { refreshProfile: vi.fn(async () => ({ profile: {
      userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
      createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
    } })) }
    const realtime = { scheduleChatSessionProjection: vi.fn() }
    const chat = new ChatService(
      runtime as never, source as never, profile as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, realtime as never,
    )

    await expect(chat.extendSourceMessage(
      'opaque-source', snapshotActionRef(), '三级延展', childRecordUid, [],
      { relationUid: childRelationUid, parentRecordUid: 'extension-level-two' },
    )).resolves.toMatchObject({
      parentRecordUid: 'extension-level-two',
      extension: { parentRecordUid: 'extension-level-two', level: 3, textContent: '三级延展' },
    })
    expect(worldPost).not.toHaveBeenCalled()
    expect(chatPost).toHaveBeenCalledWith('/api/v1/chats/extensions/tree/page', {
      chat_session_uid: 'chat-1', parent_record_owner_user_id: 42,
      parent_record_uid: 'record-snapshot-1', limit: 100,
    }, expect.anything(), undefined)
    expect(chatPost).toHaveBeenCalledWith(
      '/api/v1/chats/extensions/children/create',
      expect.objectContaining({
        chat_session_uid: 'chat-1',
        parent_record_owner_user_id: 17,
        parent_record_uid: 'extension-level-two',
        child_record_uid: childRecordUid,
        child_rel_uid: childRelationUid,
      }),
      expect.anything(), undefined,
    )
  })

  it('creates a group-chat extension child through the same durable desktop chat contract', async () => {
    const childRecordUid = '11111111-1111-4111-8111-111111111111'
    const childRelationUid = '22222222-2222-4222-8222-222222222222'
    const chatPost = vi.fn(async (path: string, body: Record<string, unknown>) => {
      if (path !== '/api/v1/chats/extensions/children/create') throw new Error(`unexpected chat path: ${path}`)
      return { child_record_uid: body.child_record_uid, child_rel_uid: body.child_rel_uid, seq: 18 }
    })
    const runtime = {
      config,
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedChatPost: chatPost,
      authenticatedWorldPost: vi.fn(async () => { throw new Error('group chat extension must not use the public-record API') }),
    }
    const source = { openSourceRef: vi.fn(async () => ({
      version: 1, userId: 42, kind: 'group_chat', ownerRef: 'chat-1', displayName: '512',
    })) }
    const profile = { refreshProfile: vi.fn(async () => ({ profile: {
      userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
      createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: { phoneMasked: '138****0000' },
    } })) }
    const realtime = { scheduleChatSessionProjection: vi.fn() }
    const chat = new ChatService(
      runtime as never, source as never, profile as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, realtime as never,
    )

    await expect(chat.extendSourceMessage(
      'opaque-source', snapshotActionRef(), '群聊延展', childRecordUid, [], { relationUid: childRelationUid },
    )).resolves.toMatchObject({
      recordUid: childRecordUid,
      parentRecordUid: 'record-snapshot-1',
      relationUid: childRelationUid,
      sequence: 18,
      localState: 'synced',
      extension: { textContent: '群聊延展' },
    })
    expect(chatPost).toHaveBeenCalledTimes(1)
    expect(runtime.authenticatedWorldPost).not.toHaveBeenCalled()
    expect(realtime.scheduleChatSessionProjection).toHaveBeenCalledWith('chat-1', 18)
  })

  it('creates a send-to-self extension through the durable desktop record-extension contract', async () => {
    const childRecordUid = '11111111-1111-4111-8111-111111111111'
    const assets = [{
      fileAssetUid: 'asset-image-1234', fileName: 'photo.png', mimeType: 'image/png', size: 12, fileKind: 1 as const,
    }]
    const runtime = {
      config,
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedWorldPost: vi.fn(async () => { throw new Error('record extension must not use the public-record API') }),
    }
    const source = {
      openSourceRef: vi.fn(async () => ({
        version: 1, userId: 42, kind: 'send_to_self', ownerRef: 'all', displayName: '发给自己',
      })),
      invalidateSourceListCache: vi.fn(),
    }
    const profile = { refreshProfile: vi.fn(async () => ({ profile: {
      userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: 'profile-avatar-42',
      arkmeId: 'doge', accountType: 1, createdAt: 1,
      bindings: { apple: false, wechat: true, google: false }, contact: { phoneMasked: '138****0000' },
    }, cachedAtMillis: 1, revision: 1 })) }
    const record = {
      createExtensionForConversation: vi.fn(async () => ({ recordUid: childRecordUid, status: 1, localState: 'synced' })),
      createTextForConversation: vi.fn(),
      createFileAssetsForConversation: vi.fn(),
    }
    const realtime = { nextChatClientRevision: vi.fn(() => 7), emitChatClientEvent: vi.fn() }
    const chat = new ChatService(
      runtime as never, source as never, profile as never, {} as never, record as never,
      {} as never, {} as never, {} as never, realtime as never,
    )
    const recordActionRef = snapshotActionRef({
      sourceKind: 'record', sourceOwnerRef: 'all', chatSessionUid: '', relationUid: '',
      recordOwnerUserId: 42, recordUid: 'record-snapshot-1', senderUserId: 42,
    })

    await expect(chat.extendSourceMessage(
      'opaque-source', recordActionRef, ' 附件延展 ', childRecordUid, assets,
    )).resolves.toMatchObject({
      recordUid: childRecordUid,
      parentRecordUid: 'record-snapshot-1',
      status: 1,
      localState: 'synced',
      extension: { textContent: '附件延展', templateKind: 2 },
    })
    expect(record.createExtensionForConversation).toHaveBeenCalledWith(
      'record-snapshot-1', childRecordUid, '附件延展', assets,
    )
    expect(record.createTextForConversation).not.toHaveBeenCalled()
    expect(record.createFileAssetsForConversation).not.toHaveBeenCalled()
    expect(runtime.authenticatedWorldPost).not.toHaveBeenCalled()
    expect(source.invalidateSourceListCache).toHaveBeenCalledWith(42, 'send_to_self')
    expect(realtime.emitChatClientEvent).toHaveBeenCalledWith({ type: 'projection-invalidated', revision: 7, projection: 'record' })
  })

  it('creates a topic extension through the desktop topic-extension endpoint', async () => {
    const childRecordUid = '11111111-1111-4111-8111-111111111111'
    const assets = [{
      fileAssetUid: 'asset-image-1234', fileName: 'photo.png', mimeType: 'image/png', size: 12, fileKind: 1 as const,
    }]
    const authenticatedPost = vi.fn(async (path: string, body: Record<string, unknown>) => {
      if (path !== '/api/v1/topics/records/extensions/create') throw new Error(`unexpected record path: ${path}`)
      return {
        record_uid: body.record_uid,
        record_status: 1,
        topic_uid: body.topic_uid,
        rel_uid: 'rel-topic-child-1',
        relation_status: 1,
        edge_uid: 'edge-topic-child-1',
        parent_record_uid: body.parent_record_uid,
        root_record_uid: body.parent_record_uid,
        edge_status: 1,
      }
    })
    const runtime = {
      config,
      stateStore: { uniqueCode: vi.fn(async () => 'snapshot-test-signing-key') },
      requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
      authenticatedPost,
      authenticatedWorldPost: vi.fn(async () => { throw new Error('topic extension must not use the public-record API') }),
    }
    const source = {
      openSourceRef: vi.fn(async () => ({
        version: 1, userId: 42, kind: 'topic', ownerRef: 'topic-1', displayName: '实习性',
      })),
      invalidateSourceListCache: vi.fn(),
    }
    const profile = { refreshProfile: vi.fn(async () => ({ profile: {
      userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: 'profile-avatar-42',
      arkmeId: 'doge', accountType: 1, createdAt: 1,
      bindings: { apple: false, wechat: true, google: false }, contact: { phoneMasked: '138****0000' },
    } })) }
    const record = { createExtensionForConversation: vi.fn() }
    const realtime = { nextChatClientRevision: vi.fn(() => 8), emitChatClientEvent: vi.fn() }
    const chat = new ChatService(
      runtime as never, source as never, profile as never, {} as never, record as never,
      {} as never, {} as never, {} as never, realtime as never,
    )
    const topicActionRef = snapshotActionRef({
      sourceKind: 'record', sourceOwnerRef: 'topic-1', chatSessionUid: '', relationUid: '',
      recordOwnerUserId: 42, recordUid: 'record-snapshot-1', senderUserId: 42,
    })

    await expect(chat.extendSourceMessage(
      'opaque-topic-source', topicActionRef, ' 主题延展 ', childRecordUid, assets,
    )).resolves.toMatchObject({
      recordUid: childRecordUid,
      parentRecordUid: 'record-snapshot-1',
      relationUid: 'rel-topic-child-1',
      status: 1,
      localState: 'synced',
      extension: { textContent: '主题延展', templateKind: 2 },
    })
    expect(authenticatedPost).toHaveBeenCalledWith(
      '/api/v1/topics/records/extensions/create',
      {
        topic_uid: 'topic-1',
        parent_record_uid: 'record-snapshot-1',
        record_uid: childRecordUid,
        template_kind: 2,
        title: '',
        text_content: '主题延展',
        content_payload: {
          payload_kind: 2,
          schema_version: 1,
          text_state: 1,
          media_refs: [{
            file_asset_uid: 'asset-image-1234', content_file_role: 1, render_role: 1, sort_order: 0,
            file_name: 'photo.png', file_kind: 1, mime_type: 'image/png', size: 12,
          }],
        },
        send_at: expect.any(Number),
      },
      expect.anything(),
      undefined,
    )
    expect(record.createExtensionForConversation).not.toHaveBeenCalled()
    expect(runtime.authenticatedWorldPost).not.toHaveBeenCalled()
    expect(source.invalidateSourceListCache).toHaveBeenCalledWith(42, 'send_to_self')
    expect(realtime.emitChatClientEvent).toHaveBeenCalledWith({ type: 'projection-invalidated', revision: 8, projection: 'record' })
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

  it.each(['', '群成员', '群内昵称'])(
    'uses the public profile identity instead of the group member name %j when opening a private chat',
    async groupMemberName => {
      const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
      const authenticatedChatPost = vi.fn(async (path: string) => path === '/api/v1/chats/members/list'
        ? { items: [{ user_id: 7, status: 1, remark: '', display_name_snapshot: groupMemberName }] }
        : {
            session: { chat_session_uid: 'private-1', last_active_at: 1_700_000_000_000, last_seq: 0 },
            unread_snapshot: { unread_count: 0, session_last_seq: 0 },
          })
      const runtime = {
        stateStore: {
          uniqueCode: vi.fn(async () => 'member-signing-key'),
        },
        requireSession: vi.fn(async () => session),
        authenticatedChatPost,
      }
      const source = {
        openSourceRef: vi.fn(async () => ({ kind: 'group_chat', ownerRef: 'group-1' })),
        cachedChatSource: vi.fn(() => undefined),
        sealSourceRef: vi.fn(async () => 'private-source-ref'),
        chatDirectorySourceKey: vi.fn(async () => 'chat:private-1'),
        setChatSourceByKey: vi.fn(),
      }
      const profile = {
        publicProfileSummariesByUserIds: vi.fn(async () => new Map([[7, { displayName: '公开昵称' }]])),
      }
      const chat = new ChatService(
        runtime as never, source as never, profile as never, {} as never, {} as never,
        {} as never, {} as never, {} as never, {} as never,
      )

      await expect(chat.openPrivateChatFromMember(
        'group-source-ref', chatMemberRef(42, 'group-1', 7),
      )).resolves.toMatchObject({ source: { displayName: '公开昵称', peerUserId: 7 } })
      expect(authenticatedChatPost).toHaveBeenLastCalledWith(
        '/api/v1/chats/create-private',
        expect.objectContaining({
          peer_user_id: 7,
        }),
        session,
        undefined,
      )
      const createBody = authenticatedChatPost.mock.calls[1]?.[1] as Record<string, unknown>
      expect(createBody).not.toHaveProperty('title')
      expect(createBody).not.toHaveProperty('owner_display_name_snapshot')
      expect(createBody).not.toHaveProperty('peer_display_name_snapshot')
      expect(createBody).not.toHaveProperty('extra')
    },
  )

  it('keeps private-chat creation usable without persisting a placeholder identity', async () => {
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const authenticatedChatPost = vi.fn(async () => ({
      session: { chat_session_uid: 'private-2', last_active_at: 1_700_000_000_000, last_seq: 0 },
      unread_snapshot: { unread_count: 0, session_last_seq: 0 },
    }))
    const runtime = {
      stateStore: {},
      requireSession: vi.fn(async () => session),
      authenticatedChatPost,
    }
    const source = {
      cachedChatSource: vi.fn(() => undefined),
      sealSourceRef: vi.fn(async () => 'private-source-ref'),
      chatDirectorySourceKey: vi.fn(async () => 'chat:private-2'),
      setChatSourceByKey: vi.fn(),
    }
    const profile = {
      publicProfileSummariesByUserIds: vi.fn(async () => { throw new Error('profile unavailable') }),
    }
    const chat = new ChatService(
      runtime as never, source as never, profile as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.openPrivateChatFromUser(7)).resolves.toMatchObject({
      source: { displayName: '群成员', peerUserId: 7 },
    })
    const createBody = authenticatedChatPost.mock.calls[0]?.[1] as Record<string, unknown>
    expect(createBody).not.toHaveProperty('title')
    expect(createBody).not.toHaveProperty('owner_display_name_snapshot')
    expect(createBody).not.toHaveProperty('peer_display_name_snapshot')
    expect(createBody).not.toHaveProperty('extra')
  })

  it('keeps the existing viewer-bound private-chat projection when create-private reuses a session', async () => {
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const existingSource = {
      sourceRef: 'existing-private-source-ref',
      sourceKey: 'chat:private-existing',
      peerUserId: 7,
      kind: 'private_chat',
      displayName: '我的备注',
      activeAtMillis: 1_700_000_000_000,
      unreadCount: 3,
      latestSequence: 9,
    }
    const authenticatedChatPost = vi.fn(async (path: string) => path === '/api/v1/chats/members/list'
      ? { items: [{ user_id: 7, status: 1, remark: '我的备注', display_name_snapshot: '群内昵称' }] }
      : {
          session: { chat_session_uid: 'private-existing', last_active_at: 1_700_000_000_500, last_seq: 9 },
          unread_snapshot: { unread_count: 3, session_last_seq: 9 },
        })
    const runtime = {
      stateStore: {
        uniqueCode: vi.fn(async () => 'member-signing-key'),
      },
      requireSession: vi.fn(async () => session),
      authenticatedChatPost,
    }
    const source = {
      openSourceRef: vi.fn(async () => ({ kind: 'group_chat', ownerRef: 'group-1' })),
      cachedChatSource: vi.fn(() => existingSource),
      sealSourceRef: vi.fn(async () => 'new-private-source-ref'),
      chatDirectorySourceKey: vi.fn(async () => 'chat:private-existing'),
      setChatSourceByKey: vi.fn(),
    }
    const profile = {
      publicProfileSummariesByUserIds: vi.fn(async () => new Map([[7, { displayName: '公开昵称' }]])),
    }
    const chat = new ChatService(
      runtime as never, source as never, profile as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    const opened = await chat.openPrivateChatFromMember(
      'group-source-ref', chatMemberRef(42, 'group-1', 7),
    )
    expect(opened.source).toMatchObject({
      sourceRef: existingSource.sourceRef,
      sourceKey: existingSource.sourceKey,
      displayName: '我的备注',
      activeAtMillis: 1_700_000_000_500,
      unreadCount: 3,
      latestSequence: 9,
    })
    expect(source.setChatSourceByKey).toHaveBeenCalledWith('42:private-existing', opened.source)
    const createBody = authenticatedChatPost.mock.calls[1]?.[1] as Record<string, unknown>
    expect(createBody).not.toHaveProperty('title')
    expect(createBody).not.toHaveProperty('owner_display_name_snapshot')
    expect(createBody).not.toHaveProperty('peer_display_name_snapshot')
  })

  it.each([
    { name: 'self member', targetUserId: 42, memberChatSessionUid: 'group-1', members: [{ user_id: 42 }], code: 'private-chat-self-invalid' },
    { name: 'stale member', targetUserId: 7, memberChatSessionUid: 'group-1', members: [], code: 'chat-member-ref-stale' },
    { name: 'member from another chat', targetUserId: 7, memberChatSessionUid: 'group-2', members: [{ user_id: 7 }], code: 'chat-member-ref-invalid' },
  ])('rejects $name before creating a private chat', async ({ targetUserId, memberChatSessionUid, members, code }) => {
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const authenticatedChatPost = vi.fn(async () => ({ items: members }))
    const runtime = {
      stateStore: { uniqueCode: vi.fn(async () => 'member-signing-key') },
      requireSession: vi.fn(async () => session),
      authenticatedChatPost,
    }
    const source = { openSourceRef: vi.fn(async () => ({ kind: 'group_chat', ownerRef: 'group-1' })) }
    const profile = { publicProfileSummariesByUserIds: vi.fn() }
    const chat = new ChatService(
      runtime as never, source as never, profile as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.openPrivateChatFromMember(
      'group-source-ref', chatMemberRef(42, memberChatSessionUid, targetUserId),
    )).rejects.toMatchObject({ code })
    expect(authenticatedChatPost.mock.calls.some(call => call[0] === '/api/v1/chats/create-private')).toBe(false)
    expect(profile.publicProfileSummariesByUserIds).not.toHaveBeenCalled()
  })

  it('does not cache or activate an incomplete create-private response', async () => {
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const runtime = {
      stateStore: {},
      requireSession: vi.fn(async () => session),
      authenticatedChatPost: vi.fn(async () => ({ session: {}, unread_snapshot: {} })),
    }
    const source = {
      cachedChatSource: vi.fn(),
      sealSourceRef: vi.fn(),
      chatDirectorySourceKey: vi.fn(),
      setChatSourceByKey: vi.fn(),
    }
    const profile = { publicProfileSummariesByUserIds: vi.fn(async () => new Map()) }
    const chat = new ChatService(
      runtime as never, source as never, profile as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )

    await expect(chat.openPrivateChatFromUser(7)).rejects.toMatchObject({ code: 'private-chat-contract-invalid' })
    expect(source.cachedChatSource).not.toHaveBeenCalled()
    expect(source.sealSourceRef).not.toHaveBeenCalled()
    expect(source.setChatSourceByKey).not.toHaveBeenCalled()
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
