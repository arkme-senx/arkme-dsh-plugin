import { afterEach, expect, it, vi } from 'vitest'
import { SourceService } from '../../src/services/source-service.js'
import { SearchService } from '../../src/services/search-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
const bundle = (uid: string) => ({ session: { chat_session_uid: uid, session_kind: 1 }, private_counterpart: { user_id: 17, display_name_snapshot: '原昵称' }, private_supplement: { remark: '本人备注' } })
function fixture() {
  let userId = 42
  const post = vi.fn(async (_path: string, body: Record<string, unknown>) => ({ items: (body.chat_session_uids as string[]).map(bundle) }))
  const recordPost = vi.fn(async () => ({ items: [
    { record_uid: 'hit', source_kind: 3, source_uid: 'chat-1', record_core: { text_content: '搜索内容' } },
    { record_uid: 'locked', source_kind: 3, source_uid: 'locked-chat', record_core: { text_content: '私密内容' } },
  ], source_aggregates: [{ source_kind: 3, source_uid: 'chat-2', matched_record_count: 2 }] }))
  const runtime = { config: { environment: 'test' }, requireSession: async () => ({ userId, refreshToken: 'fixture' }), stateStore: { uniqueCode: async () => 'fixture-key' }, authenticatedChatPost: post, authenticatedPost: recordPost } as unknown as ServiceRuntime
  const source = new SourceService(runtime, {} as never, {} as never)
  cleanups.push(() => source.dispose())
  const list = vi.spyOn(source, 'listSources').mockResolvedValue({ directory: 'root', items: [], hasMore: false })
  const search = new SearchService(runtime, {} as never, {} as never, source, { lockedRecordUids: async () => new Set(['locked']) } as never)
  return { source, search, post, recordPost, list, setUser: (next: number) => { userId = next } }
}

it('returns navigable search results and aggregates without waiting for unrelated directory pages', async () => {
  const f = fixture(), directory = deferred<void>()
  f.list.mockImplementation(async () => { await directory.promise; return { directory: 'root', items: [], hasMore: false } })
  let settled = false
  const reading = f.search.searchRemote({ query: '搜索', limit: 50 }).then(result => { settled = true; return result })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(settled).toBe(true)
    const result = await reading
    expect(result.items.map(item => item.recordUid)).toEqual(['hit'])
    expect(result.items[0]?.targetSource).toMatchObject({ displayName: '本人备注', privateNickname: '原昵称' })
    expect(result.sourceAggregates[0]?.targetSource).toMatchObject({ displayName: '本人备注' })
    expect(await f.source.openSourceRef(result.items[0]!.targetSource!.sourceRef, 42)).toMatchObject({ ownerRef: 'chat-1', kind: 'private_chat' })
    expect(await f.source.openSourceRef(result.sourceAggregates[0]!.targetSource!.sourceRef, 42)).toMatchObject({ ownerRef: 'chat-2' })
    expect(f.post.mock.calls.map(([path, body]) => [path, body])).toEqual([['/api/v1/chats/display-snapshots', { chat_session_uids: ['chat-1', 'chat-2'] }]])
    expect(f.list).not.toHaveBeenCalled()
  } finally { directory.resolve(); await reading }
})

it('reads only missing unique conversation identities in bounded batches and reuses their viewer cache', async () => {
  const f = fixture()
  const uids = Array.from({ length: 51 }, (_, index) => `chat-${String(index).padStart(2, '0')}`)
  const result = await f.source.chatSourcesBySessionUids([...uids, uids[0]!, ''])
  expect(result.size).toBe(51)
  expect(f.post.mock.calls.map(([, body]) => (body.chat_session_uids as string[]).length)).toEqual([50, 1])
  expect(f.list).not.toHaveBeenCalled()
  expect(await f.source.chatSourcesBySessionUids(uids)).toEqual(result)
  expect(f.post).toHaveBeenCalledTimes(2)
})

it('does not fabricate navigation for an inaccessible conversation omitted by the owner', async () => {
  const f = fixture()
  f.post.mockResolvedValue({ items: [] })
  expect(await f.source.chatSourcesBySessionUids(['denied'])).toEqual(new Map())
  expect(f.post).toHaveBeenCalledOnce()
  expect(f.source.cachedChatSource(42, 'denied')).toBeUndefined()
  expect(f.list).not.toHaveBeenCalled()
})

it.each(['account', 'cancel'] as const)('does not publish a delayed source after %s changes', async reason => {
  const f = fixture(), response = deferred<{ items: ReturnType<typeof bundle>[] }>(), controller = new AbortController()
  f.post.mockImplementation(() => response.promise)
  const reading = f.source.chatSourcesBySessionUids(['chat-1'], controller.signal)
  const outcome = reading.then(value => ({ value }), error => ({ error }))
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(f.post).toHaveBeenCalledOnce()
  if (reason === 'account') f.setUser(43)
  else controller.abort()
  response.resolve({ items: [bundle('chat-1')] })
  expect(await outcome).toMatchObject({ error: reason === 'account' ? { code: 'read-account-changed' } : { name: 'AbortError' } })
  expect(f.source.cachedChatSource(42, 'chat-1')).toBeUndefined()
  expect(f.source.cachedChatSource(43, 'chat-1')).toBeUndefined()
})

it.each([
  { items: [bundle('other')] },
  { items: [bundle('chat-1'), bundle('chat-1')] },
  { items: 'invalid' },
])('rejects mismatched or malformed display snapshots before caching', async response => {
  const f = fixture()
  f.post.mockResolvedValue(response as never)
  await expect(f.source.chatSourcesBySessionUids(['chat-1'])).rejects.toMatchObject({ code: 'chat-display-snapshot-invalid' })
  expect(f.source.cachedChatSource(42, 'chat-1')).toBeUndefined()
  expect(f.source.cachedChatSource(42, 'other')).toBeUndefined()
})

it('rejects an account change instead of swallowing it as optional search navigation failure', async () => {
  const f = fixture(), response = deferred<{ items: ReturnType<typeof bundle>[] }>()
  f.post.mockImplementation(() => response.promise)
  const reading = f.search.searchRemote({ query: '搜索', limit: 50 })
  const outcome = reading.then(value => ({ value }), error => ({ error }))
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(f.post).toHaveBeenCalledOnce()
  f.setUser(43); response.resolve({ items: [bundle('chat-1'), bundle('chat-2')] })
  expect(await outcome).toMatchObject({ error: { code: 'read-account-changed' } })
})
