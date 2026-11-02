import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
import { ArkoReplyHistoryRegistry, arkoReplyHistory, readArkoReplyHistory } from '../src/client/arko-reply-history.js'
import type { ArkmeSourceItem } from '../src/types.js'
const source = { kind: 'group_chat', sourceRef: 'signed-source', sourceKey: 'opaque-key', displayName: '讨论群' } as ArkmeSourceItem
const item = { itemUid: 'note', sendAtMillis: 1, isMe: true, version: 1, messageActionRef: 'signed-action', timelineItemKey: 'opaque-item' }
const thought = { id: 'one', recordUid: 'note', biz: 2 as const, content: '本人想法', scene: 3 as const, visibility: 'user' as const, status: 'ready' as const }
beforeEach(() => { mock.call.mockReset(); arkoReplyHistory.activate(undefined) })
it('separates audiences and clears already-read previews when versions or accounts change', () => {
  const index = new ArkoReplyHistoryRegistry()
  index.observe('prod:1', source, item, [thought, { ...thought, id: 'two', scene: 2, visibility: 'members', content: '公开回答' }])
  expect(index.list('prod:1').map(row => row.scene)).toEqual(['group_private_followup', 'group_mention'])
  index.observeItem('prod:1', source, { ...item, version: 2 }); expect(index.list('prod:1')).toEqual([])
  index.observe('prod:1', source, item, [thought]); index.activate('prod:2')
  expect(index.list('prod:1')).toEqual([]); expect(index.list('prod:2')).toEqual([])
})
it('never exposes cached text until the owner confirms the same account, relation and ready scene', async () => {
  arkoReplyHistory.observe('prod:1', source, item, [thought])
  mock.call.mockResolvedValue({ accountScope: 'prod:1', items: [] })
  const result = await readArkoReplyHistory('prod:1', 'all', 0, new AbortController().signal)
  expect(result.items).toEqual([])
  expect(mock.call).toHaveBeenCalledWith('chat.thoughts.query', { expectedAccountScope: 'prod:1', sourceRef: 'signed-source', messageActionRefs: ['signed-action'] }, expect.any(AbortSignal), { priority: 'background' })
  arkoReplyHistory.observe('prod:1', source, item, [thought]); mock.call.mockResolvedValue({ accountScope: 'prod:2', items: [thought] })
  expect((await readArkoReplyHistory('prod:1', 'all', 0, new AbortController().signal)).items).toEqual([])
})
it('revalidates ready results and omits denied sources without falling back to cached content', async () => {
  arkoReplyHistory.observe('prod:1', source, item, [thought])
  mock.call.mockResolvedValue({ accountScope: 'prod:1', items: [{ ...thought, content: '当前有效内容' }] })
  expect((await readArkoReplyHistory('prod:1', 'all', 0, new AbortController().signal)).items[0]?.thought.content).toBe('当前有效内容')
  mock.call.mockRejectedValue(Error('not a member'))
  expect(await readArkoReplyHistory('prod:1', 'all', 0, new AbortController().signal)).toMatchObject({ items: [], failedSources: 1 })
})
it('keeps pagination complete even when first-page denied results are removed from the index', async () => {
  for (let i = 0; i < 60; i++) arkoReplyHistory.observe('prod:1', source, { ...item, itemUid: String(i), sendAtMillis: i }, [{ ...thought, id: String(i), recordUid: String(i) }])
  const snapshot = arkoReplyHistory.list('prod:1'), signal = new AbortController().signal
  mock.call.mockResolvedValue({ accountScope: 'prod:1', items: [] })
  expect(await readArkoReplyHistory('prod:1', 'all', 0, signal, snapshot)).toMatchObject({ hasMore: true, nextOffset: 50 })
  expect(await readArkoReplyHistory('prod:1', 'all', 50, signal, snapshot)).toMatchObject({ hasMore: false, nextOffset: 60 })
  expect(mock.call.mock.calls[1]?.[1].messageActionRefs).toEqual(['signed-action'])
})
