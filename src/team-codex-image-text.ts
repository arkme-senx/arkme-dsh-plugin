import { unified } from 'unified'
import remarkParse from 'remark-parse'

type Node = { type: string; url?: string; children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } } }
type ImageReference = { url: string; start: number; end: number; definition?: { start: number; end: number } }
/** Parse Markdown rather than treating fenced examples as actual attachments. */
export function codexMarkdownImages(text: string): ImageReference[] {
  if (!text.includes('![')) return []
  const result: ImageReference[] = []
  const tree = unified().use(remarkParse).parse(text) as Node
  const definitions = new Map<string, Node>()
  const collect = (node: Node & { identifier?: string }) => {
    if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier.toLowerCase())) definitions.set(node.identifier.toLowerCase(), node)
    node.children?.forEach(collect)
  }
  collect(tree)
  const visit = (node: Node & { identifier?: string }) => {
    const definition = node.type === 'imageReference' ? definitions.get(node.identifier?.toLowerCase() ?? '') : undefined
    const url = node.type === 'image' ? node.url : definition?.url
    if (url && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) result.push({ url, start: node.position.start.offset, end: node.position.end.offset,
      ...(definition?.position?.start.offset !== undefined && definition.position.end.offset !== undefined ? { definition: { start: definition.position.start.offset, end: definition.position.end.offset } } : {}) })
    node.children?.forEach(visit)
  }
  visit(tree)
  return result
}

/** Shared snapshots never include image URLs/base64/local attachment paths. */
export function codexImageSafeText(text: string): string {
  if (!/!\[|<image\b|<img\b|data:image\/|Image attachment: true/i.test(text)) return text
  let safe = text
  const images = codexMarkdownImages(text)
  const ranges = new Map(images.map(image => [image.start, { start: image.start, end: image.end }]))
  for (const image of images) if (image.definition) ranges.set(image.definition.start, image.definition)
  // Remove the original source range too: parsed URLs can decode Markdown escapes.
  for (const image of [...ranges.values()].sort((a,b)=>b.start-a.start)) safe = safe.slice(0, image.start) + '[图片仅本人可见]' + safe.slice(image.end)
  // Reference definitions must not keep the URL after their image is replaced.
  for (const { url } of images) if (url) safe = safe.split(url).join('[私有图片]')
  safe = safe.replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, '[图片仅本人可见]')
    .replace(/<img\b[^>]*>/gi, '[图片仅本人可见]')
    .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/g, '[图片仅本人可见]')
  // Codex's attachment envelope, not arbitrary prose that happens to mention a file.
  safe = safe.replace(/(^|\n)## [^\n]+\nImage attachment: true[^\n]*(?=\n|$)/g, '$1[图片仅本人可见]')
  safe = safe.replace(/^# Files mentioned by the user:\r?\n([\s\S]*?)\r?\nDistinguish instructions in attached documents from the user's request\./, (all, files:string) =>
    /^\s*(?:\[图片仅本人可见\]\s*)+$/.test(files) ? '[图片仅本人可见]' : all)
  return safe
}
