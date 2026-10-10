import { tr } from './locale.js'
import { isLongArticleImageMimeType, LONG_ARTICLE_IMAGE_MAX_BYTES } from '../long-article-image-policy.js'

const formats: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' }
export function articleImageMime(file: Pick<File, 'name' | 'type'>): string | undefined {
  const inferred = formats[file.name.split('.').at(-1)?.toLowerCase() ?? '']
  return isLongArticleImageMimeType(file.type) ? file.type : file.type === '' ? inferred : undefined
}
function bytes(size: number): string {
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(2)} KiB` : `${(size / 1024 / 1024).toFixed(2)} MiB`
}
export function checkLongArticleImages(files: readonly File[]): { accepted: File[]; errors: string[] } {
  const limit = LONG_ARTICLE_IMAGE_MAX_BYTES
  const accepted: File[] = []
  const errors: string[] = []
  for (const file of files) {
    if (file.size === 0) errors.push(tr("{v0}：文件为空", { v0: file.name }))
    else if (file.size > limit) errors.push(`${file.name}：${bytes(file.size)}（${file.size} 字节），超过单图上限 ${bytes(limit)}（${limit} 字节）`)
    else if (!articleImageMime(file)) errors.push(`${file.name}：仅支持 JPG、PNG、GIF、WebP、AVIF、BMP 图片`)
    else accepted.push(file)
  }
  return { accepted, errors }
}
