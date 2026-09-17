// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  SelfTopicExpansionStore, selfTopicExpansionKey, sourceRefsFromExpansionKeys, updateExpansionKeys, useSelfTopicExpansion,
} from '../src/client/self-topic-expansion-preference.js'
import { ArkmeSourceBreadcrumb } from '../src/client/ArkmeSourceBreadcrumb.js'
import { SELF_TOPIC_MENU_OPEN, type SelfTopicMenuRequest } from '../src/client/self-topic-menu-bridge.js'
import type { ArkmeEnvironment, ArkmeSourceItem } from '../src/types.js'
import { expandAncestorsForReveal } from '../src/client/ArkmeVirtualWorkspace.js'

const sources: ArkmeSourceItem[] = [
  { kind: 'topic', sourceRef: 'root', topicHierarchyKey: 'stable-root', displayName: '工作' },
  { kind: 'topic', sourceRef: 'inner', topicHierarchyKey: 'stable-inner', parentTopicHierarchyKey: 'stable-root', displayName: '项目' },
  { kind: 'topic', sourceRef: 'leaf', topicHierarchyKey: 'stable-leaf', parentTopicHierarchyKey: 'stable-inner', displayName: '需求' },
  { kind: 'topic', sourceRef: 'other', topicHierarchyKey: 'stable-other', displayName: '生活' },
  { kind: 'topic', sourceRef: 'other-child', topicHierarchyKey: 'stable-other-child', parentTopicHierarchyKey: 'stable-other', displayName: '计划' },
]
let host: HTMLDivElement, root: Root
let userId = 81000
beforeEach(() => {
  userId += 1
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLElement.prototype.scrollTo = vi.fn()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function render(options: { userId?: number; environment?: ArkmeEnvironment; sources?: ArkmeSourceItem[]; selected?: ArkmeSourceItem } = {}) {
  await act(async () => root.render(<ArkmeSourceBreadcrumb userId={options.userId ?? userId}
    environment={options.environment ?? 'prod'} sources={options.sources ?? sources} selectedSource={options.selected}
    onSelect={() => {}} onSelectAggregate={() => {}} />))
}
async function click(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(button).not.toBeNull()
  await act(async () => button!.click())
}
const row = (ref: string) => document.querySelector(`[data-arkme-self-topic-tree-row-ref="${ref}"]`)

it('persists each nested state through closing, remounting and a fresh preference store', async () => {
  await render(); await click('选择主题')
  await click('收起项目'); await click('收起工作'); await click('收起生活')
  const key = selfTopicExpansionKey(userId, 'prod')!
  expect(new Set(JSON.parse(localStorage.getItem(key)!))).toEqual(new Set(['stable-root', 'stable-inner', 'stable-other']))
  await click('选择主题'); await click('选择主题')
  expect(row('root')?.getAttribute('aria-expanded')).toBe('false')
  await act(async () => root.unmount()); root = createRoot(host)
  await render(); await click('选择主题'); await click('展开工作')
  expect(row('inner')?.getAttribute('aria-expanded')).toBe('false')
  expect(row('leaf')).toBeNull()
  expect(row('other')?.getAttribute('aria-expanded')).toBe('false')
  const fresh = new SelfTopicExpansionStore(key, localStorage)
  expect(fresh.getSnapshot()).toEqual(new Set(['stable-inner', 'stable-other']))
})

it('does not expand a selected topic ancestor from either header or hover entry', async () => {
  await render({ selected: sources[2] }); await click('选择主题'); await click('收起工作')
  await click('选择主题'); await click('选择主题')
  expect(row('root')?.getAttribute('aria-expanded')).toBe('false')
  await click('选择主题')
  const request: SelfTopicMenuRequest = { anchor: () => ({ left: 20, right: 300, top: 50, bottom: 100 }),
    accepted: false, focusMenu: false, checkPointer() {}, onClose() {}, onSelect() {} }
  await act(async () => document.dispatchEvent(new CustomEvent(SELF_TOPIC_MENU_OPEN, { detail: request })))
  expect(request.accepted).toBe(true)
  expect(row('root')?.getAttribute('aria-expanded')).toBe('false')
  expect(row('leaf')).toBeNull()
})

it('keeps stable identities across renames, hierarchy moves and incomplete page loads', async () => {
  await render(); await click('选择主题'); await click('收起项目')
  await render({ sources: [sources[0]!] })
  const renamed = sources.map(source => source.sourceRef === 'inner'
    ? { ...source, sourceRef: 'renamed-inner', displayName: '新项目名称', parentTopicHierarchyKey: 'stable-other' } : source)
  await render({ sources: renamed })
  expect(row('renamed-inner')?.getAttribute('aria-expanded')).toBe('false')
  expect(row('leaf')).toBeNull()
})

it('isolates accounts and environments and immediately restores the earlier account', async () => {
  await render(); await click('选择主题'); await click('收起工作')
  await render({ userId: userId + 1000 })
  expect(row('root')?.getAttribute('aria-expanded')).toBe('true')
  await render({ environment: 'test' })
  expect(row('root')?.getAttribute('aria-expanded')).toBe('true')
  await render()
  expect(row('root')?.getAttribute('aria-expanded')).toBe('false')
})

it('updates only the chosen loaded branch and preserves hidden descendants', () => {
  const keys = new Set(['stable-root', 'stable-inner', 'not-loaded'])
  const next = updateExpansionKeys(keys, [sources[0]!], current => {
    const result = new Set(current); result.delete('root'); return result
  })
  expect(next).toEqual(new Set(['stable-inner', 'not-loaded']))
  expect(sourceRefsFromExpansionKeys(next, sources)).toEqual(new Set(['inner']))
})

it('shares changes between menu and creation owners while revealing only a newly created branch', async () => {
  const loaded = sources.map(source => ({ ...source,
    ...(source.sourceRef === 'inner' ? { parentSourceRef: 'root' } : {}),
  }))
  const created: ArkmeSourceItem = { kind: 'topic', sourceRef: 'new-leaf', displayName: '新增内容', parentSourceRef: 'inner' }
  function Owner({ name }: { name: string }) {
    const [collapsed, update] = useSelfTopicExpansion(userId, 'prod', loaded)
    return <div data-owner={name} data-collapsed={[...collapsed].sort().join(',')}>
      <button aria-label={`collapse-${name}`} onClick={() => update(() => new Set(['root', 'inner', 'other']))} />
      <button aria-label={`create-${name}`} onClick={() => {
        const next = [...loaded, created]
        update(current => expandAncestorsForReveal(next, created.sourceRef, current), next)
      }} />
    </div>
  }
  await act(async () => root.render(<><Owner name="menu" /><Owner name="creation" /></>))
  await click('collapse-menu')
  expect([...document.querySelectorAll('[data-owner]')].map(el => el.getAttribute('data-collapsed')))
    .toEqual(['inner,other,root', 'inner,other,root'])
  await click('create-creation')
  expect([...document.querySelectorAll('[data-owner]')].map(el => el.getAttribute('data-collapsed')))
    .toEqual(['other', 'other'])
  expect(new SelfTopicExpansionStore(selfTopicExpansionKey(userId, 'prod'), localStorage).getSnapshot())
    .toEqual(new Set(['stable-other']))
})

it('handles missing identities and malformed or blocked storage without breaking toggles', () => {
  const malformed = { getItem: () => '{bad', setItem: vi.fn() }
  const broken = { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('blocked') } }
  expect(new SelfTopicExpansionStore('key', malformed).getSnapshot().size).toBe(0)
  const store = new SelfTopicExpansionStore('key', broken), listener = vi.fn()
  const stop = store.subscribe(listener)
  expect(() => store.update(() => new Set(['topic']))).not.toThrow()
  expect(store.getSnapshot()).toEqual(new Set(['topic']))
  expect(listener).toHaveBeenCalledOnce()
  stop(); store.update(() => new Set())
  expect(listener).toHaveBeenCalledOnce()
  expect(selfTopicExpansionKey(undefined, 'prod')).toBeUndefined()
  expect(selfTopicExpansionKey(-1, 'prod')).toBeUndefined()
})
