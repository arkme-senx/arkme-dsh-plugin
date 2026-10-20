import type { ExploreEvidence } from './explore-contract.js'

/** One card per source identity, keeping all distinct mention positions across pages. */
export function mergeExploreEvidence(...pages: readonly ExploreEvidence[][]): ExploreEvidence[] {
  const rows = new Map<string, ExploreEvidence>()
  for (const item of pages.flat()) {
    const previous = rows.get(item.key)
    if (!previous) { rows.set(item.key, item); continue }
    // A current body or revoked source replaces every older attribution/ref.
    // Merging old positions into an edited body would present stale identities.
    if (item.personReferenceStatus === 'unavailable' || item.text !== previous.text) {
      rows.set(item.key, item); continue
    }
    const mentions = new Map<string, NonNullable<ExploreEvidence['mentions']>[number]>()
    for (const mention of [...previous.mentions ?? [], ...item.mentions ?? []]) {
      mentions.set(`${mention.start}:${mention.end}:${mention.text}`, mention)
    }
    rows.set(item.key, {
      ...previous, ...item, text: item.text || previous.text,
      ...(previous.ref && !item.ref ? { ref: previous.ref } : {}),
      anchor: previous.anchor || item.anchor,
      ...(mentions.size ? { mentions: [...mentions.values()].sort((a,b) => a.start-b.start) } : {}),
    })
  }
  return [...rows.values()]
}
