import { expect, it, vi } from 'vitest'
import { WorldSuggestionsService } from '../src/services/world-suggestions-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'
import type { WorldSuggestionsState, WorldSuggestionPrepared } from '../src/world-suggestions-contract.js'
const key = 'a'.repeat(64), id = 'world-suggestions:fixture-job'
function fixture() {
  let actor = 8, changed = () => {}
  const source = { sourceRef: 'PRIVATE-SELF', itemUid: 'PRIVATE-RECORD', version: 7, title: '标题', textContent: '完整原文', sendAtMillis: 100, attachments: [] }
  const raw = { id: key, source: { record_uid: source.itemUid, version: 7, revision: 'b'.repeat(64) }, title: source.title, preview: '原文预览', reason: '有独立观点', occurred_at: 100 }
  const post = vi.fn(async (path: string) => {
    if (path.endsWith('/state')) return { candidate_count: 1, unavailable_count: 0, result_id: id, items: [raw] }
    if (path.endsWith('/source')) return raw
    if (path.endsWith('/hide')) return { hidden: true }
    return { schema_version: 1, supported: true, durable_jobs: true, source_recheck: true, idempotent_create: true, unified_models: true }
  })
  const runtime = { config: { environment: 'test' }, requireSession: async () => ({ userId: actor }), stateStore: { uniqueCode: async () => 'sharing-fixture-key' }, subscribeAccountScope: (cb: () => void) => { changed = cb; return vi.fn() }, authenticatedIntelligentPost: post } as unknown as ServiceRuntime
  const ports = { selfSource: vi.fn(async () => source.sourceRef), source: vi.fn(async () => source) }
  return { service: new WorldSuggestionsService(runtime, ports), post, ports, source, raw, switchAccount: () => { actor = 9; changed() }, invalidate: () => changed() }
}
it('projects opaque account-bound candidates and resolves the original again without leaking owner IDs', async () => {
  const f = fixture(), state = await f.service.execute({ action: 'state', accountKey: 'test:8', includeItems: true }) as WorldSuggestionsState
  expect(JSON.stringify(state)).not.toMatch(/PRIVATE|fixture-job|record_uid|revision/)
  const prepared = await f.service.execute({ action: 'prepare', accountKey: 'test:8', ref: state.items[0]!.ref }) as WorldSuggestionPrepared
  expect(prepared.origin.kind).toBe('suggestion'); expect(prepared.draft.textContent).toBe('完整原文')
  expect(JSON.stringify(prepared)).not.toMatch(/PRIVATE|fixture-job|record_uid|revision/)
  expect(f.ports.source).toHaveBeenCalledWith('PRIVATE-SELF', 'PRIVATE-RECORD', undefined)
  f.source.version++
  await expect(f.service.resolve('test:8', prepared.origin)).rejects.toThrow()
  f.switchAccount()
  await expect(f.service.execute({ action: 'hide', accountKey: 'test:9', ref: state.items[0]!.ref, confirmed: true })).rejects.toThrow()
  expect(f.post.mock.calls.filter(c => c[0].endsWith('/hide'))).toHaveLength(0)
  f.service.dispose()
})
it('rejects unconfirmed or malformed commands and cross-account requests before IO', async () => {
  const f = fixture()
  for (const input of [{ action: 'state', accountKey: 'test:9' }, { action: 'create', accountKey: 'test:8', days: 30, requestId: 'fixed-request-1234', confirmed: false }, { action: 'create', accountKey: 'test:8', days: 2, requestId: 'fixed-request-1234', confirmed: true }]) await expect(f.service.execute(input as never)).rejects.toThrow()
  expect(f.post).not.toHaveBeenCalled(); f.service.dispose()
})
it('does not return an in-flight private response after account scope invalidation, even for the same user', async () => {
  const f = fixture(); let release!: (v: unknown) => void
  f.post.mockImplementationOnce(() => new Promise(resolve => { release = resolve }) as never)
  const request = f.service.execute({ action: 'state', accountKey: 'test:8' })
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  f.invalidate(); release({ candidate_count: 0, unavailable_count: 0, items: [] })
  await expect(request).rejects.toThrow(); f.service.dispose()
})
it('reports missing backend capability honestly and does not fall back to retired generation', async () => {
  const f = fixture(); f.post.mockRejectedValue(new ArkmePluginError('http-404', 'missing', false, 404))
  await expect(f.service.execute({ action: 'capabilities', accountKey: 'test:8' })).resolves.toEqual({ version: 1, supported: false })
  expect(f.post).toHaveBeenCalledOnce(); f.service.dispose()
})
it('rejects oversized or malformed result projection and uses current unified model source names', async () => {
  const f = fixture(); f.post.mockResolvedValueOnce({ items: [{ route: 'my-model', name: '我的模型', source: 'user-api' }] } as never)
  await expect(f.service.execute({ action: 'models', accountKey: 'test:8' })).resolves.toEqual({ items: [{ route: 'my-model', name: '我的模型', source: 'account' }] })
  f.post.mockResolvedValueOnce({ items: Array(51).fill(f.raw), result_id: id, candidate_count: 51, unavailable_count: 0 } as never)
  await expect(f.service.execute({ action: 'state', accountKey: 'test:8' })).rejects.toThrow(); f.service.dispose()
})
