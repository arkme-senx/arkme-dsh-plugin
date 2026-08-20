import { createHash } from 'node:crypto'
import type { ArkmeExtensionManager } from '../../extensions/manager.js'
import type { ArkmeExtensionPreviewItem } from '../../extensions/types.js'

export interface ResolvedPreviewImage {
  index: number
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  data: Uint8Array
  digest: string
}

export interface PreviewBatchResult {
  outcome: 'complete' | 'partial'
  extension_id: string
  added_count: number
  preview_images: ArkmeExtensionPreviewItem[]
  preview_revision: number
  failed?: { index: number; message: string }
}

export function previewImageDigest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

export function previewImageFingerprint(extensionId: string, images: readonly ResolvedPreviewImage[]): string {
  return createHash('sha256')
    .update(`arkme-extension-preview-confirmation\0${extensionId}\0${images.map(image => image.digest).join('\0')}`)
    .digest('hex')
}

export async function preflightResolvedPreviewBatch(input: {
  extensionId: string
  images: readonly ResolvedPreviewImage[]
  manager: ArkmeExtensionManager
  signal?: AbortSignal
}): Promise<{ existing: ArkmeExtensionPreviewItem[]; missing: ResolvedPreviewImage[]; previewRevision: number }> {
  if (input.images.length === 0 || input.images.length > 20
    || new Set(input.images.map(image => image.digest)).size !== input.images.length) {
    throw new Error('预览图批次必须包含 1-20 张内容不同的图片')
  }
  const page = await input.manager.myList(input.signal)
  const owned = page.items.find(item => item.extension_id === input.extensionId)
  if (owned === undefined) throw new Error('当前账号不存在该扩展')
  const existing = owned.preview_images ?? []
  const existingRefs = new Set(existing.map(item => item.preview_ref))
  const missing = input.images.filter(image => !existingRefs.has(`preview_v1_${image.digest}`))
  if (existing.length + missing.length > 20) throw new Error('扩展预览图最多只能有 20 张')
  return { existing, missing, previewRevision: owned.preview_revision ?? 0 }
}

function mutationUuid(extensionId: string, digest: string): string {
  const value = createHash('sha256').update(`arkme-extension-preview\0${extensionId}\0${digest}`).digest('hex')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`
}

export async function addResolvedPreviewBatch(input: {
  extensionId: string
  images: readonly ResolvedPreviewImage[]
  manager: ArkmeExtensionManager
  signal?: AbortSignal
}): Promise<PreviewBatchResult> {
  const preflight = await preflightResolvedPreviewBatch(input)

  let gallery = {
    extension_id: input.extensionId,
    preview_images: preflight.existing,
    preview_revision: preflight.previewRevision,
  }
  let added = 0
  for (const item of preflight.missing) {
    try {
      gallery = await input.manager.addPreview({
        extensionId: input.extensionId,
        mediaType: item.mediaType,
        data: item.data,
        idempotencyKey: mutationUuid(input.extensionId, item.digest),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
      added += 1
    } catch (error) {
      if (added === 0) throw error
      return {
        outcome: 'partial', extension_id: input.extensionId, added_count: added,
        preview_images: gallery.preview_images, preview_revision: gallery.preview_revision,
        failed: { index: item.index, message: '预览图上传失败，请刷新后重试' },
      }
    }
  }
  return {
    outcome: 'complete', extension_id: input.extensionId, added_count: added,
    preview_images: gallery.preview_images, preview_revision: gallery.preview_revision,
  }
}
