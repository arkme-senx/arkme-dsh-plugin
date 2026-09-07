import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { decodeString } from 'micromark-util-decode-string'
import { arkmeHashTagRanges, type ArkmeHashTagRange } from './hashtag.js'

export type ArkmeTextFormat = 'plain' | 'markdown'

/** Never infer the format from punctuation in a historical note. */
export function arkmeRecordTextFormat(value: unknown): ArkmeTextFormat {
  if (typeof value === 'string' && value.trimStart().startsWith('{')) {
    try { return arkmeRecordTextFormat(JSON.parse(value)) } catch { return 'plain' }
  }
  if (typeof value !== 'object' || value === null) return 'plain'
  const data = value as Record<string, unknown>
  const format = data.text_format ?? data.textFormat
  if (format === 'markdown' || format === 'plain') return format
  for (const key of ['content_payload', 'contentPayload', 'payload', 'recordPayload', 'record_payload', 'record_core', 'record', 'snapshot', 'render_content_payload']) {
    if (arkmeRecordTextFormat(data[key]) === 'markdown') return 'markdown'
  }
  return 'plain'
}

interface MarkdownNode {
  type: string
  value?: string
  children?: MarkdownNode[]
  data?: { hName?: string | undefined; hProperties?: Record<string, unknown> | undefined } | undefined
  position?: { start: { offset?: number | undefined }; end: { offset?: number | undefined } } | undefined
}

const parser = unified().use(remarkParse).use(remarkGfm)
export function arkmeMarkdownTree(source: string): MarkdownNode {
  return parser.parse(source)
}

export function arkmeEscapeMarkdownText(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/[\\`*_[\]<>#!|~]/gu, '\\$&')
}

/** The editor must also retain unsupported constructs on paste/import, before Marked parses HTML. */
export function arkmeMarkdownEditorSource(source: string): string {
  const replacements: { start: number; end: number }[] = []
  const visit = (node: MarkdownNode) => {
    if (['html', 'image', 'imageReference'].includes(node.type)) {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) replacements.push({ start, end })
    } else node.children?.forEach(visit)
  }
  visit(arkmeMarkdownTree(source))
  let result = source
  for (const { start, end } of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, start) + arkmeEscapeMarkdownText(result.slice(start, end)) + result.slice(end)
  }
  return result
}

/** UTF-16 source ranges, including escaped punctuation, are kept separate from editor positions. */
export function arkmeMarkdownTextRanges(source: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  const visit = (node: MarkdownNode) => {
    if (['code', 'inlineCode', 'html', 'image', 'imageReference', 'definition', 'link', 'linkReference'].includes(node.type)) return
    if (node.type === 'text') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) ranges.push({ start, end })
    }
    node.children?.forEach(visit)
  }
  visit(arkmeMarkdownTree(source))
  return ranges
}

export function arkmeMarkdownHashTagRanges(source: string): ArkmeHashTagRange[] {
  return arkmeMarkdownTextRanges(source).flatMap(({ start, end }) =>
    arkmeMarkdownTextHashTagRanges(source.slice(start, end))
      .map(tag => ({ ...tag, startIndex: start + tag.startIndex })),
  )
}

/** Read an already parsed text node without reinterpreting its block context. */
function arkmeMarkdownTextHashTagRanges(raw: string): ArkmeHashTagRange[] {
  let text = ''
  const starts: number[] = []
  const ends: number[] = []
  const append = (value: string, offset: number) => {
    const decoded = decodeString(value)
    for (let index = 0; index < decoded.length; index++) {
      starts.push(offset + (decoded === value ? index : 0))
      ends.push(offset + (decoded === value ? index + 1 : value.length))
    }
    text += decoded
  }
  let cursor = 0
  // Decode CommonMark punctuation escapes and entities while retaining UTF-16 wire ranges.
  for (const match of raw.matchAll(/\\[\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e]|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]*);/gu)) {
    append(raw.slice(cursor, match.index), cursor)
    append(match[0], match.index)
    cursor = match.index + match[0].length
  }
  append(raw.slice(cursor), cursor)
  return arkmeHashTagRanges(text).flatMap(tag => {
    const offset = starts[tag.startIndex]!
    // An escaped/entity-encoded hash is literal text, not a business tag anchor.
    if (raw[offset] !== '#' && raw[offset] !== '＃') return []
    return [{ tag: tag.tag, startIndex: offset,
      length: ends[tag.startIndex + tag.length - 1]! - offset }]
  })
}

/** A display/search summary only. The canonical body is always the original Markdown. */
export function arkmeMarkdownPlainText(source: string): string {
  const read = (node: MarkdownNode): string => {
    if (node.type === 'definition') return ''
    if (node.type === 'image' || node.type === 'imageReference') {
      return source.slice(node.position?.start.offset, node.position?.end.offset)
    }
    if (node.value !== undefined) return node.value
    return (node.children ?? []).map(read).join(
      ['root', 'blockquote', 'list', 'listItem', 'table', 'tableRow'].includes(node.type) ? '\n' : '',
    )
  }
  return read(arkmeMarkdownTree(source)).trim()
}

/** HTML and inline images remain visible source; neither becomes an active browser element. */
export function arkmeLiteralMarkdownNodes() {
  return (tree: MarkdownNode, file: { value?: unknown }) => {
    const source = String(file.value ?? '')
    const visit = (node: MarkdownNode) => {
      if (['html', 'image', 'imageReference'].includes(node.type)) {
        node.type = 'text'
        node.value = source.slice(node.position?.start.offset, node.position?.end.offset)
        delete node.children
      } else node.children?.forEach(visit)
    }
    visit(tree)
  }
}

/** Tag activation follows source text nodes, so escaped hashes and code never become links. */
export function arkmeMarkdownBusinessNodes() {
  return (tree: MarkdownNode, file: { value?: unknown }) => {
    const source = String(file.value ?? '')
    const visit = (node: MarkdownNode) => {
      if (['code', 'inlineCode', 'html', 'image', 'imageReference', 'link', 'linkReference'].includes(node.type)) return
      if (node.type !== 'text') { node.children?.forEach(visit); return }
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) return
      const raw = source.slice(start, end)
      const tags = arkmeMarkdownTextHashTagRanges(raw)
      const children: MarkdownNode[] = []
      const append = (value: string, kind: string) => {
        if (value) children.push({ type: 'arkmeBusinessText', data: { hName: 'span', hProperties: { 'data-arkme-markdown-run': kind } }, children: [{ type: 'text', value: decodeString(value) }] })
      }
      let cursor = 0
      for (const tag of tags) {
        append(raw.slice(cursor, tag.startIndex), 'text')
        append(raw.slice(tag.startIndex, tag.startIndex + tag.length), 'tag')
        cursor = tag.startIndex + tag.length
      }
      append(raw.slice(cursor), 'text')
      node.type = 'arkmeBusinessText'
      delete node.value
      node.data = { hName: 'span', hProperties: {} }
      node.children = children
    }
    visit(tree)
  }
}
