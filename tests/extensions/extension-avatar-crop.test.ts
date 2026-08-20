import { describe, expect, it, vi } from 'vitest'
import {
  chooseExtensionAvatarEncoding,
  extensionAvatarCropGeometry,
  extensionAvatarSourceError,
} from '../../src/client/extension-avatar-crop.js'

const MiB = 1024 * 1024

describe('extension avatar crop and normalization', () => {
  it('accepts a large browser-decodable image for cropping before enforcing the final limit', () => {
    expect(extensionAvatarSourceError({ type: 'image/heic', size: 8 * MiB })).toBeUndefined()
    expect(extensionAvatarSourceError({ type: 'image/jpeg', size: 20 * MiB })).toBeUndefined()
  })

  it('rejects empty, non-image, and source files above the browser memory guard', () => {
    expect(extensionAvatarSourceError({ type: 'image/jpeg', size: 0 })).toContain('不能为空')
    expect(extensionAvatarSourceError({ type: 'application/pdf', size: 10 })).toContain('图片')
    expect(extensionAvatarSourceError({ type: 'image/jpeg', size: 20 * MiB + 1 })).toContain('20 MiB')
  })

  it('derives a centered square crop from a landscape image and zooms around its center', () => {
    const base = extensionAvatarCropGeometry({
      imageWidth: 4000, imageHeight: 2000, viewportSize: 280, zoom: 1, panX: 0, panY: 0,
    })
    expect(base.sourceX).toBeCloseTo(1000)
    expect(base.sourceY).toBeCloseTo(0)
    expect(base.sourceSize).toBeCloseTo(2000)
    const zoomed = extensionAvatarCropGeometry({
      imageWidth: 4000, imageHeight: 2000, viewportSize: 280, zoom: 2, panX: 0, panY: 0,
    })
    expect(zoomed.sourceX).toBeCloseTo(1500)
    expect(zoomed.sourceY).toBeCloseTo(500)
    expect(zoomed.sourceSize).toBeCloseTo(1000)
  })

  it('clamps panning so the square viewport never exposes empty space', () => {
    const geometry = extensionAvatarCropGeometry({
      imageWidth: 1000, imageHeight: 2000, viewportSize: 280, zoom: 1, panX: 9999, panY: -9999,
    })
    expect(geometry.sourceX).toBe(0)
    expect(geometry.sourceY).toBeCloseTo(1000)
    expect(geometry.sourceSize).toBeCloseTo(1000)
  })

  it('tries WebP first and falls back until encoded output fits the 2 MiB final contract', async () => {
    const attempts: Array<{ mediaType: string; quality: number; dimension: number }> = []
    const result = await chooseExtensionAvatarEncoding(async candidate => {
      attempts.push(candidate)
      return { size: attempts.length === 1 ? 3 * MiB : 900_000, type: candidate.mediaType } as Blob
    })
    expect(attempts.slice(0, 2)).toEqual([
      { mediaType: 'image/webp', quality: 0.86, dimension: 1024 },
      { mediaType: 'image/webp', quality: 0.76, dimension: 1024 },
    ])
    expect(result).toMatchObject({ mediaType: 'image/webp', dimension: 1024 })
    expect(result.blob.size).toBe(900_000)
  })

  it('fails clearly when every normalized encoding still exceeds the final limit', async () => {
    const encode = vi.fn(async candidate => ({ size: 3 * MiB, type: candidate.mediaType } as Blob))
    await expect(chooseExtensionAvatarEncoding(encode)).rejects.toThrow('2 MiB')
    expect(encode.mock.calls.length).toBeGreaterThan(2)
  })
})
