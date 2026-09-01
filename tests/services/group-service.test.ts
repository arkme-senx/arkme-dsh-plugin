import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { GroupService } from '../../src/services/group-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
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

describe('GroupService', () => {
  function fixture(fetchImpl: typeof fetch, inviteSender?: ConstructorParameters<typeof GroupService>[3]) {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const state = { async uniqueCode() { return 'device-secret' } } as StateStore
    const runtime = new ServiceRuntime(config, sessions, state, fetchImpl)
    const profile = new ProfileService(runtime)
    const source = new SourceService(runtime, profile, {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    return { source, service: new GroupService(runtime, source, profile, inviteSender) }
  }

  it('reads group settings through an account-bound source', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const state = { async uniqueCode() { return 'device-secret' } } as StateStore
    const runtime = new ServiceRuntime(config, sessions, state, async () => new Response(JSON.stringify({
      code: 200, data: { session: { chat_session_uid: 'group-1', title: '研发群' }, current_policy: { mute_state: 2 } },
    }), { status: 200 }))
    const profile = new ProfileService(runtime)
    const source = new SourceService(runtime, profile, {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const sourceRef = await source.sealSourceRef(42, 'group_chat', 'group-1', '研发群')
    const service = new GroupService(runtime, source, profile)
    await expect(service.groupSettings(sourceRef)).resolves.toEqual({
      target: {
        sourceRef: expect.any(String), sourceKey: expect.any(String), kind: 'group_chat', displayName: '研发群',
      },
      selfRole: 'unknown', selfStatus: 'unknown', canRename: false, canDissolve: false, canLeave: false,
      messageDnd: true,
    })
  })

  it('does not replace the directory projection when group settings are read', async () => {
    const paths: string[] = []
    const { source, service } = fixture(async input => {
      const path = new URL(String(input)).pathname
      paths.push(path)
      if (path.endsWith('/chats/detail')) return new Response(JSON.stringify({
        code: 200,
        data: {
          session: { chat_session_uid: 'group-1', title: '研发群', last_active_at: 100, last_seq: 12 },
          current_policy: { mute_state: 2 },
          unread_snapshot: { unread_count: 0 },
        },
      }), { status: 200 })
      return new Response(JSON.stringify({ code: 200, data: { items: [] } }), { status: 200 })
    })
    const cachedSource = {
      sourceRef: await source.sealSourceRef(42, 'group_chat', 'group-1', '研发群'),
      sourceKey: await source.chatDirectorySourceKey(42, 'group-1'),
      kind: 'group_chat' as const,
      displayName: '研发群',
      latestPreview: '不能被设置详情覆盖的最新消息',
      latestSequence: 12,
      activeAtMillis: 100,
      unreadCount: 0,
      avatarRef: 'group-avatar-ref',
    }
    source.setChatSource(42, 'group-1', cachedSource)
    const normalizedCachedSource = source.cachedChatSource(42, 'group-1')

    await service.groupSettings(cachedSource.sourceRef)

    expect(source.cachedChatSource(42, 'group-1')).toEqual(normalizedCachedSource)
    expect(paths).toEqual(['/api/v1/chats/detail'])
  })

  it('invalidates a cached root page after enabling do-not-disturb', async () => {
    let muted = false
    let listReads = 0
    const { source, service } = fixture(async (input) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/chats/list')) {
        listReads += 1
        return new Response(JSON.stringify({ code: 200, data: {
          items: [{
            session: { chat_session_uid: 'group-dnd', session_kind: 2, title: '免打扰测试群', last_seq: 9 },
            current_policy: { mute_state: muted ? 2 : 1, notify_state: muted ? 2 : 1 },
            unread_snapshot: { unread_count: 3, session_last_seq: 9 },
          }],
          has_more: false,
        } }), { status: 200 })
      }
      if (path.endsWith('/chats/group-avatar-snapshots')) {
        return new Response(JSON.stringify({ code: 200, data: { items: [] } }), { status: 200 })
      }
      if (path.endsWith('/chats/policy/get')) {
        return new Response(JSON.stringify({ code: 200, data: {
          show_in_home_state: 1, privacy_state: 1, mute_state: muted ? 2 : 1,
          pin_state: 1, notify_state: muted ? 2 : 1, status: 1,
        } }), { status: 200 })
      }
      if (path.endsWith('/chats/policy/update')) {
        muted = true
        return new Response(JSON.stringify({ code: 200, data: {} }), { status: 200 })
      }
      throw new Error(`unexpected ${path}`)
    })

    const before = await source.listSources('root')
    expect(before.items[0]).toMatchObject({ unreadCount: 3, badgeUnreadCount: 3, isMuted: false })
    await service.setGroupMessageDnd(before.items[0]!.sourceRef, true)
    const after = await source.listSources('root')
    expect(after.items[0]).toMatchObject({ unreadCount: 3, badgeUnreadCount: 0, isMuted: true })
    expect(listReads).toBe(2)
  })

  it('invalidates the root directory cache after a group rename', async () => {
    let renamed = false
    let directoryReads = 0
    const { source, service } = fixture(async input => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/chats/list')) {
        directoryReads += 1
        return new Response(JSON.stringify({ code: 200, data: { items: [{
          session: {
            chat_session_uid: 'group-1', session_kind: 2,
            title: renamed ? 'Harness3' : 'harness2', last_active_at: 123, last_seq: 9,
          },
          unread_snapshot: { unread_count: 2, session_last_seq: 9 },
        }] } }), { status: 200 })
      }
      if (path.endsWith('/chats/rename')) {
        renamed = true
        return new Response(JSON.stringify({ code: 200, data: {
          session: {
            chat_session_uid: 'group-1', session_kind: 2,
            title: 'Harness3', last_active_at: 123, last_seq: 9,
          },
          unread_snapshot: { unread_count: 2, session_last_seq: 9 },
        } }), { status: 200 })
      }
      if (path.endsWith('/chats/group-avatar-snapshots')) {
        return new Response(JSON.stringify({ code: 200, data: { items: [] } }), { status: 200 })
      }
      throw new Error(`unexpected ${path}`)
    })
    const before = await source.listSources('root')

    await service.renameGroup(before.items[0]!.sourceRef, 'Harness3')
    const after = await source.listSources('root')

    expect(after.items[0]?.displayName).toBe('Harness3')
    expect(directoryReads).toBe(2)
  })

  it.each([
    ['leave', '/api/v1/chats/members/update'],
    ['dissolve', '/api/v1/chats/dissolve'],
  ] as const)('treats group %s as a command and never replaces the cached projection', async (command, expectedPath) => {
    const paths: string[] = []
    const { source, service } = fixture(async input => {
      paths.push(new URL(String(input)).pathname)
      return new Response(JSON.stringify({ code: 200, data: {} }), { status: 200 })
    })
    const cachedSource = {
      sourceRef: await source.sealSourceRef(42, 'group_chat', 'group-1', '研发群'),
      sourceKey: await source.chatDirectorySourceKey(42, 'group-1'),
      kind: 'group_chat' as const,
      displayName: '研发群',
      latestPreview: '退出前最后一条消息',
      activeAtMillis: 100,
      unreadCount: 0,
    }
    source.setChatSource(42, 'group-1', cachedSource)
    const normalizedCachedSource = source.cachedChatSource(42, 'group-1')
    const invalidate = vi.spyOn(source, 'invalidateSourceListCache')

    const result = command === 'leave'
      ? await service.leaveGroup(cachedSource.sourceRef)
      : await service.dissolveGroup(cachedSource.sourceRef)

    expect(result).toEqual({ status: 'ok' })
    expect(paths).toEqual([expectedPath])
    expect(source.cachedChatSource(42, 'group-1')).toEqual(normalizedCachedSource)
    expect(invalidate).toHaveBeenCalledWith(42, 'root')
  })

  it('lists account-bound private-chat candidates and adds one idempotently', async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    const { source, service } = fixture(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push({ path, body })
      const data = path.endsWith('/members/list')
        ? { items: [{ user_id: 42, status: 1 }] }
        : path.endsWith('/chats/list')
          ? { items: [{
              session: { chat_session_uid: 'private-7', session_kind: 1 },
              private_counterpart: { user_id: 7, display_name_snapshot: '小林' },
              private_supplement: { contact_state: 1 },
            }] }
          : path.endsWith('/invite-preview')
            ? { preview: { join_mode: 1 } }
            : path.endsWith('/members/add')
              ? { item: { outcome: 'idempotent_hit' } }
              : { items: [] }
      return new Response(JSON.stringify({ code: 200, data }), { status: 200 })
    })
    const sourceRef = await source.sealSourceRef(42, 'group_chat', 'group-1', '研发群')
    const candidates = await service.listGroupMemberCandidates(sourceRef)
    expect(candidates).toMatchObject({ mode: 'direct_add', contactCount: 1, strangerCount: 0, groups: [], items: [{ displayName: '小林', origin: 'private_chat', relation: 'contact' }] })
    const result = await service.addGroupMembers(sourceRef, [candidates.items[0]!.candidateRef])
    expect(result).toMatchObject({ succeededCount: 1, failedCount: 0, results: [{ status: 'already_member' }] })
    expect(calls.find(call => call.path.endsWith('/members/add'))?.body).toMatchObject({
      chat_session_uid: 'group-1', target_user_id: 7, display_name_snapshot: '小林',
    })
  })

  it('expands another group into addable member candidates', async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    const { source, service } = fixture(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push({ path, body })
      const data = path.endsWith('/members/list') && body.chat_session_uid === 'group-1'
        ? { items: [{ user_id: 42, status: 1 }, { user_id: 7, status: 1, display_name_snapshot: '已在群内' }] }
        : path.endsWith('/members/list') && body.chat_session_uid === 'group-2'
          ? { items: [
              { user_id: 7, status: 1, display_name_snapshot: '已在群内' },
              { user_id: 9, status: 1, display_name_snapshot: '阿九' },
              { user_id: 42, status: 1, display_name_snapshot: '我' },
            ] }
          : path.endsWith('/chats/list')
            ? { items: [{
                session: { chat_session_uid: 'group-2', session_kind: 2, title: '前端重构', updated_at: 123 },
              }] }
            : path.endsWith('/invite-preview')
              ? { preview: { join_mode: 1 } }
              : path.endsWith('/members/add')
                ? { item: { outcome: 'created' } }
                : { items: [] }
      return new Response(JSON.stringify({ code: 200, data }), { status: 200 })
    })
    const targetRef = await source.sealSourceRef(42, 'group_chat', 'group-1', '研发群')
    const peerRef = await source.sealSourceRef(42, 'group_chat', 'group-2', '前端重构')
    const candidates = await service.listGroupMemberCandidates(targetRef, { groupSourceRefs: [peerRef] })
    expect(candidates.groups).toMatchObject([{ displayName: '前端重构' }])
    expect(candidates.groupCandidates).toMatchObject([{
      group: { displayName: '前端重构' },
      total: 2,
      items: [
        { displayName: '已在群内', origin: 'group_chat', relation: 'group', disabled: true, alreadyMember: true },
        { displayName: '阿九', origin: 'group_chat', relation: 'group' },
      ],
    }])
    const addable = candidates.groupCandidates[0]!.items.find(item => item.displayName === '阿九')!
    const result = await service.addGroupMembers(targetRef, [addable.candidateRef])
    expect(result).toMatchObject({ succeededCount: 1, failedCount: 0, results: [{ status: 'added' }] })
    expect(calls.find(call => call.path.endsWith('/members/add'))?.body).toMatchObject({
      chat_session_uid: 'group-1', target_user_id: 9, display_name_snapshot: '阿九',
    })
  })

  it('sends an approval invite through the candidate private chat', async () => {
    const sent: string[] = []
    const { source, service } = fixture(async (input) => {
      const path = new URL(String(input)).pathname
      const data = path.endsWith('/members/list') ? { items: [{ user_id: 42 }] }
        : path.endsWith('/chats/list') ? { items: [{
            session: { chat_session_uid: 'private-8', session_kind: 1 },
            private_counterpart: { user_id: 8, display_name_snapshot: '小周' },
          }] }
        : { preview: { join_mode: 2, invite_link: 'https://invite.test/group-1' } }
      return new Response(JSON.stringify({ code: 200, data }), { status: 200 })
    }, {
      async sendPrivateText(_sourceRef, chatSessionUid, text) { sent.push(`${chatSessionUid}:${text}`) },
    })
    const sourceRef = await source.sealSourceRef(42, 'group_chat', 'group-1', '研发群')
    const candidates = await service.listGroupMemberCandidates(sourceRef)
    const result = await service.addGroupMembers(sourceRef, [candidates.items[0]!.candidateRef])
    expect(result.results[0]?.status).toBe('invite_sent')
    expect(sent[0]).toContain('private-8:邀请你加入群聊“研发群”：https://invite.test/group-1')
  })
})
