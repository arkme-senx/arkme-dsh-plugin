export const LONG_ARTICLE_IMAGE_MAX_BYTES = 50 * 1024 * 1024
export const LONG_ARTICLE_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'] as const

const LONG_ARTICLE_IMAGE_MIME_TYPE_SET = new Set<string>(LONG_ARTICLE_IMAGE_MIME_TYPES)

export function isLongArticleImageMimeType(mimeType: string): boolean {
  return LONG_ARTICLE_IMAGE_MIME_TYPE_SET.has(mimeType)
}
