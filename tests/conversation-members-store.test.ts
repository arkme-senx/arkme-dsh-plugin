import { afterEach, describe, expect, it, vi } from 'vitest'
import { memberPageFixture } from './helpers/member-page-fixture.js'
import { ConversationMembersStore } from '../src/client/conversation-members-store.js'
import type { ArkmeConversationMemberItem, ArkmeConversationMemberList, ArkmeSourceItem } from '../src/types.js'

const account = 'test:42'
const source: ArkmeSourceItem = { sourceRef: 'group-ref', sourceKey: 'group-key', kind: 'group_chat', displayName: '群' }
const member = (memberRef: string, displayName = memberRef): ArkmeConversationMemberItem => ({
  memberRef, displayName, role: 'member', status: 'active', isSelf: false, isOwner: false,
  joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
})
function result(items: ArkmeConversationMemberItem[], group = source): ArkmeConversationMemberList {
  return { source: group, items, total: items.length, activeCount: items.length }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function createStore(load: (ref: string, signal: AbortSignal) => Promise<ArkmeConversationMemberList>) {
  const api = memberPageFixture(async (_operation, params, signal) => await load(String(params?.sourceRef), signal!))
  const store = new ConversationMembersStore({
    cached: async () => null,
    page: (ref, cursor, signal) => api('source.members.page', { sourceRef: ref, ...(cursor === undefined ? {} : { cursor }) }, signal) as never,
    presentation: (ref, refs, signal) => api('source.members.presentation', { sourceRef: ref, memberRefs: refs }, signal) as never,
  })
  store.activateAccount(account)
  return store
}

afterEach(() => { vi.useRealTimers() })

describe('shared conversation members', () => {
  it('joins conversation and drawer loads and reuses the snapshot when reopened', async () => {
    const pending = deferred<ArkmeConversationMemberList>()
    const load = vi.fn(() => pending.promise)
    const store = createStore(load)
    const releaseConversation = store.subscribe(account, source, vi.fn())
    const releaseDrawer = store.subscribe(account, source, vi.fn())
    const loading = store.ensure(account, source)
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
    pending.resolve(result([member('a')]))
    await loading
    const snapshot = store.get(account, source)
    releaseDrawer()
    const releaseAgain = store.subscribe(account, source, vi.fn())
    await store.ensure(account, source)
    expect(load).toHaveBeenCalledTimes(1)
    expect(store.get(account, source)).toBe(snapshot)
    releaseAgain(); releaseConversation(); store.activateAccount(undefined)
  })

  it('changes only affected entities, retains unchanged arrays, and reconciles deletions', async () => {
    let items = [member('a'), member('b')]
    const store = createStore(async () => result(items))
    store.subscribe(account, source, vi.fn())
    await store.ensure(account, source)
    const before = store.get(account, source).items
    items = items.map(item => ({ ...item }))
    await store.ensure(account, source, true)
    expect(store.get(account, source).items).toBe(before)
    items = [member('a'), member('b', '新备注'), member('c')]
    await store.ensure(account, source, true)
    const changed = store.get(account, source).items
    expect(changed[0]).toBe(before[0])
    expect(changed.find(item => item.memberRef === 'b')).not.toBe(before.find(item => item.memberRef === 'b'))
    expect(changed.find(item => item.memberRef === 'b')?.displayName).toBe('新备注')
    items = [member('a'), member('c')]
    await store.ensure(account, source, true)
    expect(store.get(account, source).items.map(item => item.memberRef)).toEqual(['a', 'c'])
    expect(store.get(account, source).items.find(item => item.memberRef === 'c')).toBe(changed.find(item => item.memberRef === 'c'))
    store.activateAccount(undefined)
  })

  it('keeps known data on failures and rejects incomplete, duplicate and foreign snapshots', async () => {
    let response = result([member('a'), member('b')])
    const load = vi.fn(async () => response)
    const store = createStore(load)
    store.subscribe(account, source, vi.fn())
    await store.ensure(account, source)
    const before = store.get(account, source).items
    for (const invalid of [
      result([{ ...member('a'), status: 'unknown' }]),
      result([member('a'), member('a')]),
      result([], { ...source, sourceKey: 'other' }),
    ]) {
      response = invalid
      await store.ensure(account, source, true)
      expect(store.get(account, source).items).toBe(before)
      expect(store.get(account, source).error).toBeDefined()
    }
    load.mockRejectedValueOnce(new Error('offline'))
    await store.ensure(account, source, true)
    expect(store.get(account, source).items).toBe(before)
    expect(store.get(account, source).error).toBe('offline')
    store.activateAccount(undefined)
  })

  it('revalidates rotated capabilities without losing known rows and clears confirmed revocation', async () => {
    let response = result([member('a')])
    const load = vi.fn(async () => response)
    const store = createStore(load)
    const release = store.subscribe(account, source, vi.fn())
    await store.ensure(account, source)
    const before = store.get(account, source).items
    release()
    const rotated = { ...source, sourceRef: 'new-ref' }
    response = result([member('a')], rotated)
    store.subscribe(account, rotated, vi.fn())
    expect(store.get(account, rotated).items).toBe(before)
    await store.ensure(account, rotated)
    expect(load).toHaveBeenLastCalledWith('new-ref', expect.any(AbortSignal))
    expect(store.get(account, rotated).items).toBe(before)
    load.mockRejectedValueOnce({ body: { code: 'arkme-code-403' } })
    await store.ensure(account, rotated, true)
    expect(store.get(account, rotated).items).toEqual([])
    store.activateAccount(undefined)
  })

  it('does not resurrect a locally removed member with an older in-flight result', async () => {
    vi.useFakeTimers()
    const old = deferred<ArkmeConversationMemberList>()
    const load = vi.fn(async () => result([member('a'), member('b')]))
    const store = createStore(load)
    store.subscribe(account, source, vi.fn())
    await store.ensure(account, source)
    load.mockImplementationOnce(() => old.promise)
    const refresh = store.ensure(account, source, true)
    await Promise.resolve()
    store.remove(account, source, 'b')
    old.resolve(result([member('a'), member('b')]))
    await refresh
    expect(store.get(account, source).items.map(item => item.memberRef)).toEqual(['a'])
    load.mockResolvedValue(result([member('a')]))
    await vi.advanceTimersByTimeAsync(180)
    expect(load).toHaveBeenCalledTimes(3)
    expect(store.get(account, source).items.map(item => item.memberRef)).toEqual(['a'])
    store.activateAccount(undefined)
  })

  it('coalesces repeated hints and keeps different groups independent', async () => {
    vi.useFakeTimers()
    const other = { ...source, sourceKey: 'other', sourceRef: 'other-ref' }
    const load = vi.fn(async (ref: string) => result([member(ref)], ref === source.sourceRef ? source : other))
    const store = createStore(load)
    store.subscribe(account, source, vi.fn())
    store.subscribe(account, other, vi.fn())
    await Promise.all([store.ensure(account, source), store.ensure(account, other)])
    for (let index = 0; index < 50; index++) store.invalidate(account, source)
    await vi.advanceTimersByTimeAsync(180)
    expect(load).toHaveBeenCalledTimes(3)
    expect(store.get(account, other).items[0]?.memberRef).toBe('other-ref')
    store.activateAccount(undefined)
  })

  it('only cancels when the last subscriber leaves and fences account switches', async () => {
    const pending = deferred<ArkmeConversationMemberList>()
    let signal!: AbortSignal
    const store = createStore(async (_ref, current) => { signal = current; return pending.promise })
    const first = store.subscribe(account, source, vi.fn())
    const second = store.subscribe(account, source, vi.fn())
    const loading = store.ensure(account, source)
    await Promise.resolve()
    first(); await Promise.resolve()
    expect(signal.aborted).toBe(false)
    second(); await Promise.resolve()
    expect(signal.aborted).toBe(true)
    store.activateAccount('prod:42')
    pending.resolve(result([member('a')]))
    await loading
    expect(store.get('prod:42', source).items).toEqual([])
  })

  it('suspends hidden work and preserves subscriptions across a runtime reset', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async () => result([member('a')]))
    const store = createStore(load)
    store.subscribe(account, source, vi.fn())
    await store.ensure(account, source)
    store.setForeground(false)
    store.invalidate(account, source)
    await vi.advanceTimersByTimeAsync(1000)
    expect(load).toHaveBeenCalledTimes(1)
    store.setForeground(true)
    await vi.advanceTimersByTimeAsync(180)
    expect(load).toHaveBeenCalledTimes(2)
    store.reset()
    expect(store.get(account, source).ready).toBe(false)
    await vi.advanceTimersByTimeAsync(180)
    expect(load).toHaveBeenCalledTimes(3)
    expect(store.get(account, source).ready).toBe(true)
    store.activateAccount(undefined)
  })

  it('evicts idle groups without disturbing an observed group', async () => {
    const load = vi.fn(async (ref: string) => result([], { ...source, sourceKey: ref, sourceRef: ref }))
    const store = createStore(load)
    for (let index = 0; index < 25; index++) {
      const group = { ...source, sourceKey: String(index), sourceRef: String(index) }
      const release = store.subscribe(account, group, vi.fn())
      await store.ensure(account, group)
      if (index !== 0) release()
    }
    await Promise.resolve()
    expect(store.get(account, { sourceRef: '0', sourceKey: '0' }).ready).toBe(true)
    expect(store.get(account, { sourceRef: '1', sourceKey: '1' }).ready).toBe(false)
    store.activateAccount(undefined)
  })
})
