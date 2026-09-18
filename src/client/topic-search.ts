import type { ArkmeSourceItem } from '../types.js'

/** Match names, retaining ancestors so nested results keep their context. */
export function filterArkmeTopicSources(sources: readonly ArkmeSourceItem[], input: string): ArkmeSourceItem[] {
  const query = input.trim().toLocaleLowerCase()
  if (!query) return [...sources]
  const byRef = new Map(sources.map(source => [source.sourceRef, source]))
  const byKey = new Map(sources.flatMap(source => source.topicHierarchyKey ? [[source.topicHierarchyKey, source] as const] : []))
  const included = new Set<string>()
  for (const source of sources) {
    if (!source.displayName.toLocaleLowerCase().includes(query)) continue
    let current: ArkmeSourceItem | undefined = source
    const visited = new Set<string>()
    while (current && !visited.has(current.sourceRef)) {
      visited.add(current.sourceRef)
      included.add(current.sourceRef)
      current = current.parentTopicHierarchyKey ? byKey.get(current.parentTopicHierarchyKey)
        : current.parentSourceRef ? byRef.get(current.parentSourceRef) : undefined
    }
  }
  return sources.filter(source => included.has(source.sourceRef))
}
