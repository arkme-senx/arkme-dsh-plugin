// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeSourceBreadcrumb } from '../src/client/ArkmeSourceBreadcrumb.js'
import type { ArkmeSourceItem } from '../src/types.js'

it.each([1, 3])('allows only ordinary topics as ordering anchors (kind=%s)', async topicKind => {
  const anchor: ArkmeSourceItem = { sourceRef: 'anchor', kind: 'topic', topicKind,
    displayName: 'DSH Agent Input', siblingOrder: 1 }
  const other: ArkmeSourceItem = { sourceRef: 'other', kind: 'topic', displayName: 'Other', siblingOrder: 2 }
  const moving: ArkmeSourceItem = { sourceRef: 'moving', kind: 'topic', displayName: 'Moving', siblingOrder: 3 }
  const onMove = vi.fn().mockResolvedValue(undefined)
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<ArkmeSourceBreadcrumb selectedSource={undefined}
    sources={[anchor, other, moving]} onSelect={() => {}} onSelectAggregate={() => {}} onMoveTopic={onMove} />) })
  try {
    await act(async () => { renderer.root.findByProps({ 'aria-label': '选择主题' }).props.onClick() })
    await act(async () => {
      renderer.root.findAllByType('button').find(button => button.children.includes('自定义'))!.props.onClick()
    })
    const row = (ref: string) => renderer.root.findByProps({ 'data-arkme-self-topic-tree-row-ref': ref })
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }
    await act(async () => {
      row('moving').findAllByType('button').find(button => button.props.draggable === true)!.props.onDragStart({
        clientX: 100, dataTransfer,
      })
    })
    const event = { clientX: 100, clientY: 1, dataTransfer, preventDefault: vi.fn(),
      currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 40 }) } }
    await act(async () => { row('anchor').props.onDragOver(event) })
    await act(async () => { row('anchor').props.onDrop(event) })
    if (topicKind === 3) {
      expect(onMove).not.toHaveBeenCalled()
    } else {
      expect(onMove).toHaveBeenCalledExactlyOnceWith(moving, undefined, undefined, anchor)
    }
  } finally { act(() => { renderer.unmount() }) }
})
