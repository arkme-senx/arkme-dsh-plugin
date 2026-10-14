import type { ArkmeConversationMemberJoinEvent, ArkmeConversationMemberJoinPerson, ArkmeInterwovenMention, ArkmeMemberEvent, ArkmeTimelineItem } from './types.js'

export const CHAT_TIMELINE_SOURCES = ['messages', 'interwoven', 'group_metadata', 'member_left', 'ai_polish', 'world_public', 'wechat_import'] as const
export type ArkmeTimelineSource = typeof CHAT_TIMELINE_SOURCES[number]
export type ArkmeTimelineMode = 'initial' | 'older' | 'newer' | 'around' | 'refresh'
export interface ArkmeUnifiedTimelineQuery {
  cacheOnly?: boolean
  /** Read a committed window containing this opaque event/row identity; cacheOnly only. */
  anchorId?: string
  /** Host completes all refresh pages before committing. Bounded by 2000 events / 4 MiB. */
  reconcile?: boolean
  /** Optional tail catch-up in the same reconcile transaction; never used for history reading. */
  newerCursor?: string
  mode?: ArkmeTimelineMode
  cursor?: string
  windowTokens?: string[]
  limit?: number
  itemUid?: string
  recordOwnerUserId?: number | string
}
export interface ArkmeTimelineSourceStatus {
  source: ArkmeTimelineSource
  status: 'ready' | 'not_applicable' | 'gap'
  itemCount: number
}
export interface ArkmeTimelineEventOrder {
  /** Stable account-bound event identity, distinct from a Record identity. */
  eventId: string
  source: ArkmeTimelineSource
  occurredAtMillis: number
  orderTie: string
  windowToken?: string
  contentStatus: 'available' | 'unavailable'
}
export type ArkmeTimelineMemberJoinEvent = ArkmeConversationMemberJoinEvent | {
  eventId: string
  action: 'join'
  occurredAtMillis: number
  invitees: ArkmeConversationMemberJoinPerson[]
}

export type ArkmeUnifiedTimelineEvent = ArkmeTimelineEventOrder & (
  | { kind: 'message'; item: ArkmeTimelineItem }
  | { kind: 'moment'; item: ArkmeInterwovenMention }
  | { kind: 'member-event'; item: ArkmeMemberEvent }
  | { kind: 'member-join'; item: ArkmeTimelineMemberJoinEvent }
  | { kind: 'notice'; text: string }
  | { kind: 'external'; title: string; text: string }
  | { kind: 'world-public'; recordRef: string; authorName: string }
)
export interface ArkmeUnifiedTimelineWindow {
  protocolVersion: 1
  events: ArkmeUnifiedTimelineEvent[]
  sources: ArkmeTimelineSourceStatus[]
  complete: boolean
  windowTokens: string[]
  olderCursor?: string | undefined
  newerCursor?: string | undefined
  nextCursor?: string
  olderHasMore: boolean
  newerHasMore: boolean
  hasMore: boolean
}

/** Reverse of the Chat owner's descending total order; never use locale collation. */
export function compareUnifiedTimelineEvents(a: ArkmeTimelineEventOrder, b: ArkmeTimelineEventOrder): number {
  if (a.occurredAtMillis !== b.occurredAtMillis) return a.occurredAtMillis - b.occurredAtMillis
  if (a.source !== b.source) return CHAT_TIMELINE_SOURCES.indexOf(b.source) - CHAT_TIMELINE_SOURCES.indexOf(a.source)
  const tie = a.orderTie < b.orderTie ? -1 : a.orderTie > b.orderTie ? 1 : 0
  return a.source === 'world_public' ? -tie : tie
}

/** Merge only confirmed pages. A refresh's input is the entire completed covered window. */
export function mergeUnifiedTimelineWindow(
  previous: ArkmeUnifiedTimelineWindow | undefined,
  incoming: ArkmeUnifiedTimelineWindow,
  mode: ArkmeTimelineMode,
): ArkmeUnifiedTimelineWindow {
  const replace = mode === 'initial' || mode === 'around'
  const gap = new Set(incoming.sources.filter(s => s.status === 'gap').map(s => s.source))
  const retired = new Set(incoming.sources.filter(s => s.status === 'not_applicable').map(s => s.source))
  const retained = replace ? [] : (previous?.events ?? []).filter(event => !retired.has(event.source)
    && (mode !== 'refresh' || gap.has(event.source)))
  const events = new Map(retained.map(event => [event.eventId, event]))
  for (const event of incoming.events) events.set(event.eventId, event)
  return {
    ...incoming,
    events: [...events.values()].sort(compareUnifiedTimelineEvents),
    windowTokens: [...new Set([...(replace || mode === 'refresh' && gap.size === 0 ? [] : previous?.windowTokens ?? []), ...incoming.windowTokens])],
    ...(mode === 'refresh' && previous ? {
      olderCursor: previous.olderCursor, olderHasMore: previous.olderHasMore,
      newerCursor: previous.newerCursor, newerHasMore: previous.newerHasMore,
    } : mode === 'older' && previous ? { newerCursor: previous.newerCursor, newerHasMore: previous.newerHasMore }
      : mode === 'newer' && previous ? { olderCursor: previous.olderCursor, olderHasMore: previous.olderHasMore } : {}),
  }
}
