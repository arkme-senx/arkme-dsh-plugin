import { afterEach, describe, expect, it, vi } from 'vitest'

import { BotService } from '../../src/services/bot-service.js'
import { ContactDirectoryService } from '../../src/services/contact-directory-service.js'
import { SourceService } from '../../src/services/source-service.js'

const session = { userId: 7, accessToken: 'access', refreshToken: 'refresh' }

interface FixtureOptions {
  contacts?: Record<string, unknown>
  groups?: Record<string, unknown>
  groupAvatars?: Record<string, unknown>
  bots?: Record<string, unknown>
  profiles?: Map<number, Record<string, unknown>>
}

function fixture(options: FixtureOptions = {}) {
  let currentSession = session
  const runtime = {
    config: { environment: 'test' },
    stateStore: { async uniqueCode() { return 'directory-test-secret' } },
    requireSession: vi.fn(async () => currentSession),
    authenticatedChatPost: vi.fn(async (path: string) => {
      if (path === '/api/v1/chats/list') return options.groups ?? { items: [], has_more: false }
      if (path === '/api/v1/chats/group-avatar-snapshots') return options.groupAvatars ?? { items: [] }
      if (path === '/api/v1/chats/contacts/list') return options.contacts ?? { items: [], total: 0, has_more: false }
      throw new Error(`unexpected chat path: ${path}`)
    }),
    authenticatedBotPost: vi.fn(async () => options.bots ?? { bots: [] }),
  }
  const profiles = options.profiles ?? new Map<number, Record<string, unknown>>()
  const profile = {
    publicProfileSummariesByUserIds: vi.fn(async (userIds: readonly number[]) => new Map(
      userIds.flatMap(userId => {
        const value = profiles.get(userId)
        return value === undefined ? [] : [[userId, value] as const]
      }),
    )),
    sealProfileImageRef: vi.fn(async (_viewerUserId: number, targetUserId: number) => `avatar-ref-${String(targetUserId)}`),
  }
  const source = new SourceService(runtime as never, profile as never, {
    async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
    recordItem() { return undefined },
  })
  const bot = new BotService(runtime as never, source)
  const world = { listUserWorldFeed: vi.fn(async () => ({ items: [], total: 0, hasMore: false })) }
  const chat = { openPrivateChatFromUser: vi.fn(async () => ({ source: { sourceRef: 'private-source-ref' } })) }
  const service = new ContactDirectoryService(
    runtime as never, source, bot, profile as never, world as never, chat as never,
  )
  return {
    service, runtime, source, bot, profile, world, chat,
    setSession(next: typeof session) { currentSession = next },
  }
}

afterEach(() => { vi.useRealTimers() })

describe('ContactDirectoryService', () => {
  it('opens only a signed current-account group and checks abort before and after source projection', async () => {
    const { service, source, setSession } = fixture({
      groups: { items: [{ session: { chat_session_uid: 'group-owner-1', session_kind: 2, title: '项目群' } }] },
    })
    const page = await service.list('groups')
    const groupRef = page.items[0]!.kind === 'group' ? page.items[0]!.sourceRef : ''
    await expect(service.openGroupChat(groupRef)).resolves.toMatchObject({ kind: 'group_chat', displayName: '项目群' })

    setSession({ ...session, userId: 8 })
    await expect(service.openGroupChat(groupRef)).rejects.toMatchObject({ code: expect.any(String) })
    setSession(session)

    vi.spyOn(source, 'openSourceRef').mockResolvedValueOnce({ kind: 'private_chat' } as never)
    await expect(service.openGroupChat(groupRef)).rejects.toMatchObject({ code: 'directory-group-invalid' })

    const preAborted = new AbortController(); preAborted.abort()
    await expect(service.openGroupChat(groupRef, preAborted.signal)).rejects.toMatchObject({ name: 'AbortError' })

    const deferred = new AbortController()
    vi.spyOn(source, 'sourceItem').mockImplementationOnce(async item => {
      deferred.abort()
      return { sourceRef: 'should-not-return', kind: item.kind, displayName: '延迟群', activeAtMillis: 1, unreadCount: 0 } as never
    })
    await expect(service.openGroupChat(groupRef, deferred.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('counts only the directory sections owned by the contact service without issuing display rows or opaque contact references', async () => {
    const { service, runtime, profile } = fixture({
      groups: { items: [{ session: { chat_session_uid: 'must-not-project', session_kind: 2, title: '群' } }], total: 11 },
      bots: { bots: [{ bot_id: 'must-not-project', name: 'Bot', provider: 'webhook' }], total: 12 },
      contacts: { items: [{ user_id: 88, remark: 'must-not-project' }], total: 14 },
    })

    await expect(Promise.all((['groups', 'bots', 'contacts'] as const).map(
      async section => await service.list(section, { countOnly: true }),
    ))).resolves.toEqual([
      { section: 'groups', items: [], total: 11, hasMore: false },
      { section: 'bots', items: [], total: 12, hasMore: false },
      { section: 'contacts', items: [], total: 1, hasMore: false },
    ])
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/list', { limit: 0, session_kind: 2 }, session, undefined,
      expect.objectContaining({ lane: 'interactive-read' }),
    )
    expect(runtime.authenticatedBotPost).toHaveBeenCalledWith(
      '/api/v1/bot/list', { limit: 0 }, session, undefined,
    )
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/contacts/list', { limit: 50, offset: 0 }, session, undefined,
      expect.objectContaining({ lane: 'interactive-read' }),
    )
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/list', { limit: 50, session_kind: 1 }, session, undefined,
      expect.objectContaining({ lane: 'interactive-read' }),
    )
    expect(profile.publicProfileSummariesByUserIds).not.toHaveBeenCalled()
  })

  it('reads only group sessions through SourceService and preserves account-bound source refs', async () => {
    const { service, runtime, source } = fixture({
      groups: {
        items: [
          { session: { chat_session_uid: 'group-secret-1', session_kind: 2, title: '项目群' } },
          { session: { chat_session_uid: 'private-secret-1', session_kind: 1, title: '不应出现' } },
          { session: { chat_session_uid: '', session_kind: 2, title: '损坏项' } },
        ],
        total: 137,
        has_more: false,
      },
    })

    const page = await service.list('groups', { limit: 99 })

    expect(page).toEqual({
      section: 'groups', total: 137, hasMore: false,
      items: [{ kind: 'group', sourceRef: expect.stringMatching(/^arkme-source-v1\./), displayName: '项目群' }],
    })
    expect(JSON.stringify(page)).not.toContain('group-secret-1')
    expect(JSON.stringify(page)).not.toContain('private-secret-1')
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/list', { limit: 50, session_kind: 2 }, session, undefined,
      expect.objectContaining({ lane: 'interactive-read' }),
    )
    await expect(source.openSourceRef(page.items[0]!.kind === 'group' ? page.items[0]!.sourceRef : '', 7))
      .resolves.toMatchObject({ kind: 'group_chat', ownerRef: 'group-secret-1' })
  })

  it('preserves the conversation group-avatar projection in directory rows', async () => {
    const { service } = fixture({
      groups: {
        items: [{ session: { chat_session_uid: 'group-avatar-1', session_kind: 2, title: '头像群' } }],
        total: 1, has_more: false,
      },
      groupAvatars: { items: [{
        chat_session_uid: 'group-avatar-1', member_count: 2, strategy: 'recent_active', computed_at: 123,
        members: [{ user_id: 11 }, { user_id: 12 }],
      }] },
      profiles: new Map([
        [11, { userId: 11, displayName: '成员一', nickname: '成员一', avatarUrl: 'private-avatar-url' }],
        [12, { userId: 12, displayName: '成员二', nickname: '成员二', avatarFallback: { kind: 'phone_default', colorIndex: 3, label: '成员' } }],
      ]),
    })

    const page = await service.list('groups')

    expect(page.items[0]).toMatchObject({
      kind: 'group', displayName: '头像群',
      groupAvatar: {
        memberCount: 2, strategy: 'recent_active', computedAtMillis: 123,
        slots: [
          { avatarRef: 'avatar-ref-11' },
          { fallback: { kind: 'phone_default', colorIndex: 3, label: '成员' } },
        ],
      },
    })
    expect(JSON.stringify(page)).not.toContain('private-avatar-url')
  })

  it('reuses BotService projection, skips malformed Bots, and never leaks raw Bot ids', async () => {
    const { service } = fixture({ bots: { bots: [
      { bot_id: 'bot-private-1', name: '小助手', provider: 'webhook', status: 'online' },
      { bot_id: '', name: '损坏 Bot', provider: 'webhook' },
    ] } })

    const page = await service.list('bots')

    expect(page).toEqual({
      section: 'bots', total: 1, hasMore: false,
      items: [{
        kind: 'bot', bot: {
        botRef: expect.stringMatching(/^arkme-bot-v2\./),
        directoryKey: expect.stringMatching(/^arkme-bot-directory-v1\./),
        name: '小助手', provider: 'webhook', description: '', status: 'online',
        directChatAvailable: false, privateChatOutboundEnabled: false, refreshOnRecordChanges: false,
        conversationProjection: 'none',
      } }],
    })
    expect(page.items[0]).not.toHaveProperty('botRef')
    expect(page.items[0]).not.toHaveProperty('displayName')
    expect(page.items[0]).not.toHaveProperty('avatarRef')
    expect(JSON.stringify(page)).not.toContain('bot-private-1')
  })

  it('rejects Team reads because Team has an independent OpenAPI-backed owner', async () => {
    const { service } = fixture()
    await expect(service.list('teams')).rejects.toMatchObject({
      code: 'directory-section-not-owned',
      httpStatus: 501,
    })
  })

  it('projects contacts with remark, profile nickname, allowed account name, then a safe fallback', async () => {
    const { service, runtime } = fixture({
      contacts: {
        items: [
          { chat_session_uid: 'chat-1', user_id: 101, remark: '老张', display_name: '后端组合名', contact_state: 1 },
          { chat_session_uid: 'chat-2', user_id: 102, remark: '', display_name: '后端组合名', contact_state: 1 },
          { chat_session_uid: 'chat-3', user_id: 103, remark: '', display_name: '后端组合名', contact_state: 1 },
          { chat_session_uid: 'chat-4', user_id: 104, remark: '', display_name: 'private raw name', contact_state: 1 },
          { chat_session_uid: 'broken', user_id: 0, remark: '损坏', contact_state: 1 },
        ],
        total: 4,
        has_more: false,
      },
      profiles: new Map([
        [101, { userId: 101, displayName: '张三', nickname: '张三', accountName: 'zhang-san', avatarUrl: 'private-url' }],
        [102, { userId: 102, displayName: '林林', nickname: '林林', accountName: 'lin-lin' }],
        [103, { userId: 103, displayName: 'account-three', nickname: '', accountName: 'account-three' }],
      ]),
    })

    const page = await service.list('contacts', { limit: 4 })

    expect(page).toMatchObject({ section: 'contacts', total: 4, hasMore: false })
    expect(page.items).toEqual([
      expect.objectContaining({ kind: 'contact', displayName: '老张', nickname: '张三', remark: '老张', accountName: 'zhang-san', letter: 'L', avatarRef: 'avatar-ref-101' }),
      expect.objectContaining({ kind: 'contact', displayName: '林林', nickname: '林林', remark: '', accountName: 'lin-lin', letter: 'L' }),
      expect.objectContaining({ kind: 'contact', displayName: 'account-three', nickname: '', remark: '', accountName: 'account-three', letter: 'A' }),
      expect.objectContaining({ kind: 'contact', displayName: '联系人', nickname: '', remark: '', letter: 'L' }),
    ])
    const serialized = JSON.stringify(page)
    expect(serialized).not.toContain('chat-1')
    expect(serialized).not.toContain('user_id')
    expect(serialized).not.toContain('private-url')
    expect(serialized).not.toContain('private raw name')
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/contacts/list', { limit: 50, offset: 0 }, session, undefined,
      expect.objectContaining({ lane: 'interactive-read' }),
    )
  })

  it('provides current-user and contact identities to the recording speaker candidate interface', async () => {
    const { service, profile } = fixture({
      contacts: {
        items: [
          { chat_session_uid: 'chat-self', user_id: 7, remark: '不应重复的自己', contact_state: 1 },
          { chat_session_uid: 'chat-101', user_id: 101, remark: '老张', contact_state: 1 },
          { chat_session_uid: 'chat-102', user_id: 102, remark: '', display_name: '快照名', contact_state: 1 },
        ],
        total: 3,
        has_more: false,
      },
      profiles: new Map([
        [7, { userId: 7, displayName: '当前用户', nickname: '我', avatarUrl: 'private-current-avatar' }],
        [101, { userId: 101, displayName: '张三', nickname: '张三', avatarUrl: 'private-contact-avatar' }],
        [102, { userId: 102, displayName: '', nickname: '', accountName: 'contact-102' }],
      ]),
    })
    const controller = new AbortController()

    await expect(service.listRecordingSpeakerUsers(session, controller.signal)).resolves.toEqual([
      { userId: 7, label: '当前用户', avatarRef: 'avatar-ref-7' },
      { userId: 101, label: '老张', avatarRef: 'avatar-ref-101' },
      { userId: 102, label: 'contact-102' },
    ])
    expect(profile.publicProfileSummariesByUserIds).toHaveBeenCalledWith(
      [7, 101, 102], session, controller.signal,
    )
    expect(profile.sealProfileImageRef).toHaveBeenCalledWith(7, 7)
    expect(profile.sealProfileImageRef).toHaveBeenCalledWith(7, 101)
  })

  it('keeps the current account selectable when its public profile is temporarily unavailable', async () => {
    const { service } = fixture()

    await expect(service.listRecordingSpeakerUsers(session)).resolves.toEqual([
      { userId: 7, label: '我' },
    ])
  })

  it('merges every base and direct-person page without duplicating contacts or admitting Bot identities', async () => {
    const profiles = new Map<number, Record<string, unknown>>([
      [101, { userId: 101, displayName: '张三', nickname: '张三', accountName: 'zhang-san' }],
      [102, { userId: 102, displayName: '林林', nickname: '林林', accountName: 'lin-lin' }],
      [103, { userId: 103, displayName: '陈晨', nickname: '陈晨', accountName: 'chen-chen' }],
      [104, { userId: 104, displayName: '周周', nickname: '周周', accountName: 'zhou-zhou' }],
      [105, { userId: 105, displayName: '吴吴', nickname: '吴吴', accountName: 'wu-wu' }],
    ])
    const { service, runtime } = fixture({ profiles })
    runtime.authenticatedChatPost.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (path === '/api/v1/chats/contacts/list') {
        return body.offset === 0
          ? {
              items: [
                { chat_session_uid: 'base-101', user_id: 101, remark: '老张', contact_state: 1 },
                { chat_session_uid: 'base-102', user_id: 102, remark: '', contact_state: 1 },
              ],
              total: 3, has_more: true,
            }
          : {
              items: [{ chat_session_uid: 'base-104', user_id: 104, remark: '', contact_state: 1 }],
              total: 3, has_more: false,
            }
      }
      if (path === '/api/v1/chats/list' && body.session_kind === 1) {
        return body.page_cursor === undefined
          ? {
              items: [
                {
                  session: { chat_session_uid: 'direct-101', session_kind: 1 },
                  private_counterpart: { user_id: 101, display_name_snapshot: '私聊张三' },
                  private_supplement: { remark: '不应覆盖基础备注' },
                },
                {
                  session: { chat_session_uid: 'direct-103', session_kind: 1 },
                  private_counterpart: { user_id: 103, display_name_snapshot: '陈晨' },
                  private_supplement: { remark: '私聊陈' },
                },
                {
                  session: { chat_session_uid: 'bot-private', session_kind: 1 },
                  private_counterpart: { user_id: 999, display_name_snapshot: '机器人' },
                  bot_participants: [{ bot_uid: 'bot-999' }],
                },
              ],
              has_more: true,
              next_page_cursor: { session_kind: 1, pin_state: 1, sort_active_at: 20, chat_session_uid: 'direct-103' },
            }
          : {
              items: [
                {
                  session: { chat_session_uid: 'direct-104', session_kind: 1 },
                  private_counterpart: { user_id: 104, display_name_snapshot: '周周' },
                },
                {
                  session: { chat_session_uid: 'direct-105', session_kind: 1 },
                  private_counterpart: { user_id: 105, display_name_snapshot: '吴吴' },
                },
                {
                  session: { chat_session_uid: 'broken-direct', session_kind: 1 },
                  private_counterpart: { user_id: 0, display_name_snapshot: '身份缺失' },
                },
              ],
              has_more: false,
            }
      }
      throw new Error(`unexpected chat request: ${path} ${JSON.stringify(body)}`)
    })

    const page = await service.list('contacts', { limit: 50 })

    expect(page).toMatchObject({ section: 'contacts', total: 5, hasMore: false })
    expect(page.items.map(item => item.displayName)).toEqual(['老张', '林林', '周周', '私聊陈', '吴吴'])
    expect(JSON.stringify(page)).not.toContain('direct-')
    expect(JSON.stringify(page)).not.toContain('base-')
    expect(page.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'contact', displayName: '机器人' }),
    ]))
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/list',
      { limit: 50, session_kind: 1 },
      session,
      undefined,
      expect.objectContaining({ lane: 'interactive-read' }),
    )
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/list',
      {
        limit: 50,
        session_kind: 1,
        page_cursor: { session_kind: 1, pin_state: 1, sort_active_at: 20, chat_session_uid: 'direct-103' },
      },
      session,
      undefined,
      expect.objectContaining({ lane: 'interactive-read' }),
    )
  })

  it('returns empty pages, advances contact offset cursors, and rejects a source failure without cache', async () => {
    const { service, runtime } = fixture()
    await expect(service.list('contacts')).resolves.toEqual({
      section: 'contacts', items: [], total: 0, hasMore: false,
    })

    runtime.authenticatedChatPost.mockImplementation(async (path: string) => {
      if (path === '/api/v1/chats/contacts/list') return {
        items: [
          { chat_session_uid: 'chat-8', user_id: 108, remark: '八', contact_state: 1 },
          { chat_session_uid: 'chat-9', user_id: 109, remark: '九', contact_state: 1 },
        ],
        total: 2, has_more: false,
      }
      if (path === '/api/v1/chats/list') return { items: [], has_more: false }
      throw new Error(`unexpected chat path: ${path}`)
    })
    const first = await service.list('contacts', { limit: 1 })
    const second = await service.list('contacts', { limit: 1, cursor: first.nextCursor })
    expect(first).toMatchObject({ total: 2, hasMore: true, items: [expect.objectContaining({ displayName: '八' })] })
    expect(second).toMatchObject({ total: 2, hasMore: false, items: [expect.objectContaining({ displayName: '九' })] })

    await expect(service.list('teams')).rejects.toMatchObject({ code: 'directory-section-not-owned' })
  })

  it('expires, caps, and rejects tampered, cross-account, and wrong-type contact refs', async () => {
    vi.useFakeTimers()
    const { service, runtime, setSession } = fixture({
      contacts: { items: [{ chat_session_uid: 'chat-88', user_id: 88, remark: '林林', contact_state: 1 }], total: 1, has_more: false },
    })
    const firstPage = await service.list('contacts')
    const contactRef = firstPage.items[0]!.kind === 'contact' ? firstPage.items[0]!.contactRef : ''

    const tamperedRef = `${contactRef.slice(0, -1)}${contactRef.endsWith('0') ? '1' : '0'}`
    await expect(service.contactProfile(tamperedRef)).rejects.toMatchObject({ code: 'directory-contact-ref-expired' })
    await expect(service.contactProfile(contactRef.replace('arkme-directory-contact-v1', 'arkme-contact-v1')))
      .rejects.toMatchObject({ code: 'directory-contact-ref-invalid' })
    setSession({ ...session, userId: 8 })
    await expect(service.contactProfile(contactRef)).rejects.toMatchObject({ code: 'directory-contact-ref-account-mismatch' })
    setSession(session)
    vi.advanceTimersByTime(30 * 60_000 + 1)
    await expect(service.contactProfile(contactRef)).rejects.toMatchObject({ code: 'directory-contact-ref-expired' })

    vi.setSystemTime(0)
    let sequence = 0
    runtime.authenticatedChatPost.mockImplementation(async (path: string) => {
      if (path === '/api/v1/chats/list') return { items: [], has_more: false }
      if (path !== '/api/v1/chats/contacts/list') return { items: [] }
      const start = sequence++ * 50 + 1
      return {
        items: Array.from({ length: 50 }, (_, index) => ({
          chat_session_uid: `chat-${String(start + index)}`, user_id: start + index,
          remark: `联系人${String(start + index)}`, contact_state: 1,
        })),
        total: 50, has_more: false,
      }
    })
    const oldest = await service.list('contacts', { limit: 50 })
    for (let page = 1; page < 42; page += 1) await service.list('contacts', { limit: 50 })
    const oldestRef = oldest.items[0]!.kind === 'contact' ? oldest.items[0]!.contactRef : ''
    await expect(service.contactProfile(oldestRef)).rejects.toMatchObject({ code: 'directory-contact-ref-expired' })
  })

  it('revalidates the current account before profile, World, or private chat uses the target user id', async () => {
    const { service, profile, world, chat, setSession } = fixture({
      contacts: { items: [{ chat_session_uid: 'chat-private-88', user_id: 88, remark: '同事', contact_state: 1 }], total: 1, has_more: false },
      profiles: new Map([[88, { userId: 88, displayName: '林林', nickname: '林林', accountName: 'lin-lin', avatarUrl: 'private-url' }]]),
    })
    const page = await service.list('contacts')
    const contactRef = page.items[0]!.kind === 'contact' ? page.items[0]!.contactRef : ''

    setSession({ ...session, userId: 8 })
    await expect(service.contactProfile(contactRef)).rejects.toMatchObject({ code: 'directory-contact-ref-account-mismatch' })
    await expect(service.contactWorld(contactRef)).rejects.toMatchObject({ code: 'directory-contact-ref-account-mismatch' })
    await expect(service.openContactChat(contactRef)).rejects.toMatchObject({ code: 'directory-contact-ref-account-mismatch' })
    expect(world.listUserWorldFeed).not.toHaveBeenCalled()
    expect(chat.openPrivateChatFromUser).not.toHaveBeenCalled()

    setSession(session)
    await expect(service.contactProfile(contactRef)).resolves.toEqual({
      contactRef, displayName: '同事', nickname: '林林', remark: '同事', avatarRef: 'avatar-ref-88',
    })
    await service.contactWorld(contactRef, { limit: 10, offset: 5 })
    expect(world.listUserWorldFeed).toHaveBeenCalledWith(88, { limit: 10, offset: 5 })
    await service.openContactChat(contactRef)
    expect(chat.openPrivateChatFromUser).toHaveBeenCalledWith(88, { presentationDisplayName: '同事' })
    expect(profile.publicProfileSummariesByUserIds).toHaveBeenLastCalledWith([88], session, undefined)
  })

  it('rejects the unmarked-speaker section until its dedicated owner is installed', async () => {
    const { service } = fixture()
    await expect(service.list('unmarked-speakers')).rejects.toMatchObject({ code: 'directory-section-not-owned' })
  })
})
