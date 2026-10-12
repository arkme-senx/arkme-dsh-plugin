import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeRecordLocationObservation } from '../types.js'
import type { DayActivityQuery } from './calendar-activity-model.js'
import { readDayLocations, type DayLocationPoint, type DayLocationsSnapshot } from './day-location-reader.js'
import { groupDayLocationPoints } from './day-location-map.js'
import { loadBaiduMaps, convertBaiduPoints, type BaiduMap, type BaiduMaps, type BaiduPoint } from './baidu-map.js'
import { arkmeAuthStore } from './auth-store.js'
import { tr, arkmeIntlLocale, useArkmeLocale } from './locale.js'
import { arkmeTheme } from './arkme-theme.js'
import css from './day-location-map.css?inline'

const emptySnapshot: DayLocationsSnapshot = { points: [], scanned: 0, failed: 0, complete: false }

export function DayLocationMapCanvas({ points, selectedId, onSelect, browserAk = '' }: {
  points: DayLocationPoint[]; selectedId?: string; onSelect(id: string): void; browserAk?: string
}) {
  const canvas = useRef<HTMLDivElement>(null)
  const [runtime, setRuntime] = useState<{ sdk: BaiduMaps; map: BaiduMap }>()
  const [positions, setPositions] = useState<Map<string, BaiduPoint>>(new Map())
  const [error, setError] = useState('')
  const [tilesReady, setTilesReady] = useState(false)
  const [revision, setRevision] = useState(0)
  const [, redraw] = useState(0)
  const cache = useRef(new Map<string, BaiduPoint>())
  const manualView = useRef(false)
  const lastSelection = useRef<string>()
  const groups = useMemo(() => groupDayLocationPoints(points), [points])
  useEffect(() => {
    let disposed = false, map: BaiduMap | undefined, observer: ResizeObserver | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let frame = 0
    setRuntime(undefined); setPositions(new Map()); setError(''); setTilesReady(false)
    manualView.current = false; lastSelection.current = undefined
    const update = () => {
      if (disposed || frame) return
      frame = requestAnimationFrame(() => { frame = 0; if (!disposed) redraw(value => value + 1) })
    }
    const loaded = () => { if (!disposed) { clearTimeout(timer); setTilesReady(true); setError(current => current === '百度地图加载失败，位置列表仍可查看' ? '' : current); update() } }
    const failed = () => { if (!disposed) setError('百度地图加载失败，位置列表仍可查看') }
    const events = ['moving', 'moveend', 'zooming', 'zoomend', 'resize']
    void loadBaiduMaps(browserAk).then(sdk => {
      if (disposed || !canvas.current) return
      map = new sdk.Map(canvas.current, { minZoom: 3, maxZoom: 19, enableMapClick: false, enableRotate: false, enableTilt: false })
      map.enableScrollWheelZoom()
      for (const event of events) map.addEventListener(event, update)
      map.addEventListener('tilesloaded', loaded)
      map.addEventListener('style_loaded_error', failed)
      map.addEventListener('style_loaded_timeout', failed)
      timer = setTimeout(failed, 20_000)
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => { map?.checkResize(); update() })
        observer.observe(canvas.current)
      }
      setRuntime({ sdk, map })
    }).catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : '百度地图加载失败，位置列表仍可查看') })
    return () => {
      disposed = true; clearTimeout(timer); cancelAnimationFrame(frame); observer?.disconnect()
      if (map) {
        for (const event of events) map.removeEventListener(event, update)
        map.removeEventListener('tilesloaded', loaded)
        map.removeEventListener('style_loaded_error', failed)
        map.removeEventListener('style_loaded_timeout', failed)
        map.destroy()
      }
    }
  }, [browserAk, revision])
  useEffect(() => {
    if (!runtime) return
    const controller = new AbortController()
    void convertBaiduPoints(runtime.sdk, groups.map(group => ({ lng: group[0]!.location.longitude, lat: group[0]!.location.latitude })), cache.current, controller.signal)
      .then(converted => {
        if (controller.signal.aborted) return
        setPositions(new Map(groups.flatMap((group, index) => group.map(point => [point.id, converted[index]!] as const))))
        if (!manualView.current && converted.length) {
          runtime.map.centerAndZoom(converted[0]!, 16)
          if (converted.length > 1) runtime.map.setViewport(converted, { margins: [65, 45, 45, 45], enableAnimation: false })
        }
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '地图坐标转换失败，请重试') })
    return () => controller.abort()
  }, [runtime, groups])
  useEffect(() => {
    if (!runtime || !selectedId || lastSelection.current === selectedId) return
    const point = positions.get(selectedId)
    if (!point) return
    lastSelection.current = selectedId; manualView.current = true
    runtime.map.centerAndZoom(point, Math.max(14, runtime.map.getZoom() || 14))
    redraw(value => value + 1)
  }, [runtime, positions, selectedId])
  const ready = Boolean(runtime && positions.size)
  const zoom = (delta: number) => {
    if (!runtime || !ready) return
    manualView.current = true
    runtime.map.setZoom(Math.max(3, Math.min(19, runtime.map.getZoom() + delta)))
  }
  const fit = () => {
    if (!runtime || !positions.size) return
    manualView.current = false
    const all = groups.map(group => positions.get(group[0]!.id)).filter((point): point is BaiduPoint => Boolean(point))
    if (all.length === 1) runtime.map.centerAndZoom(all[0]!, 16)
    else runtime.map.setViewport(all, { margins: [65, 45, 45, 45], enableAnimation: false })
  }
  return <div className="arkme-day-map-canvas" role="region" aria-label={tr('当天位置地图')} tabIndex={0}
    onPointerDown={() => { manualView.current = true }} onWheel={() => { manualView.current = true }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget || !ready) return
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1) }
      if (event.key === '-') { event.preventDefault(); zoom(-1) }
      const direction = ({ ArrowLeft: [100, 0], ArrowRight: [-100, 0], ArrowUp: [0, 100], ArrowDown: [0, -100] } as Record<string, number[]>)[event.key]
      if (direction) { event.preventDefault(); manualView.current = true; runtime?.map.panBy(direction[0]!, direction[1]!) }
    }}>
    <div ref={canvas} className="arkme-day-map-baidu" />
    {runtime && groups.map((group, index) => {
      const point = group[0]!, coordinate = positions.get(point.id)
      if (!coordinate) return null
      const pixel = runtime.map.pointToPixel(coordinate)
      return <button type="button" key={point.id} className="arkme-day-map-pin" aria-pressed={group.some(p => p.id === selectedId)}
        aria-label={tr('位置 {number}：{label}，{count} 条记录', { number: String(index + 1), label: point.location.label || tr('地址暂不可用'), count: String(group.length) })}
        style={{ left: pixel.x, top: pixel.y }} onClick={() => onSelect(point.id)}>
        {index + 1}{group.length > 1 && <sup>{group.length}</sup>}
      </button>
    })}
    <div className="arkme-day-map-controls">
      <button type="button" aria-label={tr('放大地图')} disabled={!ready || runtime!.map.getZoom() >= 19} onClick={() => zoom(1)}>＋</button>
      <button type="button" aria-label={tr('缩小地图')} disabled={!ready || runtime!.map.getZoom() <= 3} onClick={() => zoom(-1)}>−</button>
      <button type="button" disabled={!ready} onClick={fit}>{tr('显示全部')}</button>
    </div>
    {(error || !tilesReady) && <div className="arkme-day-map-status" role="status">{tr(error || '正在加载百度地图…')}
      {error && <button type="button" onClick={() => setRevision(value => value + 1)}>{tr('重试')}</button>}</div>}
  </div>
}

export function ArkmeDayLocationMap({ query, initialLocation, onClose }: {
  query: DayActivityQuery; initialLocation?: ArkmeRecordLocationObservation; onClose(): void
}) {
  useArkmeLocale()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const root = useRef<HTMLElement>(null)
  const [data, setData] = useState(emptySnapshot)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [selectedId, setSelectedId] = useState<string>()
  const controllerRef = useRef<AbortController>()
  const initialApplied = useRef(false)
  useEffect(() => {
    const previous = document.activeElement
    root.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    const controller = new AbortController(); controllerRef.current = controller
    setLoading(true); setError(''); setData(emptySnapshot)
    void readDayLocations(query, controller.signal, value => { if (!controller.signal.aborted) setData(value) })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : tr('当天位置加载失败')) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [query.accountScope, query.bucketDate, query.timezone, revision])
  useEffect(() => {
    if (initialApplied.current || !initialLocation) return
    const point = data.points.find(point => point.location.latitude === initialLocation.latitude && point.location.longitude === initialLocation.longitude)
    if (point) { initialApplied.current = true; setSelectedId(point.id) }
  }, [data.points, initialLocation])
  const selected = data.points.find(point => point.id === selectedId)
  const time = (point: DayLocationPoint) => new Intl.DateTimeFormat(arkmeIntlLocale(), { timeZone: query.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(point.location.capturedAtMillis ?? point.recordedAtMillis)
  const select = (id: string) => {
    setSelectedId(id)
    const element = [...(root.current?.querySelectorAll<HTMLElement>('[data-location-record]') ?? [])].find(node => node.dataset.locationRecord === id)
    element?.scrollIntoView?.({ block: 'nearest' })
  }
  const body = <div className="arkme-day-map-backdrop" data-arkme-notification-blocking-overlay="true" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <style>{css}</style>
    <section ref={root} className="arkme-day-map-dialog" style={{ background: arkmeTheme.base, color: arkmeTheme.text }} role="dialog" aria-modal="true" aria-label={tr('当天位置')} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
        if (event.key === 'Tab') {
          const nodes = [...(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]') ?? [])]
          const first = nodes[0], last = nodes.at(-1)
          if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <header><div><h2>{query.bucketDate} · {tr('当天位置')}</h2><p>{query.timezone}</p></div>
        <button type="button" aria-label={tr('关闭当天位置')} onClick={onClose}>×</button></header>
      {data.points.length > 0 ? <div className="arkme-day-map-layout">
        <DayLocationMapCanvas key={`${query.accountScope}:${query.bucketDate}:${query.timezone}`} browserAk={auth.config?.baiduMapBrowserAk ?? ''} points={data.points} {...(selectedId ? { selectedId } : {})} onSelect={select} />
        <div className="arkme-day-map-list" aria-label={tr('当天位置记录')}>
          {data.points.map(point => <button type="button" key={point.id} data-location-record={point.id} aria-pressed={point.id === selectedId} onClick={() => select(point.id)}>
            <time>{time(point)}</time><strong>{point.location.label || tr('地址暂不可用')}</strong>
            <small>{point.location.deviceLabel || tr('设备定位')}{point.location.capturedAtMillis === undefined ? ` · ${tr('记录时间')}` : ''}</small>
          </button>)}
        </div>
      </div> : <div className="arkme-day-map-empty" role="status">{loading ? tr('正在读取当天位置…') : error || data.failed ? tr('当天位置尚未读取完整，请重试') : tr('当天暂无位置记录')}</div>}
      {selected && <div className="arkme-day-map-selected"><strong>{time(selected)} · {selected.location.label || tr('地址暂不可用')}</strong>
        <span>{selected.location.latitude.toFixed(5)}, {selected.location.longitude.toFixed(5)}{selected.location.accuracyMeters !== undefined ? ` · ${tr('定位精度约 {meters} 米', { meters: String(Math.round(selected.location.accuracyMeters)) })}` : ''}</span></div>}
      <footer aria-live="polite"><div>{tr('已加载 {count} 条位置记录', { count: String(data.points.length) })}
        {loading ? ` · ${tr('正在读取当天位置…')}` : !data.complete ? ` · ${tr('尚未加载完整')}` : ''}
        <small>{tr('位置来自当天记录的设备定位点')}</small>
        {(error || data.failed > 0) && <p role="status">{error || tr('{count} 条记录的位置读取失败', { count: String(data.failed) })}</p>}</div>
        {loading ? <button type="button" onClick={() => { controllerRef.current?.abort(); setLoading(false) }}>{tr('停止加载')}</button>
          : <button type="button" onClick={() => { setSelectedId(undefined); setRevision(value => value + 1) }}>{error || data.failed ? tr('重试') : tr('刷新')}</button>}
      </footer>
    </section>
  </div>
  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}
