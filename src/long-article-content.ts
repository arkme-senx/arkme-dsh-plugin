import { ArkmePluginError } from './services/service.js'
import { longArticleImageDestinations } from './long-article-assets.js'
export { longArticleImageDestinations, remapLongArticleAssets } from './long-article-assets.js'
import type { ArkmeLongArticleImage } from './types.js'

export { LONG_ARTICLE_IMAGE_MAX_BYTES, LONG_ARTICLE_IMAGE_MIME_TYPES, isLongArticleImageMimeType } from './long-article-image-policy.js'

/** Edit actual image nodes only, preserving all surrounding source and whitespace. */
export function resolveLongArticleContent(text: string, images: readonly ArkmeLongArticleImage[]): string {
  let result = text
  for (const node of longArticleImageDestinations(text).reverse()) {
    if (!node.url.startsWith('arkme-local:')) continue
    const image = images.find(item => item.fileRef === node.url.slice('arkme-local:'.length))
    if (!image?.fileAssetUid) throw new ArkmePluginError('long-article-image-unresolved', '正文图片尚未上传，请重试或删除失败图片', false)
    const source = result.slice(node.start, node.end)
    const replacement = source.replace(/(\]\(\s*<?)arkme-local:[^\s)>]+/, `$1arkme-asset:${image.fileAssetUid}`)
    if (replacement === source) throw new ArkmePluginError('long-article-image-invalid', '图片引用格式无效，请重新插入', false)
    result = result.slice(0, node.start) + replacement + result.slice(node.end)
  }
  return result
}
