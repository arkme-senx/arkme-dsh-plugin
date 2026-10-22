import { describe, expect, it, vi } from 'vitest'
import { SourceService } from '../../src/services/source-service.js'
import { mergeDirectorySource } from '../../src/services/conversation-directory-service.js'
import { ArkmeChatDirectoryStore } from '../../src/client/chat-directory-store.js'
import type { ServiceRuntime } from '../../src/services/service.js'
import type { ProfileService } from '../../src/services/profile-service.js'

function fixture(remark = '') {
  const session = { userId: 42, accessToken: 'fixture', refreshToken: 'fixture' }
  const bundle = { session: { chat_session_uid: 'private', session_kind: 1 },
    private_counterpart: { user_id: 17, display_name_snapshot: '当前昵称' },
    private_supplement: { remark, counterpart_name_snapshot: '当前昵称', pending_name: '历史待定名' },
    unread_snapshot: { session_last_seq: 7, unread_count: 0 } }
  const post = vi.fn(async () => ({ items: [bundle], has_more: false }))
  // The avatar cache is deliberately older than Chat's authoritative current-name response.
  const profiles = { publicProfileSummariesByUserIds: vi.fn(async () => new Map([[17, { nickname: '旧的头像缓存昵称' }]])) }
  const runtime = { config: { environment: 'test' }, requireSession: async () => session, authenticatedChatPost: post,
    stateStore: { uniqueCode: async () => 'current-name-fixture' } } as unknown as ServiceRuntime
  return { session, bundle, post, source: new SourceService(runtime, profiles as unknown as ProfileService, {} as never) }
}

describe('current conversation name contract', () => {
  it.each(['', '  ', '我的备注'])('uses the same remark/current nickname for first paint, decoration and realtime: %s', async remark => {
    const f = fixture(remark)
    const first = (await f.source.listSources('root', { refresh: true, firstPaint: true })).items[0]!
    const decorated = (await f.source.listSources('root', { refresh: true })).items[0]!
    expect(first.displayName).toBe(remark.trim() || '当前昵称')
    expect(decorated).toMatchObject({ displayName: first.displayName, privateNickname: '当前昵称' })
    f.bundle.private_counterpart.display_name_snapshot = '改名后的昵称'
    f.bundle.private_supplement.counterpart_name_snapshot = '改名后的昵称'
    const renamed = await f.source.chatSourceFromBundle(f.bundle, f.session, decorated, [])
    expect(renamed).toMatchObject({ displayName: remark.trim() || '改名后的昵称', privateNickname: '改名后的昵称', latestSequence: 7 })
    expect(mergeDirectorySource(decorated, renamed).displayName).toBe(renamed.displayName)
    // Avatar completion must not restore the old nickname even when it finishes after realtime.
    expect((await f.source.hydrateDirectoryPage([renamed], new AbortController().signal))[0]).toMatchObject({ displayName: renamed.displayName, privateNickname: '改名后的昵称' })
  })

  it('keeps the last display after profile failure, skips registered pending-name history and recovers', async () => {
    const f = fixture()
    const previous = (await f.source.listSources('root', { refresh: true, firstPaint: true })).items[0]!
    f.bundle.private_counterpart.display_name_snapshot = ''
    f.bundle.private_supplement.counterpart_name_snapshot = ''
    const failed = (await f.source.listSources('root', { refresh: true, firstPaint: true })).items[0]!
    expect(failed.displayName).toBe(previous.displayName)
    expect((await f.source.chatSourceFromBundle(f.bundle, f.session, previous, [])).displayName).toBe(previous.displayName)
    f.bundle.private_counterpart.display_name_snapshot = '恢复后的昵称'
    f.bundle.private_supplement.counterpart_name_snapshot = '恢复后的昵称'
    expect((await f.source.listSources('root', { refresh: true, firstPaint: true })).items[0]?.displayName).toBe('恢复后的昵称')
    // The failed read cannot leak the previous account's presentation.
    f.bundle.private_counterpart.display_name_snapshot = ''
    f.bundle.private_supplement.counterpart_name_snapshot = ''
    expect((await f.source.chatSourceFromBundle(f.bundle, { ...f.session, userId: 43 }, undefined, [])).displayName).toBe('未命名会话')
  })

  it('uses the current nickname after clearing a remark and preserves pending-contact labels', async () => {
    const f = fixture('备注')
    const first = (await f.source.listSources('root', { refresh: true, firstPaint: true })).items[0]!
    f.bundle.private_supplement.remark = ''
    expect((await f.source.chatSourceFromBundle(f.bundle, f.session, first, [])).displayName).toBe('当前昵称')
    const pending = { ...f.bundle, session: { chat_session_uid: 'pending', session_kind: 3 }, private_counterpart: {},
      private_supplement: { remark: '', counterpart_name_snapshot: '', pending_name: '待注册联系人' } }
    expect((await f.source.chatSourceFromBundle(pending, f.session, undefined, [])).displayName).toBe('待注册联系人')
  })

  it('publishes a name-only delta to the Browser without changing message sequence or historical authors', async () => {
    const f = fixture()
    const first = (await f.source.listSources('root', { refresh: true, firstPaint: true })).items[0]!
    f.bundle.private_supplement.counterpart_name_snapshot = '新名字'
    f.bundle.private_counterpart.display_name_snapshot = '新名字'
    const history = [{ itemUid: 'message', senderName: '发送时名字', textContent: '历史正文', isMe: false, title: '', sendAtMillis: 1, sequence: 7 }]
    const renamed = await f.source.chatSourceFromBundle(f.bundle, f.session, first, history)
    const store = new ArkmeChatDirectoryStore()
    store.activateAccount('test:42')
    store.publish([first])
    const listener = vi.fn(); const stop = store.subscribe(listener)
    store.upsert(renamed, renamed.sourceKey)
    expect(store.getSnapshot().sources[0]).toMatchObject({ displayName: '新名字', latestSequence: 7 })
    expect(listener).toHaveBeenCalled()
    expect(history[0]!.senderName).toBe('发送时名字')
    stop(); store.activateAccount(undefined)
  })
})
