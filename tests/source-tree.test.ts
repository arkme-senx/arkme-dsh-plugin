import { describe, expect, it } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import { buildArkmeSourceTree, flattenVisibleArkmeSourceTree, sortArkmeSourceTree } from '../src/client/source-tree.js'

function source(
  sourceRef: string,
  displayName: string,
  parentSourceRef?: string,
  activeAtMillis = 0,
  recordCount = 0,
): ArkmeSourceItem {
  return {
    sourceRef,
    ...(parentSourceRef === undefined ? {} : { parentSourceRef }),
    kind: 'topic',
    displayName,
    activeAtMillis,
    unreadCount: 0,
    recordCount,
  }
}

describe('Arkme source tree', () => {
  it('sorts sibling groups while keeping descendants next to their parent', () => {
    const roots = buildArkmeSourceTree([
      source('parent', 'Beta', undefined, 20, 5),
      source('child-new', 'Zulu', 'parent', 40, 1),
      source('child-old', 'Alpha', 'parent', 10, 3),
      source('root', 'Gamma', undefined, 30, 10),
    ])

    expect(flattenVisibleArkmeSourceTree(sortArkmeSourceTree(roots, 'latest'), new Set())
      .map(row => [row.source.sourceRef, row.depth])).toEqual([
      ['root', 0], ['parent', 0], ['child-new', 1], ['child-old', 1],
    ])
    expect(flattenVisibleArkmeSourceTree(sortArkmeSourceTree(roots, 'most'), new Set())
      .map(row => row.source.sourceRef)).toEqual(['root', 'parent', 'child-old', 'child-new'])
    expect(flattenVisibleArkmeSourceTree(sortArkmeSourceTree(roots, 'name'), new Set())
      .map(row => row.source.sourceRef)).toEqual(['parent', 'child-old', 'child-new', 'root'])
  })

  it('hides descendants when a parent is collapsed', () => {
    const roots = buildArkmeSourceTree([
      source('parent', '父主题'),
      source('child-a', '子主题 A', 'parent'),
      source('child-b', '子主题 B', 'parent'),
      source('root', '独立主题'),
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
