import type { ArkmeDirectoryItem, ArkmeDirectoryPage } from '../../../types.js'
import { isPeoplePage } from '../../explore/people-view-cache.js'
import { tr } from '../../locale.js'

/** Reuse the owner-verified speaker identities, excluding identities linked to Arkme accounts. */
export function manualSpeakerDirectoryPage(value: unknown): ArkmeDirectoryPage {
  if (!isPeoplePage(value) || value.source !== 'speakers' || value.nextCursor
    || value.items.some(row => !row.key || typeof row.speakerRef !== 'string' || !row.speakerRef)) {
    throw new Error(tr('说话人名单读取不完整，请重试'))
  }
  const items = [...new Map(value.items.filter(row => !row.accountLinked && !row.isSelf).map(row => [row.key, {
    kind: 'manual-speaker', speakerKey: row.key, speakerRef: row.speakerRef!, displayName: row.name,
  } satisfies ArkmeDirectoryItem])).values()]
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN') || a.speakerKey.localeCompare(b.speakerKey))
  return { section: 'manual-speakers', items, total: items.length, hasMore: false, coverage: 'complete' }
}
