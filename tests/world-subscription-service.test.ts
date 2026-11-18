import { expect, it, vi } from 'vitest'
import {ArkmePluginError} from '../src/services/service.js'
import { WorldSubscriptionService } from '../src/services/world-subscription-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { ProfileService } from '../src/services/profile-service.js'
import type { WorldSubscriptionNoticePage } from '../src/world-subscription-contract.js'

function fixture() {
  let actor = 8
  const post = vi.fn(async (_path: string, _body: any): Promise<any> => ({ items: [], teams: [], has_more: false, unread_count: 0, publications: {}, cursor: { ceilings: {} } }))
  const teamPost = vi.fn(async () => ({ team_id: '9223372036854775800', jotmo_id: 'our_team' }))
  const runtime = { config: { environment: 'test' }, requireSession: async () => ({ userId: actor }), stateStore: { uniqueCode: async () => 'isolated-key' }, authenticatedWorldPost: post, authenticatedTeamPost: teamPost } as unknown as ServiceRuntime
  const profiles = { publicProfileSummariesByUserIds: vi.fn(async (ids: number[]) => new Map(ids.map(id => [id, { displayName: `person-${id}` }]))) } as unknown as ProfileService
  const teams = vi.fn(async () => [] as any[]), project = vi.fn(async () => [] as any[])
  const service = new WorldSubscriptionService(runtime, profiles, { teams, teamID: async () => '9223372036854775800', project })
  return { service, post, teams, project, teamPost, profiles, changeAccount: () => { actor = 9 } }
}
it('rejects a stale account before lookup or mutation and keeps large team IDs exact', async () => {
  const f = fixture()
  await expect(f.service.execute({ accountKey: 'test:7', action: 'state', target: { kind: 'person', userId: 9 } })).rejects.toMatchObject({ code: 'world-subscription-account-changed' })
  expect(f.post).not.toHaveBeenCalled()
  f.post.mockResolvedValue({ items: [{ target: { kind: 'team', id: '9223372036854775800' }, subscribed: true }] })
  await expect(f.service.execute({ accountKey: 'test:8', action: 'state', target: { kind: 'team', jotmoId: 'our_team' } })).resolves.toEqual({ subscribed: true })
  expect(f.post.mock.calls[0]!.slice(0, 2)).toEqual(['/api/v1/world/subscriptions/states', { targets: [{ kind: 'team', id: '9223372036854775800' }] }])
})
it('reconciles a replayed successful receipt against the latest choice', async () => {
  const f = fixture(), target = { kind: 'person', id: '9' }
  f.post.mockImplementation(async path => path.endsWith('/set') ? { target, subscribed: true } : { items: [{ target, subscribed: false }] })
  await expect(f.service.execute({ accountKey: 'test:8', action: 'set', target: { kind: 'person', userId: 9 }, active: true, requestUid: 'same-request-00001' })).resolves.toEqual({ subscribed: false })
  expect(f.post.mock.calls[0]![1]).toMatchObject({ request_uid: 'same-request-00001', target })
})
it('binds incoming pagination to its account and identity', async () => {
  const f = fixture()
  f.post.mockResolvedValue({ items: [{ target: { kind: 'person', id: '8' }, subscriber_user_id: 9, subscribed: true, updated_at: 100 }], teams: [], has_more: true, after_id: 'a'.repeat(64) })
  const page = await f.service.execute({ accountKey: 'test:8', action: 'query', incoming: { kind: 'self' } }) as any
  expect(page.items[0].subscriber.name).toBe('person-9')
  await expect(f.service.execute({ accountKey: 'test:8', action: 'query', cursor: page.nextCursor })).rejects.toThrow()
  f.changeAccount()
  await expect(f.service.execute({ accountKey: 'test:9', action: 'query', incoming: { kind: 'self' }, cursor: page.nextCursor })).rejects.toThrow()
  expect(f.post).toHaveBeenCalledTimes(1)
})
it('shows a withdrawn receipt without a body and seals account-scoped read watermarks', async () => {
  const f = fixture()
  f.post.mockResolvedValue({ items: [{ id: 'b'.repeat(64), kind: 'publication', target: { kind: 'person', id: '9' }, scope: { kind: 'person', id: '8' }, actor_user_id: 9, sequence: 7, at: 123, unread: true, publication_uid: 'withdrawn' }], teams: [], publications: {}, has_more: false, unread_count: 7, cursor: { ceilings: { 'person:8': 7 } } })
  const page = await f.service.execute({ accountKey: 'test:8', action: 'notifications' }) as WorldSubscriptionNoticePage
  expect(page.items[0]!.publication).toBeUndefined()
  const receipt = page.items[0]!.readRef
  f.post.mockResolvedValue({ ok: true })
  await f.service.execute({ accountKey: 'test:8', action: 'read', readRefs: [receipt, receipt] })
  expect(f.post.mock.lastCall?.slice(0, 2)).toEqual(['/api/v1/world/subscriptions/notifications/read', { items: [{ scope: { kind: 'person', id: '8' }, through: 7 }] }])
  f.changeAccount()
  await expect(f.service.execute({ accountKey: 'test:9', action: 'read', readRefs: [receipt] })).rejects.toThrow()
  expect(f.post).toHaveBeenCalledTimes(2)
})
it('rejects another recipient or unrelated publication instead of projecting it', async () => {
  const f = fixture()
  f.post.mockResolvedValue({ items: [{ id: 'b'.repeat(64), kind: 'subscriber', target: { kind: 'person', id: '9' }, scope: { kind: 'person', id: '9' }, actor_user_id: 10, sequence: 1, at: 123, unread: true }], teams: [], publications: {}, has_more: false, unread_count: 1, cursor: {} })
  await expect(f.service.execute({ accountKey: 'test:8', action: 'notifications' })).rejects.toThrow()
  f.post.mockResolvedValue({ items: [], teams: [], publications: { other: { record_uid: 'other', text_content: 'unexpected' } }, has_more: false, unread_count: 0 })
  await expect(f.service.execute({ accountKey: 'test:8', action: 'notifications' })).rejects.toThrow()
})
it('excludes ordinary team memberships and invalidates a cursor after authority changes', async () => {
  const f = fixture()
  f.teams.mockResolvedValue([{ teamRef: 'member', currentUserRole: 'member' }])
  f.post.mockResolvedValue({ items: [{ id: 'b'.repeat(64), kind: 'subscriber', target: { kind: 'person', id: '8' }, scope: { kind: 'person', id: '8' }, actor_user_id: 10, sequence: 1, at: 123, unread: true }], teams: [], publications: {}, has_more: true, unread_count: 1, cursor: { before_at: 123, before_id: 'b'.repeat(64), ceilings: { 'person:8': 1 } } })
  const page = await f.service.execute({ accountKey: 'test:8', action: 'notifications' }) as WorldSubscriptionNoticePage
  expect(f.post.mock.calls[0]![1].team_ids).toEqual([])
  f.teams.mockResolvedValue([{ teamRef: 'owner', currentUserRole: 'owner' }])
  await expect(f.service.execute({ accountKey: 'test:8', action: 'notifications', cursor: page.nextCursor! })).rejects.toMatchObject({ code: 'world-subscription-scope-changed' })
  expect(f.post).toHaveBeenCalledTimes(1)
})
it('discards an in-flight result if the account changes', async () => {
  const f = fixture()
  f.post.mockImplementation(async () => { f.changeAccount(); return { items: [{ target: { kind: 'person', id: '9' }, subscribed: true }] } })
  await expect(f.service.execute({ accountKey: 'test:8', action: 'state', target: { kind: 'person', userId: 9 } })).rejects.toMatchObject({ code: 'world-subscription-account-changed' })
})

it.each([404,501,503])('maps unavailable subscription reads %i to a useful retry message',async status=>{
 const f=fixture();f.post.mockRejectedValue(new ArkmePluginError('upstream','raw server error',false,status));
 await expect(f.service.execute({accountKey:'test:8',action:'state',target:{kind:'person',userId:9}})).rejects.toMatchObject({code:'world-subscription-unavailable',message:'订阅服务尚未接通，请稍后再试'});
 await expect(f.service.execute({accountKey:'test:8',action:'set',target:{kind:'person',userId:9},active:true,requestUid:'uncertain-request-123'})).rejects.toMatchObject({message:'暂未确认订阅操作结果，请重试核对本次操作'});
});
