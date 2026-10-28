import type { CSSProperties } from 'react'
import type { ArkmeTimelineExtensionParent } from '../types.js'
import { useArkmeMediaUrl } from './media-access.js'
import { createArkmeSdk } from '../sdk/index.js'
import { ArkmeQuotePreview } from './ArkmeQuotePreview.js'
import { ArkmeRichText } from './ArkmeRichText.js'
import { arkmeEmojiPlainText } from './arkme-emoji.js'
import { ArkmeLivePhotoBadge } from './ArkmeLivePhotoBadge.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'
const ARKME_MESSAGE_AVATAR_SIZE = 34
const styles = {
  extensionParentPreview: {
    maxWidth: 'min(600px, 100%)', minWidth: 30, display: 'flex', alignItems: 'center', gap: 8,
    padding: 8, boxSizing: 'border-box', overflow: 'hidden', borderRadius: '12px 12px 0 0',
    background: `linear-gradient(180deg, ${arkmeTheme.subtle} 0%, transparent 68.06%)`,
    color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '16px',
  },
  extensionParentPreviewMe: { marginRight: ARKME_MESSAGE_AVATAR_SIZE + 10 },
  extensionParentPreviewOther: { marginLeft: ARKME_MESSAGE_AVATAR_SIZE + 10 },
  extensionParentText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  extensionParentMedia: { display: 'flex', flex: 'none', gap: 4 },
  extensionParentImage: { width: 32, height: 32, display: 'block', objectFit: 'cover', borderRadius: 5, background: arkmeTheme.subtle },
  extensionParentFile: { maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: arkmeTheme.secondary },
} satisfies Record<string, CSSProperties>

export function ArkmeExtensionParentPreview({ parent, isMe, onSelect, inline = false }: {
  inline?: boolean
  parent: ArkmeTimelineExtensionParent
  isMe: boolean
  onSelect?: (() => void) | undefined
}) {
  const mediaUrl = useArkmeMediaUrl()
  const placement = inline ? {} : isMe ? styles.extensionParentPreviewMe : styles.extensionParentPreviewOther
  if (parent.quote || parent.quoteState === 'unavailable') return <div style={{ ...styles.extensionParentPreview, ...placement, background: 'transparent' }}><ArkmeQuotePreview parent={parent} wholeMessageText={parent.textContent || parent.title} onOpen={onSelect} /></div>
  const text = parent.textContent.trim() || parent.title.trim()
  const blocks = [...(parent.contentBlocks ?? [])].sort((left, right) => left.sortOrder - right.sortOrder)
  const visuals = blocks.filter(block => block.kind === 'image' || block.kind === 'video').slice(0, 3)
  const firstFile = blocks.find(block => block.kind !== 'image' && block.kind !== 'video')
  return <div
    data-arkme-extension-parent-preview={parent.itemUid}
    style={{
      ...styles.extensionParentPreview,
      ...placement,
      ...(onSelect === undefined ? {} : { cursor: 'pointer' }),
    }}
    title={arkmeEmojiPlainText(text) || firstFile?.fileName}
    role={onSelect === undefined ? undefined : 'button'}
    tabIndex={onSelect === undefined ? undefined : 0}
    onClick={onSelect}
    onKeyDown={onSelect === undefined ? undefined : event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() }
    }}
  >
    {text !== '' && <span style={styles.extensionParentText}><ArkmeRichText text={text} presentation="preview" /></span>}
    {visuals.length > 0 && <span style={styles.extensionParentMedia} aria-label={tr("原消息附件")}>
      {visuals.map(block => block.kind === 'image'
        ? <span key={block.mediaRef} style={{ position: 'relative', display: 'flex', alignSelf: 'center', flex: 'none' }}>
          <img
            src={mediaUrl(block) ?? (block.localFileRef === undefined
              ? `/arkme-self/api/media?ref=${encodeURIComponent(block.mediaRef)}`
              : createArkmeSdk().localFileUrl(block.localFileRef))}
            alt={block.fileName}
            draggable={false}
            style={styles.extensionParentImage}
          />
          {block.dynamicPhoto !== undefined && <span aria-label={tr("实况照片")} style={{ position: 'absolute', display: 'flex', left: 2, bottom: 2, pointerEvents: 'none' }}>
            <ArkmeLivePhotoBadge variant="extension" />
          </span>}
        </span>
        : <span key={block.mediaRef} style={styles.extensionParentFile}>{block.fileName || tr("视频")}</span>)}
    </span>}
    {text === '' && visuals.length === 0 && firstFile !== undefined
      ? <span style={styles.extensionParentFile}>{firstFile.fileName || '附件'}</span>
      : null}
  </div>
}
