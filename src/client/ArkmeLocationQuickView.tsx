import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ArkmeSearchRecordItem } from '../types.js'
import { locationSources, worldLocationViewport, type LocationMarkers, type LocationQuery, type LocationRecords, type LocationSource, type LocationViewport } from '../location-search.js'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeLocationDateFilter } from './ArkmeLocationDateFilter.js'
import { ArkmeLocationMapFrame } from './ArkmeLocationMapFrame.js'
import { ArkmeDayLocationView } from './ArkmeDayLocationView.js'
import type { LocationDateFilter } from './day-location-cache.js'
import { locationSearchCache as cache, startLocationSearchCache, type LocationSelection } from './location-search-cache.js'
import { tr, arkmeIntlLocale } from './locale.js'
import css from './location-quick-view.css?inline'

const emptyRecords: LocationRecords = { items: [], hasMore: false, nextOffset: 0, truncated: false }
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

export function ArkmeLocationQuickView({ onOpenRecord, initialDate, initialLocation }: { onOpenRecord(item: ArkmeSearchRecordItem): void; initialDate?: LocationDateFilter; initialLocation?: { latitude: number; longitude: number } }) {
  const browser = useRef<HTMLDivElement>(null), focusDate = useRef(false)
  const [date, setDate] = useState(initialDate?.bucketDate ?? '')
  const timezone = initialDate?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const lastDate = useRef(initialDate?.bucketDate ?? '')
  const changeDate = (value: string) => { focusDate.current = true; if (value) lastDate.current = value; setDate(value) }
  useLayoutEffect(() => {
    if (focusDate.current) { focusDate.current = false; browser.current?.querySelector<HTMLButtonElement>('.arkme-location-date-control>button')?.focus() }
  }, [date])
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  useState(startLocationSearchCache)
  const hardRevision = useSyncExternalStore(cache.subscribe, cache.getHardRevision, cache.getHardRevision)
  if (!auth.auth || !['authenticated', 'binding-required'].includes(auth.auth.status)) return null
  const account = `${auth.auth.environment}:${auth.auth.userId}`
  const toolbar = <ArkmeLocationDateFilter date={date} lastDate={lastDate.current} onChange={changeDate}/>
  return <div ref={browser} className="arkme-location-browser">
    <style>{css}</style>
    {date ? <ArkmeDayLocationView key={`${account}:${hardRevision}:${date}:${timezone}`} account={account} browserAk={auth.config?.baiduMapBrowserAk ?? ''}
      date={{ bucketDate: date, timezone }} toolbar={toolbar} onOpenRecord={onOpenRecord} {...(initialLocation && date === initialDate?.bucketDate ? { initialLocation } : {})} />
      : <LocationView key={`${account}:${hardRevision}`} account={account} browserAk={auth.config?.baiduMapBrowserAk ?? ''} toolbar={toolbar} onOpenRecord={onOpenRecord} />}
  </div>
}

function LocationView({ account, browserAk, toolbar, onOpenRecord }: { account: string; browserAk: string; toolbar: ReactNode; onOpenRecord(item: ArkmeSearchRecordItem): void }) {
  const saved = useRef(cache.getNavigation(account))
  const [viewport, setViewport] = useState(saved.current?.viewport ?? worldLocationViewport)
  const [initialViewport, setInitialViewport] = useState(viewport)
  const [sources, setSources] = useState<LocationSource[]>(saved.current?.sources ?? [...locationSources])
  const [snapshot, setSnapshot] = useState(() => {
    const data = cache.peek<LocationMarkers>(account, { mode: 'viewport', ...viewport })
    return data ? { query: viewport, data } : undefined
  })
  const [selected, setSelected] = useState<LocationSelection | undefined>(saved.current?.selected)
  const [mapLoading, setMapLoading] = useState(!snapshot), [mapError, setMapError] = useState(''), [retry, setRetry] = useState(0)
  const revision = useSyncExternalStore(cache.subscribe, cache.getRevision, cache.getRevision)
  const [page, setPage] = useState(saved.current?.page)
  const [recordLoading, setRecordLoading] = useState(false), [recordError, setRecordError] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const scrollTop = useRef(saved.current?.scrollTop ?? 0)
  const request = useRef(0), recordPage = useRef(page)
  const viewportKey = JSON.stringify(viewport)
  const selectedKey = selected ? JSON.stringify([selected.marker.key, selected.query]) : ''
  const records = page?.key === selectedKey ? page.data : emptyRecords
  const save = () => cache.saveNavigation(account, { viewport, sources, selected, scrollTop: scrollTop.current, page })
  useEffect(save, [account, viewport, sources, selected, page])
  useEffect(() => {
    let active = true
    const query: LocationQuery = { mode: 'viewport', ...viewport }
    const cached = cache.peek<LocationMarkers>(account, query)
    if (cached) setSnapshot({ query: viewport, data: cached })
    setMapLoading(true); setMapError('')
    void cache.load<LocationMarkers>(account, query, retry > 0).then(async data => {
      if (!active) return
      setSnapshot({ query: viewport, data })
      // An empty global projection needs only one readable anchor, not a whole page of details.
      if (viewport.bounds.swLon === -180 && viewport.bounds.neLon === 180 && !data.markers.length) {
        const anchor = await cache.load<LocationRecords>(account, { mode: 'list', limit: 1 })
        if (!active || !anchor.items.length) return
        const point = anchor.items[0]!, latitude = Math.max(-84.9, Math.min(84.9, point.latitude))
        const local = { bounds: { swLat: latitude - .1, neLat: latitude + .1,
          swLon: Math.max(-180, point.longitude - .1), neLon: Math.min(180, point.longitude + .1) }, zoom: 12 }
        setInitialViewport(local); setViewport(local)
      }
    }).catch(reason => { if (active) setMapError(message(reason)) }).finally(() => { if (active) setMapLoading(false) })
    return () => { active = false }
  }, [account, viewportKey, revision, retry])
  const loadRecords = useCallback(async (append: boolean, force = false) => {
    if (!selected) return
    const sequence = ++request.current
    const previous = recordPage.current?.key === selectedKey ? recordPage.current.data : emptyRecords
    // The sheet initially shows only a few cards; avoid hydrating twenty bodies before the first one appears.
    const query: LocationQuery = { mode: 'cluster', ...selected.query, clusterKeys: [selected.marker.key], offset: append ? previous.nextOffset : 0, limit: append ? 20 : 6 }
    const cached = cache.peek<LocationRecords>(account, query)
    if (!append && cached && previous.items.length === 0) {
      recordPage.current = { key: selectedKey, data: cached }; setPage(recordPage.current)
    }
    setRecordLoading(true); setRecordError('')
    try {
      const result = await cache.load<LocationRecords>(account, query, force)
      if (request.current !== sequence) return
      const data = !append && result === cached && previous.items.length > result.items.length ? previous : {
        ...result, items: append ? [...new Map([...previous.items, ...result.items].map(item => [item.key, item])).values()] : result.items,
      }
      recordPage.current = { key: selectedKey, data }; setPage(recordPage.current)
    } catch (reason) { if (request.current === sequence) setRecordError(message(reason)) }
    finally { if (request.current === sequence) setRecordLoading(false) }
  }, [account, selectedKey])
  useEffect(() => { void loadRecords(false); return () => { request.current++ } }, [loadRecords, revision])
  useLayoutEffect(() => { if (list.current) list.current.scrollTop = scrollTop.current }, [selectedKey])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') setRetry(value => value + 1) }
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
  }, [])
  const markers = useMemo(() => (snapshot?.data.markers ?? []).filter(marker => sources.includes(marker.source)), [snapshot, sources])
  const displayed = useMemo(() => records.items.filter(item => sources.includes(selected?.marker.source ?? item.source)), [records, sources, selected])
  const changeViewport = useCallback((query: LocationViewport) => setViewport(previous => JSON.stringify(previous) === JSON.stringify(query) ? previous : query), [])
  const closeRecords = () => { setSelected(undefined); scrollTop.current = 0 }
  return <ArkmeLocationMapFrame toolbar={toolbar} account={account} browserAk={browserAk} markers={markers} initialViewport={initialViewport}
    sources={sources} onSourcesChange={next => { setSources(next); if (selected && !next.includes(selected.marker.source)) closeRecords() }}
    {...(selected ? { selectedKey: selected.marker.key, recordTitle: selected.marker.label, recordCount: selected.marker.count } : {})}
    onViewport={changeViewport} onSelect={marker => { if (snapshot) { scrollTop.current = 0; setSelected({ marker, query: snapshot.query }) } }} onCloseRecords={closeRecords}
    summary={<>{mapError ? <>{mapError} <button type="button" onClick={() => setRetry(n => n + 1)}>{tr('重试')}</button></>
        : !snapshot && mapLoading ? tr('正在读取位置…') : sources.length === 0 ? tr('请选择位置来源') : markers.length === 0 ? tr('此范围暂无位置记录')
          : <>{tr('当前范围 {count} 个位置点', { count: String(markers.length) })}{snapshot?.data.truncated && ` · ${tr('请放大地图查看更多')}`}</>}</>}>
        <div className="arkme-location-record-list" ref={list} onScroll={event => { scrollTop.current = event.currentTarget.scrollTop; save() }}>
          {displayed.map(item => <button className="arkme-location-record" key={item.key} type="button" onClick={() => onOpenRecord(item.record)}>
            <strong>{item.label}</strong>{item.address && item.address !== item.label && <small>{item.address}</small>}
            <p>{item.record.title || item.record.snippet || item.record.textContent || tr('位置记录')}</p>
            <small>{item.record.sourceTitle ? `${item.record.sourceTitle} · ` : ''}{item.record.sendAtMillis > 0 ? new Intl.DateTimeFormat(arkmeIntlLocale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(item.record.sendAtMillis) : ''}</small>
          </button>)}
          {recordLoading && !displayed.length && <p className="arkme-location-message" role="status">{tr('正在加载位置记录…')}</p>}
          {recordError && <p className="arkme-location-message" role="alert">{recordError} <button type="button" onClick={() => { void loadRecords(records.items.length > 0 && records.hasMore, true) }}>{tr('重试')}</button></p>}
          {!recordLoading && !recordError && !displayed.length && <p className="arkme-location-message">{tr('暂无匹配的位置记录')}</p>}
          {!recordError && records.hasMore && <button className="arkme-location-more" type="button" disabled={recordLoading} onClick={() => { void loadRecords(true) }}>{tr(recordLoading ? '加载中…' : '加载更多')}</button>}
          {records.truncated && <p className="arkme-location-message">{tr('结果较多，请放大地图缩小范围')}</p>}
        </div>
  </ArkmeLocationMapFrame>
}
