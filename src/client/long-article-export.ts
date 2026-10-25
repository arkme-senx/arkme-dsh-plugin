import type { ArkmeContentBlock } from '../types.js'
import { arkmeEscapeMarkdownText, arkmeMarkdownTree } from '../markdown.js'

export interface ArticleExportContent {
  title: string; textContent: string; textFormat?: 'plain' | 'markdown' | undefined
  contentBlocks?: ArkmeContentBlock[] | undefined
}
interface Node { type: string; value?: string; url?: string; alt?: string | null; position?: { start: { offset?: number }; end: { offset?: number } }; depth?: number; ordered?: boolean; start?: number; checked?: boolean | null; children?: Node[] }
interface Run { text: string; bold?: boolean; italic?: boolean; mono?: boolean }
export type ArticleExportBlock = { kind: 'text'; runs: Run[]; size: number; gap: number; quote?: boolean }
  | { kind: 'image'; ref: string; alt: string }

export const ARTICLE_IMAGE_WIDTH = 420
export const ARTICLE_IMAGE_PAGE_HEIGHT = 2400
const PAD = 28, CONTENT_WIDTH = ARTICLE_IMAGE_WIDTH - PAD * 2
export function articleExportFileName(title: string): string {
  return (title.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, ' ').trim().slice(0, 80) || '无标题长文')
}
function inline(node: Node, style: Omit<Run, 'text'> = {}): Run[] {
  if (node.type === 'break') return [{ text: '\n', ...style }]
  if (node.type === 'image') return [{ text: node.alt || '[图片]', ...style }]
  if (node.value !== undefined) return [{ text: node.value, ...style, ...(node.type === 'inlineCode' ? { mono: true } : {}) }]
  return (node.children ?? []).flatMap(child => inline(child, { ...style,
    ...(node.type === 'strong' ? { bold: true } : {}), ...(node.type === 'emphasis' ? { italic: true } : {}) }))
}
/** Semantic mobile layout; wide tables become labeled rows rather than clipped columns. */
export function articleExportBlocks(article: ArticleExportContent): ArticleExportBlock[] {
  const blocks: ArticleExportBlock[] = []
  const text = (runs: Run[], size = 17, gap = 14, quote = false) => { if (runs.length) blocks.push({ kind: 'text', runs, size, gap, quote }) }
  const visit = (node: Node, prefix = '', quote = false) => {
    if (node.type === 'image') { blocks.push({ kind: 'image', ref: node.url ?? '', alt: node.alt || '图片' }); return }
    if (node.type === 'list') { (node.children ?? []).forEach((child, i) => visit(child, node.ordered ? `${(node.start ?? 1) + i}. ` : '• ', quote)); return }
    if (node.type === 'listItem') {
      const lead = node.checked == null ? prefix : `${node.checked ? '☑' : '☐'} `
      ;(node.children ?? []).forEach((child, i) => visit(child, i === 0 ? lead : '  ', quote)); return
    }
    if (node.type === 'blockquote') { (node.children ?? []).forEach(child => visit(child, prefix, true)); return }
    if (node.type === 'table') {
      const rows = node.children ?? [], headers = rows[0]?.children?.map(cell => inline(cell).map(run => run.text).join('')) ?? []
      for (const row of rows.slice(1)) {
        for (const [index, cell] of (row.children ?? []).entries()) text([{ text: `${headers[index] || String(index + 1)}：`, bold: true }, ...inline(cell)], 15, 7, quote)
        text([{ text: '────────' }], 12, 14)
      }
      return
    }
    if (node.type === 'code') { text([{ text: node.value ?? '', mono: true }], 13, 18, true); return }
    if (node.type === 'thematicBreak') { text([{ text: '────────────────' }], 14, 18); return }
    if (node.type === 'heading' || node.type === 'paragraph') {
      let runs: Run[] = prefix ? [{ text: prefix }] : []
      const size = node.type === 'heading' ? (node.depth === 1 ? 24 : node.depth === 2 ? 21 : 18) : 17
      for (const child of node.children ?? []) {
        if (child.type === 'image') { text(runs, size, 12, quote); runs = []; visit(child) }
        else runs.push(...inline(child, node.type === 'heading' ? { bold: true } : {}))
      }
      text(runs, size, node.type === 'heading' ? 12 : 17, quote); return
    }
    if (node.type === 'html') { text([{ text: node.value ?? '' }]); return }
    ;(node.children ?? []).forEach(child => visit(child, prefix, quote))
  }
  if (article.textFormat === 'markdown') visit(arkmeMarkdownTree(article.textContent) as Node)
  else for (const paragraph of article.textContent.split(/\n\n+/u)) text([{ text: paragraph }])
  return blocks
}

export function articleExportMarkdown(article: ArticleExportContent): string {
  const title = arkmeEscapeMarkdownText(article.title || '无标题长文').replace(/\r?\n/gu, ' ')
  return `# ${title}\n\n${article.textFormat === 'markdown' ? article.textContent : arkmeEscapeMarkdownText(article.textContent)}\n`
}
export function downloadArticleBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
function font(run: Omit<Run, 'text'>, size: number): string {
  return `${run.italic ? 'italic ' : ''}${run.bold ? '650 ' : '400 '}${size}px ${run.mono ? 'ui-monospace, monospace' : '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'}`
}
export function wrapArticleRuns(runs: Run[], size: number, width: number, measure: (text: string, run: Run, size: number) => number): Run[][] {
  const lines: Run[][] = [[]]; let used = 0
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const run of runs) for (const { segment } of segmenter.segment(run.text)) {
    if (segment === '\r') continue
    const length = measure(segment, run, size)
    if (segment === '\n' || (used + length > width && used > 0)) { lines.push([]); used = 0; if (segment === '\n') continue }
    const line = lines[lines.length - 1]!, previous = line.at(-1)
    if (previous && previous.bold === run.bold && previous.italic === run.italic && previous.mono === run.mono) previous.text += segment
    else line.push({ ...run, text: segment })
    used += length
  }
  return lines
}
export function articleBoundImage(ref: string, blocks: readonly ArkmeContentBlock[] = []): ArkmeContentBlock {
  const block = blocks.find(value => value.kind === 'image' && value.fileAssetUid && ref === `arkme-asset:${value.fileAssetUid}`)
  if (!block?.mediaRef) throw new Error('正文图片缺少可读取的附件，请重新打开长文后重试')
  return block
}
async function loadImage(ref: string, article: ArticleExportContent, signal: AbortSignal): Promise<HTMLImageElement> {
  // Only account-bound local media is exported. Never fetch arbitrary Markdown URLs.
  const block = articleBoundImage(ref, article.contentBlocks)
  const response = await fetch(`/arkme-self/api/media?ref=${encodeURIComponent(block.mediaRef)}`, { signal, credentials: 'same-origin' })
  if (!response.ok) throw new Error('图片读取失败，请重试导出')
  const blob = await response.blob()
  if (!blob.type.startsWith('image/') || blob.size > 30 * 1024 * 1024) throw new Error('图片格式或大小不适合导出')
  const url = URL.createObjectURL(blob), image = new Image()
  try { image.src = url; await image.decode(); signal.throwIfAborted(); return image } finally { URL.revokeObjectURL(url) }
}
export async function exportArticleImages(article: ArticleExportContent, signal: AbortSignal, progress: (label: string) => void): Promise<Blob[]> {
  await document.fonts?.ready; signal.throwIfAborted()
  const measureCanvas = document.createElement('canvas'), measureContext = measureCanvas.getContext('2d')
  if (!measureContext) throw new Error('当前环境不支持图片导出')
  const measure = (value: string, run: Run, size: number) => { measureContext.font = font(run, size); return measureContext.measureText(value).width }
  type Paint = { kind: 'line'; runs: Run[]; size: number; height: number; quote: boolean } | { kind: 'image'; image: HTMLImageElement; height: number }
  const pages: Paint[][] = [[]]; let height = PAD + 30
  const add = (paint: Paint) => {
    if (height + paint.height > ARTICLE_IMAGE_PAGE_HEIGHT - PAD - 24 && pages.at(-1)!.length > 0) { pages.push([]); height = PAD + 30 }
    pages.at(-1)!.push(paint); height += paint.height
  }
  const allBlocks: ArticleExportBlock[] = [{ kind: 'text', runs: [{ text: article.title || '无标题长文', bold: true }], size: 27, gap: 26 }, ...articleExportBlocks(article)]
  const images = new Map<string, HTMLImageElement>()
  for (const [index, block] of allBlocks.entries()) {
    signal.throwIfAborted(); progress(`正在排版 ${index + 1}/${allBlocks.length}…`)
    if (block.kind === 'image') {
      const image = images.get(block.ref) ?? await loadImage(block.ref, article, signal); images.set(block.ref, image)
      add({ kind: 'image', image, height: Math.min(1500, CONTENT_WIDTH * image.naturalHeight / image.naturalWidth) + 20 })
    } else {
      const lines = wrapArticleRuns(block.runs, block.size, CONTENT_WIDTH - (block.quote ? 12 : 0), measure)
      lines.forEach((runs, index) => add({ kind: 'line', runs, size: block.size,
        height: Math.ceil(block.size * 1.7) + (index === lines.length - 1 ? block.gap : 0), quote: !!block.quote }))
    }
    // Yield between blocks so a long article never locks the reader's controls.
    if (index % 15 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  const result: Blob[] = []
  for (const [index, page] of pages.entries()) {
    signal.throwIfAborted(); progress(`正在生成图片 ${index + 1}/${pages.length}…`)
    const logicalHeight = PAD * 2 + 54 + page.reduce((total, paint) => total + paint.height, 0)
    const canvas = document.createElement('canvas'); canvas.width = ARTICLE_IMAGE_WIDTH * 2; canvas.height = logicalHeight * 2
    const context = canvas.getContext('2d'); if (!context) throw new Error('无法生成导出图片')
    context.scale(2, 2); context.fillStyle = '#fff'; context.fillRect(0, 0, ARTICLE_IMAGE_WIDTH, logicalHeight)
    context.font = font({}, 11); context.fillStyle = '#8b9099'; context.fillText('Arkme 即我 · 长文', PAD, PAD + 4)
    let y = PAD + 30
    for (const paint of page) {
      if (paint.kind === 'image') {
        const available = paint.height - 20, scale = Math.min(CONTENT_WIDTH / paint.image.naturalWidth, available / paint.image.naturalHeight)
        const w = paint.image.naturalWidth * scale, h = paint.image.naturalHeight * scale
        context.drawImage(paint.image, PAD + (CONTENT_WIDTH - w) / 2, y, w, h)
      } else {
        let x = PAD + (paint.quote ? 12 : 0)
        if (paint.quote) { context.fillStyle = '#d9dde4'; context.fillRect(PAD, y, 2, paint.size * 1.7) }
        for (const run of paint.runs) { context.font = font(run, paint.size); context.fillStyle = paint.quote ? '#59616d' : '#20242b'; context.fillText(run.text, x, y + paint.size); x += context.measureText(run.text).width }
      }
      y += paint.height
    }
    context.font = font({}, 11); context.fillStyle = '#8b9099'; context.fillText(`${index + 1} / ${pages.length}`, PAD, logicalHeight - PAD)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片生成失败')), 'image/png'))
    canvas.width = 1; canvas.height = 1; result.push(blob)
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  signal.throwIfAborted(); return result
}

/** Keep the Markdown portable: image data is embedded instead of exporting expiring local URLs. */
export async function exportArticleMarkdown(article: ArticleExportContent, signal: AbortSignal): Promise<Blob> {
  let source = article.textContent
  const nodes: Array<{ url: string; start: number; end: number }> = []
  const visit = (node: Node) => {
    if (node.type === 'image' && node.url && node.position?.start.offset !== undefined && node.position.end.offset !== undefined)
      nodes.push({ url: node.url, start: node.position.start.offset, end: node.position.end.offset })
    else node.children?.forEach(visit)
  }
  if (article.textFormat === 'markdown') visit(arkmeMarkdownTree(source) as Node)
  const embedded = new Map<string, string>(); let totalBytes = 0
  for (const node of [...nodes].reverse()) {
    const asset = articleBoundImage(node.url, article.contentBlocks)
    let data = embedded.get(node.url)
    if (!data) {
      const response = await fetch(`/arkme-self/api/media?ref=${encodeURIComponent(asset.mediaRef)}`, { signal, credentials: 'same-origin' })
      if (!response.ok) throw new Error('图片读取失败，Markdown 尚未导出')
      const blob = await response.blob()
      if (!blob.type.startsWith('image/') || blob.size > 30 * 1024 * 1024) throw new Error('图片格式或大小不适合导出')
      totalBytes += blob.size
      if (totalBytes > 100 * 1024 * 1024) throw new Error('图片总量过大，请分段导出')
      data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(blob) })
      embedded.set(node.url, data)
    }
    signal.throwIfAborted()
    const original = source.slice(node.start, node.end)
    const replacement = original.replace(/(\]\(\s*<?)arkme-asset:[^\s)>]+/u, (_match, prefix: string) => prefix + data!)
    if (replacement === original) throw new Error('正文图片引用格式暂不支持导出，请重新插入图片')
    source = source.slice(0, node.start) + replacement + source.slice(node.end)
  }
  signal.throwIfAborted(); return new Blob(['\uFEFF', articleExportMarkdown({ ...article, textContent: source })], { type: 'text/markdown;charset=utf-8' })
}
