// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeArchiveManagementPanel } from '../src/client/ArkmeArchive.js'
import { ArkmeSourceBreadcrumb } from '../src/client/ArkmeSourceBreadcrumb.js'
import type { ArkmeSourceItem } from '../src/types.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
let host: HTMLDivElement
let root: Root
const inherited = { entityType: 'topic', sourceRef: 'child', ownerAvailable: true, selfArchived: false, effectiveArchived: true, revision: 0, inheritedFrom: {sourceRef: 'parent', topicHierarchyKey: 'parent-key'}, displayArchiveAt: 10, privacyLocked: false,
  source: { sourceRef: 'child', kind: 'topic', topicHierarchyKey: 'child-key', displayName: '长主题🌲'.repeat(30), unreadCount: 0, activeAtMillis: 10 } }
const page = { items: [inherited, { ...inherited, sourceRef: 'private', privacyLocked: true, source: { ...inherited.source, sourceRef: 'private', topicHierarchyKey: 'private-key', displayName: '隐私主题' } }], hasMore: false }
const click = async (text: string) => {
  const node = [...host.querySelectorAll('button')].find(button => button.textContent === text || button.getAttribute('aria-label') === text)
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
afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

it('shows inherited state without a misleading restore, masks private topics and opens by UID reference', async () => {
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  expect(host.textContent).toContain('数据管理')
  expect(host.textContent).toContain('随父主题归档')
  expect(host.textContent).not.toContain('取消归档')
  expect([...host.querySelectorAll('button')].filter(button => button.getAttribute('aria-label')?.startsWith('打开主题：'))[1]!.disabled).toBe(true)
  await click(`打开主题：${inherited.source.displayName}`)
  expect(arkmeUi.getSnapshot().selectedSource?.sourceRef).toBe('child')
  expect(host.querySelector('[role=dialog]')).toBeNull()
  mock.call.mockImplementation(async (operation: string) => operation === 'archives.set' ? { ...inherited, selfArchived: true, revision: 1, stateChanged: true, effectiveChangedCount: 0 } : page)
  await click('单独归档')
  expect(mock.call).toHaveBeenCalledWith('archives.set', { sourceRef: 'child', selfArchived: true, expectedRevision: 0 }, expect.any(AbortSignal))
})

it('shows the archive source inline and removes only that explicit marker on click', async () => {
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  mock.call.mockResolvedValueOnce({items: [{...inherited, selfArchived: true, sourceRef: 'parent', revision: 7, source: {...inherited.source, displayName: '父主题', topicHierarchyKey: 'parent-key'}}], hasMore: false})
  await click('查看来源')
  expect(host.querySelector('[role=dialog]')).toBeNull()
  expect(host.querySelector('[aria-label=归档来源]')?.textContent).toContain('父主题')
  expect(mock.call.mock.calls.filter(call => call[0] === 'archives.set')).toHaveLength(0)
  await click('取消该主题归档')
  expect(mock.call).toHaveBeenCalledWith('archives.set', { sourceRef: 'parent', selfArchived: false, expectedRevision: 7 }, expect.any(AbortSignal))
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

it('serializes paginated loading and ancestor lookup without leaving a stuck loading state', async () => {
  mock.call.mockResolvedValueOnce({items: [inherited], hasMore: true, nextCursor: 'next'})
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  let reply: (value: unknown) => void = () => {}
  mock.call.mockImplementationOnce(() => new Promise(resolve => { reply = resolve }))
  await click('加载更多')
  const origin = [...host.querySelectorAll('button')].find(node => node.textContent === '查看来源')!
  expect(origin.disabled).toBe(true)
  await act(async () => { reply({items: [], hasMore: false}) })
  expect(origin.disabled).toBe(false)
  mock.call.mockImplementationOnce(() => new Promise(resolve => { reply = resolve }))
  await click('查看来源')
  expect(origin.disabled).toBe(true)
  expect(host.querySelector('[role=status]')?.getAttribute('aria-label')).toBe('加载中')
  await act(async () => { reply({items: [{...inherited, selfArchived: true, source: {...inherited.source, topicHierarchyKey: 'parent-key'}}], hasMore: false}) })
  expect(host.querySelector('[role=status]')).toBeNull()
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
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="主题主题操作"]')!.click() })
  const archiveAction = [...row.querySelectorAll('button')].find(button => button.textContent === '归档')!
  const renameAction = [...row.querySelectorAll('button')].find(button => button.textContent === '重命名')!
  await act(async () => { renameAction.dispatchEvent(new MouseEvent('mouseover', {bubbles: true})) })
  const hoverBackground = renameAction.style.background
  await act(async () => { archiveAction.dispatchEvent(new MouseEvent('mouseover', {bubbles: true})) })
  expect(archiveAction.style.background).toBe(hoverBackground)
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
