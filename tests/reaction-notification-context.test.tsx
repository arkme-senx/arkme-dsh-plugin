import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'
import { reactionItem } from '../src/client/ArkmeNotificationCenter.js'
import { ArkmeNotificationMessage } from '../src/client/ArkmeNotificationMessage.js'
import type { ReactionNotificationPage } from '../src/reaction-contract.js'
import type { ArkmeSourceItem } from '../src/types.js'

function fixture() {
  let viewer = 7
  const group: ArkmeSourceItem = { kind: 'group_chat', sourceKey: 'key-group', sourceRef: 'opaque-group', displayName: '项目群', activeAtMillis: 1, unreadCount: 0 }
  const direct: ArkmeSourceItem = { kind: 'private_chat', sourceKey: 'key-private', sourceRef: 'opaque-private', peerUserId: 8, displayName: '私聊备注', activeAtMillis: 1, unreadCount: 0 }
  const rows = [8, 9, 8, 8].map((actor, index) => ({ id: String(index + 1).repeat(64), revision: 2, actor_user_id: actor,
    target: { chat_session_uid: index === 2 ? 'internal-private' : 'internal-group' }, record_uid: `record-${index}`,
    record_owner_user_id: 7, attach_at: 100, text: '原消息内容', unread: false,
    selections: [{ key: 'a'.repeat(64), expression: { text: '收到', emoji: 'ok_hand' }, at: 200 }],
  }))
  const owner = {
    config: { environment: 'test' },
    runtime: { config: { environment: 'test' }, requireSession: async () => ({ userId: viewer }),
      authenticatedPost: vi.fn(async () => ({ items: rows, after_id: '', has_more: false })) },
    source: {
      chatDirectorySourceKey: async (_viewer: number, uid: string) => uid === 'internal-group' ? group.sourceKey : direct.sourceKey,
      chatSourcesBySessionUids: vi.fn(async () => new Map([['internal-group', group], ['internal-private', direct]])),
    },
    profile: { publicProfileSummariesByUserIds: vi.fn(async () => new Map([[8, { displayName: '公开昵称' }], [9, { displayName: '另一个昵称' }]])) },
    chat: { reactionActorLabels: vi.fn(async (sourceRef: string) => sourceRef === group.sourceRef
      ? new Map([[8, { remark: '万宇', groupNickname: '群昵称' }], [9, { remark: '', groupNickname: '负责人' }]])
      : new Map<number, { remark: string; groupNickname: string }>()) },
  }
  const read = (signal?: AbortSignal) => ArkmeService.prototype.reactions.call(owner as never,
    { action: 'notifications', accountKey: 'test:7', limit: 50, include_read: true }, signal) as Promise<ReactionNotificationPage>
  return { owner, read, switchAccount: () => { viewer = 10 } }
}

it('batches notification identities, prefers remarks then group nicknames, and keeps read history and opaque locators', async () => {
  const { owner, read } = fixture()
  const page = await read()
  expect(page.items.map(item => item.actorName)).toEqual(['万宇', '负责人', '私聊备注', '万宇'])
  expect(page.items.map(item => item.source?.kind)).toEqual(['group_chat', 'group_chat', 'private_chat', 'group_chat'])
  expect(page.items.every(item => item.unread === false && item.revision === 2)).toBe(true)
  expect(page.items[0]).toMatchObject({ itemUid: 'record-0', sourceKey: 'key-group', source: { sourceRef: 'opaque-group' } })
  expect(owner.source.chatSourcesBySessionUids).toHaveBeenCalledExactlyOnceWith(['internal-group', 'internal-private'], undefined)
  expect(owner.profile.publicProfileSummariesByUserIds).toHaveBeenCalledExactlyOnceWith([8, 9], { userId: 7 }, undefined, 5_000)
  expect(owner.chat.reactionActorLabels.mock.calls).toEqual([['opaque-group', [8, 9], undefined], ['opaque-private', [8], undefined]])
  expect(JSON.stringify(page)).not.toContain('internal-')
})

it.each(['profile', 'source', 'chat'] as const)('keeps all notifications when optional %s details fail', async failed => {
  const { owner, read } = fixture()
  if (failed === 'profile') owner.profile.publicProfileSummariesByUserIds.mockRejectedValue(new Error('offline'))
  if (failed === 'source') owner.source.chatSourcesBySessionUids.mockRejectedValue(new Error('offline'))
  if (failed === 'chat') owner.chat.reactionActorLabels.mockRejectedValue(new Error('offline'))
  const page = await read()
  expect(page.items).toHaveLength(4)
  expect(page.items[0]?.actorName).toBe(failed === 'profile' ? '万宇' : '公开昵称')
  expect(page.items[0]?.source?.displayName).toBe(failed === 'source' ? undefined : '项目群')
})

it('does not return identities after an account switch during enrichment', async () => {
  const { owner, read, switchAccount } = fixture()
  owner.chat.reactionActorLabels.mockImplementation(async () => { switchAccount(); return new Map() })
  await expect(read()).rejects.toThrow('账号已变化')
})

it('does not swallow cancellation as an optional presentation failure', async () => {
  const { owner, read } = fixture()
  const controller = new AbortController()
  owner.profile.publicProfileSummariesByUserIds.mockImplementation(async () => { controller.abort(new Error('cancelled')); throw new Error('offline') })
  await expect(read(controller.signal)).rejects.toThrow('cancelled')
})

it('renders who reacted, the chat type and name, then the original content with the actual reaction', async () => {
  const { read } = fixture()
  const page = await read()
  for (const [index, sourceLabel] of [[0, '群聊 · 项目群'], [2, '私聊 · 私聊备注']] as const) {
    const item = reactionItem(page.items[index]!)
    expect(item.title).toContain(`收到${page.items[index]!.actorName}的表态`)
    expect(item.title).toContain('[jm_emoji:ok_hand] 收到')
    expect(item.sourceLabel).toBe(sourceLabel)
    const html = renderToStaticMarkup(<ArkmeNotificationMessage item={item} scope="test:7" category="表态" timeLabel="" onOpen={() => {}} busy={false} />)
    expect(html.indexOf('收到')).toBeLessThan(html.indexOf(sourceLabel))
    expect(html.indexOf(sourceLabel)).toBeLessThan(html.indexOf('原消息内容'))
    expect(html).toContain('查看原消息')
  }
})
