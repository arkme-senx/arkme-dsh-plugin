import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeTimelinePage } from '../types.js'
import { conversationTimelineReadPort, type ConversationTimelineReadPort } from './conversation-timeline-read-port.js'
import { readConversationTimelineWindow } from './conversation-timeline-refresh.js'

type TimelineLoadKind = 'initial' | 'older' | 'refresh'

/** Mount per account + stable conversation identity. A rotated access ref refreshes the same read window. */
export function useChatPreviewTimeline(sourceRef: string, changeRevision: number, port: ConversationTimelineReadPort = conversationTimelineReadPort) {
  const [page, setPage] = useState<ArkmeTimelinePage>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadedRevision, setLoadedRevision] = useState(changeRevision)
  const revision = useRef(changeRevision)
  revision.current = changeRevision
  const currentPage = useRef<ArkmeTimelinePage>()
  const request = useRef<AbortController>()
  const failedLoadKind = useRef<TimelineLoadKind>('initial')

  const load = useCallback(async (intent: TimelineLoadKind) => {
    if (request.current !== undefined && !request.current.signal.aborted) return
    const previous = currentPage.current
    if (intent === 'older' && (!previous?.hasMore || previous.nextCursor === undefined)) return
    const controller = new AbortController()
    request.current = controller
    failedLoadKind.current = intent
    const startedRevision = revision.current
    setLoading(true)
    setError('')
    const timer = setTimeout(() => {
      if (request.current !== controller) return
      controller.abort()
      setLoading(false)
      setError('消息加载超时，请重试')
    }, 15_000)
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
    try {
      const cursor = intent === 'older' ? previous?.nextCursor : undefined
      const refreshWindow = intent === 'refresh' && previous !== undefined && previous.items.length > 0
      const result = refreshWindow
        ? await readConversationTimelineWindow(previous,
          next => port.readPage(sourceRef, next, controller.signal), controller.signal)
        : await port.readPage(sourceRef, cursor, controller.signal)
      if (controller.signal.aborted || request.current !== controller) return
      if (!refreshWindow && result.hasMore && (result.nextCursor?.beforeSequence === undefined
        || result.nextCursor.beforeSequence <= 0
        || cursor?.beforeSequence !== undefined && result.nextCursor.beforeSequence >= cursor.beforeSequence)) {
        throw new Error('消息分页暂不可继续，请重试')
      }
      const items = new Map((intent === 'older' ? previous?.items ?? [] : []).map(item => [item.itemUid, item]))
      for (const item of result.items) items.set(item.itemUid, item)
      const next: ArkmeTimelinePage = {
        ...result,
        // Refresh replaces content in the loaded window; the older-page boundary is unchanged.
        ...(refreshWindow ? { hasMore: previous.hasMore, nextCursor: previous.nextCursor } : {}),
        items: [...items.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.sendAtMillis - b.sendAtMillis || a.itemUid.localeCompare(b.itemUid)),
      }
      currentPage.current = next
      setPage(next)
      if (intent !== 'older') setLoadedRevision(startedRevision)
    } catch (caught) {
      if (controller.signal.aborted || request.current !== controller) return
      setError(caught instanceof Error ? caught.message : '消息加载失败，请重试')
    } finally {
      clearTimeout(timer)
      if (request.current === controller) { request.current = undefined; setLoading(false) }
    }
  }, [port, sourceRef])

  useEffect(() => {
    void load(currentPage.current === undefined ? 'initial' : 'refresh')
    return () => { request.current?.abort(); request.current = undefined }
  }, [load])

  useEffect(() => {
    if (!loading && error === '' && changeRevision !== loadedRevision) void load('refresh')
  }, [changeRevision, loadedRevision, loading, error, load])

  return { page, loading, error,
    loadMore: () => load('older'), retry: () => load(failedLoadKind.current) }
}
