import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dayActivityQueryKey, mergeDayActivityItems,
  type DayActivityDetailPage, type DayActivityPage, type DayActivityQuery, type DayActivityReader,
} from './calendar-activity-model.js'

function message(error: unknown) { return error instanceof Error ? error.message : '暂时无法读取活动，请重试' }

interface Resource<T> { key: string; value?: T; loading: boolean; error: string }

/** Query-scoped, cancellable, explicitly paged reads. No history fan-out or writes. */
export function useDayActivities(query: DayActivityQuery, reader: DayActivityReader | undefined, refreshVersion = 0, enabled = true) {
  const key = dayActivityQueryKey(query)
  const [revision, setRevision] = useState(0)
  const [resource, setResource] = useState<Resource<DayActivityPage>>({ key, loading: !!reader, error: '' })
  const currentResource = useRef(resource)
  currentResource.current = resource
  const loadedReader = useRef<DayActivityReader>()
  const loadedPages = useRef(1)
  const reading = useRef<AbortController>()
  const more = useRef<AbortController>()
  const refreshPending = useRef(false)
  const lastRefresh = useRef(refreshVersion)
  const active = useRef<{ key: string; reader: DayActivityReader | undefined }>({ key, reader })
  active.current = { key, reader }
  const cursors = useRef(new Set<string>())
  const [paging, setPaging] = useState(false)
  const value = enabled && resource.key === key && loadedReader.current === reader ? resource.value : undefined
  const current = enabled && resource.key === key && (!resource.value || loadedReader.current === reader)
    ? resource : { key, loading: enabled && !!reader, error: '' }

  useEffect(() => {
    const controller = new AbortController()
    reading.current = controller
    refreshPending.current = false
    lastRefresh.current = refreshVersion
    const previous = currentResource.current
    const retained = enabled && previous.key === key && loadedReader.current === reader ? previous.value : undefined
    const wantedPages = retained ? loadedPages.current : 1
    more.current?.abort(); more.current = undefined; cursors.current.clear(); setPaging(false)
    setResource({ key, ...(retained ? { value: retained } : {}), loading: enabled && !!reader && !retained, error: '' })
    if (!enabled) { reading.current = undefined; return () => controller.abort() }
    if (reader && !query.accountScope.trim()) {
      setResource({ key, loading: false, error: '账号范围尚未确认，暂不读取活动' })
      reading.current = undefined
      return () => controller.abort()
    }
    if (reader) {
      let succeeded = false
      const read = async () => {
        if (controller.signal.aborted) return
        let page = await reader.loadDay(query, { signal: controller.signal, ...(!retained ? { onProgress: (page: DayActivityPage) => {
          if (controller.signal.aborted) return
          validatePage(page, query)
          loadedReader.current = reader
          setResource({ key, value: page, loading: true, error: '' })
        } } : {}) })
        if (controller.signal.aborted) return
        validatePage(page, query)
        let count = 1
        const seen = new Set<string>()
        // Rebuild only the prefix the user already opened, then swap it atomically.
        while (count < wantedPages && page.hasMore && page.nextCursor) {
          const cursor = page.nextCursor
          if (seen.has(cursor)) throw new Error('活动分页已失效，请重试')
          seen.add(cursor)
          const next = await reader.loadDay(query, { signal: controller.signal, cursor, snapshotId: page.snapshotId })
          if (controller.signal.aborted) return
          validatePage(next, query, page.snapshotId)
          if (next.order !== page.order) throw new Error('活动排序已变化，请重试')
          page = { ...next, items: mergeDayActivityItems(next.replaceItems ? [] : page.items, next.items, next.order) }
          count += 1
        }
        loadedPages.current = count
        loadedReader.current = reader
        cursors.current = seen
        return page
      }
      void read()
        .then(page => {
          if (controller.signal.aborted || !page) return
          validatePage(page, query)
          succeeded = true
          setResource({ key, value: { ...page, items: mergeDayActivityItems([], page.items, page.order) }, loading: false, error: '' })
        }).catch(error => {
          if (!controller.signal.aborted) setResource({ key, loading: false, error: message(error) })
        }).finally(() => {
          if (reading.current === controller) {
            reading.current = undefined
            if (succeeded && refreshPending.current && !controller.signal.aborted) setRevision(value => value + 1)
            refreshPending.current = false
          }
        })
    } else reading.current = undefined
    return () => { controller.abort(); if (reading.current === controller) reading.current = undefined; more.current?.abort(); more.current = undefined }
    // key encodes all query fields; no reload for a referentially new query object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reader, revision, enabled])

  // Soft realtime hints do not restart an in-flight read or extend its deadline.
  // Keep one trailing refresh. Account/date/privacy changes use the effect above.
  useEffect(() => {
    if (lastRefresh.current === refreshVersion) return
    lastRefresh.current = refreshVersion
    if (reading.current || more.current) refreshPending.current = true
    else if (enabled) setRevision(value => value + 1)
  }, [refreshVersion, enabled])

  const loadMore = useCallback(async () => {
    if (!reader || !value?.hasMore || !value.nextCursor || current.loading || more.current || reading.current) return
    const controller = new AbortController(); more.current = controller; setPaging(true)
    let succeeded = false
    setResource(resource => ({ ...resource, error: '' }))
    try {
      const page = await reader.loadDay(query, { signal: controller.signal, cursor: value.nextCursor, snapshotId: value.snapshotId })
      if (controller.signal.aborted || active.current.key !== key || active.current.reader !== reader) return
      validatePage(page, query, value.snapshotId)
      if (page.hasMore && (page.nextCursor === value.nextCursor || cursors.current.has(page.nextCursor!))) {
        throw new Error('活动分页已失效，请刷新当天内容')
      }
      cursors.current.add(value.nextCursor)
      if (page.order !== value.order) throw new Error('活动排序已变化，请刷新当天内容')
      loadedPages.current += 1
      succeeded = true
      setResource({ key, loading: false, error: '', value: { ...page, items: mergeDayActivityItems(page.replaceItems ? [] : value.items, page.items, page.order) } })
    } catch (error) {
      if (!controller.signal.aborted && active.current.key === key && active.current.reader === reader) {
        // Fail closed: an invalidated snapshot must not retain possibly revoked content.
        setResource({ key, loading: false, error: message(error) })
      }
    } finally {
      if (more.current === controller) {
        more.current = undefined; setPaging(false)
        if (succeeded && refreshPending.current && !controller.signal.aborted) setRevision(value => value + 1)
        refreshPending.current = false
      }
    }
  }, [reader, value, current.loading, query, key])

  return { page: value, loading: current.loading, error: current.error, loadingMore: paging && resource.key === key,
    loadMore, refresh: () => setRevision(value => value + 1) }
}

function validatePage(page: DayActivityPage, query: DayActivityQuery, snapshotId?: string) {
  if (dayActivityQueryKey(page.query) !== dayActivityQueryKey(query) || !page.snapshotId.trim()
    || snapshotId !== undefined && page.snapshotId !== snapshotId
    || page.hasMore && !page.nextCursor?.trim()
    || !Number.isFinite(page.dayStartMillis) || !Number.isFinite(page.dayEndMillis) || page.dayEndMillis <= page.dayStartMillis
    || page.items.some(item => !item.id.trim() || !Number.isFinite(item.startAtMillis) || !Number.isFinite(item.endAtMillis)
      || item.endAtMillis < item.startAtMillis || item.endAtMillis < page.dayStartMillis || item.startAtMillis >= page.dayEndMillis)) {
    throw new Error('活动数据范围或版本不一致，请刷新当天内容')
  }
}

export function useDayActivityDetail(query: DayActivityQuery, activityId: string | undefined, snapshotId: string | undefined,
  reader: DayActivityReader | undefined, contentRevision?: string) {
  const scope = dayActivityQueryKey(query)
  const identity = JSON.stringify([scope, activityId, snapshotId])
  const key = JSON.stringify([identity, contentRevision])
  const [resource, setResource] = useState<Resource<DayActivityDetailPage>>({ key, loading: false, error: '' })
  const [revision, setRevision] = useState(0)
  const controllerRef = useRef<AbortController>()
  const seen = useRef(new Set<string>())
  const loaded = useRef<{ identity: string; reader: DayActivityReader; pages: number }>()
  const keyRef = useRef(key); keyRef.current = key
  const current = resource.key === key ? resource : { key, loading: !!activityId, error: '' }

  const read = useCallback(async (cursor?: string, previous?: DayActivityDetailPage, wantedPages = 1) => {
    if (!activityId || !snapshotId || !reader || controllerRef.current) return
    const controller = new AbortController(); controllerRef.current = controller
    setResource({ key, ...(previous ? { value: previous } : {}), loading: true, error: '' })
    try {
      const cursors = cursor ? new Set(seen.current) : new Set<string>()
      const fetchPage = async (nextCursor?: string, prior?: DayActivityDetailPage) => {
        const page = await reader.loadDetail(query, activityId, { signal: controller.signal, snapshotId, ...(nextCursor ? { cursor: nextCursor } : {}) })
        controller.signal.throwIfAborted()
        if (dayActivityQueryKey(page.query) !== scope || page.activityId !== activityId || page.snapshotId !== snapshotId
          || page.items.some(item => !item.id.trim() || !Number.isFinite(item.occurredAtMillis))
          || page.hasMore && (!page.nextCursor?.trim() || page.nextCursor === nextCursor || cursors.has(page.nextCursor))) {
          throw new Error('活动详情已变化，请刷新后重试')
        }
        if (nextCursor) cursors.add(nextCursor)
        const items = page.access === 'restricted' ? [] : [...new Map([...(prior?.items ?? []), ...page.items].map(item => [item.id, item])).values()]
          .sort((a, b) => a.occurredAtMillis - b.occurredAtMillis || a.id.localeCompare(b.id))
        return { ...page, items }
      }
      let page = await fetchPage(cursor, previous)
      let count = cursor ? (loaded.current?.pages ?? 1) + 1 : 1
      // A changed group invalidates offset cursors. Rebuild just the opened prefix.
      while (count < wantedPages && page.access === 'available' && page.hasMore) {
        page = await fetchPage(page.nextCursor, page)
        count += 1
      }
      if (controller.signal.aborted || keyRef.current !== key) return
      seen.current = cursors
      loaded.current = { identity, reader, pages: count }
      setResource({ key, value: page, loading: false, error: '' })
    } catch (error) {
      if (!controller.signal.aborted && keyRef.current === key) setResource({ key, loading: false, error: message(error) })
    } finally { if (controllerRef.current === controller) controllerRef.current = undefined }
  }, [activityId, snapshotId, reader, key, identity, scope, query])

  useEffect(() => {
    controllerRef.current?.abort(); controllerRef.current = undefined; seen.current.clear()
    const wantedPages = loaded.current?.identity === identity && loaded.current.reader === reader ? loaded.current.pages : 1
    setResource({ key, loading: !!activityId, error: '' }); void read(undefined, undefined, wantedPages)
    return () => { controllerRef.current?.abort(); controllerRef.current = undefined }
    // Query identity is encoded in key; avoid a request on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reader, revision])

  return { page: current.value, loading: current.loading, error: current.error,
    retry: () => setRevision(value => value + 1),
    loadMore: () => {
      if (current.value?.access === 'available' && current.value.hasMore && current.value.nextCursor) {
        void read(current.value.nextCursor, current.value)
      }
    } }
}
