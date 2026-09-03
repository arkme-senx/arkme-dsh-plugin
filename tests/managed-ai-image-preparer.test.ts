import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  assertImageRequestCanBePrepared,
  assertPreparedImageRequestBytes,
  effectiveImageRules,
  prepareManagedImage,
} from '../src/managed-ai/image-preparer.js'
import type { ManagedImageCapability } from '../src/managed-ai/transport.js'

function capability(overrides: Partial<ManagedImageCapability> = {}): ManagedImageCapability {
  return {
    allowedMediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maximumImages: 20,
    maximumBytesPerImage: 5 * 1024 * 1024,
    maximumPixels: 40_000_000,
    countDimensionLimits: [],
    mediaTypeDimensionLimits: [],
    ...overrides,
  }
}

async function storedImage(
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  width: number,
  height: number,
  configure?: (pipeline: sharp.Sharp) => sharp.Sharp,
): Promise<StoredImageAttachment> {
  let pipeline = sharp({ create: { width, height, channels: 3, background: '#4678d4' } })
  if (configure !== undefined) pipeline = configure(pipeline)
  switch (mediaType) {
    case 'image/jpeg': pipeline = pipeline.jpeg(); break
    case 'image/png': pipeline = pipeline.png(); break
    case 'image/webp': pipeline = pipeline.webp(); break
    case 'image/gif': pipeline = pipeline.gif(); break
  }
  const data = await pipeline.toBuffer()
  return {
    ref: {
      attachmentId: AttachmentId(`${mediaType}-${String(width)}x${String(height)}`),
      mediaType,
      bytes: data.byteLength,
      width,
      height,
    },
    data,
  }
}

describe('managed image preparation', () => {
  it('keeps an already compliant image byte-identical', async () => {
    const stored = await storedImage('image/png', 24, 12)
    const rules = effectiveImageRules(capability({ maximumWidth: 64, maximumHeight: 64 }), 1, stored.ref.mediaType)
    const prepared = await prepareManagedImage(stored, capability(), rules, new AbortController().signal)

    expect(prepared.data).toBe(stored.data)
    expect(prepared.ref).toBe(stored.ref)
  })

  it('auto-orients and proportionally downsizes JPEG without changing its format', async () => {
    const stored = await storedImage('image/jpeg', 20, 10, pipeline => pipeline.withMetadata({ orientation: 6 }))
    const policy = capability({ maximumWidth: 8, maximumHeight: 16 })
    const prepared = await prepareManagedImage(
      stored,
      policy,
      effectiveImageRules(policy, 1, stored.ref.mediaType),
      new AbortController().signal,
    )
    const metadata = await sharp(prepared.data).metadata()

    expect(prepared.ref.mediaType).toBe('image/jpeg')
    expect([prepared.ref.width, prepared.ref.height]).toEqual([8, 16])
    expect([metadata.width, metadata.height, metadata.orientation]).toEqual([8, 16, undefined])
  })

  it('downsizes high-resolution static WebP under its format-specific boundary', async () => {
    const stored = await storedImage('image/webp', 40, 30)
    const policy = capability({
      mediaTypeDimensionLimits: [{ mediaType: 'image/webp', maximumLongEdge: 20, maximumShortEdge: 12 }],
    })
    const prepared = await prepareManagedImage(
      stored,
      policy,
      effectiveImageRules(policy, 1, stored.ref.mediaType),
      new AbortController().signal,
    )
    const metadata = await sharp(prepared.data).metadata()

    expect(prepared.ref.mediaType).toBe('image/webp')
    expect([prepared.ref.width, prepared.ref.height]).toEqual([16, 12])
    expect(metadata.format).toBe('webp')
  })

  it('applies provider byte limits to resized output instead of rejecting the larger source', async () => {
    const stored = await storedImage('image/png', 200, 200)
    const policy = capability({
      maximumBytesPerImage: Math.floor(stored.ref.bytes / 2),
      maximumWidth: 10,
      maximumHeight: 10,
    })

    expect(() => assertImageRequestCanBePrepared([stored.ref], policy)).not.toThrow()
    const prepared = await prepareManagedImage(
      stored,
      policy,
      effectiveImageRules(policy, 1, stored.ref.mediaType),
      new AbortController().signal,
    )

    expect(prepared.ref.bytes).toBeLessThanOrEqual(policy.maximumBytesPerImage)
  })

  it('checks the request byte budget against the actual resized images', async () => {
    const first = await storedImage('image/png', 200, 200)
    const second = await storedImage('image/png', 180, 180)
    const policy = capability({
      maximumTotalBytes: Math.max(first.ref.bytes, second.ref.bytes),
      maximumWidth: 10,
      maximumHeight: 10,
    })

    expect(first.ref.bytes + second.ref.bytes).toBeGreaterThan(policy.maximumTotalBytes!)
    expect(() => assertImageRequestCanBePrepared([first.ref, second.ref], policy)).not.toThrow()
    const prepared = await Promise.all([first, second].map(async stored => await prepareManagedImage(
      stored,
      policy,
      effectiveImageRules(policy, 2, stored.ref.mediaType),
      new AbortController().signal,
    )))
    expect(() => assertPreparedImageRequestBytes(
      prepared.reduce((total, image) => total + image.ref.bytes, 0),
      policy,
    )).not.toThrow()
  })

  it('rejects an oversized GIF instead of silently flattening or converting it', async () => {
    const stored = await storedImage('image/gif', 32, 16)
    const policy = capability({ maximumWidth: 16, maximumHeight: 16 })

    await expect(prepareManagedImage(
      stored,
      policy,
      effectiveImageRules(policy, 1, stored.ref.mediaType),
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('applies request-count dimensions independently from format dimensions', () => {
    const policy = capability({
      maximumWidth: 100,
      maximumHeight: 100,
      countDimensionLimits: [{ minimumImages: 15, maximumWidth: 40, maximumHeight: 40 }],
      mediaTypeDimensionLimits: [{ mediaType: 'image/webp', maximumLongEdge: 30, maximumShortEdge: 20 }],
    })

    expect(effectiveImageRules(policy, 15, 'image/webp')).toMatchObject({
      maximumWidth: 40,
      maximumHeight: 40,
      maximumLongEdge: 30,
      maximumShortEdge: 20,
    })
    expect(effectiveImageRules(policy, 1, 'image/png')).not.toHaveProperty('maximumLongEdge')
  })
})
