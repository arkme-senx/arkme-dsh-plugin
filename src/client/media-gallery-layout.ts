export interface GalleryImageDimensions { width: number; height: number }

// URLs are resolved by the owning conversation's authorized media resolver.
// Keep only a bounded in-memory size cache; do not persist private media URLs.
const sizes = new Map<string, GalleryImageDimensions>()
const maxCachedSizes = 256

export function galleryImageDimensions(url: string): GalleryImageDimensions | undefined {
  return sizes.get(url)
}

export function rememberGalleryImageDimensions(url: string, width: number, height: number): GalleryImageDimensions | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined
  const dimensions = { width, height }
  sizes.delete(url)
  sizes.set(url, dimensions)
  if (sizes.size > maxCachedSizes) sizes.delete(sizes.keys().next().value!)
  return dimensions
}

export function isLongGalleryImage(dimensions: GalleryImageDimensions): boolean {
  const ratio = dimensions.width / dimensions.height
  return ratio >= 2.4 || ratio <= 1 / 2.4
}

export function singleGalleryImageSize(dimensions: GalleryImageDimensions): GalleryImageDimensions {
  const scale = Math.min(1, 360 / dimensions.width, 280 / dimensions.height)
  // Preserve the image itself even for extreme strips, with a usable hit area.
  return { width: Math.max(48, dimensions.width * scale), height: Math.max(48, dimensions.height * scale) }
}
