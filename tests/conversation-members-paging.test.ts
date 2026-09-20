import { afterEach, expect, it, vi } from 'vitest'
import { memberFacts } from './helpers/member-page-fixture.js'
import { ConversationMembersStore } from '../src/client/conversation-members-store.js'
import type { ArkmeConversationMemberItem, ArkmeConversationMemberPage, ArkmeConversationMemberPresentation, ArkmeConversationMemberCache } from '../src/types.js'

const account = 'test:42'
const source = { sourceRef: 'ref', sourceKey: 'group', kind: 'group_chat' as const, displayName: '群' }
const member = (memberRef: string, displayName = memberRef): ArkmeConversationMemberItem => ({
  memberRef, displayName, role: 'member', status: 'active', isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 1, mentionCount: 0,
})
const rows = new Map<string, ArkmeConversationMemberItem>()
const page = (items: ArkmeConversationMemberItem[], cursor?: string): ArkmeConversationMemberPage => {
  for (const item of items) rows.set(item.memberRef, item)
  return { kind: 'membership', selfRole: 'member', source, items: items.map(memberFacts), removedMemberRefs: [], hasMore: cursor !== undefined,
    ...(cursor === undefined ? {} : { nextCursor: cursor }) }
}
const presentation = (items: ArkmeConversationMemberItem[], removedMemberRefs: string[] = []): ArkmeConversationMemberPresentation => ({
  kind: 'presentation', source, items, removedMemberRefs, unavailableProfileMemberRefs: [],
})
function createStore(options: ConstructorParameters<typeof ConversationMembersStore>[0]) {
  const store = new ConversationMembersStore({
    presentation: async (_ref, refs) => presentation(refs.flatMap(ref => rows.has(ref) ? [rows.get(ref)!] : []), refs.filter(ref => !rows.has(ref))),
    ...options,
  })
  store.activateAccount(account)
  return store
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
afterEach(() => { vi.useRealTimers(); rows.clear() })

it('does not resurrect cached rows after the remote access check has failed', async () => {
  const cached = deferred<ArkmeConversationMemberCache>()
  const store = createStore({
    cached: () => cached.promise,
    page: async () => { throw Object.assign(new Error('已失去访问权限'), { body: { code: 'arkme-code-1004' } }) },
  })
  store.subscribe(account, source, vi.fn())
  await store.ensure(account, source)
  cached.resolve({ items: [member('a')], joinEvents: [], cachedAtMillis: 1 })
  await Promise.resolve()
  expect(store.get(account, source).items).toEqual([])
  expect(store.get(account, source).error).toBe('已失去访问权限')
  store.activateAccount(undefined)
})

it('clears advisory rows when presentation verification reports revoked access', async () => {
  const store = createStore({
    cached: async () => ({ items: [member('a')], joinEvents: [], cachedAtMillis: 1 }),
    page: async () => ({ ...page([member('a')]),  }),
    presentation: async () => { throw Object.assign(new Error('访问权限已失效'), { body: { code: 'arkme-code-1004' } }) },
  })
  store.subscribe(account, source, vi.fn())
  await store.ensure(account, source)
  expect(store.get(account, source).items).toEqual([])
  expect(store.get(account, source).error).toBe('访问权限已失效')
  store.activateAccount(undefined)
})

it('restores disk cache immediately without skipping or waiting to start the remote request', async () => {
  const remote = deferred<ArkmeConversationMemberPage>()
  const loadPage = vi.fn(() => remote.promise)
  const store = createStore({
    cached: async () => ({ items: [member('a', '缓存名字')], joinEvents: [], cachedAtMillis: Date.now() }),
    page: loadPage,
  })
  store.subscribe(account, source, vi.fn())
  const pending = store.ensure(account, source)
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(loadPage).toHaveBeenCalledOnce()
  expect(store.get(account, source)).toMatchObject({ cached: true, refreshing: true, complete: false, items: [{ displayName: '缓存名字' }] })
  remote.resolve(page([member('a', '服务端名字')]))
  await pending
  expect(store.get(account, source)).toMatchObject({ cached: false, complete: true, items: [{ displayName: '服务端名字' }] })
  store.activateAccount(undefined)
})

it('does not let slow cache overwrite newer remote pages', async () => {
  const cache = deferred<ArkmeConversationMemberCache>()
  const store = createStore({ cached: () => cache.promise, page: async () => page([member('new')]) })
  store.subscribe(account, source, vi.fn())
  await store.ensure(account, source)
  cache.resolve({ items: [member('old')], joinEvents: [], cachedAtMillis: Date.now() })
  await Promise.resolve()
  expect(store.get(account, source).items.map(member => member.memberRef)).toEqual(['new'])
  store.activateAccount(undefined)
})

it('publishes each page and only removes absent cached members after explicit verification', async () => {
  const first = deferred<ArkmeConversationMemberPage>()
  const second = deferred<ArkmeConversationMemberPage>()
  const verify = deferred<ArkmeConversationMemberPresentation>()
  const loadPresentation = vi.fn(async (_ref: string, refs: string[]) => refs.includes('old') ? await verify.promise : presentation(refs.map(ref => member(ref))))
  const store = createStore({
    cached: async () => ({ items: [member('old')], joinEvents: [], cachedAtMillis: 1 }),
    page: async (_ref, cursor) => await (cursor ? second.promise : first.promise), presentation: loadPresentation,
  })
  store.subscribe(account, source, vi.fn())
  const pending = store.ensure(account, source)
  await Promise.resolve(); await Promise.resolve()
  first.resolve(page([member('a')], 'page-2'))
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(store.get(account, source).items.map(member => member.memberRef).sort()).toEqual(['a', 'old'])
  expect(loadPresentation.mock.calls.some(call => call[1].includes('old'))).toBe(false)
  second.resolve(page([member('b')]))
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(loadPresentation.mock.calls.some(call => call[1].includes('old'))).toBe(true)
  expect(store.get(account, source).items).toHaveLength(3)
  verify.resolve(presentation([], ['old']))
  await pending
  expect(store.get(account, source).items.map(member => member.memberRef).sort()).toEqual(['a', 'b'])
  store.activateAccount(undefined)
})

it('keeps first-page data on a later-page failure and rejects repeated cursors', async () => {
  const store = createStore({
    cached: async () => null, page: async () => page([member('a')], 'repeated'),
  })
  store.subscribe(account, source, vi.fn())
  await store.ensure(account, source)
  expect(store.get(account, source)).toMatchObject({ complete: false, ready: true, items: [{ memberRef: 'a' }], error: '成员分页游标重复或缺失，请重试' })
  store.activateAccount(undefined)
})

it('bounds hydration concurrency and makes the basic page visible before profiles complete', async () => {
  const profiles = deferred<ArkmeConversationMemberPresentation>()
  const hydration = vi.fn(() => profiles.promise)
  const store = createStore({
    cached: async () => null,
    page: async () => ({ ...page([{ ...member('a'), memberName: '基础名单' }]),  }),
    presentation: hydration,
  })
  store.subscribe(account, source, vi.fn())
  const pending = store.ensure(account, source)
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(store.get(account, source).items[0]?.displayName).toBe('基础名单')
  expect(store.get(account, source).refreshing).toBe(true)
  profiles.resolve(presentation([member('a', '完整资料')]))
  await pending
  expect(store.get(account, source).items[0]?.displayName).toBe('完整资料')
  expect(hydration).toHaveBeenCalledOnce()
  store.activateAccount(undefined)
})

it('reports an unavailable page route without switching to another data path', async () => {
  const store = createStore({ cached: async () => null, page: async () => { throw new Error('页面接口不可用') } })
  store.subscribe(account, source, vi.fn())
  await store.ensure(account, source)
  expect(store.get(account, source)).toMatchObject({ ready: false, complete: false, error: '页面接口不可用' })
  store.activateAccount(undefined)
})
