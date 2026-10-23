import { quoteCanonicalText } from '../message-quote.js'
import type { DshRemoteHistoryEntry } from './dsh-event-contract.js'

/** Versioned plugin projection over public durable messages, never a DSH renderer import. */
export function nativeAnnotationProjection(entry: DshRemoteHistoryEntry) {
  const event = entry.event
  if (event.surfaceOp !== 'append' || !['user/message', 'assistant/message'].includes(event.type)) return
  const data = event.data as { source?: { kind?: string }; content?: unknown[]; message?: { content?: unknown[] }; interrupted?: boolean }
  const role = event.type === 'user/message' ? 'user' as const : 'assistant' as const
  if ((role === 'user' && data.source?.kind !== 'user') || data.interrupted === true) return
  const content = role === 'user' ? data.content : data.message?.content
  if (!Array.isArray(content)) return
  const raw = content.flatMap(value => { const block = value as { type?: string; text?: string }; return block?.type === 'text' && typeof block.text === 'string' ? [block.text] : [] }).join('')
  const canonical = quoteCanonicalText({ textContent: raw, textFormat: role === 'assistant' ? 'markdown' : 'plain' })
  return canonical && canonical.length <= 200_000 ? { role, canonical } : undefined
}
