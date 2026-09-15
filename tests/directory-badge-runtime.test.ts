import { afterEach, expect, it, vi } from 'vitest'
import { arkmeChatDirectory as store } from '../src/client/chat-directory-store.js'
import { startArkmeDirectoryBadge } from '../src/client/directory-badge-runtime.js'

let stop: (() => void) | undefined
afterEach(() => { stop?.(); stop = undefined; store.activateAccount(undefined) })
const tick = async () => { await Promise.resolve(); await Promise.resolve() }

it('projects the visible row total to native across optimistic reads, stale Host pages, rollback and hidden rows', async () => {
  store.activateAccount('test:one')
  const source = { sourceRef: 'group', sourceKey: 'group', kind: 'group_chat' as const,
    displayName: '测试测试再测试', activeAtMillis: 1, unreadCount: 1, latestSequence: 522 }
  const other = { ...source, sourceRef: 'other', sourceKey: 'other', unreadCount: 3 }
  store.publish([source, other])
  store.hydrateVisibility([source, other].map(row => ({ entryKind: 'source', entryRef: row.sourceRef, hidden: false })))
  const apply = vi.fn(async () => true)
  stop = startArkmeDirectoryBadge(apply, 'test:one')
  await tick()
  expect(apply).toHaveBeenLastCalledWith(4)
  store.markReadOptimistic(source, source.sourceKey, 522)
  await tick()
  expect(store.getConversationSnapshot().sources[0]?.unreadCount).toBe(0)
  expect(store.getConversationSnapshot().badgeCount).toBe(3)
  expect(apply).toHaveBeenLastCalledWith(3)
  store.upsert(source)
  await tick()
  expect(apply).toHaveBeenLastCalledWith(3)
  store.rejectOptimisticRead(source.sourceRef, source.sourceKey, 522)
  await tick()
  expect(apply).toHaveBeenLastCalledWith(4)
  store.confirmVisibility('source', source.sourceRef, true)
  await tick()
  expect(apply).toHaveBeenLastCalledWith(3)
  store.activateAccount('prod:other')
  await tick()
  expect(apply).toHaveBeenLastCalledWith(0)
})

it('coalesces in-flight updates, retries failure on a new snapshot, and stops after disposal', async () => {
  store.activateAccount('test:one')
  let resolve!: (success: boolean) => void
  const apply = vi.fn<(_: number) => Promise<boolean>>().mockImplementationOnce(() => new Promise(done => { resolve = done }))
    .mockResolvedValue(true)
  stop = startArkmeDirectoryBadge(apply, 'test:one')
  const source = { sourceRef: 'group', kind: 'group_chat' as const, displayName: '群聊', activeAtMillis: 1, unreadCount: 1 }
  store.publish([source])
  store.hydrateVisibility([{ entryKind: 'source', entryRef: source.sourceRef, hidden: false }])
  store.upsert({ ...source, unreadCount: 2 })
  expect(apply).toHaveBeenCalledTimes(1)
  resolve(true); await tick()
  expect(apply.mock.calls).toEqual([[0], [2]])
  apply.mockResolvedValueOnce(false)
  store.upsert({ ...source, unreadCount: 3 }); await tick()
  store.upsert({ ...source, unreadCount: 3, activeAtMillis: 2 }); await tick()
  expect(apply.mock.calls).toEqual([[0], [2], [3], [3]])
  stop(); store.upsert({ ...source, unreadCount: 9 }); await tick()
  expect(apply).toHaveBeenCalledTimes(4)
})
