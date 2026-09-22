// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeDataManagementSettings } from '../src/client/ArkmeDataManagementSettings.js'
import { ArkmeArchiveManagementPanel } from '../src/client/ArkmeArchive.js'
import { ArkmeSourceBreadcrumb } from '../src/client/ArkmeSourceBreadcrumb.js'
import type { ArkmeSourceItem } from '../src/types.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { selfTopicDirectory, resetSelfTopicDirectories } from '../src/client/self-topic-directory-cache.js'
import { useSyncExternalStore } from 'react'

const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
let host: HTMLDivElement
let root: Root
const inherited = { entityType: 'topic', sourceRef: 'child', ownerAvailable: true, selfArchived: false, effectiveArchived: true, revision: 0, inheritedFrom: {sourceRef: 'parent', topicHierarchyKey: 'parent-key'}, displayArchiveAt: 10, privacyLocked: false,
  source: { sourceRef: 'child', kind: 'topic', topicHierarchyKey: 'child-key', displayName: '长主题🌲'.repeat(30), unreadCount: 0, activeAtMillis: 10 } }
const page = { items: [inherited, { ...inherited, sourceRef: 'private', privacyLocked: true, source: { ...inherited.source, sourceRef: 'private', topicHierarchyKey: 'private-key', displayName: '隐私主题' } }], hasMore: false }
const click = async (text: string) => {
  const node = [...document.body.querySelectorAll('button')].find(button => button.textContent === text || button.getAttribute('aria-label') === text)
  expect(node, text).toBeDefined()
  await act(async () => { node!.click() })
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  HTMLElement.prototype.scrollIntoView = vi.fn()
  mock.call.mockReset().mockImplementation(async (operation: string) => operation === 'archives.list' ? page : [{ ...inherited, sourceRef: 'parent', selfArchived: true, revision: 7 }])
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); resetSelfTopicDirectories(); vi.useRealTimers() })

it('immediately removes each clicked subtree and accepts the next archive while both reads are pending', async () => {
  const directory = selfTopicDirectory(42, 'test')
  const a = {sourceRef: 'a', topicHierarchyKey: 'a', kind: 'topic' as const, displayName: '甲', activeAtMillis: 1, unreadCount: 0}
  const b = {...a, sourceRef: 'b', topicHierarchyKey: 'b', displayName: '乙'}
  const child = {...a, sourceRef: 'child', topicHierarchyKey: 'child', parentTopicHierarchyKey: 'a', displayName: '甲的子主题'}
  directory.upsert(a); directory.upsert(b); directory.upsert(child)
  mock.call.mockImplementation(() => new Promise(() => {}))
  function Directory() {
    const snapshot = useSyncExternalStore(directory.subscribe, directory.getSnapshot)
    return <ArkmeSourceBreadcrumb userId={42} selectedSource={undefined} sources={snapshot.sources}
      onSelect={vi.fn()} onSelectAggregate={vi.fn()} onRenameTopic={vi.fn()} />
  }
  await act(async () => { root.render(<Directory />) })
  await click('选择主题')
  const menu = host.querySelector('[data-arkme-self-topic-menu]')!
  for (const source of [a, b]) {
    const row = host.querySelector(`[data-arkme-self-topic-tree-row-ref="${source.sourceRef}"]`)!
    await act(async () => { row.dispatchEvent(new MouseEvent('mouseover', {bubbles: true})) })
    await click(`${source.displayName}主题操作`)
    const action = [...document.body.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(button => button.textContent === '归档')!
    expect(action.textContent).toBe('归档')
    expect(action.disabled).toBe(false)
    await click('归档')
    expect(row.isConnected).toBe(false)
    expect(menu.isConnected).toBe(true)
  }
  expect(directory.getSnapshot().sources).toEqual([])
  expect(mock.call.mock.calls.map(call => [call[0], call[1]])).toEqual([
    ['archives.state', {sourceRefs: ['a']}], ['archives.state', {sourceRefs: ['b']}],
  ])
})

it('shows inherited state without a misleading restore, masks private topics and opens by UID reference', async () => {
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  expect(host.querySelector('[data-arkme-archive-management]')?.getAttribute('aria-label')).toBe('已归档主题')
  expect(host.textContent).toContain('随父主题归档')
  expect(host.textContent).not.toContain('取消归档')
  expect([...document.body.querySelectorAll('button')].filter(button => button.getAttribute('aria-label')?.startsWith('打开主题：'))[1]!.disabled).toBe(true)
  await click(`打开主题：${inherited.source.displayName}`)
  expect(arkmeUi.getSnapshot().selectedSource?.sourceRef).toBe('child')
  expect(host.querySelector('[role=dialog]')).toBeNull()
  mock.call.mockImplementation(async (operation: string) => operation === 'archives.set' ? { ...inherited, selfArchived: true, revision: 1, stateChanged: true, effectiveChangedCount: 0 } : page)
  await click('单独归档')
  expect(mock.call).toHaveBeenCalledWith('archives.set', { sourceRef: 'child', selfArchived: true, expectedRevision: 0 }, expect.any(AbortSignal))
})

it('shows the archive source inline and removes only that explicit marker on click', async () => {
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  const row = host.querySelector('li')!
  mock.call.mockResolvedValueOnce({items: [{...inherited, selfArchived: true, sourceRef: 'parent', revision: 7, source: {...inherited.source, displayName: '父主题', topicHierarchyKey: 'parent-key'}}], hasMore: false})
  await click('查看来源')
  expect(host.querySelector('[role=dialog]')).toBeNull()
  expect(host.querySelector('[aria-label=归档来源]')?.textContent).toContain('父主题')
  expect(host.querySelector('[aria-label=归档来源]')?.closest('li')).toBe(row)
  const toggle = row.querySelector<HTMLButtonElement>('[aria-expanded=true]')!
  expect(toggle.getAttribute('aria-controls')).toBe(host.querySelector('[aria-label=归档来源]')!.id)
  expect(mock.call.mock.calls.filter(call => call[0] === 'archives.set')).toHaveLength(0)
  await click('取消来源归档')
  expect(mock.call).toHaveBeenCalledWith('archives.set', { sourceRef: 'parent', selfArchived: false, expectedRevision: 7 }, expect.any(AbortSignal))
})

it('reuses a listed source, moves the expansion to the clicked row and supports collapse without writes', async () => {
  const parent = {...inherited, selfArchived: true, inheritedFrom: undefined, sourceRef: 'parent', revision: 7,
    source: {...inherited.source, sourceRef: 'parent', displayName: '父主题', topicHierarchyKey: 'parent-key'}}
  mock.call.mockResolvedValue({items: [...page.items, parent], hasMore: false})
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  const rows = host.querySelectorAll('li')
  await click('查看来源')
  expect(mock.call).toHaveBeenCalledTimes(1)
  expect(rows[0]!.querySelector('[aria-label=归档来源]')?.textContent).toContain('父主题')
  const secondToggle = [...rows[1]!.querySelectorAll('button')].find(button => button.textContent === '查看来源')!
  await act(async () => { secondToggle.click() })
  expect(rows[0]!.querySelector('[aria-label=归档来源]')).toBeNull()
  expect(rows[1]!.querySelector('[aria-label=归档来源]')).not.toBeNull()
  await click('收起来源')
  expect(host.querySelector('[aria-label=归档来源]')).toBeNull()
  expect(mock.call).toHaveBeenCalledTimes(1)
})

it('keeps source loading local and cancels a collapsed lookup without accepting its late result', async () => {
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  let reply: (value: unknown) => void = () => {}
  mock.call.mockImplementationOnce(() => new Promise(resolve => { reply = resolve }))
  await click('查看来源')
  const signal = mock.call.mock.calls.at(-1)![2] as AbortSignal
  expect(host.querySelector('[role=status]')?.closest('li')).toBe(host.querySelector('li'))
  await click('收起来源')
  expect(signal.aborted).toBe(true)
  await act(async () => { reply({items: [{...inherited, source: {...inherited.source, displayName: '迟到来源', topicHierarchyKey: 'parent-key'}}], hasMore: false}) })
  expect(host.querySelector('[aria-label=归档来源]')).toBeNull()
  expect(host.textContent).not.toContain('迟到来源')
})

it('retries a source lookup inside its row and never exposes a private source title', async () => {
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  mock.call.mockRejectedValueOnce(new Error('private backend details'))
  await click('查看来源')
  expect(host.querySelector('[role=alert]')?.closest('li')).toBe(host.querySelector('li'))
  expect(host.textContent).not.toContain('private backend details')
  mock.call.mockResolvedValueOnce({items: [{...inherited, privacyLocked: true, selfArchived: true, sourceRef: 'parent',
    source: {...inherited.source, displayName: '不得泄露的父主题名', topicHierarchyKey: 'parent-key'}}], hasMore: false})
  await click('重试')
  const region = host.querySelector('[aria-label=归档来源]')!
  expect(region.textContent).toContain('隐私主题')
  expect(region.textContent).not.toContain('不得泄露')
  expect(region.querySelector<HTMLButtonElement>('.arkme-archive-source-name')!.disabled).toBe(true)
})

it('discards a delayed response after account change and refreshes on foreground recovery', async () => {
  let finish: (value: unknown) => void = () => {}
  mock.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  mock.call.mockResolvedValue({ items: [], hasMore: false })
  await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 99 }) })
  await act(async () => { finish(page) })
  expect(host.textContent).not.toContain('长主题')
  expect(host.querySelector('[aria-label=暂无已归档主题]')).not.toBeNull()
  expect(host.textContent).not.toContain('暂无已归档主题')
  const count = mock.call.mock.calls.length
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(mock.call.mock.calls.length).toBeGreaterThan(count)
})

it('keeps a failed write reviewable and never silently retries with a newer revision', async () => {
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  mock.call.mockRejectedValue(new Error('ARCHIVE_REVISION_CONFLICT'))
  await click('单独归档')
  expect(mock.call.mock.calls.filter(call => call[0] === 'archives.set')).toHaveLength(1)
  expect(host.textContent).toContain('归档未完成，请稍后重试')
  expect(host.textContent).not.toContain('ARCHIVE_REVISION_CONFLICT')
  expect(host.querySelector('[role=dialog]')).toBeNull()
})

it('keeps a direct write alive when a record notification beats its reply', async () => {
  let reply: (value: unknown) => void = () => {}
  mock.call.mockImplementation(async (operation: string) => operation === 'archives.set'
    ? new Promise(resolve => { reply = resolve }) : page)
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  await click('单独归档')
  const signal = mock.call.mock.calls.find(call => call[0] === 'archives.set')![2] as AbortSignal
  await act(async () => { arkmeUi.recordChanged() })
  expect(signal.aborted).toBe(false)
  expect(host.querySelector('[role=dialog]')).toBeNull()
  await act(async () => { reply({...inherited, selfArchived: true, revision: 1, stateChanged: true, effectiveChangedCount: 0}) })
  expect(host.querySelector('[role=dialog]')).toBeNull()
})

it('deduplicates paginated entries by stable topic identity when a title changes', async () => {
  mock.call.mockResolvedValueOnce({items: [inherited], hasMore: true, nextCursor: 'page-2'})
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  mock.call.mockResolvedValueOnce({items: [{...inherited, sourceRef: 'renamed-ref',
    source: {...inherited.source, sourceRef: 'renamed-ref', displayName: '重命名后'}}], hasMore: false})
  await click('加载更多')
  expect(host.querySelectorAll('li')).toHaveLength(1)
  expect(host.textContent).toContain('重命名后')
})

it('keeps pagination and source lookup independent and reuses an ancestor arriving in the next page', async () => {
  mock.call.mockResolvedValueOnce({items: [inherited], hasMore: true, nextCursor: 'next'})
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  let pageReply: (value: unknown) => void = () => {}
  let sourceReply: (value: unknown) => void = () => {}
  mock.call.mockImplementationOnce(() => new Promise(resolve => { pageReply = resolve }))
  await click('加载更多')
  const pageSignal = mock.call.mock.calls.at(-1)![2] as AbortSignal
  const origin = [...document.body.querySelectorAll('button')].find(node => node.textContent === '查看来源')!
  expect(origin.disabled).toBe(false)
  mock.call.mockImplementationOnce(() => new Promise(resolve => { sourceReply = resolve }))
  await click('查看来源')
  const sourceSignal = mock.call.mock.calls.at(-1)![2] as AbortSignal
  expect(pageSignal.aborted).toBe(false)
  expect(origin.disabled).toBe(false)
  expect(host.querySelectorAll('[role=status]')).toHaveLength(2)
  await act(async () => { pageReply({items: [{...inherited, selfArchived: true, sourceRef: 'parent', inheritedFrom: undefined,
    source: {...inherited.source, displayName: '分页中的父主题', topicHierarchyKey: 'parent-key'}}], hasMore: false}) })
  expect(sourceSignal.aborted).toBe(true)
  await act(async () => { sourceReply({items: [], hasMore: false}) })
  expect(host.querySelector('[role=status]')).toBeNull()
  expect(host.querySelector('[aria-label=归档来源]')?.textContent).toContain('分页中的父主题')
  expect(host.querySelector('[role=dialog]')).toBeNull()
})

it('keeps a direct menu write and captured revision after its archived directory row disappears', async () => {
  const source: ArkmeSourceItem = {sourceRef: 'topic', kind: 'topic', topicHierarchyKey: 'topic-key', displayName: '主题', unreadCount: 0, activeAtMillis: 1}
  const state = {...inherited, sourceRef: source.sourceRef, selfArchived: false, effectiveArchived: false, revision: 3}
  let reply: (value: unknown) => void = () => {}
  mock.call.mockImplementation(async (operation: string) => operation === 'archives.set'
    ? new Promise(resolve => { reply = resolve }) : [state])
  const render = async (sources: ArkmeSourceItem[]) => {
    await act(async () => { root.render(<ArkmeSourceBreadcrumb userId={42} selectedSource={source}
      sources={sources} onSelect={vi.fn()} onSelectAggregate={vi.fn()} onRenameTopic={vi.fn()} />) })
  }
  await render([source])
  await click('选择主题')
  const row = host.querySelector('[data-arkme-self-topic-tree-row]')!
  await act(async () => { row.dispatchEvent(new MouseEvent('mouseover', {bubbles: true})) })
  await act(async () => { document.body.querySelector<HTMLButtonElement>('[aria-label="主题主题操作"]')!.click() })
  await click('归档')
  expect(host.querySelector('[role=dialog]')).toBeNull()
  const write = mock.call.mock.calls.find(call => call[0] === 'archives.set')!
  await render([])
  await act(async () => { arkmeUi.recordChanged() })
  expect((write[2] as AbortSignal).aborted).toBe(false)
  expect(host.querySelector('[role=dialog]')).toBeNull()
  expect(write[1]).toEqual({sourceRef: 'topic', selfArchived: true, expectedRevision: 3})
  await act(async () => { reply({...state, selfArchived: true, effectiveArchived: true, revision: 4, stateChanged: true, effectiveChangedCount: 1}) })
  expect(host.querySelector('[role=dialog]')).toBeNull()
})


const directorySource: ArkmeSourceItem = {sourceRef: 'topic', kind: 'topic', displayName: '主题', activeAtMillis: 1, unreadCount: 0}
async function openDirectoryArchive(key = 'initial') {
  await act(async () => { root.render(<ArkmeSourceBreadcrumb key={key} userId={42} selectedSource={undefined}
    sources={[directorySource]} onSelect={vi.fn()} onSelectAggregate={vi.fn()} onRenameTopic={vi.fn()} />) })
  await click('选择主题')
  const row = host.querySelector('[data-arkme-self-topic-tree-row]')!
  await act(async () => { row.dispatchEvent(new MouseEvent('mouseover', {bubbles: true})) })
  await click('主题主题操作')
  return [...document.body.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(button => button.textContent === '归档')!
}

it('opens a ready Archive action without a state read, including a fresh mount after refresh', async () => {
  for (const key of ['initial', 'after-refresh']) {
    const action = await openDirectoryArchive(key)
    expect(action.disabled).toBe(false)
    expect(action.textContent).toBe('归档')
    await act(async () => { window.dispatchEvent(new Event('focus')); arkmeUi.topicDirectoryChanged() })
    expect(mock.call).not.toHaveBeenCalled()
  }
})

it('reads the precondition only after click and keeps one operation alive after the menu closes', async () => {
  let reply: (value: unknown) => void = () => {}
  mock.call.mockImplementation((operation: string) => operation === 'archives.state'
    ? new Promise(resolve => { reply = resolve }) : new Promise(() => {}))
  const action = await openDirectoryArchive()
  await act(async () => { action.click() })
  expect(mock.call.mock.calls.map(call => call[0])).toEqual(['archives.state'])
  const signal = mock.call.mock.calls[0]![2] as AbortSignal
  await click('主题主题操作')
  const duplicate = [...document.body.querySelectorAll('button')].find(button => button.textContent === '归档')!
  expect(duplicate.disabled).toBe(true)
  await act(async () => { duplicate.click(); arkmeUi.topicDirectoryChanged() })
  expect(signal.aborted).toBe(false)
  expect(mock.call.mock.calls.filter(call => call[0] === 'archives.state')).toHaveLength(1)
  expect(mock.call.mock.calls.some(call => call[0] === 'archives.set')).toBe(false)
  await act(async () => { reply([{...inherited, sourceRef: 'topic', effectiveArchived: false, revision: 7}]) })
  expect(mock.call).toHaveBeenCalledWith('archives.set',
    {sourceRef: 'topic', selfArchived: true, expectedRevision: 7}, signal)
})

it.each([false, true])('keeps Archive intent when a stale row is already archived (self=%s)', async selfArchived => {
  mock.call.mockImplementation(async (operation: string) => operation === 'archives.state'
    ? [{...inherited, sourceRef: 'topic', selfArchived, revision: 9}] : {})
  const action = await openDirectoryArchive()
  expect(action.textContent).toBe('归档')
  await act(async () => { action.click() })
  expect(mock.call).toHaveBeenCalledWith('archives.set',
    {sourceRef: 'topic', selfArchived: true, expectedRevision: 9}, expect.any(AbortSignal))
})

it.each(['read-failure', 'unavailable', 'missing', 'wrong-source'])('does not write after an invalid precondition read: %s', async failure => {
  mock.call.mockImplementation(async () => {
    if (failure === 'read-failure') throw new Error('offline')
    if (failure === 'missing') return []
    return [{...inherited, sourceRef: failure === 'wrong-source' ? 'other' : 'topic', ownerAvailable: failure !== 'unavailable'}]
  })
  const action = await openDirectoryArchive()
  await act(async () => { action.click() })
  expect(mock.call.mock.calls.map(call => call[0])).toEqual(['archives.state'])
  expect(host.textContent).toContain('归档未完成，请稍后重试')
})

it.each(['archives.state', 'archives.set'])('restores the optimistic row after a bounded %s failure without replaying', async stalled => {
  vi.useFakeTimers()
  const directory = selfTopicDirectory(42, 'test')
  directory.upsert(directorySource)
  mock.call.mockImplementation((operation: string) => operation === stalled ? new Promise(() => {})
    : Promise.resolve([{...inherited, sourceRef: directorySource.sourceRef, revision: 7}]))
  const action = await openDirectoryArchive()
  await act(async () => { action.click() })
  expect(directory.getSnapshot().sources).toEqual([])
  const before = mock.call.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(directory.getSnapshot().sources).toEqual([directorySource])
  expect(host.textContent).toContain('归档未完成，请稍后重试')
  expect(mock.call).toHaveBeenCalledTimes(before)
  expect((mock.call.mock.calls[0]![2] as AbortSignal).aborted).toBe(true)
})

it('reports a conflict without re-reading and replaying the Archive command', async () => {
  mock.call.mockImplementation(async (operation: string) => {
    if (operation === 'archives.state') return [{...inherited, sourceRef: 'topic', revision: 11}]
    throw new Error('ARCHIVE_REVISION_CONFLICT')
  })
  const action = await openDirectoryArchive()
  await act(async () => { action.click() })
  expect(mock.call.mock.calls.map(call => call[0])).toEqual(['archives.state', 'archives.set'])
  expect(host.textContent).toContain('归档未完成，请稍后重试')
})

it.each(['account', 'environment'])('rejects a late precondition reply after changing %s', async change => {
  let reply: (value: unknown) => void = () => {}
  mock.call.mockImplementation(() => new Promise(resolve => { reply = resolve }))
  const action = await openDirectoryArchive()
  await act(async () => { action.click() })
  const signal = mock.call.mock.calls[0]![2] as AbortSignal
  await act(async () => { arkmeAuthStore.setAuth({status: 'authenticated', environment: change === 'environment' ? 'production' : 'test', userId: change === 'account' ? 99 : 42}) })
  const revision = arkmeUi.getTopicDirectoryRevision()
  await act(async () => { reply([{...inherited, sourceRef: 'topic', revision: 7}]) })
  expect(signal.aborted).toBe(true)
  expect(mock.call.mock.calls.map(call => call[0])).toEqual(['archives.state'])
  expect(arkmeUi.getTopicDirectoryRevision()).toBe(revision)
  expect(host.querySelector('[role=alert]')).toBeNull()
})

it('prevents repeated clicks from duplicating a pending write', async () => {
  mock.call.mockImplementation(async (operation: string) => operation === 'archives.set' ? new Promise(() => {}) : page)
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  await click('单独归档')
  await click('单独归档')
  expect(mock.call.mock.calls.filter(call => call[0] === 'archives.set')).toHaveLength(1)
})

it('aborts writes and clears previous items when the same user switches environment', async () => {
  let reply: (value: unknown) => void = () => {}
  mock.call.mockImplementation(async (operation: string) => operation === 'archives.set'
    ? new Promise(resolve => { reply = resolve }) : page)
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  await click('单独归档')
  const signal = mock.call.mock.calls.find(call => call[0] === 'archives.set')![2] as AbortSignal
  mock.call.mockImplementation(() => new Promise(() => {}))
  await act(async () => { arkmeAuthStore.setAuth({status: 'authenticated', environment: 'production', userId: 42}) })
  expect(signal.aborted).toBe(true)
  expect(host.textContent).not.toContain('长主题')
  const revision = arkmeUi.getTopicDirectoryRevision()
  await act(async () => { reply({...inherited, selfArchived: true}) })
  expect(arkmeUi.getTopicDirectoryRevision()).toBe(revision)
  expect(host.querySelector('[role=alert]')).toBeNull()
})

it('adds archives to the existing data management without replacing its other entries', async () => {
  const close = vi.fn()
  await act(async () => { root.render(<ArkmeDataManagementSettings close={close} />) })
  for (const title of ['已归档主题', '最近删除', '导入数据', '导出数据']) expect(host.textContent).toContain(title)
  expect(mock.call).not.toHaveBeenCalled()
  await click('已归档主题')
  expect(host.querySelectorAll('h2')).toHaveLength(1)
  expect(host.querySelector('h2')?.textContent).toBe('已归档主题')
  expect(mock.call.mock.calls.map(call => call[0])).toEqual(['archives.list'])
  await click(`打开主题：${inherited.source.displayName}`)
  expect(close).toHaveBeenCalledOnce()
  await click('‹ 数据管理')
  await click('导入数据')
  expect(host.querySelector('a')?.getAttribute('href')).toBe('https://jiwo.cc/import')
  await click('‹ 数据管理')
  mock.call.mockResolvedValue({items: [], mayHaveMore: false, unverifiedCount: 0, accountScope: 'test:42'})
  await click('最近删除')
  expect(mock.call).toHaveBeenLastCalledWith('data.deleted', {expectedAccountScope: 'test:42'}, expect.any(AbortSignal))
  expect(host.querySelector('[data-arkme-archive-management]')).toBeNull()
})

it('does not mount a status read in a hidden topic picker trigger', async () => {
  await act(async () => { root.render(<ArkmeSourceBreadcrumb userId={42} selectedSource={directorySource}
    trigger="none" sources={[directorySource]} onSelect={vi.fn()} onSelectAggregate={vi.fn()} />) })
  expect(mock.call).not.toHaveBeenCalled()
})
