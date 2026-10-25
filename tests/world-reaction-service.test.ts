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
    expect(JSON.stringify(page)).not.toMatch(/world-only|record_uid|v3/)
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
      await expect(setup(reply).owner.prepare('test:7', ['opaque-world'])).rejects.toThrow('尚未完成对接')
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
