import { decodeString } from 'micromark-util-decode-string'
import { arkmeEmojiTextRuns } from '../arkme-emoji-text.js'
import { arkmeEscapeMarkdownText, arkmeMarkdownTree } from '../markdown.js'
import { MESSAGE_QUOTE_LIMIT, quoteCanonicalText, quoteContext, quoteMatchesCanonical, type ArkmeMessageQuote, type ArkmeQuoteSource } from '../message-quote.js'
import type { ArkmeRecordReeditMention } from '../record-reedit-contract.js'

interface Unit { char: string; start: number; end: number; leaf: number }
export interface MessageTextReplacement { start: number; end: number; original: string; markdown: boolean }
const mismatch = () => new Error('原文或选区已变化，请重新选择')

function replacementUnits(item: ArkmeQuoteSource) {
  const source = item.textContent
  const markdown = item.textFormat === 'markdown' || item.senderKind === 'bot'
  const units: Unit[] = []
  let leaf = 0
  const append = (raw: string, offset: number, decode: boolean) => {
    const decoded: Unit[] = []
    const emit = (value: string, start: number, end: number, mapped: boolean) => {
      for (let i = 0; i < value.length; i++) decoded.push({ char: value[i]!, start: offset + start + (mapped ? 0 : i), end: offset + (mapped ? end : start + i + 1), leaf })
    }
    let cursor = 0
    if (decode) for (const match of raw.matchAll(/\\[\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e]|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]*);/gu)) {
      emit(raw.slice(cursor, match.index), cursor, match.index, false)
      emit(decodeString(match[0]), match.index, match.index + match[0].length, true)
      cursor = match.index + match[0].length
    }
    emit(raw.slice(cursor), cursor, raw.length, false)
    cursor = 0
    for (const run of arkmeEmojiTextRuns(decoded.map(unit => unit.char).join(''))) {
      const slice = decoded.slice(cursor, cursor + run.text.length)
      if (run.kind === 'emoji') for (let i = 0; i < run.emoji.unicode.length; i++) units.push({ ...slice[0]!, char: run.emoji.unicode[i]!, end: slice.at(-1)!.end })
      else units.push(...slice)
      cursor += run.text.length
    }
    leaf++
  }
  if (!markdown) append(source, 0, false)
  else {
    const walk = (node: ReturnType<typeof arkmeMarkdownTree>) => {
      if (node.type === 'definition') return
      if (node.value !== undefined || ['image', 'imageReference'].includes(node.type)) {
        const start = node.position?.start.offset, end = node.position?.end.offset
        if (start === undefined || end === undefined) return
        // Formatting/code constructs that do not map one-to-one are deliberately not editable here.
        if (node.type === 'text') append(source.slice(start, end), start, true)
        else {
          for (const char of (node.value ?? source.slice(start, end)).split('')) units.push({ char, start: -1, end: -1, leaf })
          leaf++
        }
        return
      }
      const separate = ['root', 'blockquote', 'list', 'listItem', 'table', 'tableRow'].includes(node.type)
      node.children?.forEach((child, index) => {
        if (separate && index) units.push({ char: ' ', start: -1, end: -1, leaf: -1 })
        walk(child)
      })
    }
    walk(arkmeMarkdownTree(source))
  }
  const normalized: Unit[] = []
  for (const unit of units) {
    if (/\s/u.test(unit.char)) {
      if (normalized.length && normalized.at(-1)!.char !== ' ') normalized.push({ ...unit, char: ' ' })
      else if (normalized.at(-1)?.char === ' ') normalized.at(-1)!.end = unit.end
    } else normalized.push(unit)
  }
  if (normalized.at(-1)?.char === ' ') normalized.pop()
  return normalized
}

/** Map rendered UTF-16 positions back to wire text, never search for the first matching word. */
export function resolveMessageTextReplacement(item: ArkmeQuoteSource, quote: ArkmeMessageQuote): MessageTextReplacement {
  const source = item.textContent
  const markdown = item.textFormat === 'markdown' || item.senderKind === 'bot'
  const normalized = replacementUnits(item)
  const text = normalized.map(unit => unit.char).join('')
  if (text !== quoteCanonicalText(item) || !quoteMatchesCanonical(quote, text)) throw mismatch()
  const first = normalized[quote.start], last = normalized[quote.end - 1]
  if (!first || !last || first.start < 0 || last.end < 0) throw new Error('这段内容请通过“重新编辑”修改')
  if (markdown && normalized.slice(quote.start, quote.end).some(unit => unit.leaf !== first.leaf)) {
    throw new Error('选区跨越了不同格式，请缩小选区或使用“重新编辑”')
  }
  // Do not split a decoded entity or emoji token.
  if (normalized[quote.start - 1]?.start === first.start || normalized[quote.end]?.end === last.end) throw mismatch()
  return { start: first.start, end: last.end, original: source.slice(first.start, last.end), markdown }
}

/** Keep the replacement on the changed span so edits to long rows and existing marks use the same quote contract. */
export function preparePlainTextReplacement(source: string, draft: string, sourceDigest: string) {
  const before = Array.from(source), after = Array.from(draft)
  let first = 0, last = before.length, nextLast = after.length
  while (first < last && first < nextLast && before[first] === after[first]) first++
  while (last > first && nextLast > first && before[last - 1] === after[nextLast - 1]) { last--; nextLast-- }
  const prefixLength = before.slice(0, first).join('').length
  const suffixLength = before.slice(last).join('').length
  const item = { textContent: source, textFormat: 'plain' as const }
  const units = replacementUnits(item)
  const canonical = units.map(unit => unit.char).join('')
  const start = units.findIndex(unit => unit.end > prefixLength)
  const end = units.findLastIndex(unit => unit.start < source.length - suffixLength)
  // An insertion must still quote at least one existing unit. Widen over
  // normalized spaces and complete emoji tokens where the wire range needs it.
  let left = Math.min(start === -1 ? units.length - 1 : start, Math.max(0, end))
  let right = Math.max(left, end)
  while (left > 0 && (units[left]!.char === ' ' || /[\uDC00-\uDFFF]/u.test(units[left]!.char) || units[left - 1]!.start === units[left]!.start)) left--
  while (right + 1 < units.length && (units[right]!.char === ' ' || /[\uD800-\uDBFF]/u.test(units[right]!.char) || units[right + 1]!.end === units[right]!.end)) right++
  if (left < 0 || units[left]!.start > prefixLength || units[right]!.end < source.length - suffixLength) {
    throw new Error('请保留转写片段首尾的原有空白')
  }
  const text = canonical.slice(left, right + 1)
  if (text.length > MESSAGE_QUOTE_LIMIT) throw new Error('单次改动范围过长，请分次修改')
  const anchor: ArkmeMessageQuote = { version: 1, projection: 'arkme-text-v1', sourceDigest,
    start: left, end: right + 1, text, ...quoteContext(canonical, left, right + 1) }
  const range = resolveMessageTextReplacement(item, anchor)
  const replacement = draft.slice(range.start, draft.length - (source.length - range.end))
  if (applyMessageTextReplacement(source, range, replacement).text !== draft) throw mismatch()
  return { anchor, replacement }
}

export function applyMessageTextReplacement(source: string, range: MessageTextReplacement, value: string, mentions: readonly ArkmeRecordReeditMention[] = []) {
  if (source.slice(range.start, range.end) !== range.original) throw mismatch()
  const replacement = range.markdown ? arkmeEscapeMarkdownText(value) : value
  const delta = replacement.length - (range.end - range.start)
  const nextMentions = mentions.flatMap(mention => {
    const end = mention.startIndex + mention.length
    if (end <= range.start) return [{ ...mention }]
    if (mention.startIndex >= range.end) return [{ ...mention, startIndex: mention.startIndex + delta }]
    if (mention.startIndex < range.start || end > range.end) throw new Error('请完整选择 @ 人名，或通过“重新编辑”修改')
    return [] // Explicitly replacing the whole mention removes its old identity, never retargets it.
  })
  return { text: source.slice(0, range.start) + replacement + source.slice(range.end), mentions: nextMentions }
}
