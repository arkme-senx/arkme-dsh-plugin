// @vitest-environment jsdom
import { useCallback, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeTopicDirectoryPopover, type ArkmeTopicCreateOpener } from '../src/client/ArkmeTopicDirectoryPopover.js'
import { ArkmeTopicCreateDialog } from '../src/client/ArkmeTopicCreateDialog.js'
import { readNavigationCache } from '../src/client/navigation-cache.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeSourceItem, ArkmeTopicCreateResult } from '../src/types.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const self: ArkmeSourceItem = { sourceRef: 'self', kind: 'send_to_self', displayName: '发给自己', activeAtMillis: 0, unreadCount: 0 }
const uncategorized: ArkmeSourceItem = { ...self, sourceRef: 'default', kind: 'default_category', displayName: '未分类' }
const parent: ArkmeSourceItem = { ...self, sourceRef: 'parent', topicHierarchyKey: 'topic-key-parent', kind: 'topic', displayName: '父主题' }
const created: ArkmeSourceItem = { ...parent, sourceRef: 'created', topicHierarchyKey: 'topic-key-created', displayName: '新主题' }
let renderer: ReactTestRenderer | undefined
let resolveCreate: (value: ArkmeTopicCreateResult) => void
let rejectCreate: (error: Error) => void

beforeEach(() => {
  localStorage.clear()
  vi.mocked(callArkme).mockReset()
  vi.mocked(callArkme).mockImplementation(async method => {
    if (method === 'sources.list') return { items: [self, uncategorized, parent], hasMore: false }
    if (method === 'topic.create') return await new Promise<ArkmeTopicCreateResult>((resolve, reject) => {
      resolveCreate = resolve; rejectCreate = reject
    })
    throw new Error(`Unexpected API: ${method}`)
  })
})
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined })

async function openCreate(child = false, trigger: 'none' | 'button' = 'none') {
  let opener: ArkmeTopicCreateOpener | undefined
  const onSelect = vi.fn()
  await act(async () => {
    renderer = create(<ArkmeTopicDirectoryPopover userId={10001} selectedSource={parent} trigger={trigger}
      onSelect={onSelect} onSelectionInvalidated={vi.fn()} onSelfSourcesResolution={vi.fn()}
      onCreateTopicReady={open => { opener = open }} retryRevision={0} />)
  })
  onSelect.mockClear()
  if (trigger === 'button') {
    await act(async () => renderer!.root.findByProps({ 'aria-label': '打开主题' }).props.onClick())
  }
  await act(async () => opener!(child ? parent : null, child ? 1 : undefined))
  return onSelect
}

function submit() {
  renderer!.root.findByType(ArkmeTopicCreateDialog).props.onConfirm('新主题')
}

describe('navigate to a newly created self topic', () => {
  it.each([false, true])('opens the acknowledged topic and preserves it in the navigation cache (child=%s)', async child => {
    const onSelect = await openCreate(child)
    await act(async () => { submit() })
    expect(onSelect).not.toHaveBeenCalled()
    const result = child ? { ...created, parentSourceRef: parent.sourceRef } : created
    await act(async () => { resolveCreate({ source: result }) })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(result)
    expect(renderer!.root.findAllByType(ArkmeTopicCreateDialog)).toHaveLength(0)
    const cache = readNavigationCache(10001)!
    expect(cache.selectedSourceRef).toBe(result.sourceRef)
    expect(cache.sources.send_to_self?.map(source => source.sourceRef)).toEqual(['self', 'default', 'parent', 'created'])
    expect(callArkme).toHaveBeenCalledWith('topic.create', {
      title: '新主题', contextSourceRef: parent.sourceRef, ...(child ? { parentSourceRef: parent.sourceRef } : {}),
    })
  })

  it('closes an open directory popover after creating and selecting the new topic', async () => {
    const onSelect = await openCreate(false, 'button')
    await act(async () => { submit(); resolveCreate({ source: created }) })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(created)
    expect(renderer!.root.findAllByProps({ role: 'dialog', 'aria-label': '主题' })).toHaveLength(0)
  })

  it('blocks duplicate requests and keeps the original selection when creation fails', async () => {
    const onSelect = await openCreate()
    const confirm = renderer!.root.findByType(ArkmeTopicCreateDialog).props.onConfirm
    await act(async () => { confirm('新主题'); confirm('新主题') })
    expect(vi.mocked(callArkme).mock.calls.filter(([method]) => method === 'topic.create')).toHaveLength(1)
    expect(renderer!.root.findByType(ArkmeTopicCreateDialog).props.submitting).toBe(true)
    expect(onSelect).not.toHaveBeenCalled()
    await act(async () => { rejectCreate(new Error('创建失败')) })
    expect(onSelect).not.toHaveBeenCalled()
    expect(renderer!.root.findByType(ArkmeTopicCreateDialog).props.error).toBe('创建失败')
    expect(renderer!.root.findByType(ArkmeTopicCreateDialog).props.submitting).toBe(false)
    expect(readNavigationCache(10001)?.selectedSourceRef).toBe(parent.sourceRef)
  })

  it.each(['before', 'after'] as const)('keeps creation and directory refresh consistent when the read finishes %s creation', async order => {
    const onSelect = await openCreate()
    let finishRead!: (value: unknown) => void
    await act(async () => { submit() })
    vi.mocked(callArkme).mockImplementationOnce(async () => await new Promise(resolve => { finishRead = resolve }))
    const props = renderer!.root.findByType(ArkmeTopicDirectoryPopover).props
    await act(async () => renderer!.update(<ArkmeTopicDirectoryPopover {...props} retryRevision={1} />))
    const extra = { ...parent, sourceRef: 'extra', topicHierarchyKey: 'topic-key-extra' }
    const finish = () => finishRead({ items: [self, uncategorized, parent, extra], hasMore: false })
    if (order === 'before') await act(async () => { finish() })
    onSelect.mockClear()
    await act(async () => { resolveCreate({ source: created }) })
    if (order === 'after') await act(async () => { finish() })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(created)
    const cache = readNavigationCache(10001)!
    expect(cache.selectedSourceRef).toBe(created.sourceRef)
    expect(cache.sources.send_to_self?.some(source => source.sourceRef === created.sourceRef)).toBe(true)
    if (order === 'before') expect(cache.sources.send_to_self?.some(source => source.sourceRef === extra.sourceRef)).toBe(true)
  })

  it('retains the new topic after the destination surface remounts and refreshes its directory', async () => {
    const onSelect = await openCreate()
    await act(async () => { submit(); resolveCreate({ source: created }) })
    const props = renderer!.root.findByType(ArkmeTopicDirectoryPopover).props
    await act(async () => renderer!.unmount())
    const refreshed = { ...created, sourceRef: 'created-current-ref', displayName: '新主题改名' }
    vi.mocked(callArkme).mockResolvedValueOnce({ items: [self, uncategorized, parent, refreshed], hasMore: false })
    onSelect.mockClear()
    await act(async () => { renderer = create(<ArkmeTopicDirectoryPopover {...props} selectedSource={created} />) })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(refreshed)
    expect(props.onSelectionInvalidated).not.toHaveBeenCalled()
    expect(readNavigationCache(10001)?.selectedSourceRef).toBe(refreshed.sourceRef)
  })

  it('keeps the last complete navigation cache until a later topic page arrives', async () => {
    const onSelect = await openCreate()
    await act(async () => { submit(); resolveCreate({ source: created }) })
    const props = renderer!.root.findByType(ArkmeTopicDirectoryPopover).props
    await act(async () => renderer!.unmount())
    let finishPage!: (value: unknown) => void
    vi.mocked(callArkme).mockResolvedValueOnce({ items: [self, uncategorized, parent], hasMore: true, nextCursor: 'page-2' })
      .mockImplementationOnce(async () => await new Promise(resolve => { finishPage = resolve }))
    onSelect.mockClear()
    await act(async () => { renderer = create(<ArkmeTopicDirectoryPopover {...props} selectedSource={created} />) })
    expect(props.onSelectionInvalidated).not.toHaveBeenCalled()
    expect(readNavigationCache(10001)?.sources.send_to_self?.some(source => source.sourceRef === created.sourceRef)).toBe(true)
    await act(async () => { finishPage({ items: [created], hasMore: false }) })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(created)
    expect(readNavigationCache(10001)?.selectedSourceRef).toBe(created.sourceRef)
  })

  it('preserves navigation on directory failure and permits creation using the existing capability', async () => {
    const onSelect = await openCreate()
    const props = renderer!.root.findByType(ArkmeTopicDirectoryPopover).props
    vi.mocked(callArkme).mockRejectedValueOnce(new Error('目录读取失败'))
    await act(async () => renderer!.update(<ArkmeTopicDirectoryPopover {...props} retryRevision={1} />))
    expect(props.onSelectionInvalidated).not.toHaveBeenCalled()
    await act(async () => { submit(); resolveCreate({ source: created }) })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(created)
  })

  it('rejects creation without an account capability and recovers once the directory loads', async () => {
    let opener!: ArkmeTopicCreateOpener
    let finishRead!: (value: unknown) => void
    const onSelect = vi.fn()
    vi.mocked(callArkme).mockImplementationOnce(async () => await new Promise(resolve => { finishRead = resolve }))
    await act(async () => { renderer = create(<ArkmeTopicDirectoryPopover userId={10001} selectedSource={undefined}
      onSelect={onSelect} onSelectionInvalidated={vi.fn()} onSelfSourcesResolution={vi.fn()}
      onCreateTopicReady={open => { if (open) opener = open }} retryRevision={0} />) })
    await act(async () => opener())
    await act(async () => { submit() })
    expect(vi.mocked(callArkme).mock.calls.some(([method]) => method === 'topic.create')).toBe(false)
    expect(renderer!.root.findByType(ArkmeTopicCreateDialog).props.submitting).toBe(false)
    expect(renderer!.root.findByType(ArkmeTopicCreateDialog).props.error).toContain('尚未加载')
    await act(async () => { finishRead({ items: [self, uncategorized], hasMore: false }) })
    await act(async () => { submit(); resolveCreate({ source: created }) })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(created)
  })

  it.each(['success', 'failure'] as const)('ignores a late %s after switching to another account surface', async outcome => {
    const oldSelect = await openCreate()
    await act(async () => { submit() })
    const props = renderer!.root.findByType(ArkmeTopicDirectoryPopover).props
    await act(async () => renderer!.unmount())
    const nextSelect = vi.fn()
    await act(async () => { renderer = create(<ArkmeTopicDirectoryPopover {...props} userId={20002} onSelect={nextSelect} />) })
    nextSelect.mockClear()
    const before = readNavigationCache(20002)
    await act(async () => { if (outcome === 'success') resolveCreate({ source: created }); else rejectCreate(new Error('旧请求失败')) })
    expect(oldSelect).not.toHaveBeenCalled()
    expect(nextSelect).not.toHaveBeenCalled()
    expect(readNavigationCache(20002)).toEqual(before)
    expect(renderer!.root.findAllByType(ArkmeTopicCreateDialog)).toHaveLength(0)
  })

  it('does not navigate when creation finishes after leaving the topic surface', async () => {
    const onSelect = await openCreate()
    await act(async () => { submit() })
    await act(async () => { renderer!.unmount() })
    renderer = undefined
    await act(async () => { resolveCreate({ source: created }) })
    expect(onSelect).not.toHaveBeenCalled()
    expect(readNavigationCache(10001)?.selectedSourceRef).toBe(parent.sourceRef)
  })

  it('preserves the warning and original selection when child creation only partially succeeds', async () => {
    const onSelect = await openCreate(true)
    await act(async () => { submit(); resolveCreate({ source: created, warning: '层级同步提示' }) })
    expect(onSelect).not.toHaveBeenCalled()
    expect(readNavigationCache(10001)?.selectedSourceRef).toBe(parent.sourceRef)
    expect(readNavigationCache(10001)?.sources.send_to_self?.some(source => source.sourceRef === created.sourceRef)).toBe(true)
    const props = renderer!.root.findByType(ArkmeTopicDirectoryPopover).props
    expect(props.onSelfSourcesResolution).toHaveBeenLastCalledWith(10001, expect.objectContaining({ status: 'ready', error: '层级同步提示' }))
  })
  it('binds root creation from the aggregate view to its existing account capability', async () => {
    await openCreate()
    const props = renderer!.root.findByType(ArkmeTopicDirectoryPopover).props
    await act(async () => renderer!.update(<ArkmeTopicDirectoryPopover {...props} selectedSource={undefined} />))
    await act(async () => { submit() })
    expect(callArkme).toHaveBeenCalledWith('topic.create', { title: '新主题', contextSourceRef: self.sourceRef })
    await act(async () => { resolveCreate({ source: created }) })
  })

  it('allows another explicit submission after a failed creation', async () => {
    const onSelect = await openCreate()
    await act(async () => { submit(); rejectCreate(new Error('创建失败')) })
    await act(async () => { submit(); resolveCreate({ source: created }) })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(created)
    expect(vi.mocked(callArkme).mock.calls.filter(([method]) => method === 'topic.create')).toHaveLength(2)
  })

  it('does not write when the user cancels or the parent is already at the maximum depth', async () => {
    const onSelect = await openCreate()
    await act(async () => renderer!.root.findByType(ArkmeTopicCreateDialog).props.onCancel())
    expect(renderer!.root.findAllByType(ArkmeTopicCreateDialog)).toHaveLength(0)
    const props = renderer!.root.findByType(ArkmeTopicDirectoryPopover).props
    let opener!: ArkmeTopicCreateOpener
    await act(async () => renderer!.update(<ArkmeTopicDirectoryPopover {...props}
      onCreateTopicReady={open => { if (open) opener = open }} />))
    await act(async () => opener(parent, 5))
    await act(async () => { submit() })
    expect(renderer!.root.findByType(ArkmeTopicCreateDialog).props.error).toContain('最多支持五级')
    expect(vi.mocked(callArkme).mock.calls.filter(([method]) => method === 'topic.create')).toHaveLength(0)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('opens the created topic through the real form and keyed destination remount', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    let accepted = false
    const onResolution = vi.fn()
    const onInvalidated = vi.fn()
    vi.mocked(callArkme).mockImplementation(async method => {
      if (method === 'sources.list') return { items: [self, uncategorized, parent, ...(accepted ? [created] : [])], hasMore: false }
      if (method === 'topic.create') { accepted = true; return { source: created } }
      throw new Error(`Unexpected API: ${method}`)
    })
    function Surface() {
      const [selected, setSelected] = useState(parent)
      const opener = useRef<ArkmeTopicCreateOpener>()
      const onSelect = useCallback((source: ArkmeSourceItem) => { setSelected(source) }, [])
      return <>
        <h1>{selected.displayName}</h1>
        <button onClick={() => opener.current?.()}>新建主题</button>
        <ArkmeTopicDirectoryPopover key={selected.sourceRef} userId={10001} selectedSource={selected} trigger="none"
          onSelect={onSelect} onSelectionInvalidated={onInvalidated} onSelfSourcesResolution={onResolution}
          onCreateTopicReady={open => { opener.current = open }} retryRevision={0} />
      </>
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => { root.render(<Surface />) })
      await act(async () => host.querySelector('button')!.click())
      const input = host.querySelector('input')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '新主题')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      expect(host.querySelector('h1')?.textContent).toBe('新主题')
      expect(host.querySelector('form')).toBeNull()
      expect(onInvalidated).not.toHaveBeenCalled()
      expect(readNavigationCache(10001)?.selectedSourceRef).toBe(created.sourceRef)
      expect(vi.mocked(callArkme).mock.calls.filter(([method]) => method === 'topic.create')).toHaveLength(1)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

})
