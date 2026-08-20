import { createHash } from 'node:crypto'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ArkmeExtensionManager } from '../../extensions/manager.js'
import type { SelectedPreviewAttachment } from '../../extensions/session-preview-attachments.js'
import type { ArkmeExtensionPreviewItem } from '../../extensions/types.js'

const MAX_PREVIEW_BYTES = 5 * 1024 * 1024
const ACCEPTED_MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp'])

export interface PreviewAttachmentBatchResult {
  outcome: 'complete' | 'partial'
  extension_id: string
  added_count: number
  preview_images: ArkmeExtensionPreviewItem[]
  preview_revision: number
  failed?: { index: number; message: string }
}

function mutationUuid(extensionId: string, attachmentId: string): string {
  const digest = createHash('sha256').update(`arkme-extension-preview\0${extensionId}\0${attachmentId}`).digest('hex')
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '预览图上传失败'
}

export async function addPreviewAttachmentBatch(input: {
  extensionId: string
  attachments: readonly SelectedPreviewAttachment[]
  store: AttachmentStore
  manager: ArkmeExtensionManager
  signal?: AbortSignal
}): Promise<PreviewAttachmentBatchResult> {
  const page = await input.manager.myList(input.signal)
  const owned = page.items.find(item => item.extension_id === input.extensionId)
  if (owned === undefined) throw new Error('当前账号不存在该扩展')
  const existing = owned.preview_images ?? []
  if (existing.length + input.attachments.length > 20) throw new Error('扩展预览图最多只能有 20 张')
  const resolved = [] as Array<{
    selected: SelectedPreviewAttachment
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
    data: Uint8Array
  }>
  for (const selected of input.attachments) {
    input.signal?.throwIfAborted()
    const stored = await input.store.readImage(selected.ref, input.signal)
    if (String(stored.ref.attachmentId) !== String(selected.ref.attachmentId)
      || stored.data.byteLength !== stored.ref.bytes || stored.data.byteLength <= 0
      || stored.data.byteLength > MAX_PREVIEW_BYTES || !ACCEPTED_MEDIA.has(stored.ref.mediaType)) {
      throw new Error(`第 ${String(selected.index)} 张图片不符合 PNG/JPEG/WebP、5 MiB 预览图限制`)
    }
    resolved.push({
      selected,
      mediaType: stored.ref.mediaType as 'image/png' | 'image/jpeg' | 'image/webp',
      data: stored.data,
    })
  }
  let gallery = { extension_id: input.extensionId, preview_images: existing, preview_revision: owned.preview_revision ?? 0 }
  let added = 0
  for (const item of resolved) {
    try {
      gallery = await input.manager.addPreview({
        extensionId: input.extensionId,
        mediaType: item.mediaType,
        data: item.data,
        idempotencyKey: mutationUuid(input.extensionId, String(item.selected.ref.attachmentId)),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
      added += 1
    } catch (error) {
      if (added === 0) throw error
      return {
        outcome: 'partial', extension_id: input.extensionId, added_count: added,
        preview_images: gallery.preview_images, preview_revision: gallery.preview_revision,
        failed: { index: item.selected.index, message: errorMessage(error) },
      }
    }
  }
  return {
    outcome: 'complete', extension_id: input.extensionId, added_count: added,
    preview_images: gallery.preview_images, preview_revision: gallery.preview_revision,
  }
}
