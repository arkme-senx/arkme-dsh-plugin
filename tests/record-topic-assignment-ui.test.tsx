// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeRecordTopicAssignmentDialog } from '../src/client/ArkmeRecordTopicAssignmentDialog.js'
import { SelfTopicDirectoryCache } from '../src/client/self-topic-directory-cache.js'
import type { ArkmeSourceItem, ArkmeSourceList } from '../src/types.js'

const source: ArkmeSourceItem = { sourceRef: 'self', kind: 'send_to_self', displayName: '发给自己' }
const topic = { ...source, kind: 'topic' as const, sourceRef: 'topic-a', topicHierarchyKey: 'topic-a-key', displayName: '工作', recordCount: 12 }
const child = { ...topic, sourceRef: 'child', topicHierarchyKey: 'child-key', parentSourceRef: topic.sourceRef, parentTopicHierarchyKey: topic.topicHierarchyKey, displayName: '产品优化', recordCount: 2 }
const defaults = [source, { ...source, sourceRef: 'default', kind: 'default_category' as const, displayName: '未分类' }, topic, child]
const result = { movedRecordUids: ['record-a'], projectionRefreshPending: true }
const page = (items: ArkmeSourceItem[] = defaults, nextCursor?: string): ArkmeSourceList => ({ directory: 'send_to_self', items, hasMore: !!nextCursor, ...(nextCursor ? { nextCursor } : {}) })
function deferred<T>() {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>(yes => { resolve = yes }), resolve: (value: T) => resolve(value) }
}
let userId = 300, root: Root, host: HTMLDivElement, anchor: HTMLButtonElement
const directories: SelfTopicDirectoryCache[] = []
function setup() {
  const load = vi.fn<(cursor: string | undefined, signal: AbortSignal, refresh: boolean) => Promise<ArkmeSourceList>>().mockResolvedValue(page())
  const directory = new SelfTopicDirectoryCache(++userId, 'prod', load, () => undefined, () => {})
  directories.push(directory)
  return { userId, environment: 'prod' as const, directory, load, anchor,
    port: { listTopics: vi.fn(), createTopic: vi.fn(async () => ({ ...topic, sourceRef: 'new', topicHierarchyKey: 'new-key', displayName: '命名的新主题' })), assign: vi.fn(async () => result) },
    source, assignmentRefs: ['assignment-a'], onCancel: vi.fn(), onAssigned: vi.fn(), onRefresh: vi.fn() }
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)
const render = async (props: ReturnType<typeof setup> & { currentTopicKey?: string }) => { await act(async () => root.render(<ArkmeRecordTopicAssignmentDialog {...props} />)) }
const click = async (label: string) => { expect(button(label), label).toBeDefined(); await act(async () => button(label)!.click()) }
async function input(value: string, selector = 'input[type="search"]') {
  const field = document.querySelector<HTMLInputElement>(selector)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function create() {
  await click('新主题')
  expect(document.querySelector('[data-arkme-self-topic-menu]')).toBeNull()
  expect(document.activeElement).toBe(document.querySelector('form input'))
  await input('命名的新主题', 'form input')
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLElement.prototype.scrollTo = vi.fn(); HTMLElement.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div'); anchor = document.createElement('button')
  document.body.append(host, anchor); anchor.focus(); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  for (const directory of directories.splice(0)) directory.dispose()
  host.remove(); anchor.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})

describe('assignment uses the shared topic menu and account directory', () => {
  it('shows the shared surface, search and footer outside the workspace, with no blocking backdrop', async () => {
    const props = setup(); await render(props)
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.hasAttribute('data-arkme-self-topic-menu')).toBe(true)
    expect(host.contains(dialog)).toBe(false)
    expect(document.querySelector('[data-arkme-confirm-dialog-backdrop]')).toBeNull()
    expect(document.activeElement).toBe(dialog.querySelector('input'))
    expect(button('新主题')).toBeDefined()
    expect(document.querySelector('[data-arkme-self-topic-footer]')).not.toBeNull()
    expect(document.querySelector('[data-arkme-menu-scroll]')).not.toBeNull()
    expect(button('移出主题')).toBeUndefined()
    expect(props.port.listTopics).not.toHaveBeenCalled()
    await click('关闭指定主题')
    expect(props.onCancel).toHaveBeenCalledOnce(); expect(props.port.assign).not.toHaveBeenCalled()
  })
  it.each([0, 101])('rejects invalid selection size without writes (%s)', async count => {
    const props = { ...setup(), assignmentRefs: Array.from({ length: count }, (_, index) => String(index)) }; await render(props)
    await click('新主题'); await click('指定到工作')
    expect(props.port.createTopic).not.toHaveBeenCalled(); expect(props.port.assign).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('1 至 100')
  })
  it('keeps current-topic metadata and avoids redundant writes', async () => {
    const props = { ...setup(), currentTopicKey: topic.topicHierarchyKey }; await render(props)
    expect(button('指定到工作')!.textContent).toContain('当前主题')
    await click('指定到工作')
    expect(document.body.textContent).toContain('已在当前主题中！')
    expect(props.port.assign).not.toHaveBeenCalled(); expect(props.onAssigned).not.toHaveBeenCalled()
  })
  it('only offers writable personal topics, never aggregate/default/system targets', async () => {
    const props = setup(); props.load.mockResolvedValue(page([...defaults, { ...topic, sourceRef: 'dsh', topicHierarchyKey: 'dsh', topicKind: 3, displayName: '系统' }]))
    await render(props)
    expect(button('指定到发给自己')).toBeUndefined(); expect(button('指定到未分类')).toBeUndefined(); expect(button('指定到系统')).toBeUndefined()
    await click('指定到产品优化')
    expect(props.port.assign).toHaveBeenCalledWith({ sourceRef: 'self', assignmentRefs: ['assignment-a'], targetSourceRef: 'child' }, expect.any(AbortSignal))
    expect(props.onAssigned).toHaveBeenCalledWith(result, child)
  })
  it('filters cached names locally, retains ancestors and restores collapsed branches after clearing', async () => {
    const props = setup(); await render(props)
    await click('收起工作'); expect(button('指定到产品优化')).toBeUndefined()
    await input('产品'); expect(button('指定到产品优化')).toBeDefined(); expect(button('指定到工作')).toBeDefined()
    await input('找不到'); expect(document.body.textContent).toContain('没有匹配的主题')
    await input(''); expect(button('指定到产品优化')).toBeUndefined()
    expect(props.load).toHaveBeenCalledOnce(); expect(props.port.listTopics).not.toHaveBeenCalled()
  })
  it('reuses the already loaded directory on open and reopen without a second request', async () => {
    const props = setup(); await props.directory.ensure(); await render(props)
    await act(async () => root.render(null)); await render(props)
    expect(button('指定到工作')).toBeDefined(); expect(props.load).toHaveBeenCalledOnce()
  })
  it('shares an in-flight page load and never claims no matches until all pages finish', async () => {
    const props = setup(), last = deferred<ArkmeSourceList>()
    props.load.mockImplementation(async cursor => cursor ? last.promise : page(defaults.slice(0, 3), 'next'))
    const ensure = props.directory.ensure(); await render(props); await input('产品')
    expect(document.body.textContent).toContain('仍在查找主题'); expect(document.body.textContent).not.toContain('没有匹配')
    await act(async () => { last.resolve(page([child])); await ensure })
    expect(button('指定到产品优化')).toBeDefined(); expect(props.load).toHaveBeenCalledTimes(2)
  })
  it('keeps cached choices during a background read failure and exposes retry', async () => {
    const props = setup(); await props.directory.ensure(); props.load.mockRejectedValueOnce(new Error('offline'))
    await props.directory.ensure(true); await render(props)
    expect(button('指定到工作')).toBeDefined(); await click('重试')
    expect(props.load.mock.lastCall?.[2]).toBe(true); expect(props.port.assign).not.toHaveBeenCalled()
  })
  it('locks synchronously against double clicks and cancellation while pending', async () => {
    const props = setup(), finish = deferred<typeof result>(); props.port.assign.mockReturnValue(finish.promise); await render(props)
    await act(async () => { button('指定到工作')!.click(); button('指定到工作')!.click(); button('关闭指定主题')!.click() })
    expect(props.port.assign).toHaveBeenCalledOnce(); expect(props.onCancel).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')!.getAttribute('aria-busy')).toBe('true')
    await act(async () => finish.resolve(result))
    expect(props.onAssigned).toHaveBeenCalledWith(result, topic)
  })
  it('ignores late write acknowledgements after scope unmount', async () => {
    const props = setup(), finish = deferred<typeof result>(); props.port.assign.mockReturnValue(finish.promise); await render(props)
    await click('指定到工作'); await act(async () => { root.render(null); }); await act(async () => finish.resolve(result))
    expect(props.onAssigned).not.toHaveBeenCalled()
  })
  it('preserves failed selection and requires a refreshed read before another write', async () => {
    const props = setup(); props.port.assign.mockRejectedValue(new Error('网络超时')); await render(props); await click('指定到工作')
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('网络超时')
    expect(button('指定到工作')!.disabled).toBe(true); expect(button('新主题')!.disabled).toBe(true)
    expect(props.onAssigned).not.toHaveBeenCalled(); await click('刷新并重新选择'); expect(props.onRefresh).toHaveBeenCalledOnce()
  })
  it('opens the existing naming dialog before creating and assigning the frozen selection', async () => {
    const props = setup(); await render(props); await create()
    expect(props.port.createTopic).toHaveBeenCalledExactlyOnceWith('命名的新主题', 'self', expect.any(AbortSignal))
    expect(props.port.assign).toHaveBeenCalledWith({ sourceRef: 'self', assignmentRefs: ['assignment-a'], targetSourceRef: 'new' }, expect.any(AbortSignal))
    expect(props.directory.getSnapshot().sources.some(item => item.sourceRef === 'new')).toBe(true)
    expect(props.onAssigned).toHaveBeenCalledOnce()
  })
  it('cancels naming back to the same search without creating or assigning', async () => {
    const props = setup(); await render(props); await input('产品'); await click('新主题'); await click('取消')
    expect(document.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('产品')
    expect(props.port.createTopic).not.toHaveBeenCalled(); expect(props.port.assign).not.toHaveBeenCalled(); expect(props.onCancel).not.toHaveBeenCalled()
  })
  it('clears search with Escape first, then dismisses and restores its trigger on unmount', async () => {
    const props = setup(); await render(props); await input('产品')
    const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await act(async () => escape())
    expect(document.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('')
    expect(props.onCancel).not.toHaveBeenCalled()
    await act(async () => escape()); expect(props.onCancel).toHaveBeenCalledOnce()
    await act(async () => root.render(null)); expect(document.activeElement).toBe(anchor)
  })
  it('dismisses on outside pointer clicks without clearing the record selection', async () => {
    const props = setup(); await render(props)
    await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(props.onCancel).toHaveBeenCalledOnce(); expect(props.onAssigned).not.toHaveBeenCalled(); expect(props.onRefresh).not.toHaveBeenCalled()
  })
  it('does not assign on creation failure or recreate after an unknown outcome', async () => {
    const props = setup(); props.port.createTopic.mockRejectedValue(new Error('创建失败')); await render(props); await create()
    expect(props.port.assign).not.toHaveBeenCalled(); expect(button('新主题')!.disabled).toBe(true)
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('创建失败')
  })
  it('retains the created topic when the subsequent assignment fails', async () => {
    const props = setup(); props.port.assign.mockRejectedValue(new Error('归属已变化')); await render(props); await create()
    expect(props.port.createTopic).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('主题「命名的新主题」已创建')
    expect(button('新主题')!.disabled).toBe(true)
  })
  it('does not assign a topic whose creation response arrives after scope unmount', async () => {
    const props = setup(), finish = deferred<Awaited<ReturnType<typeof props.port.createTopic>>>()
    props.port.createTopic.mockReturnValue(finish.promise); await render(props); await create()
    await act(async () => root.render(null)); await act(async () => finish.resolve({ ...topic, sourceRef: 'new', topicHierarchyKey: 'new-key', displayName: '命名的新主题' }))
    expect(props.port.assign).not.toHaveBeenCalled(); expect(props.onAssigned).not.toHaveBeenCalled()
  })
  it('only offers release from a topic and invalidates the shared directory after success', async () => {
    const props = { ...setup(), source: topic }; const invalidated = vi.spyOn(props.directory, 'invalidate')
    await render(props); await click('移出主题')
    expect(props.port.assign).toHaveBeenCalledWith({ sourceRef: 'topic-a', assignmentRefs: ['assignment-a'] }, expect.any(AbortSignal))
    expect(invalidated).toHaveBeenCalledOnce()
  })
})
