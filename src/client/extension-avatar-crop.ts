export const ARKME_EXTENSION_AVATAR_SOURCE_MAX_BYTES = 20 * 1024 * 1024
export const ARKME_EXTENSION_AVATAR_OUTPUT_MAX_BYTES = 2 * 1024 * 1024

export interface ExtensionAvatarCropGeometryInput {
  imageWidth: number
  imageHeight: number
  viewportSize: number
  zoom: number
  panX: number
  panY: number
}

export interface ExtensionAvatarCropGeometry {
  scale: number
  renderedWidth: number
  renderedHeight: number
  displayLeft: number
  displayTop: number
  panX: number
  panY: number
  sourceX: number
  sourceY: number
  sourceSize: number
}

export interface ExtensionAvatarEncodingCandidate {
  mediaType: 'image/webp' | 'image/jpeg'
  quality: number
  dimension: number
}

export interface ExtensionAvatarEncodingResult extends ExtensionAvatarEncodingCandidate {
  blob: Blob
}

export function extensionAvatarSourceError(file: Pick<File, 'type' | 'size'>): string | undefined {
  if (!Number.isFinite(file.size) || file.size <= 0) return '头像文件不能为空'
  if (!file.type.toLowerCase().startsWith('image/')) return '请选择图片文件'
  if (file.size > ARKME_EXTENSION_AVATAR_SOURCE_MAX_BYTES) return '原始图片必须小于 20 MiB'
  return undefined
}

export function extensionAvatarCropGeometry(input: ExtensionAvatarCropGeometryInput): ExtensionAvatarCropGeometry {
  const imageWidth = Math.max(1, input.imageWidth)
  const imageHeight = Math.max(1, input.imageHeight)
  const viewportSize = Math.max(1, input.viewportSize)
  const zoom = Math.min(3, Math.max(1, input.zoom))
  const scale = Math.max(viewportSize / imageWidth, viewportSize / imageHeight) * zoom
  const renderedWidth = imageWidth * scale
  const renderedHeight = imageHeight * scale
  const maxPanX = Math.max(0, (renderedWidth - viewportSize) / 2)
  const maxPanY = Math.max(0, (renderedHeight - viewportSize) / 2)
  const panX = Math.min(maxPanX, Math.max(-maxPanX, input.panX))
  const panY = Math.min(maxPanY, Math.max(-maxPanY, input.panY))
  const displayLeft = (viewportSize - renderedWidth) / 2 + panX
  const displayTop = (viewportSize - renderedHeight) / 2 + panY
  const sourceSize = viewportSize / scale
  return {
    scale,
    renderedWidth,
    renderedHeight,
    displayLeft,
    displayTop,
    panX,
    panY,
    sourceX: Math.max(0, -displayLeft / scale),
    sourceY: Math.max(0, -displayTop / scale),
    sourceSize,
  }
}

const ENCODING_CANDIDATES: readonly ExtensionAvatarEncodingCandidate[] = [
  { mediaType: 'image/webp', quality: .86, dimension: 1024 },
  { mediaType: 'image/webp', quality: .76, dimension: 1024 },
  { mediaType: 'image/jpeg', quality: .84, dimension: 1024 },
  { mediaType: 'image/webp', quality: .76, dimension: 768 },
  { mediaType: 'image/jpeg', quality: .80, dimension: 768 },
  { mediaType: 'image/webp', quality: .72, dimension: 512 },
  { mediaType: 'image/jpeg', quality: .76, dimension: 512 },
]

export async function chooseExtensionAvatarEncoding(
  encode: (candidate: ExtensionAvatarEncodingCandidate) => Promise<Blob | null>,
): Promise<ExtensionAvatarEncodingResult> {
  for (const candidate of ENCODING_CANDIDATES) {
    const blob = await encode(candidate)
    if (blob !== null && blob.size > 0 && blob.size <= ARKME_EXTENSION_AVATAR_OUTPUT_MAX_BYTES) {
      return { ...candidate, blob }
    }
  }
  throw new Error('裁剪后的头像仍超过 2 MiB，请缩小图片后重试')
}

export async function normalizeExtensionAvatar(
  image: HTMLImageElement,
  geometry: Pick<ExtensionAvatarCropGeometry, 'sourceX' | 'sourceY' | 'sourceSize'>,
): Promise<File> {
  const result = await chooseExtensionAvatarEncoding(async candidate => {
    const canvas = document.createElement('canvas')
    canvas.width = candidate.dimension
    canvas.height = candidate.dimension
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('当前浏览器无法处理头像图片')
    context.drawImage(
      image,
      geometry.sourceX,
      geometry.sourceY,
      geometry.sourceSize,
      geometry.sourceSize,
      0,
      0,
      candidate.dimension,
      candidate.dimension,
    )
    return await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, candidate.mediaType, candidate.quality)
    })
  })
  const mediaType = ['image/png', 'image/jpeg', 'image/webp'].includes(result.blob.type)
    ? result.blob.type
    : result.mediaType
  const extension = mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : 'jpg'
  return new File([result.blob], `extension-avatar.${extension}`, { type: mediaType })
}
