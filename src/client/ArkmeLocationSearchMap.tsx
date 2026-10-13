import { useEffect, useRef, useState } from 'react'
import { Crosshair } from '@phosphor-icons/react/dist/icons/Crosshair'
import { SpinnerGap } from '@phosphor-icons/react/dist/icons/SpinnerGap'
import type { LocationMarker, LocationViewport } from '../location-search.js'
import { loadBaiduMaps, convertBaiduPoints, type BaiduMaps, type BaiduMap, type BaiduPoint } from './baidu-map.js'
import { locationQueryBounds } from './location-map-coordinates.js'
import { tr } from './locale.js'
import { acquireLocationMapSession, discardLocationMapSession, releaseLocationMapSession, type LocationMapSession } from './location-map-session.js'
import { ArkmeLocationCaptureError, requestArkmeRecordLocation } from './record-capture-location.js'

function currentLocationError(reason: unknown): string {
  if (reason instanceof ArkmeLocationCaptureError) {
    if (reason.failure === 'denied' || reason.failure === 'restricted') return '请在系统或浏览器设置中允许位置访问后重试'
    if (reason.failure === 'services-disabled') return '请开启系统定位服务后重试'
    if (reason.failure === 'prompt') return '请完成位置授权后重试'
    if (reason.failure === 'unavailable') return '当前环境不支持定位，请在支持定位的客户端或浏览器中打开'
    if (reason.failure === 'timeout') return '获取当前位置超时，请重试'
  }
  return '暂时无法定位到当前位置，请重试'
}

export function ArkmeLocationSearchMap({ account, browserAk, markers, initialViewport, selectedKey, onViewport, onSelect, scope = 'all', fitWhileLoading = false }: {
  account: string; browserAk: string; markers: LocationMarker[]; initialViewport: LocationViewport; selectedKey?: string
  scope?: string; fitWhileLoading?: boolean
  onViewport(viewport: LocationViewport): void; onSelect(marker: LocationMarker): void
}) {
  const canvas = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onViewport, onSelect }); callbacks.current = { onViewport, onSelect }
  const initial = useRef(initialViewport)
  initial.current = initialViewport
  const initialKey = JSON.stringify(initialViewport)
  const [runtime, setRuntime] = useState<{ sdk: BaiduMaps; map: BaiduMap }>()
  const [points, setPoints] = useState<Map<string, BaiduPoint>>(new Map())
  const session = useRef<LocationMapSession>()
  const locationRequest = useRef<AbortController>()
  const [currentLocation, setCurrentLocation] = useState<{ map: BaiduMap; point: BaiduPoint }>()
  const [locating, setLocating] = useState(false), [locationError, setLocationError] = useState('')
  const previousInitial = useRef(initialKey), previousRevision = useRef(0)
  const [error, setError] = useState(''), [ready, setReady] = useState(false), [revision, setRevision] = useState(0)
  const [, redraw] = useState(0)
  useEffect(() => {
    let disposed = false, map: BaiduMap | undefined, resize: ResizeObserver | undefined
    let timer: ReturnType<typeof setTimeout> | undefined, viewportTimer: ReturnType<typeof setTimeout> | undefined, frame = 0
    if (previousRevision.current !== revision && session.current) discardLocationMapSession(session.current)
    previousRevision.current = revision
    const retained = acquireLocationMapSession(account, browserAk)
    session.current = retained
    const scopeChanged = retained.scope !== scope
    const recenter = previousInitial.current !== initialKey || scopeChanged
    if (scopeChanged) { retained.interacted = false; retained.scope = scope }
    previousInitial.current = initialKey
    setRuntime(undefined); setPoints(new Map()); setError(''); setReady(false)
    setCurrentLocation(undefined); setLocating(false); setLocationError('')
    if (!retained.initialized || recenter) retained.fitted = initialViewport.bounds.swLon !== -180 || initialViewport.bounds.neLon !== 180
    const update = () => { if (!disposed && !frame) frame = requestAnimationFrame(() => { frame = 0; if (!disposed) redraw(n => n + 1) }) }
    const viewport = () => {
      update(); clearTimeout(viewportTimer)
      viewportTimer = setTimeout(() => {
        if (disposed || !map || (!retained.interacted && !retained.fitted)) return
        const bounds = map.getBounds()
        callbacks.current.onViewport({ bounds: locationQueryBounds(bounds.getSouthWest(), bounds.getNorthEast()), zoom: map.getZoom() })
      }, 300)
    }
    const loaded = () => { if (!disposed) { clearTimeout(timer); retained.ready = true; setReady(true); setError(''); update() } }
    const failed = () => { if (!disposed) setError('百度地图加载失败，可选择下方地点查看记录') }
    const controller = new AbortController()
    void loadBaiduMaps(browserAk).then(async sdk => {
      if (disposed || retained.disposed || !canvas.current) return
      canvas.current.appendChild(retained.element)
      map = retained.map ?? new sdk.Map(retained.element, { minZoom: 3, maxZoom: 19, enableMapClick: false, enableRotate: false, enableTilt: false })
      retained.map = map; retained.sdk = sdk
      map.enableScrollWheelZoom()
      const bounds = initial.current.bounds
      const isWorld = bounds.swLon === -180 && bounds.neLon === 180
      const position = isWorld ? { lng: 105, lat: 35 } : { lng: (bounds.swLon+bounds.neLon)/2, lat: (bounds.swLat+bounds.neLat)/2 }
      map.addEventListener('tilesloaded', loaded)
      map.addEventListener('style_loaded_error', failed); map.addEventListener('style_loaded_timeout', failed)
      if (!retained.initialized || recenter) {
        const [center] = await convertBaiduPoints(sdk, [position], retained.points, controller.signal)
        if (disposed || retained.disposed) return
        map.centerAndZoom(center!, initial.current.zoom)
        retained.initialized = true
      }
      map.addEventListener('moving', update); map.addEventListener('zooming', update)
      map.addEventListener('moveend', viewport); map.addEventListener('zoomend', viewport)
      if (retained.ready) loaded(); else timer = setTimeout(failed, 20_000)
      resize = new ResizeObserver(() => { map?.checkResize(); update() }); resize.observe(canvas.current)
      map.checkResize()
      setRuntime({ sdk, map })
    }).catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : '百度地图加载失败') })
    return () => {
      locationRequest.current?.abort(); locationRequest.current = undefined
      disposed = true; controller.abort(); clearTimeout(timer); clearTimeout(viewportTimer); cancelAnimationFrame(frame); resize?.disconnect()
      if (map && !retained.disposed) {
        map.removeEventListener('tilesloaded', loaded); map.removeEventListener('style_loaded_error', failed); map.removeEventListener('style_loaded_timeout', failed)
        map.removeEventListener('moving', update); map.removeEventListener('zooming', update); map.removeEventListener('moveend', viewport); map.removeEventListener('zoomend', viewport)
      }
      if (retained.ready) releaseLocationMapSession(retained); else discardLocationMapSession(retained)
    }
  }, [account, browserAk, revision, initialKey, scope])
  useEffect(() => {
    if (!runtime || !session.current) return
    const retained = session.current
    const controller = new AbortController()
    // Display already converted pins immediately, even while new ones are converting.
    setPoints(new Map(markers.flatMap(marker => {
      const point = retained.points.get(`${marker.longitude},${marker.latitude}`)
      return point ? [[marker.key, point] as const] : []
    })))
    void convertBaiduPoints(runtime.sdk, markers.map(marker => ({ lng: marker.longitude, lat: marker.latitude })), retained.points, controller.signal)
      .then(converted => {
        if (controller.signal.aborted) return
        setPoints(new Map(markers.map((marker, i) => [marker.key, converted[i]!])) )
        while (retained.points.size > 1000) retained.points.delete(retained.points.keys().next().value!)
        if ((!retained.fitted || fitWhileLoading) && !retained.interacted && converted.length) {
          retained.fitted = true
          if (initial.current.bounds.swLon === -180 && initial.current.bounds.neLon === 180) {
            if (converted.length === 1) runtime.map.centerAndZoom(converted[0]!, 14)
            else runtime.map.setViewport(converted, { margins: [60,50,65,50], enableAnimation: false })
          }
        }
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '位置坐标转换失败') })
    return () => controller.abort()
  }, [runtime, markers, fitWhileLoading])
  const locate = async () => {
    const retained = session.current
    if (!runtime || !retained || retained.disposed || retained.account !== account || locationRequest.current) return
    const controller = new AbortController()
    locationRequest.current = controller
    retained.interacted = true
    setLocating(true); setLocationError('')
    try {
      const location = await requestArkmeRecordLocation()
      controller.signal.throwIfAborted()
      if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)
        || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) throw new Error('Invalid location')
      // Current position is display-only: do not add it to historical records or their cache.
      const [point] = await convertBaiduPoints(runtime.sdk, [{ lng: location.longitude, lat: location.latitude }], new Map(), controller.signal)
      if (controller.signal.aborted || retained.disposed || session.current !== retained) return
      runtime.map.centerAndZoom(point!, Math.min(19, Math.max(16, runtime.map.getZoom())))
      setCurrentLocation({ map: runtime.map, point: point! })
    } catch (reason) {
      if (!controller.signal.aborted && !retained.disposed) setLocationError(currentLocationError(reason))
    } finally {
      if (locationRequest.current === controller) { locationRequest.current = undefined; setLocating(false) }
    }
  }
  const currentPixel = runtime && currentLocation?.map === runtime.map ? runtime.map.pointToPixel(currentLocation.point) : undefined
  return <div className="arkme-location-map" role="region" aria-label={tr('历史位置地图')}
    onPointerDown={() => { if (session.current) session.current.interacted = true }} onWheel={() => { if (session.current) session.current.interacted = true }}>
    <div className="arkme-location-canvas" ref={canvas} />
    {currentPixel && Number.isFinite(currentPixel.x) && Number.isFinite(currentPixel.y) && <div
      className="arkme-location-current-position" role="img" aria-label={tr('当前位置')}
      style={{ left: currentPixel.x, top: currentPixel.y }} />}
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
      <button type="button" aria-label={tr('放大地图')} disabled={!runtime} onClick={() => { if (session.current) session.current.interacted = true; runtime?.map.setZoom(Math.min(19,runtime.map.getZoom()+1)) }}>＋</button>
      <button type="button" aria-label={tr('缩小地图')} disabled={!runtime} onClick={() => { if (session.current) session.current.interacted = true; runtime?.map.setZoom(Math.max(3,runtime.map.getZoom()-1)) }}>−</button>
      <button type="button" className="arkme-location-locate" title={tr('定位到当前位置')}
        aria-label={tr(locating ? '正在获取当前位置…' : '定位到当前位置')} aria-busy={locating} disabled={!runtime || locating}
        onClick={() => { void locate() }}>{locating ? <SpinnerGap size={19} aria-hidden className="arkme-location-locate-spinner" /> : <Crosshair size={19} aria-hidden />}</button>
    </div>
    {locationError && <div className="arkme-location-locate-error" role="alert">{tr(locationError)}
      <button type="button" onClick={() => { void locate() }}>{tr('重试')}</button>
    </div>}
    {(error || !ready) && <div className="arkme-location-map-status" role="status">{tr(error || '正在加载百度地图…')}{error && <>
      <button type="button" onClick={() => setRevision(n => n+1)}>{tr('重试')}</button>
      <div className="arkme-location-fallback" aria-label={tr('可查看的地点')}>{markers.map(marker => <button type="button" key={marker.key}
        onClick={() => callbacks.current.onSelect(marker)}>{marker.label || marker.preview || tr('地点')} · {marker.count}</button>)}</div>
    </>}</div>}
  </div>
}
