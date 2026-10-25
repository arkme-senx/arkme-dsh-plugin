import { MESSAGE_QUOTE_LIMIT } from './message-quote.js'

/** A personal reading snapshot, not a server-verified extension relation. */
export interface SelectedTextNoteQuote {
  version: 1
  sourceLabel: string
  senderName: string
  sourceAtMillis: number
  text: string
}
export interface SelectedTextNotePresentation {
  quote: SelectedTextNoteQuote
  header: string
  noteText: string
  storage: 'local'
  kind?: 'forward'
}
export function readSelectedTextNoteQuote(value: unknown): SelectedTextNoteQuote | undefined {
  if (!value || typeof value !== 'object') return undefined
  const q = value as SelectedTextNoteQuote
  if (q.version !== 1 || typeof q.sourceLabel !== 'string' || !q.sourceLabel.trim() || q.sourceLabel.length > 300
    || typeof q.senderName !== 'string' || !q.senderName.trim() || q.senderName.length > 200
    || !Number.isSafeInteger(q.sourceAtMillis) || q.sourceAtMillis < 0 || q.sourceAtMillis > 8.64e15
    || typeof q.text !== 'string' || !q.text.trim() || q.text.length > MESSAGE_QUOTE_LIMIT) return undefined
  return { version: 1, sourceLabel: q.sourceLabel.trim(), senderName: q.senderName.trim(), sourceAtMillis: q.sourceAtMillis, text: q.text }
}
export function selectedTextNoteHeader(quote: SelectedTextNoteQuote): string {
  const time = quote.sourceAtMillis > 0 ? new Date(quote.sourceAtMillis).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '原时间未提供'
  return `引用 · ${quote.sourceLabel}\n${quote.senderName} · ${time}`
}
export function selectedTextNotePrefix(quote: SelectedTextNoteQuote, header = selectedTextNoteHeader(quote)): string {
  return `${header}\n${quote.text}\n\n我的笔记\n`
}
export function selectedTextNoteWireText(note: string, quote: SelectedTextNoteQuote): string {
  return `${selectedTextNotePrefix(quote)}${note.trim()}`
}

export function selectedTextForwardPrefix(quote: SelectedTextNoteQuote, header = selectedTextNoteHeader(quote)): string {
  return `${header}\n${quote.text}\n\n附言\n`
}
export function selectedTextForwardWireText(comment: string, quote: SelectedTextNoteQuote): string {
  return comment.trim() ? `${selectedTextForwardPrefix(quote)}${comment.trim()}` : `${selectedTextNoteHeader(quote)}\n${quote.text}`.trimEnd()
}

/** Recheck the current text after edits or presentation refreshes; never render a stale snapshot. */
export function selectedTextNotePresentation(text: string, saved: SelectedTextNotePresentation | undefined): SelectedTextNotePresentation | undefined {
  if (!saved) return undefined
  if (saved.kind === 'forward') {
    const bare = `${saved.header}\n${saved.quote.text}`
    if (text === bare.trimEnd()) return { ...saved, quote: { ...saved.quote, text: saved.quote.text.trimEnd() }, noteText: '' }
    const prefix = selectedTextForwardPrefix(saved.quote, saved.header)
    return text.startsWith(prefix) && text.slice(prefix.length).trim() ? { ...saved, noteText: text.slice(prefix.length) } : undefined
  }
  const prefix = selectedTextNotePrefix(saved.quote, saved.header)
  const noteText = text.startsWith(prefix) ? text.slice(prefix.length) : ''
  return noteText.trim() ? { ...saved, noteText } : undefined
}
