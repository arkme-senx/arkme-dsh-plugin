import { expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'
import type { ReactionRequest } from '../src/reaction-contract.js'

const key = 'a'.repeat(64)
const target = { id: 'message', teamConversationRef: 'conversation-ref', teamMessageRef: 'message-ref' }
const wire = { team_conversation_uid: 'conversation', team_message_uid: 'message' }
function owner(side: 'team' | 'external' = 'team', action = 'query') {
  const group = { key, expression: { text: '收到' }, count: 1, actor_user_ids: side === 'team' ? [8] : [] }
  return {
    config: { environment: 'test' },
    runtime: { config: { environment: 'test' }, requireSession: async () => ({ userId: 7 }),
      authenticatedPost: vi.fn(async () => action === 'actors' ? { user_ids: side === 'team' ? [8] : [], has_more: false }
        : action === 'groups' ? { items: [group], has_more: false }
        : { items: [{ target: wire, mine: { revision: 0, selections: [] }, groups: [group], has_more: false, actors_visible: side === 'team', private: false }] }) },
    teamApp: { reactionTarget: async () => ({ ...wire, team_side: side }),
      reactionActorKeys: vi.fn(async () => new Map([[8, 'opaque-person-key']])) },
    profile: { publicProfileSummariesByUserIds: vi.fn(async () => new Map([[8, { displayName: '公开昵称' }]])) },
    source: { privateRemarksByUserIds: vi.fn(async () => new Map([[8, '私人备注']])) },
  }
}
function request(o: ReturnType<typeof owner>, input: Omit<ReactionRequest, 'accountKey'>) {
  return ArkmeService.prototype.reactions.call(o as never, { ...input, accountKey: 'test:7' } as ReactionRequest) as Promise<any>
}
it('returns Team reaction facts before optional profiles/remarks and supplies only opaque person aliases', async () => {
  const o = owner()
  o.profile.publicProfileSummariesByUserIds.mockImplementation(() => new Promise(() => {}))
  o.source.privateRemarksByUserIds.mockImplementation(() => new Promise(() => {}))
  const result = await request(o, { action: 'query', actorPresentation: 'deferred', targets: [target] } as never)
  expect(result.items[0].groups[0].actors).toEqual([{ userId: 8, displayName: '用户', presentationPending: true, teamPersonKey: 'opaque-person-key' }])
  expect(o.profile.publicProfileSummariesByUserIds).not.toHaveBeenCalled()
  expect(o.source.privateRemarksByUserIds).not.toHaveBeenCalled()
})
it('external Team views never resolve or expose internal actors', async () => {
  const o = owner('external')
  const result = await request(o, { action: 'query', actorPresentation: 'deferred', targets: [target] } as never)
  expect(result.items[0].groups[0]).toMatchObject({ count: 1, actors: [] })
  expect(o.teamApp.reactionActorKeys).not.toHaveBeenCalled()
  expect(o.profile.publicProfileSummariesByUserIds).not.toHaveBeenCalled()
  expect(o.source.privateRemarksByUserIds).not.toHaveBeenCalled()
})
for (const action of ['query', 'groups', 'actors'] as const) {
  const input = action === 'query' ? { action, targets: [target] }
    : action === 'groups' ? { action, target, after_key: '', limit: 30 }
    : { action, target, key, after_user_id: 0, limit: 30 }
  it(`uses the same private remark for Team ${action} and retains facts on profile failure`, async () => {
    const o = owner('team', action)
    const first = await request(o, input as never)
    expect(JSON.stringify(first)).toContain('私人备注')
    expect(JSON.stringify(first)).toContain('"teamPersonKey":"opaque-person-key"')
    o.profile.publicProfileSummariesByUserIds.mockRejectedValueOnce(new Error('profile offline'))
    const degraded = await request(o, input as never)
    expect(JSON.stringify(degraded)).toContain('私人备注')
    expect(o.runtime.authenticatedPost).toHaveBeenCalledTimes(2)
    o.source.privateRemarksByUserIds.mockRejectedValueOnce(new Error('remark offline'))
    expect(JSON.stringify(await request(o, input as never))).toContain('公开昵称')
  })
}
