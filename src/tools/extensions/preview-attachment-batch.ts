import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ArkmeExtensionManager } from '../../extensions/manager.js'
import type { SelectedPreviewAttachment } from '../../extensions/session-preview-attachments.js'
import {
  addResolvedPreviewBatch,
  previewImageDigest,
  type PreviewBatchResult,
  type ResolvedPreviewImage,
} from './preview-batch.js'

const MAX_PREVIEW_BYTES = 5 * 1024 * 1024
const ACCEPTED_MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp'])

export async function resolvePreviewAttachments(input: {
  attachments: readonly SelectedPreviewAttachment[]
  store: AttachmentStore
  signal?: AbortSignal
}): Promise<ResolvedPreviewImage[]> {
  const resolved: ResolvedPreviewImage[] = []
  for (const selected of input.attachments) {
    input.signal?.throwIfAborted()
    const stored = await input.store.readImage(selected.ref, input.signal)
    if (String(stored.ref.attachmentId) !== String(selected.ref.attachmentId)
      || stored.data.byteLength !== stored.ref.bytes || stored.data.byteLength <= 0
      || stored.data.byteLength > MAX_PREVIEW_BYTES || !ACCEPTED_MEDIA.has(stored.ref.mediaType)
      || stored.ref.width < 320 || stored.ref.height < 320 || stored.ref.width > 4096 || stored.ref.height > 4096) {
      throw new Error(`第 ${String(selected.index)} 张图片不符合 PNG/JPEG/WebP、320-4096 像素、5 MiB 预览图限制`)
    }
    resolved.push({
      index: selected.index,
      mediaType: stored.ref.mediaType as 'image/png' | 'image/jpeg' | 'image/webp',
      data: stored.data,
      digest: previewImageDigest(stored.data),
    })
  }
  return resolved
}

export async function addPreviewAttachmentBatch(input: {
  extensionId: string
  attachments: readonly SelectedPreviewAttachment[]
  store: AttachmentStore
  manager: ArkmeExtensionManager
  signal?: AbortSignal
}): Promise<PreviewBatchResult> {
  const images = await resolvePreviewAttachments(input)
  return await addResolvedPreviewBatch({
    extensionId: input.extensionId,
    images,
    manager: input.manager,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
}
