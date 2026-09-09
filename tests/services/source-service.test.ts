import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { arkmeChatConversationPreview, arkmeTimelineConversationPreview, SourceService } from '../../src/services/source-service.js'
import type { ArkmeSourceItem, ArkmeSourceList } from '../../src/types.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('SourceService', () => {
  it('excludes system topics from write candidates without losing pagination or same-name ordinary topics', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body))
      expect(body.keyword).toBe('DSH Agent Input')
      const secondPage = body.offset === 1
      return new Response(JSON.stringify({ code: 0, data: {
        items: [{ topic_core: {
          topic_uid: secondPage ? 'ordinary-topic' : 'system-topic',
          title: 'DSH Agent Input', kind: secondPage ? 1 : 3, status: 1,
        } }],
        has_more: !secondPage,
        ...(!secondPage ? { next_offset: 1 } : {}),
      } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    const first = await service.listTopicCandidates(' DSH Agent Input ')
    expect(first.items).toEqual([])
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBeTruthy()
    const second = await service.listTopicCandidates('DSH Agent Input', first.nextCursor)
    expect(second.items).toHaveLength(1)
    expect(second.items[0]).toMatchObject({ kind: 'topic', topicKind: 1, displayName: 'DSH Agent Input' })
    expect(second.hasMore).toBe(false)
    expect(second.nextCursor).toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('logs private avatar sealing failure without dropping the last good presentation', async () => {
    const runtime = { config } as ServiceRuntime
    const profile = {
      publicProfileSummariesByUserIds: vi.fn().mockResolvedValue(new Map([[88, { avatarUrl: 'unused' }]])),
      sealProfileImageRef: vi.fn().mockRejectedValue(new Error('SECRET_KEYCHAIN_DETAIL')),
    } as unknown as ProfileService
    const service = new SourceService(runtime, profile, {} as never)
    const items: ArkmeSourceItem[] = [{ sourceRef: 'source', kind: 'private_chat', displayName: 'SECRET_NAME', avatarRef: 'old-avatar' }]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await service.hydrateSourceAvatars(items, new Map([[0, 88]]), new Map(), { userId: 42, accessToken: 'access', refreshToken: 'refresh' })
      expect(items[0]?.avatarRef).toBe('old-avatar')
      expect(warn).toHaveBeenCalledOnce()
      const line = String(warn.mock.calls[0]![0])
      expect(JSON.parse(line.slice('[ArkmeAvatarDiag] '.length))).toMatchObject({
        event: 'private_avatar_seal_failed', viewerUserId: 42, targetUserId: 88,
      })
      expect(line).not.toMatch(/SECRET|old-avatar/)
    } finally { warn.mockRestore() }
  })

  it('uses the server-owned full unread summary instead of summing the current page', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ limit: 1 })
      return new Response(JSON.stringify({ code: 200, data: {
        // The first page is intentionally incomplete; summary covers later pages too.
        items: [{ unread_snapshot: { unread_count: 1 } }],
        has_more: true,
        next_page_cursor: { sort_active_at: 1, chat_session_uid: 'page-2' },
        summary: {
          badge_count: 61,
          muted_unread_count: 120,
          session_count_with_unread: 55,
          // Ordinary unread without a human mention is valid.
          has_attention: false,
          summary_version: 1000,
          updated_at: 1000,
        },
      } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    await expect(service.chatUnreadBadgeSummary()).resolves.toEqual({
      badgeCount: 61,
      mutedUnreadCount: 120,
      sessionCountWithUnread: 55,
      hasAttention: false,
      summaryVersion: 1000,
      updatedAtMillis: 1000,
    })
  })

  it('retains the last successful chat avatars when profile and group hydration temporarily fail', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const privateAvatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar/private.png?x-oss-signature=private'
    const groupAvatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar/group.png?x-oss-signature=group'
    let hydrationUnavailable = false
    const fetchImpl = vi.fn(async (input) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/chats/list') return new Response(JSON.stringify({ code: 200, data: {
        items: [{
          session: { chat_session_uid: 'private-1', session_kind: 1, last_active_at: 2 },
          private_counterpart: { user_id: 7, display_name_snapshot: '联系人' },
          unread_snapshot: { unread_count: 1 },
        }, {
          session: { chat_session_uid: 'group-1', session_kind: 2, title: '项目群', last_active_at: 1 },
          unread_snapshot: { unread_count: 1 },
        }],
        has_more: false,
      } }), { status: 200 })
      if (path === '/api/v1/chats/group-avatar-snapshots') {
        if (hydrationUnavailable) throw new Error('group avatars unavailable')
        return new Response(JSON.stringify({ code: 200, data: { items: [{
          chat_session_uid: 'group-1', member_count: 1, strategy: 'owner_recent_speakers',
          computed_at: 1, members: [{ user_id: 8 }],
        }] } }), { status: 200 })
      }
      if (path === '/api/v1/auth/get-public-users-by-ids') {
        if (hydrationUnavailable) throw new Error('profiles unavailable')
        return new Response(JSON.stringify({ code: 200, data: { items: [
          { user_id: 7, nick_name: '联系人', head_img: privateAvatar },
          { user_id: 8, nick_name: '群成员', head_img: groupAvatar },
        ] } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const service = new SourceService(runtime, profile, {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    const hydrated = await service.listSources('root', { refresh: true })
    const privateAvatarRef = hydrated.items[0]?.avatarRef
    const groupAvatarRefs = hydrated.items[1]?.avatarRefs
    const groupPresentation = hydrated.items[1]?.groupAvatar
    expect(privateAvatarRef).toMatch(/^arkme-profile-image-v1\./)
    expect(groupAvatarRefs).toHaveLength(1)
    expect(groupPresentation?.slots).toHaveLength(1)

    hydrationUnavailable = true
    profile.invalidate()
    service.invalidateGroupAvatar(42, 'group-1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await service.listSources('root', { refresh: true })
      expect(result.items[0]).toMatchObject({ avatarRef: privateAvatarRef })
      expect(result.items[1]).toMatchObject({
        avatarRefs: groupAvatarRefs,
        groupAvatar: groupPresentation,
      })
      expect(service.cachedChatSource(42, 'private-1')).toMatchObject({ avatarRef: privateAvatarRef })
      expect(service.cachedChatSource(42, 'group-1')).toMatchObject({
        avatarRefs: groupAvatarRefs,
        groupAvatar: groupPresentation,
      })
    } finally {
      warn.mockRestore()
    }
  })

  it('lets a successful complete avatar baseline remove previous chat avatars', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async (input) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/chats/list') return new Response(JSON.stringify({ code: 200, data: {
        items: [{
          session: { chat_session_uid: 'private-1', session_kind: 1, last_active_at: 2 },
          private_counterpart: { user_id: 7, display_name_snapshot: '联系人' },
          unread_snapshot: { unread_count: 1 },
        }, {
          session: { chat_session_uid: 'group-1', session_kind: 2, title: '项目群', last_active_at: 1 },
          unread_snapshot: { unread_count: 1 },
        }],
        has_more: false,
      } }), { status: 200 })
      if (path === '/api/v1/chats/group-avatar-snapshots') {
        return new Response(JSON.stringify({ code: 200, data: { items: [] } }), { status: 200 })
      }
      if (path === '/api/v1/auth/get-public-users-by-ids') {
        return new Response(JSON.stringify({ code: 200, data: {
          items: [{ user_id: 7, nick_name: '联系人', head_img: '' }],
        } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    service.setChatSource(42, 'private-1', {
      sourceRef: 'private-source', kind: 'private_chat', displayName: '联系人', activeAtMillis: 1,
      unreadCount: 0, avatarRef: 'last-private-avatar',
    })
    service.setChatSource(42, 'group-1', {
      sourceRef: 'group-source', kind: 'group_chat', displayName: '项目群', activeAtMillis: 1,
      unreadCount: 0, avatarRefs: ['last-group-avatar'],
      groupAvatar: {
        memberCount: 1, strategy: 'owner_recent_speakers', computedAtMillis: 1,
        slots: [{ avatarRef: 'last-group-avatar' }],
      },
    })

    const result = await service.listSources('root', { refresh: true })

    expect(result.items[0]).not.toHaveProperty('avatarRef')
    expect(result.items[1]).not.toHaveProperty('avatarRefs')
    expect(result.items[1]).not.toHaveProperty('groupAvatar')
    expect(service.cachedChatSource(42, 'private-1')).not.toHaveProperty('avatarRef')
    expect(service.cachedChatSource(42, 'group-1')).not.toHaveProperty('avatarRefs')
    expect(service.cachedChatSource(42, 'group-1')).not.toHaveProperty('groupAvatar')
  })

  it('builds Jotmo-compatible conversation previews from text and safe media metadata', () => {
    const cases: Array<{ name: string; raw: Record<string, unknown>; expected: string }> = [
      {
        name: 'image',
        raw: { content_payload: { media_refs: [{ file_type: 1, file_name: 'photo.png' }] } },
        expected: '[图片]',
      },
      {
        name: 'file',
        raw: { content_payload: { media_refs: [{ file_type: 6, file_name: 'contract.pdf' }] } },
        expected: '[文件]',
      },
      {
        name: 'video',
        raw: { content_payload: { media_refs: [{ file_type: 3, file_name: 'clip.mp4' }] } },
        expected: '[视频]',
      },
      {
        name: 'voice',
        raw: { content_payload: { voice: { source_file_asset_uid: 'voice-1' } } },
        expected: '[语音]',
      },
      {
        name: 'image and text',
        raw: {
          text_content: '  图文\n正文  ',
          content_payload: { media_refs: [{ file_type: 1, file_name: 'photo.png' }] },
        },
        expected: '[图片]图文 正文',
      },
      {
        name: 'media and rich emoji token',
        raw: {
          text_content: '说明[jm_emoji:red_angry_face]',
          content_payload: { media_refs: [{ file_type: 1, file_name: 'photo.png' }] },
        },
        expected: '[图片]说明[jm_emoji:red_angry_face]',
      },
      {
        name: 'media priority ignores payload order',
        raw: {
          text_content: '混合',
          content_payload: { media_refs: [
            { file_type: 2, file_name: 'voice.m4a' },
            { file_type: 1, file_name: 'photo.png' },
            { file_type: 3, file_name: 'clip.mp4' },
            { file_type: 6, file_name: 'contract.pdf' },
          ] },
        },
        expected: '[文件]混合',
      },
      {
        name: 'business file type wins over misleading MIME',
        raw: {
          content_payload: { media_refs: [{ file_type: 6, file_name: 'photo.png', mime_type: 'image/png' }] },
        },
        expected: '[文件]',
      },
      {
        name: 'MIME corrects a stale file kind',
        raw: {
          content_payload: { media_refs: [{ file_kind: 4, file_name: 'photo.png', mime_type: 'image/png' }] },
        },
        expected: '[图片]',
      },
      {
        name: 'nested current text outranks an outer stale summary',
        raw: {
          record: { summary: '旧摘要', payload: { text_content: '真实正文' } },
        },
        expected: '真实正文',
      },
      {
        name: 'background sound is not a visible attachment',
        raw: {
          text_content: '快记',
          content_payload: { media_refs: [{ file_type: 2, content_file_role: 4, file_name: 'ambient.m4a' }] },
        },
        expected: '快记',
      },
      {
        name: 'sticker render role',
        raw: { content_payload: { media_refs: [{ render_role: 3, file_type: 1, file_name: 'sticker.webp' }] } },
        expected: '[表情]',
      },
      {
        name: 'legacy sticker render kind',
        raw: { content_payload: { render_kind: 'sticker' } },
        expected: '[表情]',
      },
      {
        name: 'known inline emoji already represents the sticker',
        raw: {
          text_content: '[jm_emoji:heart_eyes]',
          content_payload: { media_refs: [{ render_role: 3, file_type: 1, file_name: 'sticker.webp' }] },
        },
        expected: '[jm_emoji:heart_eyes]',
      },
      {
        name: 'unknown inline emoji remains visible',
        raw: {
          text_content: '[jm_emoji:not_exists]',
          content_payload: { media_refs: [{ render_role: 3, file_type: 1, file_name: 'sticker.webp' }] },
        },
        expected: '[表情][jm_emoji:not_exists]',
      },
    ]

    for (const testCase of cases) {
      expect(arkmeChatConversationPreview(testCase.raw), testCase.name).toBe(testCase.expected)
    }
  })

  it('truncates previews by code point without splitting rich emoji tokens', () => {
    const prefix = '字'.repeat(299)
    expect(arkmeChatConversationPreview({ text_content: `${prefix}[jm_emoji:heart_eyes]尾` })).toBe(prefix)
    expect(arkmeChatConversationPreview({ text_content: `${prefix}😠尾` })).toBe(`${prefix}😠`)
  })

  it('combines Markdown plain-text summaries with rich media preview markers', () => {
    expect(arkmeChatConversationPreview({
      text_content: '## 发布\n\n**正文**',
      content_payload: {
        text_format: 'markdown',
        media_refs: [{ file_type: 1, file_name: 'photo.png' }],
      },
    })).toBe('[图片]发布 正文')
    expect(arkmeChatConversationPreview({
      record: {
        summary: '旧摘要',
        payload: {
          text_content: '**新的**\n\n- 内容', text_format: 'markdown',
          media_refs: [{ file_type: 6, file_name: 'contract.pdf' }],
        },
      },
    })).toBe('[文件]新的 内容')
  })

  it('keeps Markdown summaries in legacy timeline media previews', () => {
    expect(arkmeTimelineConversationPreview({
      itemUid: 'markdown-image', title: '', textContent: '# 标题\n\n**正文**', textFormat: 'markdown',
      sendAtMillis: 1, senderName: '我', isMe: true, status: 1, displayKind: 0,
      contentBlocks: [{ kind: 'image', mediaRef: 'image-ref', sortOrder: 0 }],
    })).toBe('[图片]标题 正文')
  })

  it('does not interpret plain-text preview punctuation as Markdown', () => {
    expect(arkmeChatConversationPreview({ text_content: '**原文**', text_format: 'plain' })).toBe('**原文**')
  })

  it('keeps hydrated and legacy timeline preview paths on the shared owner', () => {
    expect(arkmeTimelineConversationPreview({
      itemUid: 'rich-item', title: '', textContent: '正文', sendAtMillis: 1, senderName: '我', isMe: true,
      status: 1, displayKind: 0,
      conversationPreview: '[图片]正文',
      contentBlocks: [],
    })).toBe('[图片]正文')
    expect(arkmeTimelineConversationPreview({
      itemUid: 'legacy-file-item', title: '', textContent: '正文', sendAtMillis: 1, senderName: '我', isMe: true,
      status: 1, displayKind: 0,
      contentBlocks: [{ kind: 'file', mediaRef: 'file-ref', fileName: '方案.pdf', mimeType: 'application/pdf', size: 1, sortOrder: 0 }],
    })).toBe('[文件]正文')
  })

  it('updates only the chat pin while preserving unrelated policy fields', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ path, body })
      if (path === '/api/v1/chats/policy/get') {
        return new Response(JSON.stringify({ code: 200, data: {
          show_in_home_state: 1, privacy_state: 2, mute_state: 2, pin_state: 1, notify_state: 2, status: 3,
        } }), { status: 200 })
      }
      if (path === '/api/v1/chats/policy/update') return new Response(JSON.stringify({ code: 200, data: { chat_session_uid: body.chat_session_uid, user_id:42, show_in_home_state:1, privacy_state:2, mute_state:2, pin_state:2, notify_state:2, status:3, update_at:1000 } }), { status: 200 })
      if (path === '/api/v1/topics/pin/set') return new Response(JSON.stringify({ code: 400, message: 'topic is not found' }), { status: 200 })
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    const source = await service.sourceItem({
      version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '测试会话',
      sidebarSubjectUid: 'topic-chat-1', conversationListActivityAtMillis: 500,
      conversationListLatestSequence: 7,
    })

    await expect(service.setChatDirectoryPin(source.sourceRef, true)).resolves.toEqual({
      sourceRef: source.sourceRef, pinned: true, policyUpdatedAtMillis: expect.any(Number),
    })
    expect(requests).toEqual([{ path: '/api/v1/chats/policy/update', body: { chat_session_uid: 'chat-1', patch: {pin_state:2} } }])
    expect(requests.every(request => request.path.startsWith('/api/v1/chats/'))).toBe(true)
  })

  it('resolves Chat preference identity and activity without changing policy state', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ path, body })
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    const source = await service.sourceItem({
      version: 1, userId: 42, kind: 'group_chat', ownerRef: 'chat-group-1', displayName: '测试群聊',
      sidebarSubjectUid: 'topic-group-1', conversationListActivityAtMillis: 123,
      conversationListLatestSequence: 9,
    })

    await expect(service.chatConversationListPreferenceEntry(source.sourceRef)).resolves.toEqual({
      ownerUserId: 42,
      ref: { entityKind: 1, entityUid: 'chat-group-1' },
      evidence: { sequence: 9, activityAtMillis: 123 },
    })
    expect(requests).toEqual([])
  })

  it('uses the session activity fallback when a list row has no positive sort activity', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, vi.fn(async input => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/chats/list') return new Response(JSON.stringify({ code: 200, data: {
        items: [{
          sort_active_at: 0,
          session: {
            chat_session_uid: 'group-fallback', session_kind: 2, title: '回退群聊',
            last_active_at: 500, last_seq: 8,
          },
          unread_snapshot: { unread_count: 0, session_last_seq: 8 },
        }],
        has_more: false,
      } }), { status: 200 })
      if (path === '/api/v1/chats/group-avatar-snapshots') {
        return new Response(JSON.stringify({ code: 200, data: { items: [] } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    const listed = await service.listGroupSources({ refresh: true })
    const item = listed.items[0]!

    expect(item.activeAtMillis).toBe(500)
    await expect(service.chatConversationListPreferenceEntry(item.sourceRef)).resolves.toMatchObject({
      ref: { entityKind: 1, entityUid: 'group-fallback' },
      evidence: { sequence: 8, activityAtMillis: 500 },
    })
  })

  it('resolves only current-viewer remarks across contact and direct-chat owners', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ path, body })
      if (path === '/api/v1/chats/contacts/list') {
        return new Response(JSON.stringify({ code: 200, data: {
          items: [
            { user_id: '7', remark: 'apple备注' },
            { user_id: '8', remark: '' },
          ],
          has_more: false,
        } }), { status: 200 })
      }
      if (path === '/api/v1/chats/list') {
        return new Response(JSON.stringify({ code: 200, data: {
          items: [
            {
              session: { session_kind: 1 },
              private_counterpart: { user_id: '8' },
              private_supplement: { remark: '' },
            },
            {
              session: { session_kind: 1 },
              private_counterpart: { user_id: '9' },
              private_supplement: { remark: '小九备注' },
            },
          ],
          has_more: false,
        } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    await expect(service.privateRemarksByUserIds([7, 8, 9, 42, 0, 7])).resolves.toEqual(new Map([
      [7, 'apple备注'],
      [9, '小九备注'],
    ]))
    expect(requests).toEqual([
      { path: '/api/v1/chats/contacts/list', body: { limit: 50, offset: 0 } },
      { path: '/api/v1/chats/list', body: { limit: 50 } },
    ])
  })

  it('does not let an invalidated in-flight send-to-self read repopulate the cache', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, vi.fn() as typeof fetch)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    let releaseStale = (): void => {}
    const staleGate = new Promise<void>(resolve => { releaseStale = resolve })
    let reads = 0
    const staleResult: ArkmeSourceList = { directory: 'send_to_self', items: [], total: 1, hasMore: false }
    const freshResult: ArkmeSourceList = { directory: 'send_to_self', items: [], total: 2, hasMore: false }
    const loader = service as unknown as { listSourcesUncached(): Promise<ArkmeSourceList> }
    vi.spyOn(loader, 'listSourcesUncached').mockImplementation(async () => {
      reads += 1
      if (reads === 1) {
        await staleGate
        return staleResult
      }
      return freshResult
    })

    const staleRead = service.listSources('send_to_self', { refresh: true })
    await vi.waitFor(() => { expect(reads).toBe(1) })
    service.invalidateSourceListCache(42, 'send_to_self')
    const freshRead = service.listSources('send_to_self', { refresh: true })
    try {
      await vi.waitFor(() => { expect(reads).toBe(2) })
      await expect(freshRead).resolves.toEqual(freshResult)
    } finally {
      releaseStale()
    }
    await expect(staleRead).resolves.toEqual(staleResult)
    await expect(service.listSources('send_to_self')).resolves.toEqual(freshResult)
    expect(reads).toBe(2)
  })

  it('cancels a send-to-self owner read when its caller is superseded', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let latestRecordSignal: AbortSignal | undefined
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/records/privacy/visibility-snapshot') {
        return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), { status: 200 })
      }
      if (path === '/api/v1/records/uncategorized/query') {
        latestRecordSignal = init?.signal ?? undefined
        return await new Promise<Response>((_resolve, reject) => {
          const rejectAbort = (): void => reject(new DOMException('aborted', 'AbortError'))
          if (init?.signal?.aborted === true) rejectAbort()
          else init?.signal?.addEventListener('abort', rejectAbort, { once: true })
        })
      }
      if (path === '/api/v1/topics/display/list') {
        return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 })
      }
      if (path === '/api/v1/topics/hierarchy/relations/list') {
        return new Response(JSON.stringify({ code: 0, data: { relations: [] } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    const controller = new AbortController()

    const read = service.listSources('send_to_self', { refresh: true, signal: controller.signal })
    await vi.waitFor(() => { expect(latestRecordSignal).toBeDefined() })
    controller.abort()

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(latestRecordSignal?.aborted).toBe(true)
  })

  it('creates a topic with an account-bound source reference', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {
      topic_uid: 'topic-1', status: 1,
    } }), { status: 200 })) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, stateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    await expect(service.createTopic('项目复盘')).resolves.toMatchObject({
      source: {
        kind: 'topic', displayName: '项目复盘',
        sourceRef: expect.stringMatching(/^arkme-source-v1\./),
      },
    })
  })

  it('moves a topic atomically to the root and persists its sibling order', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    let created = 0
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ path, body })
      if (path === '/api/v1/topics/create') {
        created += 1
        return new Response(JSON.stringify({ code: 0, data: { topic_uid: `topic-${String(created)}`, status: 1 } }), { status: 200 })
      }
      if (path === '/api/v1/topics/hierarchy/bind') {
        return new Response(JSON.stringify({ code: 0, data: { relation: { status: 1 } } }), { status: 200 })
      }
      if (path === '/api/v1/topics/hierarchy/move') {
        return new Response(JSON.stringify({ code: 0, data: {
          topic_uid: 'topic-2', parent_topic_uid: '', sibling_order: 1,
        } }), { status: 200 })
      }
      throw new Error(`unexpected request: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    const parent = await service.createTopic('父主题')
    const child = await service.createTopic('子主题', parent.source.sourceRef)
    await expect(service.moveTopicHierarchy(
      child.source.sourceRef, parent.source.sourceRef, undefined, undefined,
    )).resolves.toEqual({ sourceRef: child.source.sourceRef, siblingOrder: 1 })
    expect(calls.at(-1)).toMatchObject({
      path: '/api/v1/topics/hierarchy/move',
      body: {
        topic_uid: 'topic-2', previous_parent_topic_uid: 'topic-1',
        parent_topic_uid: '', insert_before_topic_uid: '',
      },
    })
  })

  it('does not join concurrent root and group-only reads or share their failure state', async () => {
    const activeSession = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const sessions: ArkmeSessionStore = {
      async read() { return activeSession }, async write() {}, async delete() {},
    }
    let releaseRequests = (): void => {}
    const requestGate = new Promise<void>(resolve => { releaseRequests = resolve })
    const listBodies: Array<Record<string, unknown>> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (path === '/api/v1/chats/group-avatar-snapshots') {
        return new Response(JSON.stringify({ code: 200, data: { items: [] } }), { status: 200 })
      }
      if (path !== '/api/v1/chats/list') throw new Error(`unexpected path: ${path}`)
      listBodies.push(body)
      await requestGate
      if (body.session_kind !== 2) {
        return new Response(JSON.stringify({ code: 500, message: 'root unavailable' }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 200, data: {
        items: [{ session: { chat_session_uid: 'group-1', session_kind: 2, title: '项目群' } }],
        has_more: false,
      } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    const rootRead = service.listSources('root', { refresh: true })
    const groupRead = service.listGroupSources({ refresh: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    releaseRequests()
    const [rootResult, groupResult] = await Promise.allSettled([rootRead, groupRead])

    expect(rootResult.status).toBe('rejected')
    expect(groupResult).toMatchObject({
      status: 'fulfilled', value: { items: [{ kind: 'group_chat', displayName: '项目群' }] },
    })
    expect(listBodies).toEqual([
      { limit: 30 },
      { limit: 30, session_kind: 2 },
    ])
  })

  it('skips DSH Agent input records when decorating the default category preview', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const fetchImpl = vi.fn(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), { status: 200 })
      }
      if (url.endsWith('/api/v1/topics/display/list')) {
        return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 })
      }
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) {
        return new Response(JSON.stringify({ code: 0, data: { relations: [] } }), { status: 200 })
      }
      if (url.endsWith('/api/v1/records/uncategorized/query')) {
        return new Response(JSON.stringify({ code: 0, data: {
          items: [{
            record_uid: 'dsh-input-1',
            send_at: 200,
            record_core: {
              record_uid: 'dsh-input-1',
              text_content: '不该作为默认分类预览',
              creation_source: 3,
              send_at: 200,
            },
          }, {
            record_uid: 'normal-1',
            send_at: 190,
            record_core: {
              record_uid: 'normal-1',
              text_content: '普通发给自己',
              creation_source: 0,
              send_at: 190,
            },
          }],
        } }), { status: 200 })
      }
      throw new Error(`unexpected request: ${url}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, stateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 2, wordsCount: 0, totalSec: 0 } },
      isDSHAgentInput(raw) {
        const item = raw as { record_core?: { creation_source?: number } }
        return item.record_core?.creation_source === 3
      },
      recordItem(raw) {
        const item = raw as { record_uid: string; send_at: number; record_core: { text_content: string } }
        return {
          recordUid: item.record_uid,
          sendAtMillis: item.send_at,
          title: '',
          textContent: item.record_core.text_content,
          templateKind: 1,
          status: 1,
          version: 1,
        }
      },
    })

    const result = await service.listSources('send_to_self', { refresh: true })
    const defaultCategory = result.items.find(item => item.kind === 'default_category')

    expect(defaultCategory).toMatchObject({
      displayName: '未分类',
      latestPreview: '普通发给自己',
      activeAtMillis: 190,
    })
  })

  it('never projects privacy-locked topics or protected quick notes into the personal directory', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const bodies: Array<Record<string, unknown>> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      bodies.push(body)
      if (path === '/api/v1/records/privacy/visibility-snapshot') {
        return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), { status: 200 })
      }
      if (path === '/api/v1/topics/display/list') return new Response(JSON.stringify({ code: 0, data: { items: [
        { topic_core: { topic_uid: 'public-topic', title: '公开主题', privacy_state: 1 }, summary: { record_count: 1 } },
        { topic_core: { topic_uid: 'private-topic', title: '不能显示', privacy_state: 2 }, summary: { record_count: 99 } },
      ] } }), { status: 200 })
      if (path === '/api/v1/topics/hierarchy/relations/list') {
        return new Response(JSON.stringify({ code: 0, data: { relations: [] } }), { status: 200 })
      }
      if (path === '/api/v1/records/uncategorized/query') return new Response(JSON.stringify({ code: 0, data: { items: [
        { record_uid: 'locked-record', record_core: { record_uid: 'locked-record', text_content: '不能显示', content_access_state: 2 } },
        { record_uid: 'public-record', send_at: 10, record_core: { record_uid: 'public-record', text_content: '公开快记', send_at: 10 } },
      ] } }), { status: 200 })
      throw new Error(`unexpected request: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 1, wordsCount: 0, totalSec: 0 } },
      recordItem(raw) {
        const item = raw as { record_uid: string; send_at: number; record_core: { text_content: string } }
        return { recordUid: item.record_uid, sendAtMillis: item.send_at, title: '', textContent: item.record_core.text_content, templateKind: 1, status: 1, version: 1 }
      },
    })

    const result = await service.listSources('send_to_self', { refresh: true })
    expect(result.items.map(item => item.displayName)).toEqual(['发给自己', '未分类', '公开主题'])
    expect(result.items.find(item => item.kind === 'default_category')).toMatchObject({ latestPreview: '公开快记' })
    expect(bodies).toContainEqual({ limit: 30, keyword: '', privacy_state: 1 })
    expect(bodies).toContainEqual({ limit: 10 })
  })

  it('loads 100 personal topics so a parent after the first 50 can retain its child hierarchy', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const fillerTopics = Array.from({ length: 99 }, (_, index) => ({
      topic_core: { topic_uid: `topic-${String(index + 1)}`, title: `主题${String(index + 1)}` },
      summary: { record_count: 0 },
    }))
    const displayItems = [
      { topic_core: { topic_uid: 'child', title: '二级主题' }, summary: { record_count: 0 } },
      ...fillerTopics,
      { topic_core: { topic_uid: 'parent', title: '一级主题' }, summary: { record_count: 0 } },
    ]
    const displayListBodies: Array<Record<string, unknown>> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (path === '/api/v1/records/privacy/visibility-snapshot') {
        return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), { status: 200 })
      }
      if (path === '/api/v1/topics/display/list') {
        displayListBodies.push(body)
        const limit = Number(body.limit)
        const offset = Number(body.offset ?? 0)
        const nextOffset = offset + limit
        return new Response(JSON.stringify({ code: 0, data: {
          items: displayItems.slice(offset, nextOffset),
          has_more: nextOffset < displayItems.length,
          ...(nextOffset < displayItems.length ? { next_offset: nextOffset } : {}),
        } }), { status: 200 })
      }
      if (path === '/api/v1/topics/hierarchy/relations/list') {
        return new Response(JSON.stringify({ code: 0, data: { relations: [{
          parent_topic_uid: 'parent', child_topic_uid: 'child', rel_kind: 1, status: 1,
        }] } }), { status: 200 })
      }
      if (path === '/api/v1/records/uncategorized/summary') {
        return new Response(JSON.stringify({ code: 0, data: { record_count: 0 } }), { status: 200 })
      }
      if (path === '/api/v1/records/uncategorized/query') {
        return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, stateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    const first = await service.listSources('send_to_self', { limit: 100, refresh: true })
    const child = first.items.find(item => item.displayName === '二级主题')
    const second = await service.listSources('send_to_self', { limit: 100, cursor: first.nextCursor, refresh: true })
    const parent = second.items.find(item => item.displayName === '一级主题')

    expect(displayListBodies).toEqual([
      { limit: 100, keyword: '', privacy_state: 1 },
      { limit: 100, keyword: '', privacy_state: 1, offset: 100 },
    ])
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(child?.parentSourceRef).toBeUndefined()
    expect(child?.parentTopicHierarchyKey).toEqual(expect.any(String))
    expect(parent?.topicHierarchyKey).toBe(child?.parentTopicHierarchyKey)
  })
})


describe('Chat directory pin owner boundary', () => {
  function fixture(options: { failure?: 'get' | 'update'; userId?: number; getReply?: Record<string, unknown>; updateReply?: Record<string, unknown> } = {}) {
    const requests: Array<{ origin: string; path: string; body: Record<string, unknown> }> = []
    const policy = { chat_session_uid: 'chat-1', user_id: options.userId ?? 42, update_at: 1000, show_in_home_state: 2, privacy_state: 2, mute_state: 2, pin_state: 1, notify_state: 2, status: 3 }
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: options.userId ?? 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ origin: url.origin, path: url.pathname, body })
      if (url.origin !== config.chatBaseUrl) throw new Error('Chat pin must not access Record or Subject')
      if (url.pathname === `/api/v1/chats/policy/${options.failure}`) {
        return new Response(JSON.stringify({ code: 400, message: 'policy denied' }), { status: 200 })
      }
      if (url.pathname === '/api/v1/chats/list') {
        return new Response(JSON.stringify({ code: 200, data: { has_more: false, items: [{
          session: { chat_session_uid: 'chat-1', session_kind: 1 },
          current_policy: policy,
          private_supplement: { remark: '会话' },
        }] } }), { status: 200 })
      }
      if (url.pathname === '/api/v1/chats/policy/get') {
        return new Response(JSON.stringify({ code: 200, data: options.getReply ?? policy }), { status: 200 })
      }
      if (url.pathname === '/api/v1/chats/policy/update') {
        Object.assign(policy, body.patch, { update_at: policy.update_at + 1 })
        return new Response(JSON.stringify({ code: 200, data: options.updateReply ?? policy }), { status: 200 })
      }
      throw new Error(`Unexpected Chat endpoint: ${url.pathname}`)
    })
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    return { service, requests, policy, runtime, fetchImpl }
  }

  for (const kind of ['private_chat', 'group_chat'] as const) {
    for (const pinned of [true, false]) {
      it.each([undefined, 'unrelated-personal-topic'])(`${kind} pinned=${pinned} ignores subject metadata %s`, async sidebarSubjectUid => {
        const { service, requests } = fixture()
        const source = await service.sourceItem({
          version: 1, userId: 42, kind, ownerRef: 'chat-1', displayName: '会话',
          ...(sidebarSubjectUid === undefined ? {} : { sidebarSubjectUid }),
        })
        const cached = { ...source, isPinned: !pinned, unreadCount: 7, isMuted: true }
        service.setChatSource(42, 'chat-1', cached)
        service.setChatSource(43, 'chat-1', { ...cached, displayName: '其他账号' })
        const before = service.cachedChatSource(42, 'chat-1')
        const otherAccountBefore = service.cachedChatSource(43, 'chat-1')

        await expect(service.setChatDirectoryPin(source.sourceRef, pinned)).resolves.toEqual({ sourceRef: source.sourceRef, pinned, policyUpdatedAtMillis: expect.any(Number) })
        expect(requests.map(request => request.path)).toEqual(['/api/v1/chats/policy/update'])
        expect(requests[0]?.body).toEqual({ chat_session_uid: 'chat-1', patch: { pin_state: pinned ? 2 : 1 } })
        expect(service.cachedChatSource(42, 'chat-1')).toEqual({ ...before, isPinned: pinned, chatPolicyUpdatedAtMillis: expect.any(Number), chatNotificationPolicyUpdatedAtMillis: expect.any(Number) })
        expect(service.cachedChatSource(43, 'chat-1')).toEqual(otherAccountBefore)
      })
    }
  }

  it.each(['update'] as const)('preserves the cached row when Chat policy %s fails', async failure => {
    const { service, requests } = fixture({ failure })
    const source = await service.sourceItem({ version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '会话' })
    const cached = { ...source, isPinned: false }
    service.setChatSource(42, 'chat-1', cached)
    const before = service.cachedChatSource(42, 'chat-1')
    await expect(service.setChatDirectoryPin(source.sourceRef, true)).rejects.toThrow('policy denied')
    expect(service.cachedChatSource(42, 'chat-1')).toEqual(before)
    expect(requests.map(request => request.path)).toEqual(['/api/v1/chats/policy/update'])
  })

  it('keeps repeated pin requests idempotent and can subsequently unpin', async () => {
    const { service, policy } = fixture()
    const source = await service.sourceItem({ version: 1, userId: 42, kind: 'group_chat', ownerRef: 'chat-1', displayName: '群聊' })
    await service.setChatDirectoryPin(source.sourceRef, true)
    await service.setChatDirectoryPin(source.sourceRef, true)
    expect(policy.pin_state).toBe(2)
    await service.setChatDirectoryPin(source.sourceRef, false)
    expect(policy).toMatchObject({ pin_state: 1, privacy_state: 2, mute_state: 2, show_in_home_state: 2 })
  })

  it('projects owner policy timestamps through directory and realtime rows without regressing newer cached pins', async () => {
    const { service, policy } = fixture()
    Object.assign(policy, { pin_state: 2, update_at: 3000 })
    const first = await service.listSources('root')
    expect(first.items[0]).toMatchObject({ isPinned: true, chatPolicyUpdatedAtMillis: 3000 })
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const stale = await service.chatSourceFromBundle({
      session: { chat_session_uid: 'chat-1', session_kind: 1 },
      current_policy: { ...policy, pin_state: 1, update_at: 2000 },
      unread_snapshot: { session_last_seq: 11, unread_count: 1 },
    }, session, first.items[0], [])
    expect(stale).toMatchObject({ isPinned: true, chatPolicyUpdatedAtMillis: 3000, latestSequence: 11, unreadCount: 1 })
    const fresh = await service.chatSourceFromBundle({
      session: { chat_session_uid: 'chat-1', session_kind: 1 },
      current_policy: { ...policy, pin_state: 1, update_at: 4000 },
    }, session, stale, [])
    service.setChatSource(42, 'chat-1', fresh)
    service.setChatSource(42, 'chat-1', stale)
    expect(service.cachedChatSource(42, 'chat-1')).toMatchObject({ isPinned: false, chatPolicyUpdatedAtMillis: 4000 })
  })

  it('returns consistent notification fields when an old realtime bundle follows newer mute evidence', async () => {
    const { service, policy } = fixture()
    Object.assign(policy, { mute_state: 2, notify_state: 2, update_at: 2000 })
    const first = await service.listSources('root')
    const cached = { ...first.items[0]!, isPinned: true, chatPolicyUpdatedAtMillis: 3000 }
    const stale = await service.chatSourceFromBundle({
      session: { chat_session_uid: 'chat-1', session_kind: 1 },
      current_policy: { ...policy, mute_state: 1, notify_state: 1, update_at: 1000 },
      unread_snapshot: { unread_count: 5, session_last_seq: 12 },
    }, { userId: 42, accessToken: 'access', refreshToken: 'refresh' }, cached, [])
    expect(stale).toMatchObject({
      isPinned: true, chatPolicyUpdatedAtMillis: 3000,
      isMuted: true, chatNotificationPolicyUpdatedAtMillis: 2000,
      unreadCount: 5, badgeUnreadCount: 0, notificationAllowed: false,
    })
  })

  it('invalidates the directory cache and reads pin state back from Chat after each write', async () => {
    const { service, requests } = fixture()
    const first = await service.listSources('root')
    const source = first.items[0]!
    expect(source.isPinned).toBe(false)
    await service.listSources('root')
    expect(requests.filter(request => request.path === '/api/v1/chats/list')).toHaveLength(1)
    await service.setChatDirectoryPin(source.sourceRef, true)
    expect((await service.listSources('root')).items[0]?.isPinned).toBe(true)
    await service.setChatDirectoryPin(source.sourceRef, false)
    expect((await service.listSources('root')).items[0]?.isPinned).toBe(false)
    expect(requests.filter(request => request.path === '/api/v1/chats/list')).toHaveLength(3)
  })

  it('does not reuse an in-flight directory read started before pinning', async () => {
    const { service } = fixture()
    const source = await service.sourceItem({ version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '会话' })
    let releaseStale = (): void => {}
    const staleGate = new Promise<void>(resolve => { releaseStale = resolve })
    const staleResult: ArkmeSourceList = { directory: 'root', items: [{ ...source, isPinned: false }], hasMore: false }
    const freshResult: ArkmeSourceList = { directory: 'root', items: [{ ...source, isPinned: true }], hasMore: false }
    const loader = service as unknown as { listSourcesUncached(): Promise<ArkmeSourceList> }
    const read = vi.spyOn(loader, 'listSourcesUncached')
      .mockImplementationOnce(async () => { await staleGate; return staleResult })
      .mockResolvedValue(freshResult)
    const staleRead = service.listSources('root', { refresh: true })
    await vi.waitFor(() => { expect(read).toHaveBeenCalledTimes(1) })
    await service.setChatDirectoryPin(source.sourceRef, true)
    const freshRead = service.listSources('root', { refresh: true })
    try {
      await vi.waitFor(() => { expect(read).toHaveBeenCalledTimes(2) })
      await expect(freshRead).resolves.toEqual(freshResult)
    } finally {
      releaseStale()
    }
    await staleRead
    await expect(service.listSources('root')).resolves.toEqual(freshResult)
  })

  it.each(['pin-ack', 'policy-notice'] as const)('retires coordinated directory reads after %s', async trigger => {
    const { service, policy, fetchImpl, runtime } = fixture()
    const source = await service.sourceItem({ version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '会话' })
    let releaseOld!: (response: Response) => void
    const oldResponse = new Response(JSON.stringify({ code: 200, data: { has_more: false, items: [{
      session: { chat_session_uid: 'chat-1', session_kind: 1 },
      current_policy: { ...policy },
    }] } }), { status: 200 })
    fetchImpl.mockImplementationOnce(async () => await new Promise<Response>(resolve => { releaseOld = resolve }))
    const oldRead = service.listSources('root', { refresh: true })
    await vi.waitFor(() => { expect(releaseOld).toBeTypeOf('function') })
    if (trigger === 'pin-ack') await service.setChatDirectoryPin(source.sourceRef, true)
    else {
      policy.pin_state = 2
      service.invalidateSourceListCache(42, 'root')
    }
    const callsBeforeRefresh = fetchImpl.mock.calls.length
    const freshRead = service.listSources('root', { refresh: true })
    try {
      // A detached read cannot be joined after a write, but the route retains its
      // single-execution budget until the old transport has actually settled.
      await new Promise(resolve => setTimeout(resolve, 250))
      expect(fetchImpl).toHaveBeenCalledTimes(callsBeforeRefresh)
      releaseOld(oldResponse)
      await vi.waitFor(() => { expect(fetchImpl).toHaveBeenCalledTimes(callsBeforeRefresh + 1) })
      await expect(freshRead).resolves.toMatchObject({ items: [{ isPinned: true }] })
    } finally {
      releaseOld(oldResponse)
      await Promise.allSettled([oldRead, freshRead])
      runtime.dispose()
    }
    await expect(service.listSources('root')).resolves.toMatchObject({ items: [{ isPinned: true }] })
    expect(service.cachedChatSource(42, 'chat-1')?.isPinned).toBe(true)
  })

  it('rejects a source from another account before network I/O', async () => {
    const { service, requests } = fixture({ userId: 43 })
    const source = await service.sourceItem({ version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '会话' })
    await expect(service.setChatDirectoryPin(source.sourceRef, true)).rejects.toMatchObject({ code: 'source-ref-invalid' })
    expect(requests).toEqual([])
  })

  it.each(['topic', 'default_category'] as const)('rejects %s as a chat pin target before network I/O', async kind => {
    const { service, requests } = fixture()
    const source = await service.sourceItem({ version: 1, userId: 42, kind, ownerRef: 'topic-1', displayName: '主题' })
    await expect(service.setChatDirectoryPin(source.sourceRef, true)).rejects.toMatchObject({ code: 'chat-directory-policy-invalid' })
    expect(requests).toEqual([])
  })


  it.each([
    {}, { chat_session_uid: 'other-chat', pin_state: 2, update_at: 1000 },
    { chat_session_uid: 'chat-1', pin_state: 0, update_at: 1000 },
    ...[undefined, 0, -1, '1000'].map(update_at => ({ chat_session_uid: 'chat-1', pin_state: 2, update_at })),
  ])('does not publish an invalid write acknowledgement: %j', async updateReply => {
    const { service } = fixture({ updateReply })
    const source = await service.sourceItem({ version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '会话' })
    service.setChatSource(42, 'chat-1', { ...source, isPinned: false })
    await expect(service.setChatDirectoryPin(source.sourceRef, true)).rejects.toMatchObject({ code: 'chat-policy-result-invalid' })
    expect(service.cachedChatSource(42, 'chat-1')?.isPinned).toBe(false)
  })

  it('does not report success when Chat ignores a stale pin write', async () => {
    const { service } = fixture({ updateReply: { chat_session_uid: 'chat-1', user_id:42, show_in_home_state:2, privacy_state:2, mute_state:2, notify_state:2, status:3, pin_state: 1, update_at: 2000 } })
    const source = await service.sourceItem({ version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '会话' })
    service.setChatSource(42, 'chat-1', { ...source, isPinned: false })
    await expect(service.setChatDirectoryPin(source.sourceRef, true)).rejects.toMatchObject({ code: 'chat-policy-conflict' })
    expect(service.cachedChatSource(42, 'chat-1')?.isPinned).toBe(false)
  })

  it('does not send an already cancelled pin request' , async () => {
    const { service, requests } = fixture()
    const source = await service.sourceItem({ version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '会话' })
    const controller = new AbortController()
    controller.abort()
    await expect(service.setChatDirectoryPin(source.sourceRef, true, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests).toEqual([])
  })
})
