import { arkmeMarkdownPlainText } from './markdown.js'
import { arkmeEmojiPlainText } from './arkme-emoji-text.js'

export const MESSAGE_QUOTE_LIMIT = 2_000
export interface ArkmeMessageQuote {
  version: 1
  projection: 'arkme-text-v1'
  sourceDigest: string
  recordVersion?: number
  /** UTF-16 offsets in quoteCanonicalText(), never offsets into Markdown. */
  start: number
  end: number
  text: string
  prefix: string
  suffix: string
}
export interface ArkmeQuoteReplyCapabilities { supported: boolean; maxQuoteLength: number }
export type ArkmeQuoteSource = { title?: string; textContent: string; textFormat?: 'plain' | 'markdown'; senderKind?: string }

/** Versioned matching projection. Displayed quotation keeps its original whitespace. */
export function normalizeQuoteText(text: string): string { return text.replace(/\s+/gu, ' ').trim() }
export function quoteSourceContent(item: ArkmeQuoteSource): string {
  return JSON.stringify([item.textContent || item.title || '', item.senderKind === 'bot' ? 'markdown' : item.textFormat ?? 'plain'])
}
export function quoteCanonicalText(item: ArkmeQuoteSource): string {
  const text = item.textContent || item.title || ''
  return normalizeQuoteText(arkmeEmojiPlainText(item.textFormat === 'markdown' || item.senderKind === 'bot' ? arkmeMarkdownPlainText(text) : text))
}
export function readMessageQuote(value: unknown): ArkmeMessageQuote | undefined {
  if (!value || typeof value !== 'object') return undefined
  const q = value as ArkmeMessageQuote
  if (q.version !== 1 || q.projection !== 'arkme-text-v1' || !/^[a-f0-9]{64}$/u.test(q.sourceDigest)
    || !Number.isSafeInteger(q.start) || !Number.isSafeInteger(q.end) || q.start < 0 || q.end <= q.start || q.end > 1_000_000
    || typeof q.text !== 'string' || !q.text.trim() || q.text.length > MESSAGE_QUOTE_LIMIT
    || normalizeQuoteText(q.text).length !== q.end - q.start
    || typeof q.prefix !== 'string' || q.prefix.length > 32 || typeof q.suffix !== 'string' || q.suffix.length > 32
    || (q.recordVersion !== undefined && (!Number.isSafeInteger(q.recordVersion) || q.recordVersion < 0))) return undefined
  return { version: 1, projection: 'arkme-text-v1', sourceDigest: q.sourceDigest,
    start: q.start, end: q.end, text: q.text, prefix: q.prefix, suffix: q.suffix,
    ...(q.recordVersion === undefined ? {} : { recordVersion: q.recordVersion }) }
}
/** New captures never serialize half a surrogate pair at the context boundary. */
export function quoteContext(text: string, start: number, end: number): { prefix: string; suffix: string } {
  let before = Math.max(0, start - 32), after = Math.min(text.length, end + 32)
  if (before > 0 && /[\uDC00-\uDFFF]/u.test(text[before]!) && /[\uD800-\uDBFF]/u.test(text[before - 1]!)) before++
  if (after < text.length && /[\uDC00-\uDFFF]/u.test(text[after]!) && /[\uD800-\uDBFF]/u.test(text[after - 1]!)) after--
  return { prefix: text.slice(before, start), suffix: text.slice(end, after) }
}
export function quoteMatchesCanonical(quote: ArkmeMessageQuote, text: string): boolean {
  const context = quoteContext(text, quote.start, quote.end)
  // Existing private SQLite anchors can contain the original 32-unit context.
  // Retain their readability; only new captures use the portable safe boundary.
  return text.slice(quote.start, quote.end) === normalizeQuoteText(quote.text)
    && (quote.prefix === context.prefix || wellFormedQuoteContext(quote.prefix) === wellFormedQuoteContext(text.slice(Math.max(0, quote.start - 32), quote.start)))
    && (quote.suffix === context.suffix || wellFormedQuoteContext(quote.suffix) === wellFormedQuoteContext(text.slice(quote.end, quote.end + 32)))
}
// A 32-unit hint may split a surrogate pair. Go's JSON decoder represents
// that lone unit as U+FFFD; context matching uses the same scalar projection.
function wellFormedQuoteContext(value:string):string {
  let result=''
  for(const scalar of value){const unit=scalar.charCodeAt(0);result+=scalar.length===1&&unit>=0xd800&&unit<=0xdfff?'\uFFFD':scalar}
  return result
}
export function quoteCapabilitiesFromWire(value: unknown): ArkmeQuoteReplyCapabilities {
  const q = value as Record<string, unknown> | null
  return q?.protocol_version === 1 && q.enabled === true && q.projection === 'arkme-text-v1'
    && Number.isSafeInteger(q.max_quote_length) && Number(q.max_quote_length) > 0
    ? { supported: true, maxQuoteLength: Math.min(MESSAGE_QUOTE_LIMIT, Number(q.max_quote_length)) }
    : { supported: false, maxQuoteLength: MESSAGE_QUOTE_LIMIT }
}

/** Only a server-validated, explicitly accessible quote may expose its snapshot. */
export function projectedMessageQuote(value: unknown, state: unknown): {
  quote?: ArkmeMessageQuote; quoteState?: 'available' | 'edited' | 'unavailable'
} {
  if (value === undefined && state === undefined) return {}
  const quote = readMessageQuote(value)
  return quote && (state === 'available' || state === 'edited')
    ? { quote, quoteState: state } : { quoteState: 'unavailable' }
}
