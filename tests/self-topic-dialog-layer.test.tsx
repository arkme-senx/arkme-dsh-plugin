// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeSourceBreadcrumb } from '../src/client/ArkmeSourceBreadcrumb.js'
import { ArkmeTopicDirectoryPopover, type ArkmeTopicCreateOpener } from '../src/client/ArkmeTopicDirectoryPopover.js'
import { watchSelfTopicMenuHover } from '../src/client/self-topic-menu-hover.js'
import { resetSelfTopicDirectories } from '../src/client/self-topic-directory-cache.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeSourceItem } from '../src/types.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const self: ArkmeSourceItem = { kind: 'send_to_self', sourceRef: 'self', displayName: '发给自己' }
const topic: ArkmeSourceItem = { kind: 'topic', sourceRef: 'parent', topicHierarchyKey: 'parent-key', displayName: '工作', recordCount: 2 }
const sources = [self, { ...self, kind: 'default_category' as const, sourceRef: 'default', displayName: '未分类' }, topic]
let host: HTMLDivElement, anchor: HTMLButtonElement, root: Root, stop: () => void
const selected = vi.fn(), rename = vi.fn(), dissolve = vi.fn()

function Workspace({ hidden }: { hidden: boolean }) {
  const create = useRef<ArkmeTopicCreateOpener>()
  return <div data-arkme-owned="arkme-conversation-layer" aria-hidden={hidden || undefined}
    style={{ visibility: hidden ? 'hidden' : 'visible', pointerEvents: hidden ? 'none' : 'auto', zIndex: hidden ? 0 : 1 }}>
    <ArkmeTopicDirectoryPopover userId={123} selectedSource={undefined} trigger="none" retryRevision={0}
      onSelect={selected} onSelectionInvalidated={() => {}} onSelfSourcesResolution={() => {}}
      onCreateWarning={() => {}} onCreateTopicReady={open => { create.current = open }} />
    <ArkmeSourceBreadcrumb userId={123} trigger="none" selectedSource={undefined} sources={sources}
      onSelect={selected} onSelectAggregate={() => {}} onCreateTopic={() => create.current?.()}
      onCreateChildTopic={(parent, level) => create.current?.(parent, level)} onRenameTopic={rename} onDissolveTopic={dissolve} />
  </div>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLElement.prototype.scrollTo = vi.fn()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  resetSelfTopicDirectories(); localStorage.clear()
  selected.mockReset(); rename.mockReset(); dissolve.mockReset()
  vi.mocked(callArkme).mockReset().mockImplementation(async method => {
    if (method === 'sources.list') return { items: sources, hasMore: false }
    if (method === 'topic.create') return { source: { ...topic, sourceRef: 'new', displayName: '测试主题' } }
    throw new Error(`Unexpected API: ${method}`)
  })
  host = document.createElement('div'); anchor = document.createElement('button')
  document.body.append(host, anchor)
  root = createRoot(host)
  const rect = new DOMRect(20, 50, 280, 60)
  vi.spyOn(anchor, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect)
  stop = watchSelfTopicMenuHover(anchor, () => {})
})
afterEach(async () => {
  stop()
  await act(async () => root.unmount())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  host.remove(); anchor.remove()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

async function openAction(hidden: boolean, action: string) {
  await act(async () => root.render(<Workspace hidden={hidden} />))
  await act(async () => {
    anchor.dispatchEvent(new Event('pointerenter'))
    vi.advanceTimersByTime(200)
  })
  const menu = document.querySelector<HTMLElement>('[data-arkme-self-topic-menu]')!
  expect(menu.closest('[aria-hidden="true"]')).toBeNull()
  if (action === '新主题') {
    await act(async () => menu.querySelector<HTMLButtonElement>('[aria-label="新主题"]')!.click())
  } else {
    const row = menu.querySelector('[data-arkme-self-topic-tree-row-ref="parent"]')!
    await act(async () => row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await act(async () => row.querySelector<HTMLButtonElement>('[aria-label="工作主题操作"]')!.click())
    const actions = document.querySelector('[role="menu"]')!
    expect(menu.contains(actions)).toBe(false)
    // Real pointer events reach the document's outside-click handlers first.
    const button = [...actions.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === action)!
    await act(async () => button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(document.querySelector('[role="menu"]')).toBe(actions)
    await act(async () => button.click())
  }
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog).not.toBeNull()
  expect(dialog.closest('[data-arkme-owned="arkme-conversation-layer"]')).toBeNull()
  expect(dialog.closest('[aria-hidden="true"]')).toBeNull()
  expect(getComputedStyle(dialog).visibility).toBe('visible')
  expect(getComputedStyle(dialog).pointerEvents).not.toBe('none')
  expect(document.querySelector('[data-arkme-self-topic-menu]')).toBeNull()
  if (action !== '解散主题') expect(document.activeElement).toBe(dialog.querySelector('input'))
  return dialog
}

it.each([true, false])('opens and cancels all topic dialogs outside the workspace (DSH focused=%s)', async hidden => {
  for (const action of ['新主题', '新建子主题', '重命名', '解散主题']) {
    const dialog = await openAction(hidden, action)
    await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent === '取消')!.click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(host.querySelector('[data-arkme-owned]')!.getAttribute('aria-hidden')).toBe(hidden ? 'true' : null)
    expect(selected).not.toHaveBeenCalled()
  }
  expect(vi.mocked(callArkme).mock.calls.every(([method]) => method === 'sources.list')).toBe(true)
  expect(rename).not.toHaveBeenCalled(); expect(dissolve).not.toHaveBeenCalled()
})

it.each(['新主题', '新建子主题'])('creates once from the visible form and selects the result while DSH is focused (%s)', async action => {
  const dialog = await openAction(true, action)
  const input = dialog.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '测试主题')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => dialog.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(vi.mocked(callArkme).mock.calls.filter(([method]) => method === 'topic.create')).toEqual([
    ['topic.create', { title: '测试主题', contextSourceRef: action === '新主题' ? 'self' : 'parent',
      ...(action === '新主题' ? {} : { parentSourceRef: 'parent' }) }],
  ])
  expect(selected).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sourceRef: 'new' }))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
