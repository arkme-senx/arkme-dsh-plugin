import { useRef } from 'react'
import { ArkmeAttachmentDraftTile } from './ArkmeRichContent.js'
import { arkmeLocalFileUrl } from './ArkmeFileViewer.js'
import { arkmeAttachmentId, arkmeAttachmentMetadata, type ArkmeComposerAttachment } from './composer-draft-store.js'

/** Local preparation stays in the existing add button, not in a separate workflow. */
export function ArkmeFilePreparingIndicator() {
  return <svg width="18" height="18" viewBox="0 0 20 20" role="progressbar" aria-label="正在准备附件">
    <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="30 14">
      <animateTransform attributeName="transform" type="rotate" from="0 10 10" to="360 10 10" dur="0.8s" repeatCount="indefinite" />
    </circle>
  </svg>
}

export function ArkmeAttachmentStrip({ attachments, disabled, onMove, onRemove, onPreview }: {
  attachments: readonly ArkmeComposerAttachment[]
  disabled: boolean
  onMove(from: number, to: number): void
  onRemove(attachment: ArkmeComposerAttachment): void
  onPreview(attachment: ArkmeComposerAttachment): void
}) {
  const dragging = useRef<string>()
  return <div role="list" aria-label="待发送附件" style={{ display: 'flex', gap: 4, overflowX: 'auto', flex: 'none' }}>
    {attachments.map((attachment, index) => {
      const id = arkmeAttachmentId(attachment)
      const metadata = arkmeAttachmentMetadata(attachment)
      const canMove = !disabled && attachments.length > 1
      return <span key={id} role="listitem" tabIndex={canMove ? 0 : -1}
        aria-label={`${metadata.fileName}，第 ${index + 1} 个附件`}
        aria-keyshortcuts={canMove ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined}
        title={canMove ? '拖动调整顺序；也可按 Alt 加左右方向键' : metadata.fileName}
        draggable={canMove} style={{ display: 'inline-flex', flex: 'none', cursor: canMove ? 'grab' : undefined }}
        onDragStart={event => {
          if (!canMove) { event.preventDefault(); return }
          dragging.current = id
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-arkme-draft-attachment', id)
        }}
        onDragEnd={() => { dragging.current = undefined }}
        onDragOver={event => { if (canMove && dragging.current !== undefined) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
        onDrop={event => {
          const from = attachments.findIndex(value => arkmeAttachmentId(value) === dragging.current)
          dragging.current = undefined
          if (!canMove || from < 0) return
          event.preventDefault(); event.stopPropagation()
          if (from !== index) onMove(from, index)
        }}
        onKeyDown={event => {
          if (!canMove || !event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
          const to = index + (event.key === 'ArrowLeft' ? -1 : 1)
          event.preventDefault(); event.stopPropagation()
          if (to >= 0 && to < attachments.length) onMove(index, to)
        }}>
        <ArkmeAttachmentDraftTile asset={metadata} disabled={disabled}
          {...(attachment.localFile === undefined
            ? attachment.previewUrl === undefined ? {} : { previewUrl: attachment.previewUrl }
            : { previewUrl: arkmeLocalFileUrl(attachment.localFile.fileRef), onOpen: () => onPreview(attachment) })}
          onRemove={() => { if (!disabled) onRemove(attachment) }} />
      </span>
    })}
  </div>
}
