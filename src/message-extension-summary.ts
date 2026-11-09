import { readMessageQuote, type ArkmeMessageQuote } from './message-quote.js'
import { ArkmePluginError } from './services/service.js'

export interface ArkmeMessageExtensionSummary {
  accessible: boolean
  complete: boolean
  commentCount: number
  quoteCount: number
  sourceRecordVersion: number
  anchors: ArkmeMessageQuote[]
}
export interface ArkmeMessageExtensionSummaryItem { actionRef: string; summary: ArkmeMessageExtensionSummary }

/** Validate the entire partition before exposing any quoted text to a consumer. */
export function readExtensionSummaryBatch(value: unknown, refs: readonly string[]): ArkmeMessageExtensionSummaryItem[] {
  const invalid = () => { throw new ArkmePluginError('extension-summary-invalid', '评论汇总暂不可用，请重试', true, 502) }
  if (!value || typeof value !== 'object') return invalid()
  const data = value as Record<string, unknown>
  if (data.version !== 1 || !Array.isArray(data.items) || data.items.length !== refs.length) return invalid()
  const result: ArkmeMessageExtensionSummaryItem[] = [], seen = new Set<number>()
  for (const raw of data.items) {
    if (!raw || typeof raw !== 'object') return invalid()
    const row = raw as Record<string, unknown>, index = row.target_index
    const count = row.comment_count, quotes = row.quote_count, version = row.source_record_version
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= refs.length || seen.has(index)
      || typeof row.accessible !== 'boolean' || typeof row.complete !== 'boolean'
      || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0
      || typeof quotes !== 'number' || !Number.isSafeInteger(quotes) || quotes < 0 || quotes > count
      || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0 || !Array.isArray(row.anchors)) return invalid()
    seen.add(index)
    // Unavailable/incomplete results are redactions, never a successful zero or an old-text fallback.
    if (!row.accessible || !row.complete) {
      if (count !== 0 || quotes !== 0 || row.anchors.length) return invalid()
      result.push({ actionRef: refs[index]!, summary: { accessible: row.accessible, complete: row.complete, commentCount: 0, quoteCount: 0, sourceRecordVersion: version, anchors: [] } })
      continue
    }
    const anchors: ArkmeMessageQuote[] = [], unique = new Set<string>()
    for (const wire of row.anchors) {
      const quote = readMessageQuote(wire)
      if (!quote || (quote.recordVersion !== undefined && quote.recordVersion !== version)) return invalid()
      const key = JSON.stringify(quote)
      if (unique.has(key)) return invalid()
      unique.add(key); anchors.push(quote)
    }
    if (anchors.length > quotes || (quotes > 0 && !anchors.length)) return invalid()
    result.push({ actionRef: refs[index]!, summary: { accessible: true, complete: true, commentCount: count, quoteCount: quotes, sourceRecordVersion: version, anchors } })
  }
  return result
}
