import { ArkmePluginError } from './services/service.js'
import { arkmeMarkdownTree } from './markdown.js'
import type { ArkmeLongArticleImage } from './types.js'

export { LONG_ARTICLE_IMAGE_MAX_BYTES, LONG_ARTICLE_IMAGE_MIME_TYPES, isLongArticleImageMimeType } from './long-article-image-policy.js'

type Node = ReturnType<typeof arkmeMarkdownTree>

export function longArticleImageDestinations(text: string): Array<{ url: string; start: number; end: number }> {
  const images: Array<{ url: string; start: number; end: number }> = []
  const visit = (node: Node) => {
    if (node.type === 'image' && node.url !== undefined) {
      const start = node.position?.start.offset; const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) images.push({url: node.url, start, end})
    } else node.children?.forEach(visit)
  }
  visit(arkmeMarkdownTree(text))
  return images
}

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

/** An authorized frozen snapshot gets item-local aliases, never source asset IDs. */
export function remapLongArticleAssets(text: string, aliases: ReadonlyMap<string, string>): string {
  let result = text
  for (const node of longArticleImageDestinations(text).reverse()) {
    const replacement = aliases.get(node.url)
    if (replacement === undefined) continue
    const source = result.slice(node.start, node.end)
    result = result.slice(0, node.start) + source.replace(/(\]\(\s*<?)arkme-asset:[^\s)>]+/, `$1${replacement}`) + result.slice(node.end)
  }
  return result
}
