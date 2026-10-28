import type { ArkmeAiLetterItem, ArkmeAiLetterPage, ArkmeAiLetterUnread } from '../types.js'
import { ServiceRuntime, objectValue, stringValue } from './service.js'

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function millisValue(value: unknown): number {
  const numeric = Math.trunc(numberValue(value))
  if (numeric <= 0) return 0
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
}

function letterItem(raw: unknown): ArkmeAiLetterItem | undefined {
  const item = objectValue(raw)
  const letterId = stringValue(item.letter_id ?? item.letterId).trim()
  if (letterId === '') return undefined
  const readStatus = Math.trunc(numberValue(item.read_status ?? item.readStatus))
  return {
    letterId,
    title: stringValue(item.title).trim() || 'AI 来信',
    summary: stringValue(item.summary ?? item.body).replace(/\s+/g, ' ').trim(),
    createdAtMillis: millisValue(item.created_at ?? item.createdAt),
    // The mobile contract uses read_status=1 for unread.
    unread: readStatus === 1,
  }
}

export class AiLetterService {
  constructor(private readonly runtime: ServiceRuntime) {}

  async listLetters(options: {
    periodType?: number
    cursorStartAt?: number
    limit?: number
    signal?: AbortSignal
  } = {}): Promise<ArkmeAiLetterPage> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-letter/list', {
        period_type: Math.max(0, Math.trunc(options.periodType ?? 0)),
        cursor_start_at: Math.max(0, Math.trunc(options.cursorStartAt ?? 0)),
        limit: Math.min(50, Math.max(1, Math.trunc(options.limit ?? 20))),
      }, session, options.signal,
    )
    const items = listValue(data.items).map(letterItem).filter((item): item is ArkmeAiLetterItem => item !== undefined)
    return {
      items,
      nextCursor: Math.max(0, Math.trunc(numberValue(data.next_cursor ?? data.nextCursor))),
    }
  }

  async unread(signal?: AbortSignal): Promise<ArkmeAiLetterUnread> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-letter/unread-count', {}, session, signal,
    )
    const latestUnread = letterItem(data.latest_unread ?? data.latestUnread)
    return {
      unreadCount: Math.max(0, Math.trunc(numberValue(data.unread_count ?? data.unreadCount))),
      ...(latestUnread === undefined ? {} : { latestUnread }),
    }
  }

  async markRead(letterIds: readonly string[], signal?: AbortSignal): Promise<ArkmeAiLetterUnread> {
    const session = await this.runtime.requireSession()
    const ids = [...new Set(letterIds.map(value => value.trim()).filter(value => value !== ''))].slice(0, 50)
    if (ids.length === 0) return await this.unread(signal)
    const data = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-letter/mark-read', { letter_ids: ids }, session, signal,
    )
    return { unreadCount: Math.max(0, Math.trunc(numberValue(data.unread_count ?? data.unreadCount))) }
  }
}
