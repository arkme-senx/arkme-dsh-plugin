import { describe, expect, it } from 'vitest'
import { arkmeChatActivityPreview, retainNewerArkmeChatActivity } from '../src/chat-activity-preview.js'
import type { ArkmeSourceItem } from '../src/types.js'

import { joinedBundle } from './fixtures/member-joined.js'

describe('mobile-parity member joined activity preview', () => {
  it.each([
    ['direct_add', 0, '张三 添加 李四 加入群聊'],
    ['direct_add', 1, '你 添加 李四 加入群聊'],
    ['direct_add', 2, '张三 添加 你 加入群聊'],
    ['invite', 0, '张三 邀请 李四 加入群聊'],
    ['invite', 1, '你 邀请 李四 加入群聊'],
    ['invite', 2, '张三 邀请 你 加入群聊'],
  ])('formats %s for viewer %s', (source, viewer, expected) => {
    expect(arkmeChatActivityPreview(joinedBundle(source as string), viewer as number)).toEqual({
      latestPreview: expected, latestActivityAtMillis: 200, latestActivityKind: 'member_joined',
    })
  })
  it.each(['membership_page', 'official_community', 'dsh_beta_community'])('does not invite oneself for %s', source => {
    const bundle = joinedBundle(source, 2, 2)
    expect(arkmeChatActivityPreview(bundle, 0).latestPreview).toBe('李四 加入了群聊')
    expect(arkmeChatActivityPreview(bundle, 2).latestPreview).toBe(source === 'membership_page' ? '你 加入了群聊' : '李四 加入了群聊')
    expect(arkmeChatActivityPreview(joinedBundle(source), 0).latestPreview).toBe('张三 邀请 李四 加入群聊')
  })
  it.each(['', '1', '用户', '即我'])('rejects unsafe actor names %s and still supports you', name => {
    const bundle = joinedBundle()
    bundle.latest_activity.member_joined.actor_display_name_snapshot = name
    expect(arkmeChatActivityPreview(bundle, 0).latestPreview).toBeUndefined()
    expect(arkmeChatActivityPreview(bundle, 1).latestPreview).toBe('你 添加 李四 加入群聊')
  })
  it.each(['', '2', '用户', '即我'])('rejects unsafe member names %s', name => {
    const bundle = joinedBundle()
    bundle.latest_activity.member_joined.member_display_name_snapshot = name
    expect(arkmeChatActivityPreview(bundle, 0).latestPreview).toBeUndefined()
    expect(arkmeChatActivityPreview(bundle, 2).latestPreview).toBe('张三 添加 你 加入群聊')
  })
  it('ignores malformed, incomplete and unknown activities without leaking upstream identities', () => {
    for (const activity of [{}, { kind: 1, activity_at: 200 }, { kind: 3, activity_at: 200, activity_uid: 'private' },
      { ...joinedBundle().latest_activity, activity_at: Infinity },
      { ...joinedBundle().latest_activity, member_joined: { actor_user_id: 0, member_user_id: 2 } }]) {
      expect(arkmeChatActivityPreview({ latest_activity: activity }, 1)).toEqual({})
    }
    const result = JSON.stringify(arkmeChatActivityPreview(joinedBundle(), 0))
    expect(result).not.toContain('join-event')
    expect(result).not.toContain('user_id')
  })
  it('keeps a record activity as freshness, leaving text to the normal message formatter', () => {
    expect(arkmeChatActivityPreview({ latest_activity: { kind: 2, activity_uid: 'record', activity_at: 201 } }, 1))
      .toEqual({ latestActivityAtMillis: 201, latestActivityKind: 'record' })
  })
  it('orders activity freshness separately from sequence and read facts', () => {
    const source: ArkmeSourceItem = { sourceRef: 'ref', sourceKey: 'same', kind: 'group_chat', displayName: '群',
      latestSequence: 7, readSequence: 5, unreadCount: 2, activeAtMillis: 200,
      latestPreview: '李四 加入了群聊', latestActivityAtMillis: 200, latestActivityKind: 'member_joined' }
    const older = { ...source, latestPreview: '旧消息', latestActivityAtMillis: 100, latestActivityKind: 'record' as const,
      activeAtMillis: 100, readSequence: 7, unreadCount: 0 }
    expect(retainNewerArkmeChatActivity(source, older)).toMatchObject({ latestPreview: source.latestPreview,
      latestActivityAtMillis: 200, activeAtMillis: 200, readSequence: 7, unreadCount: 0 })
    const record = { ...source, latestPreview: '新消息', latestActivityKind: 'record' as const }
    expect(retainNewerArkmeChatActivity(record, source).latestPreview).toBe('新消息')
    expect(retainNewerArkmeChatActivity(source, record)).toEqual(record)
    const legacy = { ...older }; delete legacy.latestActivityAtMillis; delete legacy.latestActivityKind
    expect(retainNewerArkmeChatActivity(source, legacy).latestPreview).toBe(source.latestPreview)
    expect(retainNewerArkmeChatActivity(source, { ...record, latestSequence: 8, latestActivityAtMillis: 201 }).latestPreview).toBe('新消息')
  })
})
