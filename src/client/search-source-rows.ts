import type { ArkmeSearchSourceAggregate, ArkmeSearchSourceMatch } from '../types.js'

export type SearchSourceRow = ArkmeSearchSourceMatch & {
  matchedRecordCount?: number
  matchedRecordCountExact?: boolean
  nameMatched?: boolean
}

/** Keep authoritative content counts while prioritizing viewer-visible name matches. */
export function searchSourceRows(aggregates: ArkmeSearchSourceAggregate[], names: ArkmeSearchSourceMatch[]): SearchSourceRow[] {
  const byKey = new Map<string, SearchSourceRow>()
  for (const item of aggregates) byKey.set(`${String(item.sourceKind)}:${item.sourceUid}`, item)
  for (const item of names) {
    const key = `${String(item.sourceKind)}:${item.sourceUid}`
    byKey.set(key, { ...byKey.get(key), ...item, nameMatched: true })
  }
  return [...byKey.values()].map(item => ({ ...item, title: item.targetSource?.displayName || item.title,
    ...(item.targetSource?.privateNickname ? { nickname: item.targetSource.privateNickname } : {}) }))
    .sort((a, b) => Number(b.nameMatched === true) - Number(a.nameMatched === true))
}
