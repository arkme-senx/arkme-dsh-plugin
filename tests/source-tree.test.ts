import { describe, expect, it } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import {
  aggregateArkmeSourceTreeRecordCounts, buildArkmeSourceTree, canMoveArkmeTopicToParent,
  flattenVisibleArkmeSourceTree, sortArkmeSourceTree,
} from '../src/client/source-tree.js'

function source(
  sourceRef: string,
  displayName: string,
  parentSourceRef?: string,
): ArkmeSourceItem {
  return {
    sourceRef,
    ...(parentSourceRef === undefined ? {} : { parentSourceRef }),
    kind: 'topic',
    displayName,
    activeAtMillis: 0,
    unreadCount: 0,
  }
}

describe('Arkme source tree', () => {
  it('keeps server order and hides descendants when a parent is collapsed', () => {
    const roots = buildArkmeSourceTree([
      source('parent', '父主题'),
      source('child-a', '子主题 A', 'parent'),
      source('child-b', '子主题 B', 'parent'),
      source('root', '独立主题'),
    ])

    expect(flattenVisibleArkmeSourceTree(roots, new Set()).map(row => [
      row.source.sourceRef, row.depth, row.hasChildren, row.expanded,
    ])).toEqual([
      ['parent', 0, true, true],
      ['child-a', 1, false, false],
      ['child-b', 1, false, false],
      ['root', 0, false, false],
    ])
    expect(flattenVisibleArkmeSourceTree(roots, new Set(['parent'])).map(row => row.source.sourceRef))
      .toEqual(['parent', 'root'])
  })

  it('renders missing and cyclic parents safely at the root', () => {
    const roots = buildArkmeSourceTree([
      source('orphan', '孤儿主题', 'missing'),
      source('cycle-a', '循环 A', 'cycle-b'),
      source('cycle-b', '循环 B', 'cycle-a'),
    ])
    expect(roots.map(node => node.source.sourceRef)).toEqual(['orphan', 'cycle-a', 'cycle-b'])
    expect(roots.every(node => node.children.length === 0)).toBe(true)
  })

  it('keeps a paged child hidden until its opaque parent key arrives', () => {
    const child: ArkmeSourceItem = {
      ...source('child', '二级主题'),
      topicHierarchyKey: 'topic-child', parentTopicHierarchyKey: 'topic-parent',
    }
    const parent: ArkmeSourceItem = {
      ...source('parent', '一级主题'),
      topicHierarchyKey: 'topic-parent', hasPendingChildren: true,
    }

    expect(flattenVisibleArkmeSourceTree(buildArkmeSourceTree([child]), new Set())).toEqual([])
    expect(flattenVisibleArkmeSourceTree(buildArkmeSourceTree([child, parent]), new Set()).map(row => [
      row.source.displayName, row.depth,
    ])).toEqual([['一级主题', 0], ['二级主题', 1]])
  })

  it('sorts each hierarchy level without separating children from their parent', () => {
    const parent = { ...source('parent', 'B parent'), activeAtMillis: 10, recordCount: 2 }
    const childA = { ...source('child-a', 'Z child', 'parent'), activeAtMillis: 1, recordCount: 20 }
    const childB = { ...source('child-b', 'A child', 'parent'), activeAtMillis: 20, recordCount: 1 }
    const root = { ...source('root', 'A root'), activeAtMillis: 15, recordCount: 4 }
    const roots = buildArkmeSourceTree([parent, childA, childB, root])

    expect(flattenVisibleArkmeSourceTree(sortArkmeSourceTree(roots, 'latest'), new Set()).map(row => row.source.sourceRef))
      .toEqual(['root', 'parent', 'child-b', 'child-a'])
    expect(flattenVisibleArkmeSourceTree(sortArkmeSourceTree(roots, 'most'), new Set()).map(row => row.source.sourceRef))
      .toEqual(['root', 'parent', 'child-a', 'child-b'])
    expect(flattenVisibleArkmeSourceTree(sortArkmeSourceTree(roots, 'custom'), new Set()).map(row => row.source.sourceRef))
      .toEqual(['root', 'parent', 'child-b', 'child-a'])
  })

  it('uses persisted sibling order for custom sorting at every hierarchy level', () => {
    const parent = { ...source('parent', 'Z 父主题'), siblingOrder: 2 }
    const firstRoot = { ...source('first-root', 'A 根主题'), siblingOrder: 1 }
    const childLater = { ...source('child-later', 'A 子主题', 'parent'), siblingOrder: 2 }
    const childFirst = { ...source('child-first', 'Z 子主题', 'parent'), siblingOrder: 1 }

    const rows = flattenVisibleArkmeSourceTree(sortArkmeSourceTree(
      buildArkmeSourceTree([parent, firstRoot, childLater, childFirst]), 'custom',
    ), new Set())
    expect(rows.map(row => row.source.sourceRef)).toEqual([
      'first-root', 'parent', 'child-first', 'child-later',
    ])
  })

  it('aggregates each parent count from direct and descendant topic records without double counting', () => {
    const parent = { ...source('parent', '一级主题'), recordCount: 2 }
    const child = { ...source('child', '二级主题', 'parent'), recordCount: 3 }
    const grandchild = { ...source('grandchild', '三级主题', 'child'), recordCount: 5 }
    const unrelated = { ...source('unrelated', '其他主题'), recordCount: 7 }
    const totals = aggregateArkmeSourceTreeRecordCounts(buildArkmeSourceTree([parent, child, grandchild, unrelated]))

    expect(totals.get('parent')).toBe(10)
    expect(totals.get('child')).toBe(8)
    expect(totals.get('grandchild')).toBe(5)
    expect(totals.get('unrelated')).toBe(7)
  })

  it('allows moving a branch across parents while preventing cycles and over-deep hierarchies', () => {
    const root = source('root', '一级主题')
    const child = source('child', '二级主题', 'root')
    const leaf = source('leaf', '三级主题', 'child')
    const peer = source('peer', '另一个一级主题')

    expect(canMoveArkmeTopicToParent(child, peer, [root, child, leaf, peer])).toBe(true)
    expect(canMoveArkmeTopicToParent(root, leaf, [root, child, leaf, peer])).toBe(false)

    const level4 = source('level-4', '四级主题', 'leaf')
    const level5 = source('level-5', '五级主题', 'level-4')
    expect(canMoveArkmeTopicToParent(root, level5, [root, child, leaf, level4, level5, peer])).toBe(false)
  })
})
