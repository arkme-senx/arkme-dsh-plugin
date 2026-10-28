import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem, ArkmeSourceList } from '../src/types.js'
import { callArkme } from '../src/client/api.js'
import { createSelfTopic } from '../src/client/create-self-topic.js'
import { SelfTopicDirectoryCache } from '../src/client/self-topic-directory-cache.js'
import { buildArkmeSourceTree, sortArkmeSourceTree } from '../src/client/source-tree.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const topic = (id: string, order = 0, parent?: string): ArkmeSourceItem => ({
  sourceRef: id, topicHierarchyKey: id, kind: 'topic', displayName: id,
  activeAtMillis: 0, unreadCount: 0, siblingOrder: order,
  ...(parent ? { parentSourceRef: parent, parentTopicHierarchyKey: parent } : {}),
})
const roots: ArkmeSourceItem[] = [
  { sourceRef: 'self', kind: 'send_to_self', displayName: '全部' },
  { sourceRef: 'default', kind: 'default_category', displayName: '未分类' },
]
const order = (items: readonly ArkmeSourceItem[], parent?: string) => sortArkmeSourceTree(
  buildArkmeSourceTree(items.filter(item => item.kind === 'topic' && item.parentSourceRef === parent)
    .map(item => { const { parentSourceRef, parentTopicHierarchyKey, ...root } = item; return root })), 'custom',
).map(node => node.source.sourceRef)
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const caches: SelfTopicDirectoryCache[] = []
function directory(items?: ArkmeSourceItem[]) {
  const read = vi.fn<() => Promise<ArkmeSourceList>>(async () => ({ directory: 'send_to_self', items: [...roots, ...(items ?? [])], hasMore: false }))
  const cache = new SelfTopicDirectoryCache(42, 'prod', read, () => items ? {
    version: 1, userId: 42, directory: 'root', updatedAtMillis: Date.now(), sources: { send_to_self: [...roots, ...items] },
    selfTopics: { environment: 'prod', complete: true, refreshedAtMillis: Date.now() },
  } : undefined, () => {})
  caches.push(cache)
  return { cache, read }
}
beforeEach(() => { vi.mocked(callArkme).mockReset() })
afterEach(() => { for (const cache of caches.splice(0)) cache.dispose() })

describe('creating a self topic without reloading the directory', () => {
  it.each([false, true])('keeps a late child hidden while its parent archive is pending (partial=%s)', async partial => {
    const parent = topic('parent'), child = topic('child', 0, 'parent')
    const { cache, read } = directory([parent])
    const creation = deferred<{ source: ArkmeSourceItem; warning?: string }>()
    const background = deferred<ArkmeSourceList>()
    read.mockReturnValue(background.promise)
    vi.mocked(callArkme).mockReturnValueOnce(creation.promise)
      .mockResolvedValueOnce({ sourceRef: 'child', siblingOrder: 1024 })
    const pending = createSelfTopic({ title: 'child', parentSourceRef: 'parent' }, cache)
    const settle = cache.beginArchive(parent)!
    creation.resolve({ source: child, ...(partial ? { warning: '部分完成' } : {}) })
    await pending
    expect(cache.getSnapshot().sources).toEqual(roots)
    expect(read).toHaveBeenCalledOnce()
    // A read taken before the archive commits cannot undo the pending removal.
    background.resolve({ items: [...roots, parent, child], hasMore: false })
    await cache.ensure()
    expect(cache.getSnapshot().sources).toEqual(roots)
    settle(false)
    expect(cache.getSnapshot().sources.map(item => item.sourceRef)).toEqual(['self', 'default', 'parent', 'child'])
    expect(vi.mocked(callArkme).mock.calls.filter(([op]) => op === 'topic.create')).toHaveLength(1)
  })

  it('does not block a warm creation on an older read and reconciles its stale result afterward', async () => {
    const { cache, read } = directory([topic('old', 1024)])
    const old = deferred<ArkmeSourceList>()
    read.mockReturnValueOnce(old.promise).mockResolvedValue({ items: [...roots, topic('old', 2048), topic('new', 1024)], hasMore: false })
    const pending = cache.ensure(true)
    vi.mocked(callArkme).mockResolvedValueOnce({ source: topic('new') }).mockResolvedValueOnce({ sourceRef: 'new', siblingOrder: 1024 })
    const result = await createSelfTopic({ title: 'new' }, cache)
    expect(order(result.sources!)).toEqual(['new', 'old'])
    expect(read).toHaveBeenCalledOnce()
    old.resolve({ items: [...roots, topic('old', 1024)], hasMore: false })
    await pending
    await cache.ensure()
    expect(read).toHaveBeenCalledTimes(2)
    expect(order(cache.getSnapshot().sources)).toEqual(['new', 'old'])
    expect(cache.getSnapshot().sources.find(item => item.sourceRef === 'old')?.siblingOrder).toBe(2048)
  })
  it.each([undefined, 'parent'])('uses the warm directory and returns before background reconciliation (parent=%s)', async parent => {
    const oldFirst = topic('Z manually first', 1024, parent)
    const oldSecond = topic('A manually second', 2048, parent)
    const created = topic('new', 0, parent)
    const parentSources = parent ? [topic(parent)] : []
    const { cache, read } = directory([...parentSources, oldSecond, oldFirst])
    const background = deferred<ArkmeSourceList>()
    read.mockImplementation(() => background.promise)
    vi.mocked(callArkme).mockResolvedValueOnce({ source: created })
      .mockResolvedValueOnce({ sourceRef: 'new', siblingOrder: 1024 })
    const result = await createSelfTopic({ title: 'new', ...(parent ? { parentSourceRef: parent } : {}) }, cache)
    expect(callArkme).toHaveBeenNthCalledWith(2, 'topic.hierarchy.move', {
      sourceRef: 'new', insertBeforeSourceRef: oldFirst.sourceRef,
      ...(parent ? { currentParentSourceRef: parent, nextParentSourceRef: parent } : {}),
    }, expect.any(AbortSignal))
    expect(result.warning).toBeUndefined()
    expect(order(result.sources!, parent)).toEqual(['new', 'Z manually first', 'A manually second'])
    expect(read).toHaveBeenCalledOnce()
    expect(cache.getSnapshot()).toMatchObject({ complete: true, loading: true })
    background.resolve({ items: [...roots, ...parentSources, { ...created, siblingOrder: 1024 },
      { ...oldFirst, siblingOrder: 2048 }, { ...oldSecond, siblingOrder: 3072 }], hasMore: false })
    await cache.ensure()
    expect(cache.getSnapshot().sources.find(item => item.sourceRef === oldFirst.sourceRef)?.siblingOrder).toBe(2048)
    expect(order(cache.getSnapshot().sources, parent)).toEqual(['new', 'Z manually first', 'A manually second'])
  })

  it('shares a cold paginated directory read before creating and never uses an incomplete anchor', async () => {
    const { cache, read } = directory()
    read.mockResolvedValueOnce({ items: [...roots, topic('A', 2048)], hasMore: true, nextCursor: 'last' } as ArkmeSourceList)
      .mockResolvedValueOnce({ items: [topic('Z', 1024)], hasMore: false })
    const initial = cache.ensure()
    vi.mocked(callArkme).mockResolvedValueOnce({ source: topic('new') }).mockResolvedValueOnce({ sourceRef: 'new', siblingOrder: 1024 })
    await createSelfTopic({ title: 'new' }, cache); await initial
    expect(read).toHaveBeenCalledTimes(3) // two shared initial pages, one background read
    expect(callArkme).toHaveBeenCalledWith('topic.hierarchy.move', { sourceRef: 'new', insertBeforeSourceRef: 'Z' }, expect.any(AbortSignal))
  })

  it('keeps consecutive creations first with one background read per completed mutation', async () => {
    let items = [topic('Z old', 1024), topic('A old', 2048)]
    const { cache, read } = directory(items)
    read.mockImplementation(async () => ({ items: [...roots, ...structuredClone(items)], hasMore: false }))
    vi.mocked(callArkme).mockImplementation(async (op, params) => {
      if (op === 'topic.create') {
        const created = topic(String(params!.title)); items.push(created); return { source: created }
      }
      const created = items.find(item => item.sourceRef === params!.sourceRef)!
      items = [created, ...items.filter(item => item !== created)].map((item, index) => ({ ...item, siblingOrder: (index + 1) * 1024 }))
      return { sourceRef: created.sourceRef, siblingOrder: 1024 }
    })
    await createSelfTopic({ title: 'new 1' }, cache); await cache.ensure()
    await createSelfTopic({ title: 'new 2' }, cache); await cache.ensure()
    expect(order(cache.getSnapshot().sources)).toEqual(['new 2', 'new 1', 'Z old', 'A old'])
    expect(read).toHaveBeenCalledTimes(2)
    expect(vi.mocked(callArkme).mock.calls.filter(([op]) => op === 'topic.create')).toHaveLength(2)
  })

  it('ignores system topics as ordering anchors and supports empty siblings', async () => {
    const { cache } = directory([{ ...topic('system'), topicKind: 3 }])
    vi.mocked(callArkme).mockResolvedValueOnce({ source: topic('new') }).mockResolvedValueOnce({ sourceRef: 'new', siblingOrder: 1024 })
    expect((await createSelfTopic({ title: 'new' }, cache)).warning).toBeUndefined()
    expect(callArkme).toHaveBeenLastCalledWith('topic.hierarchy.move', { sourceRef: 'new' }, expect.any(AbortSignal))
  })

  it('retains the new row when background reconciliation fails without repeating the write', async () => {
    const { cache, read } = directory([topic('old', 1024)])
    read.mockRejectedValue(Error('offline'))
    vi.mocked(callArkme).mockResolvedValueOnce({ source: topic('new') }).mockResolvedValueOnce({ sourceRef: 'new', siblingOrder: 1024 })
    expect((await createSelfTopic({ title: 'new' }, cache)).warning).toBeUndefined()
    await cache.ensure()
    expect(order(cache.getSnapshot().sources)).toEqual(['new', 'old'])
    expect(cache.getSnapshot().error).toBe('offline')
    expect(callArkme).toHaveBeenCalledTimes(2)
  })

  it('reports partial creation or failed ordering without offering a blind create retry', async () => {
    const { cache } = directory([])
    vi.mocked(callArkme).mockResolvedValueOnce({ source: topic('new'), warning: '子主题创建未完成' })
    expect((await createSelfTopic({ title: 'new' }, cache)).warning).toBe('子主题创建未完成')
    expect(callArkme).toHaveBeenCalledOnce()
    await cache.ensure()
    vi.mocked(callArkme).mockResolvedValueOnce({ source: topic('new2') }).mockRejectedValueOnce(Error('move failed'))
    expect((await createSelfTopic({ title: 'new2' }, cache)).warning).toContain('主题已创建')
    expect(callArkme).toHaveBeenCalledTimes(3)
  })

  it('does not write from malformed pagination or a missing parent', async () => {
    const { cache, read } = directory()
    read.mockResolvedValue({ items: roots, hasMore: true })
    await expect(createSelfTopic({ title: 'new' }, cache)).rejects.toThrow('主题加载未完成')
    expect(callArkme).not.toHaveBeenCalled()
    const ready = directory([])
    await expect(createSelfTopic({ title: 'new', parentSourceRef: 'gone' }, ready.cache)).rejects.toThrow('父主题已变化')
    expect(callArkme).not.toHaveBeenCalled()
  })

  it('cancels on account disposal and cannot repopulate the old account after late creation', async () => {
    const { cache, read } = directory([])
    const created = deferred<{ source: ArkmeSourceItem }>()
    vi.mocked(callArkme).mockReturnValue(created.promise)
    const pending = createSelfTopic({ title: 'new' }, cache)
    await vi.waitFor(() => expect(callArkme).toHaveBeenCalledOnce())
    cache.dispose(); created.resolve({ source: topic('new') })
    await expect(pending).rejects.toThrow('主题已创建，但操作已取消')
    expect(callArkme).toHaveBeenCalledOnce()
    expect(cache.getSnapshot().sources).toEqual(roots)
    expect(read).not.toHaveBeenCalled()
  })
})
