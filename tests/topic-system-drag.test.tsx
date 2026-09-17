// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeSourceBreadcrumb } from '../src/client/ArkmeSourceBreadcrumb.js'
import { CONVERSATION_MENU_COLORS } from '../src/client/conversation-selector-style.js'
import { arkmeTheme } from '../src/client/arkme-theme.js'
import type { ArkmeSourceItem } from '../src/types.js'

async function openCustomTopics(renderer: ReactTestRenderer) {
  await act(async () => { renderer.root.findByProps({ 'aria-label': '选择主题' }).props.onClick() })
}

const dragDataTransfer = () => ({ effectAllowed: '', dropEffect: '', setData: vi.fn() })

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
    await openCustomTopics(renderer)
    const row = (ref: string) => renderer.root.findByProps({ 'data-arkme-self-topic-tree-row-ref': ref })
    const dataTransfer = dragDataTransfer()
    await act(async () => {
      row('moving').props.onDragStart({
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

it('nests a topic through the generous center zone and immediately expands the target', async () => {
  const anchor: ArkmeSourceItem = {
    sourceRef: 'anchor', kind: 'topic', displayName: 'Anchor', siblingOrder: 1,
  }
  const child: ArkmeSourceItem = {
    sourceRef: 'child', kind: 'topic', displayName: 'Existing child', parentSourceRef: 'anchor', siblingOrder: 1,
  }
  const moving: ArkmeSourceItem = {
    sourceRef: 'moving', kind: 'topic', displayName: 'Moving', siblingOrder: 2,
  }
  const onMove = vi.fn().mockResolvedValue(undefined)
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<ArkmeSourceBreadcrumb selectedSource={undefined}
    sources={[anchor, child, moving]} onSelect={() => {}} onSelectAggregate={() => {}} onMoveTopic={onMove} />) })
  try {
    await openCustomTopics(renderer)
    const row = (ref: string) => renderer.root.findByProps({ 'data-arkme-self-topic-tree-row-ref': ref })
    await act(async () => {
      row('anchor').findByProps({ 'aria-label': '收起Anchor' }).props.onClick({ stopPropagation: vi.fn() })
    })
    expect(row('anchor').props['aria-expanded']).toBe(false)
    const dataTransfer = dragDataTransfer()
    await act(async () => {
      row('moving').props.onDragStart({
        clientX: 100, dataTransfer,
      })
    })
    const centerEvent = {
      clientX: 100, clientY: 20, dataTransfer, preventDefault: vi.fn(),
      currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 40 }) },
    }
    await act(async () => { row('anchor').props.onDragOver(centerEvent) })
    expect(renderer.root.findAllByProps({ 'data-arkme-self-topic-drop-into': 'true' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-arkme-self-topic-drop-line': 'before' })).toHaveLength(0)
    await act(async () => { row('anchor').props.onDrop(centerEvent) })
    expect(onMove).toHaveBeenCalledExactlyOnceWith(moving, undefined, anchor, undefined)
    expect(row('anchor').props['aria-expanded']).toBe(true)
  } finally { act(() => { renderer.unmount() }) }
})

it('renders a straight line for a before reorder instead of the child-drop highlight', async () => {
  const anchor: ArkmeSourceItem = { sourceRef: 'anchor', kind: 'topic', displayName: 'Anchor', siblingOrder: 1 }
  const moving: ArkmeSourceItem = { sourceRef: 'moving', kind: 'topic', displayName: 'Moving', siblingOrder: 2 }
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<ArkmeSourceBreadcrumb selectedSource={undefined}
    sources={[anchor, moving]} onSelect={() => {}} onSelectAggregate={() => {}} onMoveTopic={vi.fn().mockResolvedValue(undefined)} />) })
  try {
    await openCustomTopics(renderer)
    const row = (ref: string) => renderer.root.findByProps({ 'data-arkme-self-topic-tree-row-ref': ref })
    const dataTransfer = dragDataTransfer()
    await act(async () => {
      row('moving').props.onDragStart({ clientX: 100, dataTransfer })
    })
    await act(async () => {
      row('anchor').props.onDragOver({
        clientX: 100, clientY: 2, dataTransfer, preventDefault: vi.fn(),
        currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 40 }) },
      })
    })
    expect(renderer.root.findAllByProps({ 'data-arkme-self-topic-drop-line': 'before' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-arkme-self-topic-drop-into': 'true' })).toHaveLength(0)
  } finally { act(() => { renderer.unmount() }) }
})

it('keeps the dragged topic and its visible subtree in the original list position', async () => {
  const parent: ArkmeSourceItem = { sourceRef: 'parent', kind: 'topic', displayName: 'Parent', siblingOrder: 1 }
  const child: ArkmeSourceItem = {
    sourceRef: 'child', kind: 'topic', displayName: 'Child', parentSourceRef: 'parent', siblingOrder: 1,
  }
  const sibling: ArkmeSourceItem = { sourceRef: 'sibling', kind: 'topic', displayName: 'Sibling', siblingOrder: 2 }
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<ArkmeSourceBreadcrumb selectedSource={undefined}
    sources={[parent, child, sibling]} onSelect={() => {}} onSelectAggregate={() => {}}
    onMoveTopic={vi.fn().mockResolvedValue(undefined)} />) })
  try {
    await openCustomTopics(renderer)
    const row = (ref: string) => renderer.root.findByProps({ 'data-arkme-self-topic-tree-row-ref': ref })
    const dataTransfer = { ...dragDataTransfer(), setDragImage: vi.fn() }
    await act(async () => {
      row('parent').props.onDragStart({
        clientX: 100, dataTransfer,
      })
    })
    expect(row('parent')).toBeDefined()
    expect(row('child')).toBeDefined()
    expect(row('sibling')).toBeDefined()
    expect(renderer.root.findAllByProps({ 'data-arkme-self-topic-drag-lifted': 'true' })).toHaveLength(0)
    expect(dataTransfer.setDragImage).not.toHaveBeenCalled()
    await act(async () => {
      row('parent').props.onDragEnd()
    })
  } finally { act(() => { renderer.unmount() }) }
})

it('uses the same indented row for hover, selection, clicking and dragging', async () => {
  const parent: ArkmeSourceItem = { sourceRef: 'parent', kind: 'topic', displayName: 'Parent', siblingOrder: 1 }
  const child: ArkmeSourceItem = {
    sourceRef: 'child', kind: 'topic', displayName: 'Child', parentSourceRef: 'parent', siblingOrder: 1,
  }
  const onSelect = vi.fn()
  const props = {
    sources: [parent, child], onSelect, onSelectAggregate: () => {}, onMoveTopic: vi.fn().mockResolvedValue(undefined),
  }
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<ArkmeSourceBreadcrumb selectedSource={undefined} {...props} />) })
  try {
    await openCustomTopics(renderer)
    const childRow = () => renderer.root.findByProps({ 'data-arkme-self-topic-tree-row-ref': 'child' })
    expect(childRow().props.draggable).toBe(true)
    expect(childRow().props.style.marginLeft).toBe(16)
    expect(childRow().props.style.width).toBe('calc(100% - 16px)')
    expect(childRow().findAllByType('button').some(button => button.props.draggable === true)).toBe(false)

    await act(async () => { childRow().props.onMouseEnter() })
    expect(childRow().props.style.background).toBe(CONVERSATION_MENU_COLORS.hover)

    await act(async () => { renderer.update(<ArkmeSourceBreadcrumb selectedSource={child} {...props} />) })
    expect(childRow().props.style.background).toBe(CONVERSATION_MENU_COLORS.selected)
    expect(childRow().props.style.marginLeft).toBe(16)
    expect(childRow().props.style.width).toBe('calc(100% - 16px)')

    await act(async () => { childRow().props.onClick() })
    expect(onSelect).toHaveBeenCalledWith(child)
  } finally { act(() => { renderer.unmount() }) }
})

it('renders faint vertical guides for every visible ancestor level', async () => {
  const root: ArkmeSourceItem = { sourceRef: 'root', kind: 'topic', displayName: 'Root', siblingOrder: 1 }
  const child: ArkmeSourceItem = {
    sourceRef: 'child', kind: 'topic', displayName: 'Child', parentSourceRef: 'root', siblingOrder: 1,
  }
  const grandchild: ArkmeSourceItem = {
    sourceRef: 'grandchild', kind: 'topic', displayName: 'Grandchild', parentSourceRef: 'child', siblingOrder: 1,
  }
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<ArkmeSourceBreadcrumb selectedSource={undefined}
    sources={[root, child, grandchild]} onSelect={() => {}} onSelectAggregate={() => {}} />) })
  try {
    await openCustomTopics(renderer)
    const row = (ref: string) => renderer.root.findByProps({ 'data-arkme-self-topic-tree-row-ref': ref })
    expect(row('root').findAllByProps({ 'data-arkme-self-topic-hierarchy-guide': 0 })).toHaveLength(0)
    const childGuides = row('child').findAllByProps({ 'data-arkme-self-topic-hierarchy-guide': 0 })
    expect(childGuides).toHaveLength(1)
    expect(childGuides[0]!.props.style.left).toBe(-4)
    expect(childGuides[0]!.props.style.background).toBe(arkmeTheme.border)
    const grandchildGuides = row('grandchild').findAll(node => node.props['data-arkme-self-topic-hierarchy-guide'] !== undefined)
    expect(grandchildGuides.map(guide => guide.props.style.left)).toEqual([-20, -4])
  } finally { act(() => { renderer.unmount() }) }
})
