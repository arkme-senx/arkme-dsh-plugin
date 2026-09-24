import { expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'
import { ChatService } from '../src/services/chat-service.js'

it.each(['group_chat', 'private_chat', 'send_to_self'])('reads only actual group nicknames for %s in bounded batches', async kind => {
  const memberRead = vi.fn(async (_session, group, _path, body) => ({ chat_session_uid: group, items: body.user_ids.map((userId: number) => ({ user_id: userId, status: 1, display_name_snapshot: userId === 1 ? '项目负责人' : '', remark: '私人备注' })) }))
  const owner = { runtime: { requireSession: async () => ({ userId: 1 }) }, source: { openSourceRef: async () => ({ kind, ownerRef: 'group' }) }, memberRead }
  const names = await ChatService.prototype.reactionActorLabels.call(owner as never, 'signed', Array.from({ length: 51 }, (_, index) => index + 1))
  expect(names.get(1)).toEqual(kind === 'send_to_self' ? undefined : { remark: '', groupNickname: kind === 'group_chat' ? '项目负责人' : '' })
  expect(names.get(2)?.remark).toBe(kind === 'send_to_self' ? undefined : '私人备注')
  expect(memberRead).toHaveBeenCalledTimes(kind !== 'send_to_self' ? 2 : 0)
  for (const call of memberRead.mock.calls) expect(call[3].user_ids.length).toBeLessThanOrEqual(50)
})

it.each(['query', 'groups', 'actors'] as const)('adds nicknames through the shared %s owner using the viewer remark before the personal name', async action => {
  const key = 'a'.repeat(64)
  const group = { key, expression: { text: '收到' }, count: 1, actor_user_ids: [7] }
  const target = { id: 'message', sourceRef: 'signed', messageActionRef: 'message' }
  const wire = { chat_session_uid: 'group', rel_uid: 'message' }
  let remark = '哇咔咔'
  const reactionActorLabels = vi.fn(async () => new Map([[7, { remark, groupNickname: '项目负责人' }]]))
  const owner = {
    config: { environment: 'test' },
    runtime: { config: { environment: 'test' }, requireSession: async () => ({ userId: 7 }), authenticatedPost: async () => action === 'actors' ? { user_ids: [7], has_more: false } : action === 'groups' ? { items: [group], has_more: false } : { items: [{ target: wire, mine: { revision: 0, selections: [] }, groups: [group, group], has_more: false, actors_visible: true, private: false }] } },
    chat: { reactionTarget: async () => wire, reactionActorLabels },
    profile: { publicProfileSummariesByUserIds: async () => new Map([[7, { displayName: '兔老大', avatarUrl: 'https://private-avatar.invalid/image' }]]), sealProfileImageRef: vi.fn(async () => 'opaque-avatar') },
  }
  const request = action === 'query' ? { action, targets: [target] } : action === 'groups' ? { action, target, after_key: '', limit: 30 } : { action, target, key, after_user_id: 0, limit: 30 }
  const result = await ArkmeService.prototype.reactions.call(owner as never, { ...request, accountKey: 'test:7' })
  expect(JSON.stringify(result)).toContain('"displayName":"哇咔咔","groupNickname":"项目负责人"')
  expect(JSON.stringify(result)).toContain('"avatarRef":"opaque-avatar"')
  expect(JSON.stringify(result)).not.toContain('private-avatar.invalid')
  expect(owner.profile.sealProfileImageRef).toHaveBeenCalledExactlyOnceWith(7, 7)
  expect(reactionActorLabels).toHaveBeenCalledExactlyOnceWith('signed', [7], undefined)
  remark = ''
  const unremarked = await ArkmeService.prototype.reactions.call(owner as never, { ...request, accountKey: 'test:7' })
  expect(JSON.stringify(unremarked)).toContain('"displayName":"项目负责人","groupNickname":"项目负责人"')
  reactionActorLabels.mockRejectedValueOnce(new Error('member unavailable'))
  const degraded = await ArkmeService.prototype.reactions.call(owner as never, { ...request, accountKey: 'test:7' })
  expect(JSON.stringify(degraded)).toContain('"displayName":"兔老大"')
  expect(JSON.stringify(degraded)).not.toContain('groupNickname')
})
