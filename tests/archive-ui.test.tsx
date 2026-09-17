// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeArchiveManagementPanel } from '../src/client/ArkmeArchive.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
let host: HTMLDivElement
let root: Root
const inherited = { entityType: 'topic', sourceRef: 'child', ownerAvailable: true, selfArchived: false, effectiveArchived: true, revision: 0, inheritedFrom: {sourceRef: 'parent', topicHierarchyKey: 'parent-key'}, displayArchiveAt: 10, privacyLocked: false,
  source: { sourceRef: 'child', kind: 'topic', displayName: '长主题🌲'.repeat(30), unreadCount: 0, activeAtMillis: 10 } }
const page = { items: [inherited, { ...inherited, sourceRef: 'private', privacyLocked: true, source: { ...inherited.source, sourceRef: 'private', displayName: '隐私主题' } }], hasMore: false }
const click = async (text: string) => {
  const node = [...host.querySelectorAll('button')].find(button => button.textContent === text)
  expect(node, text).toBeDefined()
  await act(async () => { node!.click() })
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  mock.call.mockReset().mockImplementation(async (operation: string) => operation === 'archives.list' ? page : [{ ...inherited, sourceRef: 'parent', selfArchived: true, revision: 7 }])
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

it('shows inherited state without a misleading restore, masks private topics and opens by UID reference', async () => {
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  expect(host.textContent).toContain('数据管理')
  expect(host.textContent).toContain('随父级归档')
  expect(host.textContent).not.toContain('取消归档')
  expect([...host.querySelectorAll('button')].filter(button => button.textContent === '打开主题')[1]!.disabled).toBe(true)
  await click('打开主题')
  expect(arkmeUi.getSnapshot().selectedSource?.sourceRef).toBe('child')
  await click('单独归档')
  expect(host.querySelector('[role=dialog]')?.textContent).toContain('此主题及其子主题')
  expect(mock.call.mock.calls.filter(call => call[0] === 'archives.set')).toHaveLength(0)
  mock.call.mockImplementation(async (operation: string) => operation === 'archives.set' ? { ...inherited, selfArchived: true, revision: 1, stateChanged: true, effectiveChangedCount: 0 } : page)
  await click('确认归档')
  expect(mock.call).toHaveBeenCalledWith('archives.set', { sourceRef: 'child', selfArchived: true, expectedRevision: 0 }, expect.any(AbortSignal))
})

it('requires an explicit confirmation before removing an ancestor marker', async () => {
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  mock.call.mockResolvedValueOnce({items: [{...inherited, selfArchived: true, sourceRef: 'parent', revision: 7, source: {...inherited.source, displayName: '父主题', topicHierarchyKey: 'parent-key'}}], hasMore: false})
  await click('查看归档来源')
  expect(host.querySelector('[role=dialog]')?.textContent).toContain('单独归档的子主题仍保留')
  await click('确认取消归档')
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
  expect(host.textContent).toContain('暂无已归档主题')
  const count = mock.call.mock.calls.length
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(mock.call.mock.calls.length).toBeGreaterThan(count)
})

it('keeps a failed write reviewable and never silently retries with a newer revision', async () => {
  await act(async () => { root.render(<ArkmeArchiveManagementPanel />) })
  await click('单独归档')
  mock.call.mockRejectedValue(new Error('ARCHIVE_REVISION_CONFLICT'))
  await click('确认归档')
  expect(mock.call.mock.calls.filter(call => call[0] === 'archives.set')).toHaveLength(1)
  // Refresh after an uncertain/conflicting write clears the previous list. The
  // failed owner read is surfaced rather than presenting cached success.
  expect(host.textContent).toContain('ARCHIVE_REVISION_CONFLICT')
})
