import type { ArkmeCalendarBucketDay, ArkmeCalendarBucketPage, ArkmeInterwovenMention, ArkmeInterwovenState } from '../types.js'

export type ConversationCalendarInteractionState = ArkmeInterwovenState | 'loading' | 'error'

/** Merge only authorized, already loaded cards. Never mutate/persist the message-only index. */
export function mergeConversationCalendar(page: ArkmeCalendarBucketPage | undefined,
  moments: readonly ArkmeInterwovenMention[], offsetMillis: number): ArkmeCalendarBucketPage | undefined {
  if (!page || page.scope !== 'private_chat') return page
  const days = new Map<string, ArkmeCalendarBucketDay & { conversationCounts: { messages: number; interactions: number } }>(page.days.map(day => [day.bucketDate, { ...day,
    conversationCounts: { messages: day.count, interactions: 0 } }]))
  const anchors = page.days.flatMap(day => day.anchor ? [day.anchor] : [])
    .filter(anchor => Number.isFinite(anchor.sendAtMillis) && anchor.sendAtMillis > 0)
    .sort((a, b) => a.sendAtMillis - b.sendAtMillis)
  const unique = [...new Map(moments.map(moment => [moment.momentId, moment])).values()]
    .filter(moment => moment.momentId && Number.isFinite(moment.occurredAtMillis) && moment.occurredAtMillis > 0)
    .sort((a, b) => a.occurredAtMillis - b.occurredAtMillis || a.momentId.localeCompare(b.momentId))
  for (const moment of unique) {
    const shifted = new Date(moment.occurredAtMillis + offsetMillis)
    if (!Number.isFinite(shifted.getTime())) continue
    const date = shifted.toISOString().slice(0, 10)
    const day: ArkmeCalendarBucketDay & { conversationCounts: { messages: number; interactions: number } } = days.get(date) ?? { bucketDate: date, count: 0, protectedCount: 0, hasRecords: true,
      conversationCounts: { messages: 0, interactions: 0 } }
    day.count += 1
    day.hasRecords = true
    day.conversationCounts.interactions += 1
    // Unknown message-anchor times must not be guessed. Preserve their existing unavailable state.
    if (!day.momentAnchor && (day.conversationCounts.messages === 0
      || day.anchor && day.anchor.sendAtMillis > moment.occurredAtMillis)) {
      const contextAnchor = anchors.findLast(anchor => anchor.sendAtMillis <= moment.occurredAtMillis) ?? anchors[0]
      day.momentAnchor = { momentId: moment.momentId, occurredAtMillis: moment.occurredAtMillis,
        ...(contextAnchor ? { contextAnchor } : {}) }
    }
    days.set(date, day)
  }
  const result = [...days.values()].sort((a, b) => a.bucketDate.localeCompare(b.bucketDate))
  return { ...page, days: result, totalDayCount: result.length }
}

export function conversationCalendarNotice(state: ConversationCalendarInteractionState): string {
  switch (state) {
    case 'disabled': return ''
    case 'loading': return '正在加载群聊互动；当前日期统计尚未完整'
    case 'error': return '群聊互动加载失败，当前统计可能不完整'
    case 'partial': return '部分群聊互动暂不可用；已计入可用互动，历史统计可能不完整'
    default: return '已计入当前已加载的群聊互动，历史统计可能不完整'
  }
}
