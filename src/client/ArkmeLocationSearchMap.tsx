import { useEffect, useRef, useState } from 'react'
import type { LocationMarker, LocationViewport } from '../location-search.js'
import { loadBaiduMaps, convertBaiduPoints, type BaiduMaps, type BaiduMap, type BaiduPoint } from './baidu-map.js'
import { locationQueryBounds } from './location-map-coordinates.js'
import { tr } from './locale.js'

export function ArkmeLocationSearchMap({ browserAk, markers, initialViewport, selectedKey, onViewport, onSelect }: {
  browserAk: string; markers: LocationMarker[]; initialViewport: LocationViewport; selectedKey?: string
  onViewport(viewport: LocationViewport): void; onSelect(marker: LocationMarker): void
}) {
  const canvas = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onViewport, onSelect }); callbacks.current = { onViewport, onSelect }
  const initial = useRef(initialViewport)
  initial.current = initialViewport
  const initialKey = JSON.stringify(initialViewport)
  const [runtime, setRuntime] = useState<{ sdk: BaiduMaps; map: BaiduMap }>()
  const [points, setPoints] = useState<Map<string, BaiduPoint>>(new Map())
  const cache = useRef(new Map<string, BaiduPoint>())
  const interacted = useRef(false), fitted = useRef(false)
  const [error, setError] = useState(''), [ready, setReady] = useState(false), [revision, setRevision] = useState(0)
  const [, redraw] = useState(0)
  useEffect(() => {
    let disposed = false, map: BaiduMap | undefined, resize: ResizeObserver | undefined
    let timer: ReturnType<typeof setTimeout> | undefined, viewportTimer: ReturnType<typeof setTimeout> | undefined, frame = 0
    setRuntime(undefined); setPoints(new Map()); setError(''); setReady(false)
    fitted.current = initialViewport.bounds.swLon !== -180 || initialViewport.bounds.neLon !== 180
    const update = () => { if (!disposed && !frame) frame = requestAnimationFrame(() => { frame = 0; if (!disposed) redraw(n => n + 1) }) }
    const viewport = () => {
      update(); clearTimeout(viewportTimer)
      viewportTimer = setTimeout(() => {
        if (disposed || !map || (!interacted.current && !fitted.current)) return
        const bounds = map.getBounds()
        callbacks.current.onViewport({ bounds: locationQueryBounds(bounds.getSouthWest(), bounds.getNorthEast()), zoom: map.getZoom() })
      }, 300)
    }
    const loaded = () => { if (!disposed) { clearTimeout(timer); setReady(true); setError(''); update() } }
    const failed = () => { if (!disposed) setError('百度地图加载失败，位置记录仍可查看') }
    const controller = new AbortController()
    void loadBaiduMaps(browserAk).then(async sdk => {
      if (disposed || !canvas.current) return
      map = new sdk.Map(canvas.current, { minZoom: 3, maxZoom: 19, enableMapClick: false, enableRotate: false, enableTilt: false })
      map.enableScrollWheelZoom()
      const bounds = initial.current.bounds
      const isWorld = bounds.swLon === -180 && bounds.neLon === 180
      const position = isWorld ? { lng: 105, lat: 35 } : { lng: (bounds.swLon+bounds.neLon)/2, lat: (bounds.swLat+bounds.neLat)/2 }
      const [center] = await convertBaiduPoints(sdk, [position], cache.current, controller.signal)
      if (disposed) return
      map.addEventListener('tilesloaded', loaded)
      map.addEventListener('style_loaded_error', failed); map.addEventListener('style_loaded_timeout', failed)
      map.centerAndZoom(center!, initial.current.zoom)
      map.addEventListener('moving', update); map.addEventListener('zooming', update)
      map.addEventListener('moveend', viewport); map.addEventListener('zoomend', viewport)
      timer = setTimeout(failed, 20_000)
      resize = new ResizeObserver(() => { map?.checkResize(); update() }); resize.observe(canvas.current)
      setRuntime({ sdk, map })
    }).catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : '百度地图加载失败') })
    return () => {
      disposed = true; controller.abort(); clearTimeout(timer); clearTimeout(viewportTimer); cancelAnimationFrame(frame); resize?.disconnect()
      if (map) {
        map.removeEventListener('tilesloaded', loaded); map.removeEventListener('style_loaded_error', failed); map.removeEventListener('style_loaded_timeout', failed)
        map.removeEventListener('moving', update); map.removeEventListener('zooming', update); map.removeEventListener('moveend', viewport); map.removeEventListener('zoomend', viewport)
        map.destroy()
      }
    }
  }, [browserAk, revision, initialKey])
  useEffect(() => {
    if (!runtime) return
    const controller = new AbortController()
    void convertBaiduPoints(runtime.sdk, markers.map(marker => ({ lng: marker.longitude, lat: marker.latitude })), cache.current, controller.signal)
      .then(converted => {
        if (controller.signal.aborted) return
        setPoints(new Map(markers.map((marker, i) => [marker.key, converted[i]!])) )
        if (!fitted.current && !interacted.current && converted.length) {
          fitted.current = true
          if (initial.current.bounds.swLon === -180 && initial.current.bounds.neLon === 180) {
            if (converted.length === 1) runtime.map.centerAndZoom(converted[0]!, 14)
            else runtime.map.setViewport(converted, { margins: [60,50,65,50], enableAnimation: false })
          }
        }
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '位置坐标转换失败') })
    return () => controller.abort()
  }, [runtime, markers])
  return <div className="arkme-location-map" role="region" aria-label={tr('历史位置地图')}
    onPointerDown={() => { interacted.current = true }} onWheel={() => { interacted.current = true }}>
    <div className="arkme-location-canvas" ref={canvas} />
    {runtime && markers.map(marker => {
      const point = points.get(marker.key)
      if (!point) return null
      const pixel = runtime.map.pointToPixel(point)
      if (!Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) return null
      return <button key={marker.key} type="button" className="arkme-location-pin" data-source={marker.source} aria-pressed={selectedKey === marker.key}
        style={{ left: pixel.x, top: pixel.y }} aria-label={tr('{label}，{count} 条位置记录', { label: marker.label || tr('地点'), count: String(marker.count) })}
        onClick={() => callbacks.current.onSelect(marker)}><span>{marker.count > 1 ? marker.count : '●'}</span>{marker.count === 1 && <small>{marker.label || marker.preview || tr('位置')}</small>}</button>
    })}
    <div className="arkme-location-controls">
      <button type="button" aria-label={tr('放大地图')} disabled={!runtime} onClick={() => { interacted.current = true; runtime?.map.setZoom(Math.min(19,runtime.map.getZoom()+1)) }}>＋</button>
      <button type="button" aria-label={tr('缩小地图')} disabled={!runtime} onClick={() => { interacted.current = true; runtime?.map.setZoom(Math.max(3,runtime.map.getZoom()-1)) }}>−</button>
    </div>
    {(error || !ready) && <div className="arkme-location-map-status" role="status">{tr(error || '正在加载百度地图…')}{error && <button type="button" onClick={() => setRevision(n => n+1)}>{tr('重试')}</button>}</div>}
  </div>
}
