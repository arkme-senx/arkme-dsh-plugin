import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { ArkmeFileAssetDisplayItem, ArkmeRecordSearchResult, ArkmeSearchSceneKind, ArkmeSearchRecordItem, ArkmeTimelineItem } from '../types.js'
import { conversationSearchReadPort } from './conversation-search-port.js'

export function useConversationSearch(sourceRef: string, global: boolean, scene: ArkmeSearchSceneKind, query: string, composing: boolean) {
  const [page, setPage] = useState<ArkmeRecordSearchResult>()
  const [assets, setAssets] = useState<Map<string, ArkmeFileAssetDisplayItem>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const request = useRef<AbortController>()
  const busy = useRef(false)
  const failedCursor = useRef<string>()
  const scheduled = useRef<ReturnType<typeof setTimeout>>()
  const visitedCursors = useRef(new Set<string>())
  const keyword = query.trim()

  const load = useCallback(async (cursor?: string) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    busy.current = true
    failedCursor.current = cursor
    if (cursor === undefined) visitedCursors.current.clear()
    setLoading(true)
    setError('')
    const timeout = setTimeout(() => {
      if (request.current !== controller) return
      controller.abort()
      busy.current = false
      setLoading(false)
      setError('搜索超时，请重试')
    }, 15_000)
    try {
      const result = await conversationSearchReadPort.search(
        global ? { kind: 'global' } : { kind: 'conversation', sourceRef },
        keyword === '' ? { kind: 'scene', scene } : { kind: 'keyword', text: keyword },
        cursor, controller.signal,
      )
      if (controller.signal.aborted || request.current !== controller) return
      if (result.hasMore && (!result.nextCursor || result.nextCursor === cursor || visitedCursors.current.has(result.nextCursor))) throw new Error('搜索分页暂不可继续，请重试')
      if (cursor !== undefined) visitedCursors.current.add(cursor)
      setPage(previous => {
        const items = cursor === undefined ? [] : previous?.items ?? []
        const seen = new Set(items.map(item => `${item.sourceKind}:${item.sourceUid ?? ''}:${item.recordOwnerUserId ?? ''}:${item.recordUid}`))
        return { ...result, items: [...items, ...result.items.filter(item => {
          const key = `${item.sourceKind}:${item.sourceUid ?? ''}:${item.recordOwnerUserId ?? ''}:${item.recordUid}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })] }
      })
    } catch (caught) {
      if (request.current !== controller || controller.signal.aborted) return
      setError(caught instanceof Error ? caught.message : '加载失败，请重试')
    } finally {
      clearTimeout(timeout)
      if (request.current === controller) { busy.current = false; setLoading(false) }
    }
  }, [global, keyword, scene, sourceRef])

  useEffect(() => {
    request.current?.abort()
    request.current = undefined
    busy.current = false
    setPage(undefined)
    setAssets(new Map())
    setError('')
    setLoading(!composing)
    if (composing) return
    scheduled.current = setTimeout(() => { void load() }, keyword === '' ? 0 : 300)
    return () => { clearTimeout(scheduled.current); request.current?.abort(); request.current = undefined }
  }, [composing, keyword, load])

  useEffect(() => {
    if (keyword !== '' || scene !== 'image_video' || page === undefined) return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    const uids = [...new Set(page.items.filter(item => item.sourceKind !== 3).flatMap(item => item.media.map(asset => asset.fileAssetUid)))].filter(uid => !assets.has(uid))
    void conversationSearchReadPort.readOwnAssetDisplays(uids, controller.signal, display => {
      if (!controller.signal.aborted) setAssets(previous => new Map([...previous, ...display.map(item => [item.fileAssetUid, item] as const)]))
    }).catch(() => { /* thumbnails are optional */ }).finally(() => clearTimeout(timeout))
    return () => { clearTimeout(timeout); controller.abort() }
  }, [keyword, scene, page])

  return { page, assets, loading, error,
    submit: () => { if (!composing && !busy.current) { clearTimeout(scheduled.current); void load() } },
    retry: () => { if (!busy.current && !composing) void load(failedCursor.current) },
    loadMore: () => { if (!busy.current && !composing && error === '' && page?.hasMore && page.nextCursor) void load(page.nextCursor) },
  }
}

export function useConversationSearchDetail(item: ArkmeSearchRecordItem, element?: RefObject<HTMLElement>, active = true) {
  const [snapshot, setSnapshot] = useState<{ item: ArkmeSearchRecordItem; revision: number; detail: ArkmeTimelineItem }>()
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const detail = snapshot?.item === item && snapshot.revision === revision ? snapshot.detail : undefined
  useEffect(() => {
    const controller = new AbortController()
    if (!active || detail !== undefined) return
    setError('')
    let timeout: ReturnType<typeof setTimeout> | undefined
    let started = false
    const load = () => {
      if (started || controller.signal.aborted) return
      started = true
      timeout = setTimeout(() => { controller.abort(); setError('详情加载超时，请重试') }, 15_000)
      void conversationSearchReadPort.readChatMessage(item, controller.signal).then(target => {
        if (controller.signal.aborted) return
        setSnapshot({ item, revision, detail: target })
      }).catch(caught => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '详情加载失败')
      }).finally(() => clearTimeout(timeout))
    }
    const observer = element?.current && typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { load(); observer?.disconnect() }
      }, { rootMargin: '160px' }) : undefined
    if (observer && element?.current) {
      const tiles = element.current.querySelectorAll?.('[data-search-media-tile]')
      if (tiles?.length) tiles.forEach(tile => observer.observe(tile))
      else observer.observe(element.current)
    }
    else load()
    return () => { observer?.disconnect(); clearTimeout(timeout); controller.abort() }
  }, [item, revision, element, active, detail])
  return { detail, error, retry: () => setRevision(value => value + 1) }
}
