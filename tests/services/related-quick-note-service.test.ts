import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionCredentials } from '../../src/keychain-store.js'
import type { MediaService } from '../../src/services/media-service.js'
import type { ProfileService } from '../../src/services/profile-service.js'
import type { RecordService } from '../../src/services/record-service.js'
import {
  RelatedQuickNoteService,
  type ArkmeRelatedQuickNoteSourceLocator,
} from '../../src/services/related-quick-note-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'

const locator: ArkmeRelatedQuickNoteSourceLocator = {
  viewerUserId: 42,
  sourceRef: 'opaque-source-a',
  sourceOwnerRef: 'chat-session-a',
  contextType: 'chat',
  recordUid: 'record-source',
  recordOwnerUserId: 12,
  chatSessionUid: 'chat-session-a',
}

function fixture(options: {
  relatedResponse: Record<string, unknown>
  batchItems?: unknown[]
  detail?: Record<string, unknown>
  lockedRecordUids?: string[]
}) {
  let session: ArkmeSessionCredentials = {
    userId: 42,
    accessToken: 'access',
    refreshToken: 'refresh',
  }
  const authenticatedPost = vi.fn(async (path: string) => {
    if (path === '/api/v1/records/related/query') return options.relatedResponse
    if (path === '/api/v1/records/detail') return options.detail ?? {}
    throw new Error(`unexpected record route: ${path}`)
  })
  const authenticatedDataPost = vi.fn(async (path: string) => {
    if (path === '/api/v1/memo/batch-get-records') return { items: options.batchItems ?? [] }
    throw new Error(`unexpected data route: ${path}`)
  })
  const runtime = {
    requireSession: vi.fn(async () => session),
    authenticatedPost,
    authenticatedDataPost,
    stateStore: { async uniqueCode() { return 'related-quick-note-test-secret' } },
  } as unknown as ServiceRuntime
  const profile = {
    publicProfileSummariesByUserIds: vi.fn(async () => new Map([
      [13, { userId: 13, displayName: 'B 用户', nickname: 'B 用户', avatarUrl: 'https://image.test/b.png' }],
      [14, { userId: 14, displayName: 'A 用户', nickname: 'A 用户' }],
    ])),
    sealProfileImageRef: vi.fn(async (_viewerUserId: number, targetUserId: number) => `opaque-avatar-${targetUserId}`),
  } as unknown as ProfileService
  const record = {
    recordTimelineItemFromRaw: vi.fn(() => ({
      itemUid: 'record-b',
      senderName: 'fallback',
      isMe: false,
      sendAtMillis: 1_710_000_000_000,
      title: '详情标题',
      textContent: '详情正文',
      status: 1,
    })),
  } as unknown as RecordService
  const media = {
    hydrateRecordMediaPage: vi.fn(async () => ({
      displayItemsByRecordUid: new Map([['record-b', [{ kind: 'image' }]]]),
      unavailableRecordUids: new Set<string>(),
    })),
  } as unknown as MediaService
  const privacy = {
    lockedRecordUids: vi.fn(async () => new Set(options.lockedRecordUids ?? [])),
  }
  const service = new RelatedQuickNoteService(runtime, record, media, profile, privacy)
  return {
    service,
    runtime,
    profile,
    record,
    media,
    authenticatedPost,
    authenticatedDataPost,
    switchUser(userId: number) { session = { ...session, userId } },
  }
}

describe('RelatedQuickNoteService', () => {
  it('projects the new response in source order without leaking routing fields', async () => {
    const test = fixture({
      lockedRecordUids: ['record-locked'],
      relatedResponse: {
        items: [
          { record_uid: 'record-source', record_owner_user_id: 12, text_preview: 'source' },
          {
            record_uid: 'record-b', record_owner_user_id: 13, author_user_id: 13,
            author_name: 'B 用户', text_preview: '问题不大', send_at: 1_710_000_000,
            chat_session_uid: 'chat-session-a', source_kind: 'chat',
          },
          {
            recordUid: 'record-a', recordOwnerUserId: 14, authorUserId: 14,
            authorName: 'A 用户', textPreview: '没什么问题', sendAt: 1_709_000_000,
          },
          { record_uid: 'record-b', record_owner_user_id: 13, text_preview: 'duplicate' },
          { record_uid: 'record-private', record_owner_user_id: 15, content_access_state: 2 },
          { record_uid: 'record-locked', record_owner_user_id: 16, text_preview: 'locked' },
        ],
      },
    })

    const result = await test.service.list(locator)

    expect(test.authenticatedPost).toHaveBeenCalledWith(
      '/api/v1/records/related/query',
      {
        record_uid: 'record-source',
        record_owner_user_id: 12,
        context_type: 'chat',
        chat_session_uid: 'chat-session-a',
        limit: 20,
      },
      expect.objectContaining({ userId: 42 }),
      undefined,
    )
    expect(test.authenticatedDataPost).not.toHaveBeenCalled()
    expect(result.items.map(item => item.textPreview)).toEqual(['问题不大', '没什么问题'])
    expect(result).toMatchObject({
      total: 2,
      items: [
        { senderName: 'B 用户', senderAvatarRef: 'opaque-avatar-13', textPreview: '问题不大' },
        { senderName: 'A 用户', textPreview: '没什么问题' },
      ],
    })
    expect(result.items.every(item => item.relatedRef.startsWith('arkme-related-quick-note-v1.'))).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/record_owner_user_id|chat_session_uid|author_user_id/u)
  })

  it('hydrates a legacy uid list once and preserves the upstream order', async () => {
    const test = fixture({
      relatedResponse: {
        similarLs: [
          { record_uid: 'record-b' },
          { recordUid: 'record-a' },
          { record_uid: 'record-b' },
          { record_uid: 'record-source' },
        ],
      },
      batchItems: [
        {
          record_uid: 'record-a', nickname: 'A batch',
          record_core: {
            record_uid: 'record-a', owner_user_id: 14, creator_user_id: 14,
            send_at: 1_709_000_000_000, title: '', text_content: 'A 内容', status: 1,
          },
        },
        {
          record_uid: 'record-b', nickname: 'B batch',
          record_core: {
            record_uid: 'record-b', owner_user_id: 13, creator_user_id: 13,
            send_at: 1_710_000_000_000, title: '', text_content: 'B 内容', status: 1,
          },
        },
      ],
    })

    const result = await test.service.list({ ...locator, contextType: 'record', chatSessionUid: '' })

    expect(test.authenticatedDataPost).toHaveBeenCalledTimes(1)
    expect(test.authenticatedDataPost).toHaveBeenCalledWith(
      '/api/v1/memo/batch-get-records',
      { record_uids: ['record-b', 'record-a'] },
      expect.objectContaining({ userId: 42 }),
      undefined,
    )
    expect(result.items.map(item => item.textPreview)).toEqual(['B 内容', 'A 内容'])
  })

  it('hydrates uid-only items and keeps available entries when one hydration is missing', async () => {
    const test = fixture({
      relatedResponse: {
        items: [
          { record_uid: 'record-b' },
          { record_uid: 'record-missing' },
          { record_uid: 'record-source' },
        ],
      },
      batchItems: [{
        record_uid: 'record-b', nickname: 'B batch',
        record_core: {
          record_uid: 'record-b', owner_user_id: 13, creator_user_id: 13,
          send_at: 1_710_000_000_000, title: '', text_content: 'B 内容', status: 1,
        },
      }],
    })

    const result = await test.service.list(locator)

    expect(test.authenticatedDataPost).toHaveBeenCalledWith(
      '/api/v1/memo/batch-get-records',
      { record_uids: ['record-b', 'record-missing'] },
      expect.objectContaining({ userId: 42 }),
      undefined,
    )
    expect(result.items.map(item => item.textPreview)).toEqual(['B 内容'])
  })

  it('hydrates uid-only entries inside a mixed response without dropping source order', async () => {
    const test = fixture({
      relatedResponse: {
        items: [{
          record_uid: 'record-b', record_owner_user_id: 13, author_user_id: 13,
          author_name: 'B 用户', text_preview: 'B 直接内容', send_at: 1_710_000_000,
        }, {
          record_uid: 'record-a',
        }],
      },
      batchItems: [{
        record_uid: 'record-a', nickname: 'A batch',
        record_core: {
          record_uid: 'record-a', owner_user_id: 14, creator_user_id: 14,
          send_at: 1_709_000_000_000, title: '', text_content: 'A 补全内容', status: 1,
        },
      }],
    })

    const result = await test.service.list(locator)

    expect(test.authenticatedDataPost).toHaveBeenCalledWith(
      '/api/v1/memo/batch-get-records',
      { record_uids: ['record-a'] },
      expect.objectContaining({ userId: 42 }),
      undefined,
    )
    expect(result.items.map(item => item.textPreview)).toEqual(['B 直接内容', 'A 补全内容'])
  })

  it('opens only a viewer- and source-bound related ref and hydrates detail media', async () => {
    const detail = {
      record_uid: 'record-b',
      nickname: 'B 用户',
      record_core: {
        record_uid: 'record-b', owner_user_id: 13, creator_user_id: 13,
        send_at: 1_710_000_000_000, title: '详情标题', text_content: '详情正文', status: 1,
      },
    }
    const test = fixture({
      relatedResponse: {
        items: [{
          record_uid: 'record-b', record_owner_user_id: 13, author_user_id: 13,
          author_name: 'B 用户', text_preview: '问题不大', send_at: 1_710_000_000,
        }],
      },
      detail,
    })
    const list = await test.service.list(locator)
    const relatedRef = list.items[0]?.relatedRef ?? ''

    await expect(test.service.detail('another-source', relatedRef)).rejects.toMatchObject({
      code: 'related-quick-note-ref-invalid',
    })
    const result = await test.service.detail(locator.sourceRef, relatedRef)

    expect(test.authenticatedPost).toHaveBeenCalledWith(
      '/api/v1/records/detail',
      { record_uid: 'record-b' },
      expect.objectContaining({ userId: 42 }),
      undefined,
    )
    expect(test.media.hydrateRecordMediaPage).toHaveBeenCalledWith(
      [detail], expect.objectContaining({ userId: 42 }), undefined,
    )
    expect(test.record.recordTimelineItemFromRaw).toHaveBeenCalledWith(detail, 42, {
      displayItems: [{ kind: 'image' }],
      isMe: false,
    })
    expect(result).toMatchObject({
      relatedRef, senderName: 'B 用户', avatarRef: 'opaque-avatar-13', textContent: '详情正文',
    })

    test.switchUser(99)
    await expect(test.service.detail(locator.sourceRef, relatedRef)).rejects.toMatchObject({
      code: 'related-quick-note-ref-invalid',
    })
  })

  it.each([
    {
      name: 'record uid',
      detail: {
        record_uid: 'record-b', record_owner_user_id: 13,
        record_core: { record_uid: 'record-other', owner_user_id: 13, text_content: '伪造内容' },
      },
    },
    {
      name: 'record owner',
      detail: {
        record_uid: 'record-b', record_owner_user_id: 13,
        record_core: { record_uid: 'record-b', owner_user_id: 99, text_content: '越权内容' },
      },
    },
  ])('rejects conflicting root and record_core $name identities', async ({ detail }) => {
    const test = fixture({
      relatedResponse: {
        items: [{
          record_uid: 'record-b', record_owner_user_id: 13, author_user_id: 13,
          author_name: 'B 用户', text_preview: '问题不大', send_at: 1_710_000_000,
        }],
      },
      detail,
    })
    const list = await test.service.list(locator)

    await expect(test.service.detail(locator.sourceRef, list.items[0]?.relatedRef ?? ''))
      .rejects.toMatchObject({ code: 'related-quick-note-detail-contract-invalid' })
    expect(test.media.hydrateRecordMediaPage).not.toHaveBeenCalled()
    expect(test.record.recordTimelineItemFromRaw).not.toHaveBeenCalled()
  })

  it('keeps raw related record identifiers out of list and detail browser DTOs', async () => {
    const detail = {
      record_uid: 'record-b',
      nickname: 'B 用户',
      record_core: {
        record_uid: 'record-b', owner_user_id: 13, creator_user_id: 13,
        send_at: 1_710_000_000_000, title: '详情标题', text_content: '详情正文', status: 1,
      },
    }
    const test = fixture({
      relatedResponse: {
        items: [{
          record_uid: 'record-b', record_owner_user_id: 13, author_user_id: 13,
          author_name: 'B 用户', text_preview: '问题不大', send_at: 1_710_000_000,
        }],
      },
      detail,
    })

    const list = await test.service.list(locator)
    const relatedRef = list.items[0]?.relatedRef ?? ''
    const result = await test.service.detail(locator.sourceRef, relatedRef)

    expect(list.items[0]).not.toHaveProperty('itemUid')
    expect(result).not.toHaveProperty('itemUid')
    expect(JSON.stringify({ list, result })).not.toContain('record-b')
  })
})
