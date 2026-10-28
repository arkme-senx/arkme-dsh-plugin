import type { ArkmeTimelineItem } from '../types.js'
import { arkmeEmojiUnicode } from '../arkme-emoji-text.js'
import { quoteContext, MESSAGE_QUOTE_LIMIT, normalizeQuoteText, quoteCanonicalText, quoteSourceContent, quoteMatchesCanonical, type ArkmeMessageQuote } from '../message-quote.js'

const excluded = 'button,input,textarea,select,style,script,[data-arkme-mention-read],[aria-hidden="true"],img:not([data-arkme-rich-emoji])'
const blocks = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'TD', 'TH', 'TABLE'])
type Point = { node: Node; offset: number }
/** Canonical visible prose plus DOM boundaries, including block breaks and emoji. */
export function quoteDomProjection(root: Node) {
  const units: { char: string; start: Point; end: Point }[] = []
  const add = (text: string, start: Point, end: Point) => { for (let i = 0; i < text.length; i++) units.push({ char: text[i]!, start, end }) }
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const value = node.textContent ?? ''
      for (let i = 0; i < value.length; i++) add(value[i]!, { node, offset: i }, { node, offset: i + 1 })
      return
    }
    const el = node.nodeType === 1 ? node as Element : undefined
    if (el?.matches(excluded)) return
    const parent = node.parentNode ?? node
    const index = node.parentNode ? Array.from(node.parentNode.childNodes).indexOf(node as ChildNode) : 0
    const before = { node: parent, offset: index }, after = { node: parent, offset: index + 1 }
    if (el?.matches('img[data-arkme-rich-emoji]')) {
      add(arkmeEmojiUnicode(el.getAttribute('data-arkme-rich-emoji') ?? ''), before, after); return
    }
    if (el?.tagName === 'BR') { add(' ', before, after); return }
    const block = !!el && blocks.has(el.tagName)
    if (block) add(' ', before, before)
    node.childNodes.forEach(walk)
    if (block) add(' ', after, after)
  }
  const prose = root.nodeType === 1 ? Array.from((root as Element).querySelectorAll('[data-arkme-quote-prose]')) : []
  if (prose.length) prose.forEach(walk)
  else walk(root)
  const normalized: typeof units = []
  for (const unit of units) {
    if (/\s/u.test(unit.char)) {
      if (normalized.length && normalized.at(-1)!.char !== ' ') normalized.push({ ...unit, char: ' ' })
      else if (normalized.at(-1)?.char === ' ') normalized.at(-1)!.end = unit.end
    } else normalized.push(unit)
  }
  if (normalized.at(-1)?.char === ' ') normalized.pop()
  return { text: normalized.map(unit => unit.char).join(''), units: normalized }
}
export function captureQuoteAnchor(element: HTMLElement, range: Range, selectedText: string, item: ArkmeTimelineItem) {
  if (selectedText.length > MESSAGE_QUOTE_LIMIT) throw new Error(`引用最多 ${MESSAGE_QUOTE_LIMIT} 个字符，请缩小选区`)
  const dom = quoteDomProjection(element), canonical = quoteCanonicalText(item)
  // No first-match fallback: resolved link labels or changed prose require a fresh selection.
  if (dom.text !== canonical) throw new Error('这段显示内容暂时无法准确关联原文，请在消息详情中选择原文后重试')
  const selected = dom.units.map((unit, index) => ({ unit, index })).filter(({ unit }) => {
    try { return range.comparePoint(unit.start.node, unit.start.offset) === 0 && range.comparePoint(unit.end.node, unit.end.offset) === 0 } catch { return false }
  })
  while (selected[0]?.unit.char === ' ') selected.shift()
  while (selected.at(-1)?.unit.char === ' ') selected.pop()
  const start = selected[0]?.index, end = selected.at(-1)?.index
  if (start === undefined || end === undefined || canonical.slice(start, end + 1) !== normalizeQuoteText(selectedText)) throw new Error('选中文字已变化，请重新选择')
  return { version: 1 as const, projection: 'arkme-text-v1' as const, start, end: end + 1, text: selectedText,
    ...quoteContext(canonical, start, end + 1),
    ...(item.recordVersion === undefined ? {} : { recordVersion: item.recordVersion }) }
}
export async function quoteDigest(item: ArkmeTimelineItem): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(quoteSourceContent(item)))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
/** Uses the same projection as capture, never a global text search. */
export function quoteHighlightRange(element: HTMLElement, quote: ArkmeMessageQuote): Range | undefined {
  const dom = quoteDomProjection(element)
  if (!quoteMatchesCanonical(quote, dom.text)) return undefined
  const start = dom.units[quote.start]?.start, end = dom.units[quote.end - 1]?.end
  if (!start || !end) return undefined
  const range = element.ownerDocument.createRange()
  range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset)
  return range
}
