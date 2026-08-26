import type { ArkmeSourceItem } from '../types.js'

export type ArkmeSourceTreeSort = 'latest' | 'most' | 'custom'

export interface ArkmeSourceTreeNode {
  source: ArkmeSourceItem
  children: ArkmeSourceTreeNode[]
}

export interface ArkmeSourceTreeRow {
  source: ArkmeSourceItem
  depth: number
  hasChildren: boolean
  expanded: boolean
}

/** Return the complete visible hierarchy for a topic, from its root to itself. */
export function arkmeTopicPathNames(
  selectedSource: ArkmeSourceItem | undefined,
  sources: readonly ArkmeSourceItem[],
): string[] {
  if (selectedSource === undefined || selectedSource.kind !== 'topic') return []
  const sourceByRef = new Map(sources.map(source => [source.sourceRef, source]))
  const sourceByHierarchyKey = new Map(
    sources.flatMap(source => source.topicHierarchyKey === undefined ? [] : [[source.topicHierarchyKey, source] as const]),
  )
  const path: ArkmeSourceItem[] = []
  const visited = new Set<string>()
  let current: ArkmeSourceItem | undefined = sourceByRef.get(selectedSource.sourceRef) ?? selectedSource
  while (current !== undefined && current.kind === 'topic' && !visited.has(current.sourceRef)) {
    visited.add(current.sourceRef)
    path.unshift(current)
    const parentReference: string | undefined = current.parentTopicHierarchyKey ?? current.parentSourceRef
    current = parentReference === undefined
      ? undefined
      : current.parentTopicHierarchyKey === undefined
        ? sourceByRef.get(parentReference)
        : sourceByHierarchyKey.get(parentReference)
  }
  return path.map(source => source.displayName)
}

/** A hierarchy move may not create a cycle or exceed the five-level topic limit. */
export function canMoveArkmeTopicToParent(
  source: ArkmeSourceItem,
  nextParent: ArkmeSourceItem | undefined,
  sources: readonly ArkmeSourceItem[],
): boolean {
  if (source.kind !== 'topic') return false
  if (nextParent === undefined) return true
  if (nextParent.kind !== 'topic' || nextParent.sourceRef === source.sourceRef) return false
  const byRef = new Map(sources.map(item => [item.sourceRef, item]))
  const byHierarchyKey = new Map(
    sources.flatMap(item => item.topicHierarchyKey === undefined ? [] : [[item.topicHierarchyKey, item] as const]),
  )
  const parentOf = (item: ArkmeSourceItem): ArkmeSourceItem | undefined => (
    item.parentTopicHierarchyKey === undefined
      ? item.parentSourceRef === undefined ? undefined : byRef.get(item.parentSourceRef)
      : byHierarchyKey.get(item.parentTopicHierarchyKey)
  )
  const targetAncestors = new Set<string>()
  let current: ArkmeSourceItem | undefined = nextParent
  while (current !== undefined && !targetAncestors.has(current.sourceRef)) {
    targetAncestors.add(current.sourceRef)
    current = parentOf(current)
  }
  if (targetAncestors.has(source.sourceRef)) return false

  const childRefsByParent = new Map<string, ArkmeSourceItem[]>()
  for (const item of sources) {
    const parent = parentOf(item)
    if (parent === undefined) continue
    const children = childRefsByParent.get(parent.sourceRef) ?? []
    children.push(item)
    childRefsByParent.set(parent.sourceRef, children)
  }
  const subtreeDepth = (item: ArkmeSourceItem, visited = new Set<string>()): number => {
    if (visited.has(item.sourceRef)) return 0
    visited.add(item.sourceRef)
    return 1 + Math.max(0, ...(childRefsByParent.get(item.sourceRef) ?? []).map(child => subtreeDepth(child, visited)))
  }
  return targetAncestors.size + subtreeDepth(source) <= 5
}

/** Build a stable tree while keeping paged children hidden until their known parent arrives. */
export function buildArkmeSourceTree(sources: ArkmeSourceItem[]): ArkmeSourceTreeNode[] {
  const sourcesByRef = new Map(sources.map(source => [source.sourceRef, source]))
  const sourcesByTopicHierarchyKey = new Map(
    sources.flatMap(source => source.topicHierarchyKey === undefined ? [] : [[source.topicHierarchyKey, source] as const]),
  )
  const nodesByRef = new Map<string, ArkmeSourceTreeNode>(
    sources.map(source => [source.sourceRef, { source, children: [] }]),
  )
  const roots: ArkmeSourceTreeNode[] = []

  const validParent = (source: ArkmeSourceItem): ArkmeSourceItem | undefined | null => {
    if (source.kind !== 'topic') return undefined
    const parentReference = source.parentTopicHierarchyKey ?? source.parentSourceRef
    if (parentReference === undefined) return undefined
    const parentByReference = (reference: string): ArkmeSourceItem | undefined => (
      source.parentTopicHierarchyKey === undefined
        ? sourcesByRef.get(reference)
        : sourcesByTopicHierarchyKey.get(reference)
    )
    const seen = new Set([source.topicHierarchyKey ?? source.sourceRef])
    let parentRef: string | undefined = parentReference
    let directParent: ArkmeSourceItem | undefined
    while (parentRef !== undefined) {
      if (seen.has(parentRef)) return undefined
      seen.add(parentRef)
      const parent = parentByReference(parentRef)
      // A paged child must not temporarily appear as a top-level topic.
      if (parent === undefined) return source.parentTopicHierarchyKey === undefined ? undefined : null
      if (parent.kind !== 'topic') return undefined
      directParent ??= parent
      parentRef = parent.parentTopicHierarchyKey ?? parent.parentSourceRef
    }
    return directParent
  }

  for (const source of sources) {
    const node = nodesByRef.get(source.sourceRef)!
    const parent = validParent(source)
    if (parent === null) continue
    const parentNode = parent === undefined ? undefined : nodesByRef.get(parent.sourceRef)
    if (parentNode === undefined) roots.push(node)
    else parentNode.children.push(node)
  }
  return roots
}

const sourceNameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

function nonNegativeFinite(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Sort peers only, preserving every parent-child relationship. `custom` uses
 * the server's persisted sibling order, with the legacy name order as fallback.
 */
export function sortArkmeSourceTree(
  roots: readonly ArkmeSourceTreeNode[],
  sort: ArkmeSourceTreeSort,
): ArkmeSourceTreeNode[] {
  const compare = (left: ArkmeSourceTreeNode, right: ArkmeSourceTreeNode): number => {
    if (left.source.kind === 'default_category') return right.source.kind === 'default_category' ? 0 : -1
    if (right.source.kind === 'default_category') return 1
    if (sort === 'latest') {
      const byLatest = nonNegativeFinite(right.source.activeAtMillis) - nonNegativeFinite(left.source.activeAtMillis)
      if (byLatest !== 0) return byLatest
      const byCount = nonNegativeFinite(right.source.recordCount) - nonNegativeFinite(left.source.recordCount)
      if (byCount !== 0) return byCount
    } else if (sort === 'most') {
      const byCount = nonNegativeFinite(right.source.recordCount) - nonNegativeFinite(left.source.recordCount)
      if (byCount !== 0) return byCount
      const byLatest = nonNegativeFinite(right.source.activeAtMillis) - nonNegativeFinite(left.source.activeAtMillis)
      if (byLatest !== 0) return byLatest
    } else {
      const leftOrder = nonNegativeFinite(left.source.siblingOrder)
      const rightOrder = nonNegativeFinite(right.source.siblingOrder)
      if (leftOrder > 0 || rightOrder > 0) {
        if (leftOrder <= 0) return 1
        if (rightOrder <= 0) return -1
        const byOrder = leftOrder - rightOrder
        if (byOrder !== 0) return byOrder
      }
    }
    return sourceNameCollator.compare(left.source.displayName, right.source.displayName)
  }
  return roots
    .map(node => ({ ...node, children: sortArkmeSourceTree(node.children, sort) }))
    .sort(compare)
}

/** Total every topic from its direct records plus every descendant exactly once. */
export function aggregateArkmeSourceTreeRecordCounts(
  roots: readonly ArkmeSourceTreeNode[],
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>()
  const visit = (node: ArkmeSourceTreeNode): number => {
    const direct = nonNegativeFinite(node.source.recordCount)
    const total = direct + node.children.reduce((sum, child) => sum + visit(child), 0)
    totals.set(node.source.sourceRef, total)
    return total
  }
  roots.forEach(visit)
  return totals
}

export function flattenVisibleArkmeSourceTree(
  roots: ArkmeSourceTreeNode[],
  collapsedSourceRefs: ReadonlySet<string>,
): ArkmeSourceTreeRow[] {
  const rows: ArkmeSourceTreeRow[] = []
  const visit = (node: ArkmeSourceTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0
    const expanded = hasChildren && !collapsedSourceRefs.has(node.source.sourceRef)
    rows.push({ source: node.source, depth, hasChildren, expanded })
    if (expanded) node.children.forEach(child => { visit(child, depth + 1) })
  }
  roots.forEach(root => { visit(root, 0) })
  return rows
}
