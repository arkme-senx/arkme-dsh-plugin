import type { ArkmeTimelineCursor, ArkmeTimelinePage } from '../types.js'
import { compareUnifiedTimelineEvents, mergeUnifiedTimelineWindow, type ArkmeUnifiedTimelineWindow } from '../unified-chat-timeline.js'

export const MAX_ACTIVE_TIMELINE_EVENTS = 2000
export const MAX_ACTIVE_TIMELINE_TOKENS = 500

/** Complete a finite refresh before publication; future tail and history frontiers remain independent. */
export async function refreshUnifiedTimelineWindow(
  previous: ArkmeUnifiedTimelineWindow,
  read: (cursor: ArkmeTimelineCursor) => Promise<ArkmeTimelinePage>,
  signal: AbortSignal,
  followTail: boolean,
): Promise<ArkmeTimelinePage> {
  if (previous.windowTokens.length > MAX_ACTIVE_TIMELINE_TOKENS) throw new Error('已加载历史较多，请重新定位后继续')
  let cursor: ArkmeTimelineCursor = { unified: { mode: 'refresh', windowTokens: previous.windowTokens } }
  let page: ArkmeTimelinePage | undefined
  let combined: ArkmeUnifiedTimelineWindow | undefined
  const seen = new Set<string>()
  for (let count = 0; count < MAX_ACTIVE_TIMELINE_TOKENS; count++) {
    signal.throwIfAborted()
    const key = JSON.stringify(cursor)
    if (seen.has(key)) throw new Error('时间线刷新未推进，请重试')
    seen.add(key)
    page = await read(cursor)
    const next = page.unified
    if (!next) throw new Error('统一时间线响应缺失')
    const sources = next.sources.map(s => s.status !== 'not_applicable' && combined?.sources.some(old => old.source === s.source && old.status === 'gap') ? { ...s, status: 'gap' as const } : s)
    combined = mergeUnifiedTimelineWindow(combined, next, combined ? 'older' : 'initial')
    combined.sources = sources
    combined.complete = sources.every(s => s.status !== 'gap')
    if (combined.events.length > MAX_ACTIVE_TIMELINE_EVENTS || combined.windowTokens.length > MAX_ACTIVE_TIMELINE_TOKENS) throw new Error('已加载历史较多，请重新定位后继续')
    if (!next.hasMore || !next.complete && next.events.length === 0) break
    if (!next.nextCursor) throw new Error('时间线刷新缺少续页')
    cursor = { unified: { mode: 'refresh', cursor: next.nextCursor } }
    if (count === MAX_ACTIVE_TIMELINE_TOKENS - 1) throw new Error('时间线刷新超过窗口上限')
  }
  if (!page || !combined) throw new Error('统一时间线响应缺失')
  combined = mergeUnifiedTimelineWindow(previous, combined, 'refresh')
  if (followTail && previous.newerCursor) {
    let tailCursor = previous.newerCursor
    const visited = new Set<string>()
    for (let count = 0; count < MAX_ACTIVE_TIMELINE_TOKENS; count++) {
      signal.throwIfAborted()
      if (visited.has(tailCursor)) throw new Error('时间线追赶未推进，请重试')
      visited.add(tailCursor)
      const tail = await read({ unified: { mode: 'newer', cursor: tailCursor } })
      if (!tail.unified) throw new Error('统一时间线响应缺失')
      const sources = tail.unified.sources.map(s => s.status !== 'not_applicable' && (s.status === 'gap' || combined!.sources.some(t => t.source === s.source && t.status === 'gap')) ? { ...s, status: 'gap' as const } : s)
      combined = mergeUnifiedTimelineWindow(combined, tail.unified, 'newer')
      combined.sources = sources
      combined.complete = sources.every(s => s.status !== 'gap')
      if (combined.events.length > MAX_ACTIVE_TIMELINE_EVENTS || combined.windowTokens.length > MAX_ACTIVE_TIMELINE_TOKENS) throw new Error('已加载历史较多，请重新定位后继续')
      if (!tail.unified.hasMore || !tail.unified.complete && tail.unified.events.length === 0) break
      if (!tail.unified.nextCursor) throw new Error('时间线追赶缺少续页')
      tailCursor = tail.unified.nextCursor
      if (count === MAX_ACTIVE_TIMELINE_TOKENS - 1) throw new Error('时间线追赶超过窗口上限')
    }
  }
  signal.throwIfAborted()
  combined.events.sort(compareUnifiedTimelineEvents)
  return { ...page, unified: combined, items: combined.events.flatMap(e => e.kind === 'message' ? [e.item] : []),
    hasMore: combined.olderHasMore, ...(combined.olderCursor ? { nextCursor: { unified: { mode: 'older', cursor: combined.olderCursor } } } : {}) }
}
