import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionCredentials } from '../../src/keychain-store.js'
import type { MediaService } from '../../src/services/media-service.js'
import type { ProfileService } from '../../src/services/profile-service.js'
import type { RecordService } from '../../src/services/record-service.js'
import {
  RelatedQuickNoteService,
  type ArkmeRelatedQuickNoteSourceLocator,
} from '../../src/services/related-quick-note-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../../src/services/service.js'

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
    if (path === '/api/v1/records/related/query') return { recall_mode: 'embedding', retryable: false, ...options.relatedResponse }
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
  it('returns existing content when profiles hang and ignores late metadata', async () => {
    vi.useFakeTimers()
    try {
      const test = fixture({ relatedResponse: { items: [{ record_uid: 'record-b', record_owner_user_id: 13, text_preview: 'readable' }] },
        detail: { record_uid: 'record-b', record_owner_user_id: 13 } })
      let finish!: (value: Map<number, { userId: number; displayName: string; nickname: string }>) => void
      vi.mocked(test.profile.publicProfileSummariesByUserIds).mockImplementation(() => new Promise(resolve => { finish = resolve }))
      const pending = test.service.list(locator)
      await vi.advanceTimersByTimeAsync(501)
      const result = await pending
      expect(result.items[0]).toMatchObject({ textPreview: 'readable', senderName: 'Arkme 用户' })
      finish(new Map([[13, { userId: 13, displayName: 'late', nickname: 'late' }]]))
      await Promise.resolve()
      expect(result.items[0]?.senderName).toBe('Arkme 用户')
      await expect(test.service.detail(locator.sourceRef, result.items[0]!.relatedRef)).resolves.toMatchObject({ textContent: '详情正文' })
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('does not deliver a list after the subscriber cancels optional profiles', async () => {
    const test = fixture({ relatedResponse: { items: [{ record_uid: 'record-b', record_owner_user_id: 13, text_preview: 'readable' }] } })
    const controller = new AbortController()
    vi.mocked(test.profile.publicProfileSummariesByUserIds).mockImplementation(async () => {
      controller.abort(new DOMException('left page', 'AbortError'))
      return new Promise(() => {})
    })
    await expect(test.service.list(locator, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each([50001, 40001, 40004])('classifies record business code %i without HTTP-status heuristics', async (code) => {
    const test = fixture({ relatedResponse: {} })
    test.authenticatedPost.mockRejectedValueOnce(new ArkmePluginError(`arkme-code-${code}`, 'backend', true, 502))
    await expect(test.service.list(locator)).rejects.toMatchObject({ code: `arkme-code-${code}`, retryable: code === 50001 })
  })

  it('does not turn a failed required hydration into a definitive empty result', async () => {
    const test = fixture({ relatedResponse: { items: [{ record_uid: 'missing-details' }] }, batchItems: [] })
    await expect(test.service.list(locator)).rejects.toMatchObject({ code: 'related-invalid-response', retryable: false })
  })

  it('keeps a synthetic record owner distinct from a human profile identity', async () => {
    const owner = '6690025278483443577'
    const test = fixture({
      relatedResponse: { items: [{ record_uid: 'record-b', record_owner_user_id: owner, author_name: 'Bot 名称', text_preview: '正文' }] },
      detail: { record_uid: 'record-b', record_owner_user_id: 0, record_core: { record_uid: 'record-b', owner_user_id: owner } },
    })
    const page = await test.service.list(locator)
    expect(page.items).toHaveLength(1)
    expect(test.profile.publicProfileSummariesByUserIds).toHaveBeenCalledWith([], expect.anything(), expect.any(AbortSignal))
    await expect(test.service.detail(locator.sourceRef, page.items[0]!.relatedRef)).resolves.toMatchObject({ senderName: 'Bot 名称', isMe: false })
  })

  it('keeps preview and title limits without splitting emoji tokens', async () => {
    const test = fixture({ relatedResponse: { items: [{
      record_uid: 'record-b', record_owner_user_id: 13,
      title: '文'.repeat(495) + '[jm_emoji:heart_eyes]',
      text_preview: '文'.repeat(1995) + '[im_emoji:thumb_up]',
    }] } })
    const result = await test.service.list(locator)
    expect(result.items[0]?.title).toBe('文'.repeat(495))
    expect(result.items[0]?.textPreview).toBe('文'.repeat(1995))
  })

  it('keeps identical UIDs isolated by owner, including the source and viewer privacy snapshot', async () => {
    const test = fixture({ lockedRecordUids: ['same'], relatedResponse: { items: [
      { record_uid: 'record-source', record_owner_user_id: 12, text_preview: 'source' },
      { record_uid: 'record-source', record_owner_user_id: 13, text_preview: 'other source owner' },
      { record_uid: 'same', record_owner_user_id: 42, text_preview: 'viewer locked' },
      { record_uid: 'same', record_owner_user_id: 13, text_preview: 'owner 13' },
      { record_uid: 'same', record_owner_user_id: 14, text_preview: 'owner 14' },
      { record_uid: 'same', record_owner_user_id: 14, text_preview: 'duplicate' },
    ] } })
    const result = await test.service.list(locator)
    expect(result.items.map(item => item.textPreview)).toEqual(['other source owner', 'owner 13', 'owner 14'])
    expect(new Set(result.items.map(item => item.relatedRef)).size).toBe(3)
  })

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
          { record_uid: 'record-locked', record_owner_user_id: 42, text_preview: 'locked' },
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
      expect.objectContaining({ lane: 'interactive-read', cacheMs: 0, cancelWhenUnobserved: true }),
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
    { name: 'synthetic owner', detail: { record_uid: 'record-b', record_owner_user_id: 13, record_core: { record_uid: 'record-b', owner_user_id: '6690025278483443577' } } },
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
