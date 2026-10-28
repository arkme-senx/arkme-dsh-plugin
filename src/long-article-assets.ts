import { arkmeMarkdownTree } from './markdown.js'

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
