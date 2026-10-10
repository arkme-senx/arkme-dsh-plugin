import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeRecordLocationObservation } from '../types.js'
import type { DayActivityQuery } from './calendar-activity-model.js'
import { readDayLocations, type DayLocationPoint, type DayLocationsSnapshot } from './day-location-reader.js'
import { fitDayLocations, groupDayLocationPoints, mapPosition, nearestWorldX } from './day-location-map.js'
import { tr, arkmeIntlLocale, useArkmeLocale } from './locale.js'
import { arkmeTheme } from './arkme-theme.js'
import css from './day-location-map.css?inline'

const emptySnapshot: DayLocationsSnapshot = { points: [], scanned: 0, failed: 0, complete: false }

export function DayLocationMapCanvas({ points, selectedId, onSelect }: {
  points: DayLocationPoint[]; selectedId?: string; onSelect(id: string): void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 600, height: 430 })
  const [camera, setCamera] = useState<{ x: number; y: number; zoom: number }>()
  const [tileErrors, setTileErrors] = useState(false)
  const [tileRevision, setTileRevision] = useState(0)
  const dragging = useRef<{ id: number; x: number; y: number; centerX: number; centerY: number }>()
  const fitted = useMemo(() => fitDayLocations(points, size.width, size.height), [points, size])
  const view = camera ?? fitted, scale = 256 * 2 ** view.zoom
  const left = view.x * scale - size.width / 2, top = view.y * scale - size.height / 2
  const groups = useMemo(() => groupDayLocationPoints(points), [points])
  useEffect(() => {
    if (!root.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!selectedId) return
    const point = points.find(point => point.id === selectedId)
    if (point) setCamera(current => ({ ...mapPosition(point.location.latitude, point.location.longitude), zoom: Math.max(14, current?.zoom ?? 14) }))
    // A new scan streams point arrays; preserve the user's viewport while it does so.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])
  const tiles: Array<{ x: number; y: number }> = []
  if (points.length) for (let x = Math.floor(left / 256); x <= Math.floor((left + size.width) / 256); x++) {
    for (let y = Math.max(0, Math.floor(top / 256)); y <= Math.min(2 ** view.zoom - 1, Math.floor((top + size.height) / 256)); y++) tiles.push({ x, y })
  }
  const zoom = (delta: number) => { setCamera({ ...view, zoom: Math.max(2, Math.min(19, view.zoom + delta)) }) }
  return <div ref={root} className="arkme-day-map-canvas" role="region" aria-label={tr('当天位置地图')} tabIndex={0}
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1) }
      if (event.key === '-') { event.preventDefault(); zoom(-1) }
      const step = 100 / scale
      const direction = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, number[]>)[event.key]
      if (direction) { event.preventDefault(); setCamera({ ...view, x: view.x + direction[0]!, y: Math.max(0, Math.min(1, view.y + direction[1]!)) }) }
    }} onPointerDown={event => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button,a')) return
      dragging.current = { id: event.pointerId, x: event.clientX, y: event.clientY, centerX: view.x, centerY: view.y }
      event.currentTarget.setPointerCapture(event.pointerId)
    }} onPointerMove={event => {
      const drag = dragging.current
      if (!drag || drag.id !== event.pointerId) return
      setCamera({ ...view, x: drag.centerX - (event.clientX - drag.x) / scale, y: Math.max(0, Math.min(1, drag.centerY - (event.clientY - drag.y) / scale)) })
    }} onPointerUp={() => { dragging.current = undefined }} onPointerCancel={() => { dragging.current = undefined }}>
    {tiles.map(tile => <img key={`${view.zoom}:${tile.x}:${tile.y}:${tileRevision}`} draggable={false} alt="" referrerPolicy="strict-origin-when-cross-origin"
      src={`https://tile.openstreetmap.org/${view.zoom}/${((tile.x % 2 ** view.zoom) + 2 ** view.zoom) % 2 ** view.zoom}/${tile.y}.png`}
      onError={() => setTileErrors(true)} style={{ left: tile.x * 256 - left, top: tile.y * 256 - top }} />)}
    {groups.map((group, index) => {
      const point = group[0]!, position = mapPosition(point.location.latitude, point.location.longitude)
      return <button type="button" key={point.id} className="arkme-day-map-pin" aria-pressed={group.some(p => p.id === selectedId)}
        aria-label={tr('位置 {number}：{label}，{count} 条记录', { number: String(index + 1), label: point.location.label || tr('地址暂不可用'), count: String(group.length) })}
        style={{ left: nearestWorldX(position.x, view.x) * scale - left, top: position.y * scale - top }} onClick={() => onSelect(point.id)}>
        {index + 1}{group.length > 1 && <sup>{group.length}</sup>}
      </button>
    })}
    <div className="arkme-day-map-controls">
      <button type="button" aria-label={tr('放大地图')} disabled={view.zoom >= 19} onClick={() => zoom(1)}>＋</button>
      <button type="button" aria-label={tr('缩小地图')} disabled={view.zoom <= 2} onClick={() => zoom(-1)}>−</button>
      <button type="button" onClick={() => setCamera(undefined)}>{tr('显示全部')}</button>
    </div>
    {tileErrors && <div className="arkme-day-map-tile-error" role="status">{tr('地图底图加载失败，位置列表仍可查看')}
      <button type="button" onClick={() => { setTileErrors(false); setTileRevision(value => value + 1) }}>{tr('重试')}</button></div>}
    <a className="arkme-day-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
  </div>
}

export function ArkmeDayLocationMap({ query, initialLocation, onClose }: {
  query: DayActivityQuery; initialLocation?: ArkmeRecordLocationObservation; onClose(): void
}) {
  useArkmeLocale()
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
        <DayLocationMapCanvas points={data.points} {...(selectedId ? { selectedId } : {})} onSelect={select} />
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
