import type { ArkmeMessageCopyLinkSnapshotItem, ArkmeTimelineItem } from '../types.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { arkmeTheme } from './arkme-theme.js'

function offset(millis: number): string {
  const seconds = Math.floor(millis / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
}

/** Uses the same share detail drawer for both chat and recording links. */
export function CopyLinkSnapshotContent({ item, snapshot, shareWebsite }: {
  item: ArkmeMessageCopyLinkSnapshotItem; snapshot: ArkmeTimelineItem; shareWebsite: string
}) {
  const segments = item.templateKind === 5 && item.structuredContent?.structuredKind === 1 ? item.structuredContent.longRecordingSegments : undefined
  if (!segments?.length) return <ArkmeMessageContent item={snapshot} presentation="detail" shareWebsite={shareWebsite} />
  return <section aria-label="已分享的录音片段" data-arkme-copy-link-recording>
    {item.title && <p style={{ margin: '0 0 10px', fontWeight: 500 }}>{item.title}</p>}
    {segments.map((segment, index) => <div key={index} data-arkme-copy-link-recording-segment
      style={{ padding: '8px 0', borderTop: index ? `1px solid ${arkmeTheme.borderSoft}` : undefined }}>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', fontSize: 12, color: arkmeTheme.secondary }}>
        <span>{segment.speakerName}</span><time style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{offset(segment.startMillis)}–{offset(segment.endMillis)}</time>
      </div>
      <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text', cursor: 'text', fontSize: 14, lineHeight: 1.65 }}>{segment.textContent}</p>
    </div>)}
    {!!item.contentBlocks?.length && <ArkmeMessageContent item={{ ...snapshot, title: '', textContent: '', contentBlocks: item.contentBlocks }} presentation="detail" shareWebsite={shareWebsite} />}
    {item.mediaUnavailable && <p style={{ color: arkmeTheme.secondary, fontSize: 12 }}>分享中的音频暂不可用</p>}
  </section>
}
