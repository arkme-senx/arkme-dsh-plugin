import type { ArkmeArkoImageInput } from './types.js'

export const ARKO_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
export const ARKO_IMAGE_DRAFT_LIMIT = 9
export const ARKO_IMAGE_DRAFT_MAX_BYTES = 20 * 1024 * 1024

/** Capability is an end-to-end server promise, never inferred from a model name. */
export function arkoImageInputFromWire(value: unknown): ArkmeArkoImageInput | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const data = value as Record<string, unknown>
  const positive = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0
  if (data.protocol_version !== 1 || data.enabled !== true
    || !positive(data.max_images) || !positive(data.max_image_bytes) || !positive(data.max_total_bytes)
    || !Array.isArray(data.mime_types)) return undefined
  const supported = data.mime_types
  const mimeTypes = ARKO_IMAGE_MIME_TYPES.filter(mime => supported.includes(mime))
  if (mimeTypes.length === 0) return undefined
  return { protocolVersion: 1, maxImages: Math.min(ARKO_IMAGE_DRAFT_LIMIT, data.max_images),
    maxImageBytes: Math.min(ARKO_IMAGE_DRAFT_MAX_BYTES, data.max_image_bytes),
    maxTotalBytes: data.max_total_bytes, mimeTypes }
}

export function arkoImageInputError(capability: ArkmeArkoImageInput | undefined,
  files: readonly { mimeType: string; size: number; fileName: string }[]): string | undefined {
  if (files.length === 0) return undefined
  if (capability === undefined) return '当前模型的图片能力尚未接通，请选择支持图片的模型；图片和文字已保留'
  if (files.length > capability.maxImages) return `当前模型每次最多支持 ${capability.maxImages} 张图片`
  for (const file of files) {
    if (!capability.mimeTypes.includes(file.mimeType)) return `${file.fileName}：当前模型不支持此图片格式`
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > capability.maxImageBytes) {
      return `${file.fileName}：图片大小须在 ${Math.floor(capability.maxImageBytes / 1024 / 1024)} MB 以内`
    }
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > capability.maxTotalBytes) return '图片总大小超过当前模型限制，请减少图片后重试'
  return undefined
}
