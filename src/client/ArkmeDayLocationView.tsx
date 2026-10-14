import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ArkmeSearchRecordItem } from '../types.js'
import { worldLocationViewport, type LocationSource } from '../location-search.js'
import { ArkmeLocationMapFrame } from './ArkmeLocationMapFrame.js'
import { dayLocationCache, type LocationDateFilter } from './day-location-cache.js'
import { locationSearchCache } from './location-search-cache.js'
import { groupDayLocationPoints } from './day-location-map.js'
import { arkmeIntlLocale, tr } from './locale.js'
import type { DayLocationPoint } from './day-location-reader.js'

const daySources: readonly LocationSource[] = ['quick_note', 'my_sent']
function source(point: DayLocationPoint): LocationSource { return point.record?.sourceKind === 'chat' ? 'my_sent' : 'quick_note' }
function searchRecord(point: DayLocationPoint): ArkmeSearchRecordItem {
  const record = point.record
  return { recordUid: point.id, sourceKind: 1, routeTargetKind: 'record_detail', sendAtMillis: point.recordedAtMillis,
    title: record?.title ?? '', textContent: '', snippet: record?.preview ?? '',
    sourceTitle: record?.source?.displayName ?? record?.topicTitle ?? '', media: [], files: [] }
}
export function ArkmeDayLocationView({ account, browserAk, date, initialLocation, onOpenRecord }: {
  account: string; browserAk: string; date: LocationDateFilter; initialLocation?: { latitude: number; longitude: number }
  onOpenRecord(record: ArkmeSearchRecordItem): void
}) {
  const scope = `day:${date.bucketDate}:${date.timezone}`
  const saved = useRef(initialLocation ? undefined : locationSearchCache.getNavigation(account, scope))
  const [sources, setSources] = useState<LocationSource[]>(saved.current?.sources ?? [...daySources])
  const [selectedKey, setSelectedKey] = useState(saved.current?.selected?.marker.key)
  const [recordLimit, setRecordLimit] = useState(saved.current?.recordLimit ?? 6)
  const [initialViewport] = useState(saved.current?.viewport ?? (initialLocation ? { bounds: {
    swLat: Math.max(-85, initialLocation.latitude - .005), neLat: Math.min(85, initialLocation.latitude + .005),
    swLon: Math.max(-180, initialLocation.longitude - .005), neLon: Math.min(180, initialLocation.longitude + .005),
  }, zoom: 16 } : worldLocationViewport))
  const viewport = useRef(initialViewport), scroll = useRef(saved.current?.scrollTop ?? 0), list = useRef<HTMLDivElement>(null)
  const state = useSyncExternalStore(dayLocationCache.subscribe, () => dayLocationCache.get(account, date), () => dayLocationCache.get(account, date))
  const revision = useSyncExternalStore(locationSearchCache.subscribe, locationSearchCache.getRevision, locationSearchCache.getRevision)
  useEffect(() => { void dayLocationCache.load(account, date) }, [account, scope, revision])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') void dayLocationCache.load(account, date) }
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
  }, [account, scope])
  const groups = useMemo(() => groupDayLocationPoints(state.data.points.filter(point => sources.includes(source(point))))
    .map(points => ({ points, marker: { key: `day:${points[0]!.location.latitude.toFixed(5)},${points[0]!.location.longitude.toFixed(5)}`,
      latitude: points[0]!.location.latitude, longitude: points[0]!.location.longitude, source: source(points[0]!), count: points.length,
      label: points[0]!.location.label ?? '', preview: '' } })), [state.data.points, sources])
  const markers = useMemo(() => groups.map(group => group.marker), [groups])
  const selected = groups.find(group => group.marker.key === selectedKey)
  const initialApplied = useRef(!!saved.current?.selected)
  useEffect(() => {
    if (initialApplied.current || !initialLocation) return
    const group = groups.find(group => group.points.some(point => point.location.latitude === initialLocation.latitude && point.location.longitude === initialLocation.longitude))
    if (group) { initialApplied.current = true; setSelectedKey(group.marker.key) }
  }, [groups, initialLocation])
  const save = () => locationSearchCache.saveNavigation(account, { viewport: viewport.current, sources, scrollTop: scroll.current, recordLimit,
    ...(selected ? { selected: { marker: selected.marker, query: viewport.current } } : {}) }, scope)
  useEffect(save, [account, scope, selectedKey, sources, groups, recordLimit])
  useLayoutEffect(() => { if (list.current) list.current.scrollTop = scroll.current }, [selectedKey])
  const time = (point: DayLocationPoint) => new Intl.DateTimeFormat(arkmeIntlLocale(), { timeZone: date.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(point.location.capturedAtMillis ?? point.recordedAtMillis)
  const notice = <>{state.error ? <>{state.error} <button type="button" onClick={() => { void dayLocationCache.load(account, date, true) }}>{tr('重试')}</button></>
    : state.loading && !state.data.points.length ? tr('正在读取当天位置…') : !state.data.complete && !state.loading ? <>{tr('当天位置尚未读取完整，请重试')} <button type="button" onClick={() => { void dayLocationCache.load(account, date, true) }}>{tr('重试')}</button></>
      : sources.length === 0 ? tr('请选择位置来源') : !markers.length ? tr('当天暂无位置记录') : tr('已加载 {count} 条位置记录', { count: state.data.points.length })}
    {state.loading && state.data.points.length > 0 && ` · ${tr('正在更新…')}`}</>
  return <ArkmeLocationMapFrame account={account} browserAk={browserAk} scope={scope} markers={markers} initialViewport={initialViewport}
    fitWhileLoading sources={sources} availableSources={daySources} onSourcesChange={next => { setSources(next); setSelectedKey(undefined); scroll.current = 0 }}
    {...(selected ? { selectedKey: selected.marker.key, recordTitle: selected.marker.label, recordCount: selected.points.length } : {})}
    onViewport={value => { viewport.current = value; save() }} onSelect={marker => { scroll.current = 0; setRecordLimit(6); setSelectedKey(marker.key) }}
    onCloseRecords={() => { scroll.current = 0; setSelectedKey(undefined) }} summary={notice}>
    <div className="arkme-location-record-list" ref={list} onScroll={event => { scroll.current = event.currentTarget.scrollTop; save() }}>
      {selected?.points.slice(0, recordLimit).map(point => <button className="arkme-location-record" type="button" key={point.id} onClick={() => onOpenRecord(searchRecord(point))}>
        <strong>{time(point)} · {point.location.label || tr('地址暂不可用')}</strong>
        <p>{point.record?.title || point.record?.preview || tr('位置记录')}</p>
        <small>{point.location.deviceLabel || tr('设备定位')}</small>
      </button>)}
      {selected && selected.points.length > recordLimit && <button type="button" className="arkme-location-more" onClick={() => setRecordLimit(value => value + 20)}>{tr('加载更多')}</button>}
    </div>
  </ArkmeLocationMapFrame>
}
