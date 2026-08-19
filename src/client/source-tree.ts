import type { ArkmeSourceItem } from '../types.js'

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

/** Build a stable tree while treating missing, non-topic, self, and cyclic parents as roots. */
export function buildArkmeSourceTree(sources: ArkmeSourceItem[]): ArkmeSourceTreeNode[] {
  const sourcesByRef = new Map(sources.map(source => [source.sourceRef, source]))
  const nodesByRef = new Map<string, ArkmeSourceTreeNode>(
    sources.map(source => [source.sourceRef, { source, children: [] }]),
  )
  const roots: ArkmeSourceTreeNode[] = []

  const validParent = (source: ArkmeSourceItem): ArkmeSourceItem | undefined => {
    if (source.kind !== 'topic' || source.parentSourceRef === undefined) return undefined
    const seen = new Set([source.sourceRef])
    let parentRef: string | undefined = source.parentSourceRef
    let directParent: ArkmeSourceItem | undefined
    while (parentRef !== undefined) {
      if (seen.has(parentRef)) return undefined
      seen.add(parentRef)
      const parent = sourcesByRef.get(parentRef)
      if (parent?.kind !== 'topic') return undefined
      directParent ??= parent
      parentRef = parent.parentSourceRef
    }
    return directParent
  }

  for (const source of sources) {
    const node = nodesByRef.get(source.sourceRef)!
    const parent = validParent(source)
    const parentNode = parent === undefined ? undefined : nodesByRef.get(parent.sourceRef)
    if (parentNode === undefined) roots.push(node)
    else parentNode.children.push(node)
  }
  return roots
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
