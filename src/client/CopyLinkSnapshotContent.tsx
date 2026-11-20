import type { ArkmeMessageCopyLinkSnapshotItem, ArkmeTimelineItem } from '../types.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { RecordingShareSegments } from './RecordingShareSegments.js'

/** Uses the same share detail drawer for both chat and recording links. */
export function CopyLinkSnapshotContent({ item, snapshot, shareWebsite }: {
  item: ArkmeMessageCopyLinkSnapshotItem; snapshot: ArkmeTimelineItem; shareWebsite: string
}) {
  const segments = item.templateKind === 5 && item.structuredContent?.structuredKind === 1 ? item.structuredContent.longRecordingSegments : undefined
  if (!segments?.length) return <ArkmeMessageContent item={snapshot} presentation="detail" shareWebsite={shareWebsite} />
  const audio = item.structuredContent?.recordingAudioUrl
  return <div data-arkme-copy-link-recording><RecordingShareSegments key={audio} segments={segments} audioUrl={audio} media={item.structuredContent?.recordingAudio} /></div>
}
