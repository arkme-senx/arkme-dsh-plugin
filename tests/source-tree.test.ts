import { describe, expect, it } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import { buildArkmeSourceTree, flattenVisibleArkmeSourceTree } from '../src/client/source-tree.js'

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
})
