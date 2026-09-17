import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dayActivityQueryKey, mergeDayActivityItems,
  type DayActivityDetailPage, type DayActivityPage, type DayActivityQuery, type DayActivityReader,
} from './calendar-activity-model.js'

function message(error: unknown) { return error instanceof Error ? error.message : '暂时无法读取活动，请重试' }

interface Resource<T> { key: string; value?: T; loading: boolean; error: string }

/** Query-scoped, cancellable, explicitly paged reads. No history fan-out or writes. */
export function useDayActivities(query: DayActivityQuery, reader: DayActivityReader | undefined) {
  const key = dayActivityQueryKey(query)
  const [revision, setRevision] = useState(0)
  const [resource, setResource] = useState<Resource<DayActivityPage>>({ key, loading: !!reader, error: '' })
  const more = useRef<AbortController>()
  const active = useRef<{ key: string; reader: DayActivityReader | undefined }>({ key, reader })
  active.current = { key, reader }
  const cursors = useRef(new Set<string>())
  const [paging, setPaging] = useState(false)
  const value = resource.key === key ? resource.value : undefined
  const current = resource.key === key ? resource : { key, loading: !!reader, error: '' }

  useEffect(() => {
    const controller = new AbortController()
    more.current?.abort(); more.current = undefined; cursors.current.clear(); setPaging(false)
    setResource({ key, loading: !!reader, error: '' })
    if (reader && !query.accountScope.trim()) {
      setResource({ key, loading: false, error: '账号范围尚未确认，暂不读取活动' })
      return () => controller.abort()
    }
    if (reader) {
      void Promise.resolve().then(() => controller.signal.aborted ? undefined : reader.loadDay(query, { signal: controller.signal }))
        .then(page => {
          if (controller.signal.aborted || !page) return
          validatePage(page, query)
          setResource({ key, value: { ...page, items: mergeDayActivityItems([], page.items, page.order) }, loading: false, error: '' })
        }).catch(error => {
          if (!controller.signal.aborted) setResource({ key, loading: false, error: message(error) })
        })
    }
    return () => { controller.abort(); more.current?.abort(); more.current = undefined }
    // key encodes all query fields; no reload for a referentially new query object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reader, revision])

  const loadMore = useCallback(async () => {
    if (!reader || !value?.hasMore || !value.nextCursor || current.loading || more.current) return
    const controller = new AbortController(); more.current = controller; setPaging(true)
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
      setResource({ key, loading: false, error: '', value: { ...page, items: mergeDayActivityItems(page.replaceItems ? [] : value.items, page.items, page.order) } })
    } catch (error) {
      if (!controller.signal.aborted && active.current.key === key && active.current.reader === reader) {
        // Fail closed: an invalidated snapshot must not retain possibly revoked content.
        setResource({ key, loading: false, error: message(error) })
      }
    } finally { if (more.current === controller) { more.current = undefined; setPaging(false) } }
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
  reader: DayActivityReader | undefined) {
  const scope = dayActivityQueryKey(query)
  const key = JSON.stringify([scope, activityId, snapshotId])
  const [resource, setResource] = useState<Resource<DayActivityDetailPage>>({ key, loading: false, error: '' })
  const [revision, setRevision] = useState(0)
  const controllerRef = useRef<AbortController>()
  const seen = useRef(new Set<string>())
  const keyRef = useRef(key); keyRef.current = key
  const current = resource.key === key ? resource : { key, loading: !!activityId, error: '' }

  const read = useCallback(async (cursor?: string, previous?: DayActivityDetailPage) => {
    if (!activityId || !snapshotId || !reader || controllerRef.current) return
    const controller = new AbortController(); controllerRef.current = controller
    setResource({ key, ...(previous ? { value: previous } : {}), loading: true, error: '' })
    try {
      const page = await reader.loadDetail(query, activityId, { signal: controller.signal, snapshotId, ...(cursor ? { cursor } : {}) })
      if (controller.signal.aborted || keyRef.current !== key) return
      if (dayActivityQueryKey(page.query) !== scope || page.activityId !== activityId || page.snapshotId !== snapshotId
        || page.items.some(item => !item.id.trim() || !Number.isFinite(item.occurredAtMillis))
        || page.hasMore && (!page.nextCursor?.trim() || page.nextCursor === cursor || seen.current.has(page.nextCursor))) {
        throw new Error('活动详情已变化，请刷新后重试')
      }
      if (cursor) seen.current.add(cursor)
      const items = page.access === 'restricted' ? [] : [...new Map([...(previous?.items ?? []), ...page.items].map(item => [item.id, item])).values()]
        .sort((a, b) => a.occurredAtMillis - b.occurredAtMillis || a.id.localeCompare(b.id))
      setResource({ key, value: { ...page, items }, loading: false, error: '' })
    } catch (error) {
      if (!controller.signal.aborted && keyRef.current === key) setResource({ key, loading: false, error: message(error) })
    } finally { if (controllerRef.current === controller) controllerRef.current = undefined }
  }, [activityId, snapshotId, reader, key, scope, query])

  useEffect(() => {
    controllerRef.current?.abort(); controllerRef.current = undefined; seen.current.clear()
    setResource({ key, loading: !!activityId, error: '' }); void read()
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
