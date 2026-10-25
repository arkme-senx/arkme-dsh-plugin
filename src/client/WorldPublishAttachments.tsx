import type { ArkmeContentBlock, ArkmeUploadedAsset } from '../types.js'
import { ArkmeAttachmentStrip } from './ArkmeAttachmentStrip.js'
import { createArkmeSdk } from '../sdk/index.js'
import { openSessionAttachmentPreview } from './ArkmeRichContent.js'
import { showAttachmentPreview, closeAttachmentPreview } from './attachment-preview-window.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

export interface WorldPublishAttachment {
  id: string; file?: File; asset?: ArkmeUploadedAsset; block?: ArkmeContentBlock
  previewUrl?: string; unavailable?: boolean; state?: 'preparing' | 'failed'; error?: string
}
export function worldPublishAttachmentBlocked(item: WorldPublishAttachment): boolean {
  const image = item.file ? item.file.type.startsWith('image/') : item.asset?.fileKind === 1 && item.asset.mimeType.startsWith('image/')
  const size = item.file?.size ?? item.asset?.size ?? 0
  return item.unavailable === true || !!item.block?.dynamicPhoto || !image || size <= 0 || size > 20 * 1024 * 1024
}
export function WorldPublishAttachments({ items, disabled, onRemove, onMove, onRetry }: {
  items: readonly WorldPublishAttachment[]; disabled: boolean; onRemove(id: string): void; onMove(from: number, to: number): void; onRetry(): void
}) {
  return <div data-world-publish-images="shared-self"><ArkmeAttachmentStrip disabled={disabled} onMove={onMove}
    attachments={items.map(item => {
      const asset = item.asset ?? { fileAssetUid: item.id, fileName: item.file?.name ?? '附件', size: item.file?.size ?? 0, mimeType: item.file?.type ?? '', fileKind: 1 as const }
      const previewUrl = item.previewUrl ?? (item.block?.kind === 'image' ? createArkmeSdk().mediaUrl(item.block.mediaRef) : undefined)
      const common = { clientId: item.id, ...(previewUrl ? { previewUrl } : {}) }
      return item.state ? { ...common, preparation: { ...asset, id: item.id, state: item.state, ...(item.error ? { error: item.error } : {}), retry: onRetry, cancel: () => onRemove(item.id) } } : { ...common, asset }
    })} canPreview={attachment => { const item = items.find(value => value.id === attachment.clientId); return !!item && (!!item.block || !!item.previewUrl) }}
    onPreview={attachment => {
      const item = items.find(value => value.id === attachment.clientId)
      if (item?.block) { openSessionAttachmentPreview([item.block], item.block, 'world-publish', false); return }
      if (item?.previewUrl) showAttachmentPreview(`world-draft:${item.id}`, () => <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: arkmeTheme.base, color: arkmeTheme.text }}>
        <button type="button" aria-label={tr('关闭预览')} style={{ alignSelf: 'flex-end', padding: 12 }} onClick={closeAttachmentPreview}>×</button>
        <img src={item.previewUrl} alt={item.file?.name ?? '图片'} style={{ minHeight: 0, flex: 1, width: '100%', objectFit: 'contain' }} />
      </div>)
    }} onRemove={item => onRemove(item.clientId!)} /></div>
}
