import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ArkmeSearchRecordItem } from '../types.js'
import { locationSources, worldLocationViewport, type LocationMarker, type LocationMarkers, type LocationQuery, type LocationRecords, type LocationSource, type LocationViewport } from '../location-search.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeLocationSearchMap } from './ArkmeLocationSearchMap.js'
import { tr, arkmeIntlLocale } from './locale.js'
import { arkmeTheme } from './arkme-theme.js'
import css from './location-quick-view.css?inline'

const labels: Record<LocationSource, string> = { quick_note: '快记的位置', my_sent: '我发送的位置', received_private: '发给我的位置', received_group: '群聊中的位置' }
const emptyRecords: LocationRecords = { items: [], hasMore: false, nextOffset: 0, truncated: false }
// Only navigation preferences survive closing search; no location records are persisted.
let lastView: { account: string; viewport: LocationViewport; sources: LocationSource[] } | undefined
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

export function ArkmeLocationQuickView({ onOpenRecord }: { onOpenRecord(item: ArkmeSearchRecordItem): void }) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const account = `${auth.auth?.environment ?? ''}:${auth.auth?.userId ?? ''}`
  return <LocationView key={account} account={account} browserAk={auth.config?.baiduMapBrowserAk ?? ''} onOpenRecord={onOpenRecord} />
}

function LocationView({ account, browserAk, onOpenRecord }: { account: string; browserAk: string; onOpenRecord(item: ArkmeSearchRecordItem): void }) {
  const saved = useRef(lastView?.account === account ? lastView : undefined)
  const [viewport, setViewport] = useState(saved.current?.viewport ?? worldLocationViewport)
  const [initialViewport, setInitialViewport] = useState(saved.current?.viewport ?? worldLocationViewport)
  const [sources, setSources] = useState<LocationSource[]>(saved.current?.sources ?? [...locationSources])
  const [snapshot, setSnapshot] = useState<{ query: LocationViewport; data: LocationMarkers }>()
  const [selected, setSelected] = useState<{ marker: LocationMarker; query: LocationViewport }>()
  const [mapLoading, setMapLoading] = useState(true), [mapError, setMapError] = useState(''), [revision, setRevision] = useState(0)
  const [records, setRecords] = useState(emptyRecords), [recordLoading, setRecordLoading] = useState(true), [recordError, setRecordError] = useState('')
  const recordRequest = useRef<AbortController>(), recordPage = useRef(emptyRecords)
  const viewportKey = JSON.stringify(viewport)
  const selectedKey = selected ? JSON.stringify([selected.marker.key, selected.query]) : ''
  useEffect(() => { lastView = { account, viewport, sources } }, [account, viewport, sources])
  useEffect(() => {
    const controller = new AbortController()
    setMapLoading(true); setMapError('')
    void callArkme<LocationMarkers>('search.locations', { mode: 'viewport', ...viewport }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setSnapshot({ query: viewport, data }) })
      .catch(reason => { if (!controller.signal.aborted) setMapError(message(reason)) })
      .finally(() => { if (!controller.signal.aborted) setMapLoading(false) })
    return () => controller.abort()
  }, [viewportKey, revision])
  const loadRecords = useCallback(async (append: boolean) => {
    recordRequest.current?.abort()
    const controller = new AbortController(); recordRequest.current = controller
    setRecordLoading(true); setRecordError('')
    if (!append) { recordPage.current = emptyRecords; setRecords(emptyRecords) }
    const query: LocationQuery = selected
      ? { mode: 'cluster', ...selected.query, clusterKeys: [selected.marker.key], offset: append ? recordPage.current.nextOffset : 0 }
      : { mode: 'list', ...(append && recordPage.current.nextCursor ? { cursor: recordPage.current.nextCursor } : {}) }
    try {
      const result = await callArkme<LocationRecords>('search.locations', { ...query }, controller.signal)
      if (controller.signal.aborted) return
      const items = append ? [...new Map([...recordPage.current.items,...result.items].map(item=>[item.key,item])).values()] : result.items
      recordPage.current = { ...result, items }; setRecords(recordPage.current)
    } catch (reason) { if (!controller.signal.aborted) setRecordError(message(reason)) }
    finally { if (!controller.signal.aborted) setRecordLoading(false) }
  }, [selectedKey])
  useEffect(() => { void loadRecords(false); return () => recordRequest.current?.abort() }, [loadRecords])
  useEffect(() => {
    // Global clustering can be empty even when regional clusters exist. Start
    // from the latest readable location without requesting device geolocation.
    if (viewport.bounds.swLon !== -180 || viewport.bounds.neLon !== 180 || !snapshot || snapshot.data.markers.length || !records.items.length) return
    const point = records.items[0]!
    const latitude = Math.max(-84.9, Math.min(84.9, point.latitude))
    const local = { bounds: { swLat: latitude - .1, neLat: latitude + .1,
      swLon: Math.max(-180, point.longitude - .1), neLon: Math.min(180, point.longitude + .1) }, zoom: 12 }
    setInitialViewport(local); setViewport(local)
  }, [viewport, snapshot, records])
  const markers = useMemo(() => (snapshot?.data.markers ?? []).filter(marker => sources.includes(marker.source)), [snapshot, sources])
  const displayed = useMemo(() => records.items.filter(item => sources.includes(selected?.marker.source ?? item.source)), [records, sources, selected])
  const changeViewport = useCallback((query: LocationViewport) => setViewport(previous => JSON.stringify(previous) === JSON.stringify(query) ? previous : query), [])
  return <section className="arkme-location-view" aria-label={tr('位置快速查找')} style={{ color: arkmeTheme.text, background: arkmeTheme.base }}>
    <style>{css}</style>
    <div className="arkme-location-filters" aria-label={tr('位置来源')}>
      {locationSources.map(source => <button key={source} type="button" data-arkme-feedback="neutral" aria-pressed={sources.includes(source)} onClick={() => {
        setSources(current => current.includes(source) ? current.filter(s=>s!==source) : [...current,source])
        if (selected?.marker.source === source && sources.includes(source)) setSelected(undefined)
      }}><span className="arkme-location-dot" data-source={source} />{tr(labels[source])}</button>)}
    </div>
    <div className="arkme-location-layout">
      <div className="arkme-location-stage">
        <ArkmeLocationSearchMap browserAk={browserAk} markers={markers} initialViewport={initialViewport}
          {...(selected ? { selectedKey: selected.marker.key } : {})} onViewport={changeViewport}
          onSelect={marker => { if (snapshot) setSelected({ marker, query: snapshot.query }) }} />
        <div className="arkme-location-summary" role="status">{mapLoading ? tr('正在读取位置…') : mapError ? <>{mapError} <button type="button" onClick={() => setRevision(n=>n+1)}>{tr('重试')}</button></>
          : sources.length === 0 ? tr('请选择位置来源') : markers.length === 0 ? tr('此范围暂无位置记录')
            : <>{tr('当前范围 {count} 个位置点', { count: String(markers.length) })}{snapshot?.data.truncated && ` · ${tr('请放大地图查看更多')}`}</>}</div>
      </div>
      <aside className="arkme-location-records" aria-label={tr('位置相关记录')}>
        <header><strong>{selected ? selected.marker.label || tr('该地点的记录') : tr('最近的位置记录')}</strong>
          {selected && <button type="button" onClick={() => setSelected(undefined)}>{tr('返回全部')}</button>}
          {!selected && <small>{tr('点击地图上的位置，查看相关记录')}</small>}</header>
        <div className="arkme-location-record-list">
          {displayed.map(item => <button className="arkme-location-record" key={item.key} type="button" onClick={() => onOpenRecord(item.record)}>
            <strong>{item.label}</strong>{item.address && item.address !== item.label && <small>{item.address}</small>}
            <p>{item.record.title || item.record.snippet || item.record.textContent || tr('位置记录')}</p>
            <small>{item.record.sourceTitle ? `${item.record.sourceTitle} · ` : ''}{item.record.sendAtMillis > 0 ? new Intl.DateTimeFormat(arkmeIntlLocale(), {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(item.record.sendAtMillis) : ''}</small>
          </button>)}
          {recordLoading && <p className="arkme-location-message" role="status">{tr('正在加载位置记录…')}</p>}
          {recordError && <p className="arkme-location-message" role="alert">{recordError} <button type="button" onClick={() => { void loadRecords(records.items.length > 0) }}>{tr('重试')}</button></p>}
          {!recordLoading && !recordError && displayed.length === 0 && <p className="arkme-location-message">{tr(sources.length === 0 ? '请选择位置来源' : '暂无匹配的位置记录')}</p>}
          {!recordLoading && !recordError && records.hasMore && <button className="arkme-location-more" type="button" onClick={() => { void loadRecords(true) }}>{tr('加载更多')}</button>}
          {records.truncated && <p className="arkme-location-message">{tr('结果较多，请放大地图缩小范围')}</p>}
        </div>
      </aside>
    </div>
  </section>
}
