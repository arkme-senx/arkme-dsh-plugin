import type { ArkmeTimelineItem } from '../types.js'

/** Same-version read failures may retain display, never claim a complete read. */
export function retainPartialTimelineMedia(previous: ArkmeTimelineItem | undefined, incoming: ArkmeTimelineItem): ArkmeTimelineItem {
  const version = incoming.recordVersion ?? incoming.version ?? 0
  if (incoming.mediaUnavailable !== true || incoming.status !== 1 || previous?.status !== 1
    || previous.itemUid !== incoming.itemUid || version <= 0
    || version !== (previous.recordVersion ?? previous.version)) return incoming
  const current = incoming.contentBlocks ?? []
  const assets = new Map(current.filter(block => block.fileAssetUid).map(block => [block.fileAssetUid, block]))
  const retained = (previous.contentBlocks ?? []).flatMap(block => {
    if (!block.fileAssetUid) return current.length === 0 ? [block] : []
    const replacement = assets.get(block.fileAssetUid)
    assets.delete(block.fileAssetUid)
    return [replacement ?? block]
  })
  return { ...incoming, contentBlocks: [...retained, ...current.filter(block => !block.fileAssetUid || assets.has(block.fileAssetUid))]
    .sort((left, right) => left.sortOrder - right.sortOrder) }
}
