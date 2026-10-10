import { ArkmePluginError } from './services/service.js'
import { mergeUnifiedTimelineWindow, type ArkmeUnifiedTimelineQuery, type ArkmeUnifiedTimelineWindow } from './unified-chat-timeline.js'
import type { ArkmeTimelinePage } from './types.js'

/** Host-owned finite read. The caller commits once, only after this function succeeds. */
export async function reconcileUnifiedTimeline(
  query: ArkmeUnifiedTimelineQuery,
  read: (query: ArkmeUnifiedTimelineQuery) => Promise<ArkmeTimelinePage>,
  signal: AbortSignal,
): Promise<ArkmeTimelinePage> {
  let result: ArkmeTimelinePage | undefined
  let combined: ArkmeUnifiedTimelineWindow | undefined
  let bytes = 0
  let pages = 0
  const limit = query.limit === undefined ? {} : { limit: query.limit }
  const visited = new Set<string>()
  const drain = async (mode: 'refresh' | 'newer', first: ArkmeUnifiedTimelineQuery) => {
    let nextQuery = first
    for (;;) {
      signal.throwIfAborted()
      if (++pages > 500) throw new ArkmePluginError('chat-timeline-window-limit', '时间线校准超过窗口上限，请重新定位', false, 409)
      const key = JSON.stringify(nextQuery)
      if (visited.has(key)) throw new ArkmePluginError('chat-timeline-contract-invalid', '时间线校准游标未推进', true, 502)
      visited.add(key)
      result = await read(nextQuery)
      signal.throwIfAborted()
      const next = result.unified
      if (!next) throw new ArkmePluginError('chat-timeline-contract-invalid', '统一时间线响应缺失', true, 502)
      bytes += new TextEncoder().encode(JSON.stringify(result)).byteLength
      if (bytes > 4 * 1024 * 1024) throw new ArkmePluginError('chat-timeline-window-limit', '时间线校准超过容量，请重新定位', false, 409)
      const sources = next.sources.map(source => source.status !== 'not_applicable'
        && combined?.sources.some(old => old.source === source.source && old.status === 'gap')
        ? { ...source, status: 'gap' as const } : source)
      combined = mergeUnifiedTimelineWindow(combined, next, combined ? mode === 'refresh' ? 'older' : 'newer' : 'initial')
      combined.sources = sources
      combined.complete = sources.every(source => source.status !== 'gap')
      if (combined.events.length > 2000 || combined.windowTokens.length > 500) throw new ArkmePluginError('chat-timeline-window-limit', '时间线校准超过窗口上限，请重新定位', false, 409)
      if (!next.hasMore) break
      // Even an empty filtered page must advance along the server cursor.
      if (!next.nextCursor) throw new ArkmePluginError('chat-timeline-contract-invalid', '时间线校准缺少续页', true, 502)
      nextQuery = { mode, cursor: next.nextCursor, ...limit }
    }
  }
  await drain('refresh', { mode: 'refresh', ...(query.windowTokens ? { windowTokens: query.windowTokens } : {}), ...limit })
  if (query.newerCursor) await drain('newer', { mode: 'newer', cursor: query.newerCursor, ...limit })
  if (!result || !combined) throw new ArkmePluginError('chat-timeline-contract-invalid', '统一时间线响应缺失', true, 502)
  const window = combined as ArkmeUnifiedTimelineWindow
  const { nextCursor: _next, ...metadata } = result as ArkmeTimelinePage
  return { ...metadata, unified: { ...window, hasMore: false },
    items: window.events.flatMap(event => event.kind === 'message' ? [event.item] : []),
    hasMore: window.olderHasMore,
    ...(window.olderCursor ? { nextCursor: { unified: { mode: 'older' as const, cursor: window.olderCursor } } } : {}) }
}
