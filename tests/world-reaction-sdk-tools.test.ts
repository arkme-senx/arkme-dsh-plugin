import { expect, it, vi } from 'vitest'
import { createArkmeSdk, ARKME_PROVIDER_CONTRACT_VERSION } from '../src/sdk/index.js'
import { createArkmeCoreToolDefinitions } from '../src/tools/index.js'
it('discovers the distinct World capability and preserves request identity through SDK adapters', async () => {
  let supported = true
  const calls: { operation: string; params: unknown }[] = []
  const sdk = createArkmeSdk({ fetchImpl: async (_, init) => {
    const call = JSON.parse(String(init?.body)); calls.push(call)
    return new Response(JSON.stringify({ ok: true, value: call.operation === 'provider.capabilities' ? { contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: { worldReactionsV1: supported } } : { items: [], has_more: false } }), { headers: { 'content-type': 'application/json' } })
  } })
  const input = { action: 'query' as const, accountKey: 'test:7', targets: [{ id: 'opaque-id', worldRecordRef: 'opaque-version' }] }
  await sdk.prepareNoteWorldReactions('test:7', 'owned-source', 'owned-message')
  await sdk.prepareWorldReactions('test:7', ['opaque-record'])
  await sdk.worldReactions(input)
  await sdk.worldReactionArchive(input)
  expect(calls.filter(c => c.operation !== 'provider.capabilities')).toEqual([
    { operation: 'world.reactions.from-note', params: { accountKey: 'test:7', sourceRef: 'owned-source', messageActionRef: 'owned-message' } },
    { operation: 'world.reactions.prepare', params: { accountKey: 'test:7', recordRefs: ['opaque-record'] } },
    { operation: 'world.reactions', params: input }, { operation: 'world.reactions.archive', params: input },
  ])
  supported = false
  await expect(sdk.worldReactions(input)).rejects.toMatchObject({ body: { code: 'CAPABILITY_UNSUPPORTED' } })
})
it('separates reads, archive and explicit writes without importing local reactions', async () => {
  const ports = { prepareNoteWorldReactions: vi.fn(async () => ({items:[]})), worldReactions: vi.fn(async () => ({ items: [] })), worldReactionArchive: vi.fn(async () => ({ items: [] })), prepareWorldReactions: vi.fn(async () => ({ items: [] })) }
  const tools = createArkmeCoreToolDefinitions(ports as never)
  const read = tools.find(t => t.name === 'arkme_world_reactions_read')!, write = tools.find(t => t.name === 'arkme_world_reactions_write')!
  const exec = { signal: new AbortController().signal } as never
  const invoke = (tool: typeof read, value: unknown) => tool.execute({ request_json: JSON.stringify(value) }, exec)
  await invoke(read, { accountKey:'test:7', action:'from-note', sourceRef:'owned', messageActionRef:'message' })
  expect(ports.prepareNoteWorldReactions).toHaveBeenCalledWith('test:7','owned','message',expect.any(AbortSignal))
  await invoke(read, { accountKey: 'test:7', action: 'prepare', recordRefs: ['record'] })
  expect(ports.prepareWorldReactions).toHaveBeenCalledWith('test:7', ['record'], expect.any(AbortSignal))
  await invoke(read, { accountKey: 'test:7', action: 'query', archive: true, targets: [] })
  expect(ports.worldReactionArchive).toHaveBeenCalledOnce()
  await expect(invoke(read, { accountKey: 'test:7', action: 'set' })).rejects.toThrow()
  await expect(invoke(read, { accountKey: 'test:7', action: 'set', archive: true })).rejects.toThrow()
  await expect(invoke(write, { accountKey: 'test:7', action: 'library-set' })).rejects.toThrow()
  const input = { accountKey: 'test:7', action: 'set', target: { id: 'id', worldRecordRef: 'ref' }, expression: { text: '赞' }, active: false, expected_revision: 2, request_id: 'exact-retry' }
  await invoke(write, input)
  expect(ports.worldReactions).toHaveBeenCalledExactlyOnceWith(input, expect.any(AbortSignal))
})

it('preserves separate notification navigation and command references through public SDK and Tools', async () => {
  const notification = { id: 'a'.repeat(64), revision: 2, actorUserId: 8, unread: true, recordRef: 'public-content', target: { id: 'version', worldRecordRef: 'reaction-version' }, selections: [] }
  const page = { items: [notification], has_more: false, after_id: '' }
  const sdk = createArkmeSdk({ fetchImpl: async (_, init) => {
    const call = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ ok: true, value: call.operation === 'provider.capabilities' ? { contractVersion: ARKME_PROVIDER_CONTRACT_VERSION, features: { worldReactionsV1: true } } : page }), { headers: { 'content-type': 'application/json' } })
  } })
  const input = { action: 'notifications' as const, accountKey: 'test:7', limit: 50, include_read: true }
  const result = await sdk.worldReactions(input)
  expect(result.items[0]?.recordRef).toBe('public-content')
  expect(result.items[0]?.target.worldRecordRef).toBe('reaction-version')
  const ports = { worldReactions: vi.fn(async () => page) }
  const read = createArkmeCoreToolDefinitions(ports as never).find(tool => tool.name === 'arkme_world_reactions_read')!
  const output = await read.execute({ request_json: JSON.stringify(input) }, { signal: new AbortController().signal } as never)
  expect(JSON.stringify(output)).toContain('public-content')
  expect(ports.worldReactions).toHaveBeenCalledExactlyOnceWith(input, expect.any(AbortSignal))
})
