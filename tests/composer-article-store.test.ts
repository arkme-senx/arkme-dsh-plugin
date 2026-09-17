// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { ComposerArticleStore, composerArticleKey, type ComposerArticle } from '../src/client/composer-article-store.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
const existing = { kind: 'existing', detail: { sourceRef: 'self-42', itemUid: 'article-1', title: '标题', textContent: '全文' }, messageActionRef: 'signed' } as ComposerArticle
beforeEach(() => { localStorage.clear(); mock.call.mockReset(); arkmeAuthStore.setAuth({ status: 'authenticated', userId: 42, environment: 'prod' }) })
it('isolates account and conversation; selecting/removing never sends', () => {
  const store = new ComposerArticleStore(), key = composerArticleKey('prod:42', 'chat-1')!
  store.set(key, existing)
  expect(store.get(composerArticleKey('prod:43', 'chat-1'))).toBeUndefined()
  expect(store.get(composerArticleKey('prod:42', 'chat-2'))).toBeUndefined()
  store.remove(key); expect(store.get(key)).toBeUndefined(); expect(mock.call).not.toHaveBeenCalled()
})
it('deduplicates clicks, preserves retry identity across refresh, and uses canonical forward', async () => {
  const store = new ComposerArticleStore(); store.set('key', existing)
  let reject!: (error: Error) => void
  mock.call.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  const sent = store.send('key', 'chat-target', 42, 'prod')
  expect(store.get('key')?.sending).toBe(true)
  await store.send('key', 'chat-target', 42, 'prod'); expect(mock.call).toHaveBeenCalledTimes(1)
  store.set('key', existing); store.remove('key'); expect(store.get('key')?.sending).toBe(true)
  reject(new Error('结果待确认')); await sent
  const first = mock.call.mock.calls[0]![1]
  expect(store.get('key')?.error).toBe('结果待确认')
  const restored = new ComposerArticleStore(); mock.call.mockResolvedValueOnce({ itemUid: 'forwarded' })
  await restored.send('key', 'chat-target', 42, 'prod')
  expect(mock.call.mock.calls[1]).toEqual(mock.call.mock.calls[0]); expect(restored.get('key')).toBeUndefined()
  expect(first.targetSourceRef).toBe('chat-target'); expect(first.actionRefs).toEqual(['signed'])
})
it('blocks stale account sends and does not expose completion to another account', async () => {
  const store = new ComposerArticleStore(); store.set('key', existing)
  expect(await store.send('key', 'chat', 43, 'prod')).toBeUndefined(); expect(mock.call).not.toHaveBeenCalled()
  let finish!: (value: unknown) => void
  mock.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = store.send('key', 'chat', 42, 'prod')
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 43, environment: 'prod' })
  finish({ itemUid: 'sent' }); expect(await pending).toBeUndefined()
})
it('publishes new drafts only on send with stable IDs and conditionally clears only that editor draft', async () => {
  const store = new ComposerArticleStore()
  store.set('key', { kind: 'new', draft: { sourceRef: 'chat', title: '新文章', textContent: '正文', recordUid: 'record-123', relationUid: 'relation-123', durationMillis: 12, updatedAtMillis: 1 } })
  expect(mock.call).not.toHaveBeenCalled()
  mock.call.mockResolvedValueOnce({ itemUid: 'record-123' }).mockResolvedValueOnce(undefined)
  await store.send('key', 'chat', 42, 'prod')
  expect(mock.call.mock.calls[0]![0]).toBe('source.long-article.publish')
  expect(mock.call.mock.calls[0]![1]).toMatchObject({ recordUid: 'record-123', relationUid: 'relation-123', expectedUserId: 42 })
  expect(mock.call.mock.calls[1]).toEqual(['source.long-article.draft.delete', { sourceRef: 'chat', expectedRecordUid: 'record-123' }])
})
it('settles an in-flight article after another window replays a cloned snapshot', async () => {
 const store = new ComposerArticleStore(); store.set('key',existing)
 let resolve!: (value: unknown) => void
 mock.call.mockImplementationOnce(() => new Promise(done => {resolve=done}))
 const sending = store.send('key','chat-target',42,'prod')
 store.applyRemote('key',structuredClone(store.get('key')))
 resolve({itemUid:'sent',localState:'synced'}); await sending
 expect(store.get('key')).toBeUndefined()
})
it('restores retry state after a replayed article submission fails', async () => {
 const store = new ComposerArticleStore(); store.set('key',existing)
 let reject!: (reason: Error) => void
 mock.call.mockImplementationOnce(() => new Promise((_done,fail) => {reject=fail}))
 const sending = store.send('key','chat-target',42,'prod')
 const identity=store.get('key')!.recordUid
 store.applyRemote('key',structuredClone(store.get('key')))
 reject(new Error('offline')); await sending
 expect(store.get('key')).toMatchObject({sending:false,error:'offline',recordUid:identity})
})
