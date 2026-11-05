import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorldReactionService } from '../src/services/world-reaction-service.js'
import { ReactionService } from '../src/services/reaction-service.js'
import { ArkmePluginError } from '../src/services/service.js'
import { WORLD_REACTION_CONTRACT, WORLD_REACTION_PREFIX } from '../src/world-reaction-contract.js'

afterEach(() => vi.useRealTimers())
const prepared = { contract: WORLD_REACTION_CONTRACT, items: [{ record_uid: 'record', context_uid: 'world-only', content_revision: 'v3', readable: true, visibility: 'published' }] }
function setup(reply: unknown = prepared) {
  let userId = 7
  const post = vi.fn(async () => reply)
  const runtime = { config: { environment: 'test' }, requireSession: async () => ({ userId }), authenticatedPost: post, stateStore: { uniqueCode: async () => 'device' } }
  const resolve = vi.fn(async () => ({ record_uid: 'record' }))
  const owner = new WorldReactionService(runtime as never, resolve)
  return { owner, post, resolve, runtime, setUser: (id: number) => { userId = id } }
}
describe('isolated World reaction owner adapter', () => {
  it('prepares only through the new contract and seals the content version to this account', async () => {
    const { owner, post, setUser } = setup()
    const page = await owner.prepare('test:7', ['opaque-world'])
    expect(post.mock.calls[0]?.[0]).toBe(`${WORLD_REACTION_PREFIX}prepare`)
    expect(post.mock.calls[0]?.[1]).toEqual({ record_uids: ['record'] })
    // Match plaintext fields/values, not incidental characters in randomized ciphertext.
    expect(JSON.stringify(page)).not.toMatch(/"world-only"|"record_uid"|"v3"/)
    const target = page.items[0]!.target
    expect(await owner.resolve(target)).toEqual({ record_uid: 'record', world_context_uid: 'world-only', content_revision: 'v3' })
    setUser(8)
    await expect(owner.resolve(target)).rejects.toThrow('失效')
  })
  it('does not fall back to the legacy public union when the new route is missing', async () => {
    const { owner, post } = setup()
    post.mockRejectedValue(new ArkmePluginError('upstream-http-404', 'not found', false, 502, { upstreamStatus: 404 }))
    await expect(owner.prepare('test:7', ['opaque-world'])).rejects.toMatchObject({ code: 'world-reactions-unavailable', retryable: false })
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('rejects missing markers, mixed identities and content without an authoritative version', async () => {
    for (const reply of [{ ...prepared, contract: undefined }, { ...prepared, items: [{ ...prepared.items[0], record_uid: 'other' }] }, { ...prepared, items: [{ ...prepared.items[0], content_revision: '' }] }]) {
      await expect(setup(reply).owner.prepare('test:7', ['opaque-world'])).rejects.toMatchObject({ code: 'world-reactions-contract-invalid' })
    }
    const { owner, resolve } = setup()
    await expect(owner.prepare('test:8', ['opaque-world'])).rejects.toThrow('账号')
    expect(resolve).not.toHaveBeenCalled()
  })
  it('does not create a reaction target for a withdrawn post the viewer cannot read', async () => {
    const { owner } = setup({ contract: WORLD_REACTION_CONTRACT, items: [{ record_uid: 'record', readable: false }] })
    expect(await owner.prepare('test:7', ['opaque-world'])).toEqual({ items: [], unavailableRecordRefs: ['opaque-world'] })
  })
  it('keeps the context ID stable but rejects expired and tampered envelopes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const { owner } = setup()
    const first = (await owner.prepare('test:7', ['opaque-world'])).items[0]!.target
    vi.setSystemTime(2000)
    const second = (await owner.prepare('test:7', ['opaque-world'])).items[0]!.target
    expect(second.id).toBe(first.id)
    expect(second.worldRecordRef).not.toBe(first.worldRecordRef)
    await expect(owner.resolve({ ...first, worldRecordRef: `${first.worldRecordRef}x` })).rejects.toThrow('失效')
    vi.setSystemTime(1_000_000)
    await expect(owner.resolve(first)).rejects.toMatchObject({ code: 'world-reactions-context-expired' })
  })
  it('sends scoped queries and writes to distinct routes with strict version echoes', async () => {
    const { owner, runtime } = setup()
    const target = (await owner.prepare('test:7', ['opaque-world'])).items[0]!.target
    const wire = await owner.resolve(target)
    const post = vi.fn(async () => ({ contract: WORLD_REACTION_CONTRACT, items: [{ target: wire, mine: { revision: 0, selections: [] }, groups: [], has_more: false, actors_visible: true, private: false }] }))
    const service = new ReactionService({ ...runtime, authenticatedPost: post } as never, t => owner.resolve(t), undefined, undefined, undefined, undefined, { prefix: WORLD_REACTION_PREFIX, contract: WORLD_REACTION_CONTRACT })
    expect(await service.request({ action: 'query', accountKey: 'test:7', targets: [target] })).toMatchObject({ items: [{ target_id: target.id }] })
    expect(post.mock.calls[0]?.[0]).toBe(`${WORLD_REACTION_PREFIX}query`)
    post.mockResolvedValue({ contract: WORLD_REACTION_CONTRACT, outcome: 'updated', state: { revision: 1, selections: [] } } as never)
    await service.request({ action: 'set', accountKey: 'test:7', target, expression: { text: '有启发' }, active: true, expected_revision: 0, request_id: 'idempotent-id' })
    expect(post.mock.calls[1]?.[0]).toBe(`${WORLD_REACTION_PREFIX}set`)
    expect(post.mock.calls[1]?.[1]).toMatchObject({ target: wire, request_id: 'idempotent-id' })
    post.mockResolvedValue({ items: [] } as never)
    await expect(service.request({ action: 'query', accountKey: 'test:7', targets: [target] })).rejects.toMatchObject({ code: 'world-reactions-contract-invalid' })
  })
})

it('returns sealed history targets and own state without hydrating inaccessible original content', async () => {
  const { owner, runtime } = setup()
  const wire = { record_uid: 'record', world_context_uid: 'world-only', content_revision: 'old-version' }
  const hydrate = vi.fn(), post = vi.fn(async () => ({ contract: WORLD_REACTION_CONTRACT, items: [{ event_uid: 'a'.repeat(64), target: wire, expression: { text: '赞' }, active: true, at: 10, restricted: true, text: 'must not leak', state: { revision: 4, selections: [] } }], has_more: false }))
  const service = new ReactionService({ ...runtime, authenticatedPost: post } as never, t => owner.resolve(t), undefined, undefined, hydrate, undefined, { prefix: WORLD_REACTION_PREFIX, contract: WORLD_REACTION_CONTRACT, reference: t => owner.reference(t) })
  const result = await service.request({ accountKey: 'test:7', action: 'history', start_at: 1, end_at: 20, limit: 50 }) as import('../src/world-reaction-contract.js').WorldReactionHistoryPage
  expect(hydrate).not.toHaveBeenCalled()
  expect(result.items[0]).toMatchObject({ restricted: true, state: { revision: 4 } })
  expect(JSON.stringify(result)).not.toMatch(/must not leak|world-only|old-version|record_uid/)
  expect(await owner.resolve(result.items[0]!.target)).toEqual(wire)
})

it('exposes a separate sealed navigation reference through the common World notification owner', async () => {
 const {owner,runtime}=setup(), navigation=vi.fn(async()=> 'sealed-public-navigation')
 const post=vi.fn(async()=>({contract:WORLD_REACTION_CONTRACT,items:[{id:'a'.repeat(64),revision:1,actor_user_id:8,unread:true,target:{record_uid:'record',world_context_uid:'ctx',content_revision:'v1'},selections:[]}],has_more:false,after_id:''}))
 const service=new ReactionService({...runtime,authenticatedPost:post} as never,t=>owner.resolve(t),navigation,undefined,undefined,undefined,{prefix:WORLD_REACTION_PREFIX,contract:WORLD_REACTION_CONTRACT,reference:t=>owner.reference(t)})
 const page=await service.request({action:'notifications',accountKey:'test:7',include_read:true,limit:50}) as import('../src/world-reaction-contract.js').WorldReactionNotificationPage
 expect(page.items[0]?.recordRef).toBe('sealed-public-navigation')
 expect(navigation).toHaveBeenCalledExactlyOnceWith('record')
 expect(page.items[0]?.target.worldRecordRef).not.toBe(page.items[0]?.recordRef)
 expect(JSON.stringify(page)).not.toContain('record_uid')
})

it('pages archive versions with account/original-bound cursors and refuses mixed scope echoes', async () => {
 const {owner,post}=setup()
 const current=(await owner.prepare('test:7',['opaque'])).items[0]!.target
 const wire=await owner.resolve(current)
 post.mockResolvedValue({contract:WORLD_REACTION_CONTRACT,items:[{...wire,content_revision:'old-a'},{...wire,content_revision:'old-b'}],after_revision:'old-b',has_more:true} as never)
 const page=await owner.versions({accountKey:'test:7',target:current,limit:2})
 expect(page.items).toHaveLength(2);expect(page.hasMore).toBe(true)
 expect(JSON.stringify(page)).not.toMatch(/old-a|old-b|world-only|record_uid/)
 post.mockResolvedValue({contract:WORLD_REACTION_CONTRACT,items:[{...wire,content_revision:'old-c'}],after_revision:'old-c',has_more:false} as never)
 await owner.versions({accountKey:'test:7',target:current,limit:2,cursor:page.nextCursor})
 expect(post.mock.calls.at(-1)?.[1]).toMatchObject({after_revision:'old-b',limit:2,target:wire})
 const other=await owner.reference({...wire,record_uid:'other'})
 await expect(owner.versions({accountKey:'test:7',target:other,cursor:page.nextCursor})).rejects.toThrow()
 post.mockResolvedValue({contract:WORLD_REACTION_CONTRACT,items:[{...wire,record_uid:'other',content_revision:'old-d'}],has_more:false} as never)
 await expect(owner.versions({accountKey:'test:7',target:current})).rejects.toThrow()
 await expect(owner.versions({accountKey:'test:8',target:current})).rejects.toThrow('账号')
 await expect(owner.versions({accountKey:'test:7',target:current,limit:21})).rejects.toThrow()
})
