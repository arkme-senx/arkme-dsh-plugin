import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import sharp from 'sharp'
import type { ManagedImageCapability } from './transport.js'

const MAXIMUM_DECODED_IMAGE_PIXELS = 40_000_000
const MAXIMUM_SOURCE_IMAGE_BYTES = 64 << 20
const MAXIMUM_SOURCE_REQUEST_IMAGE_BYTES = 1 << 30

export interface EffectiveImageRules {
  maximumWidth?: number
  maximumHeight?: number
  maximumPixels?: number
  maximumLongEdge?: number
  maximumShortEdge?: number
}

export interface PreparedManagedImage {
  ref: ImageAttachmentRef
  data: Uint8Array
}

export function effectiveImageRules(
  capability: ManagedImageCapability,
  imageCount: number,
  mediaType: string,
): EffectiveImageRules {
  let maximumWidth = capability.maximumWidth
  let maximumHeight = capability.maximumHeight
  for (const limit of capability.countDimensionLimits) {
    if (imageCount >= limit.minimumImages) {
      maximumWidth = limit.maximumWidth
      maximumHeight = limit.maximumHeight
    }
  }
  const mediaLimit = capability.mediaTypeDimensionLimits?.find(limit => limit.mediaType === mediaType)
  return {
    ...(maximumWidth === undefined ? {} : { maximumWidth }),
    ...(maximumHeight === undefined ? {} : { maximumHeight }),
    ...(capability.maximumPixels === undefined ? {} : { maximumPixels: capability.maximumPixels }),
    ...(mediaLimit === undefined ? {} : {
      maximumLongEdge: mediaLimit.maximumLongEdge,
      maximumShortEdge: mediaLimit.maximumShortEdge,
    }),
  }
}

export function imagePreparationVariant(rules: EffectiveImageRules): string {
  return [
    rules.maximumWidth ?? 0,
    rules.maximumHeight ?? 0,
    rules.maximumPixels ?? 0,
    rules.maximumLongEdge ?? 0,
    rules.maximumShortEdge ?? 0,
  ].join(':')
}

export function assertImageRequestCanBePrepared(
  attachments: readonly ImageAttachmentRef[],
  capability: ManagedImageCapability,
): void {
  if (attachments.length > capability.maximumImages) {
    throw new LlmError('图片数量超过当前 Arkme 模型的输入上限', 'INVALID_REQUEST')
  }
  let totalBytes = 0
  let allImagesRemainByteIdentical = true
  for (const attachment of attachments) {
    assertSourceImage(attachment, capability)
    const rules = effectiveImageRules(capability, attachments.length, attachment.mediaType)
    const resizeRequired = requiresResize(attachment.width, attachment.height, rules)
    allImagesRemainByteIdentical &&= !resizeRequired
    if (!resizeRequired && attachment.bytes > capability.maximumBytesPerImage) {
      throw new LlmError('图片大小超过当前 Arkme 模型的输入上限', 'INVALID_REQUEST')
    }
    totalBytes += attachment.bytes
    if (!Number.isSafeInteger(totalBytes)) throw new LlmError('图片总大小无效', 'INVALID_REQUEST')
  }
  if (totalBytes > MAXIMUM_SOURCE_REQUEST_IMAGE_BYTES) {
    throw new LlmError('图片原始数据总量超过 Arkme 安全上限', 'INVALID_REQUEST')
  }
  if (allImagesRemainByteIdentical
    && capability.maximumTotalBytes !== undefined
    && totalBytes > capability.maximumTotalBytes) {
    throw new LlmError('图片总大小超过当前 Arkme 模型的输入上限', 'INVALID_REQUEST')
  }
}

export function assertPreparedImageRequestBytes(
  totalBytes: number,
  capability: ManagedImageCapability,
): void {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0
    || (capability.maximumTotalBytes !== undefined && totalBytes > capability.maximumTotalBytes)) {
    throw new LlmError('处理后的图片总大小超过当前 Arkme 模型的输入上限', 'INVALID_REQUEST')
  }
}

function assertSourceImage(attachment: ImageAttachmentRef, capability: ManagedImageCapability): void {
  const pixels = attachment.width * attachment.height
  if (!capability.allowedMediaTypes.includes(attachment.mediaType)
    || !Number.isSafeInteger(attachment.bytes) || attachment.bytes <= 0
    || !Number.isSafeInteger(attachment.width) || attachment.width <= 0
    || !Number.isSafeInteger(attachment.height) || attachment.height <= 0
    || attachment.bytes > MAXIMUM_SOURCE_IMAGE_BYTES
    || !Number.isSafeInteger(pixels) || pixels <= 0 || pixels > MAXIMUM_DECODED_IMAGE_PIXELS
    || (capability.minimumWidth !== undefined && attachment.width < capability.minimumWidth)
    || (capability.minimumHeight !== undefined && attachment.height < capability.minimumHeight)
    || (capability.maximumAspectRatio !== undefined
      && Math.max(attachment.width, attachment.height) > Math.min(attachment.width, attachment.height) * capability.maximumAspectRatio)) {
    throw new LlmError('图片不符合当前 Arkme 模型的输入限制', 'INVALID_REQUEST')
  }
}

function requiresResize(width: number, height: number, rules: EffectiveImageRules): boolean {
  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)
  return (rules.maximumWidth !== undefined && width > rules.maximumWidth)
    || (rules.maximumHeight !== undefined && height > rules.maximumHeight)
    || (rules.maximumPixels !== undefined && width * height > rules.maximumPixels)
    || (rules.maximumLongEdge !== undefined && longEdge > rules.maximumLongEdge)
    || (rules.maximumShortEdge !== undefined && shortEdge > rules.maximumShortEdge)
}

function targetDimensions(width: number, height: number, rules: EffectiveImageRules): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)
  const scales = [1]
  if (rules.maximumWidth !== undefined) scales.push(rules.maximumWidth / width)
  if (rules.maximumHeight !== undefined) scales.push(rules.maximumHeight / height)
  if (rules.maximumPixels !== undefined) scales.push(Math.sqrt(rules.maximumPixels / (width * height)))
  if (rules.maximumLongEdge !== undefined) scales.push(rules.maximumLongEdge / longEdge)
  if (rules.maximumShortEdge !== undefined) scales.push(rules.maximumShortEdge / shortEdge)
  const scale = Math.min(...scales)
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }
}

function expectedSharpFormat(mediaType: string): 'jpeg' | 'png' | 'webp' | 'gif' {
  switch (mediaType) {
    case 'image/jpeg': return 'jpeg'
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    default: throw new LlmError('图片格式不受支持', 'INVALID_REQUEST')
  }
}

function assertPreparedImage(ref: ImageAttachmentRef, capability: ManagedImageCapability, rules: EffectiveImageRules): void {
  const pixels = ref.width * ref.height
  const longEdge = Math.max(ref.width, ref.height)
  const shortEdge = Math.min(ref.width, ref.height)
  if (ref.bytes <= 0 || ref.bytes > capability.maximumBytesPerImage
    || (capability.minimumWidth !== undefined && ref.width < capability.minimumWidth)
    || (capability.minimumHeight !== undefined && ref.height < capability.minimumHeight)
    || (capability.maximumAspectRatio !== undefined && longEdge > shortEdge * capability.maximumAspectRatio)
    || (rules.maximumWidth !== undefined && ref.width > rules.maximumWidth)
    || (rules.maximumHeight !== undefined && ref.height > rules.maximumHeight)
    || (rules.maximumPixels !== undefined && pixels > rules.maximumPixels)
    || (rules.maximumLongEdge !== undefined && longEdge > rules.maximumLongEdge)
    || (rules.maximumShortEdge !== undefined && shortEdge > rules.maximumShortEdge)) {
    throw new LlmError('图片处理后仍不符合当前 Arkme 模型的输入限制', 'INVALID_REQUEST')
  }
}

export async function prepareManagedImage(
  stored: StoredImageAttachment,
  capability: ManagedImageCapability,
  rules: EffectiveImageRules,
  signal: AbortSignal,
): Promise<PreparedManagedImage> {
  signal.throwIfAborted()
  assertSourceImage(stored.ref, capability)
  if (!requiresResize(stored.ref.width, stored.ref.height, rules)) {
    assertPreparedImage(stored.ref, capability, rules)
    return stored
  }
  if (stored.ref.mediaType === 'image/gif') {
    throw new LlmError('当前 GIF 尺寸超过模型上限，请缩小后重新附加', 'INVALID_REQUEST')
  }

  const input = sharp(stored.data, {
    failOn: 'warning',
    limitInputPixels: MAXIMUM_DECODED_IMAGE_PIXELS,
    sequentialRead: true,
  }).timeout({ seconds: 10 })
  const metadata = await input.metadata()
  signal.throwIfAborted()
  if (metadata.format !== expectedSharpFormat(stored.ref.mediaType)
    || metadata.width !== stored.ref.width || metadata.height !== stored.ref.height
    || (metadata.pages ?? 1) > 1) {
    throw new LlmError('无法安全处理当前图片，请转换为静态图片后重试', 'INVALID_REQUEST')
  }

  const target = targetDimensions(metadata.autoOrient.width, metadata.autoOrient.height, rules)
  let pipeline = sharp(stored.data, {
    failOn: 'warning',
    limitInputPixels: MAXIMUM_DECODED_IMAGE_PIXELS,
    sequentialRead: true,
  }).autoOrient().resize({ width: target.width, height: target.height, fit: 'inside', withoutEnlargement: true })
    .timeout({ seconds: 10 })
  switch (stored.ref.mediaType) {
    case 'image/jpeg': pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true }); break
    case 'image/png': pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }); break
    case 'image/webp': pipeline = pipeline.webp({ quality: 90 }); break
  }
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
  signal.throwIfAborted()
  const ref: ImageAttachmentRef = {
    attachmentId: stored.ref.attachmentId,
    mediaType: stored.ref.mediaType,
    bytes: data.byteLength,
    width: info.width,
    height: info.height,
    ...(stored.ref.name === undefined ? {} : { name: stored.ref.name }),
  }
  assertPreparedImage(ref, capability, rules)
  return { ref, data }
}
