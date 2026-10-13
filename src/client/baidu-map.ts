/** The small JSAPI 4.0 surface used by the daily-location map. */
export interface BaiduPoint { lng: number; lat: number }
export interface BaiduMap {
  centerAndZoom(point: BaiduPoint, zoom: number): void
  setViewport(points: BaiduPoint[], options: { margins: number[]; enableAnimation: boolean }): void
  pointToPixel(point: BaiduPoint): { x: number; y: number }
  getBounds(): { getSouthWest(): BaiduPoint; getNorthEast(): BaiduPoint }
  getZoom(): number
  setZoom(zoom: number): void
  panBy(x: number, y: number): void
  enableScrollWheelZoom(): void
  checkResize(): void
  addEventListener(event: string, callback: () => void): void
  removeEventListener(event: string, callback: () => void): void
  destroy(): void
}
export interface BaiduMaps {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => BaiduMap
  Point: new (longitude: number, latitude: number) => BaiduPoint
  Convertor: new () => {
    translate(points: BaiduPoint[], from: number, to: number, callback: (result: { status: number; points?: BaiduPoint[] }) => void): void
  }
}

type BaiduWindow = Window & { BMap?: BaiduMaps; [key: `arkmeBaiduReady${number}`]: (() => void) | undefined }
let attempt = 0
let loading: { key: string; promise: Promise<BaiduMaps> } | undefined

/** Load once per page, only when a map is opened. Browser AKs must allow this origin. */
export function loadBaiduMaps(key: string): Promise<BaiduMaps> {
  if (!key.trim()) return Promise.reject(new Error('百度地图尚未配置，位置列表仍可查看'))
  if (loading) return loading.key === key ? loading.promise : Promise.reject(new Error('地图配置已更新，请刷新页面'))
  const callback = `arkmeBaiduReady${++attempt}` as const
  const scope = window as unknown as BaiduWindow
  const script = document.createElement('script')
  const promise = new Promise<BaiduMaps>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      script.onerror = null
      // Keep a harmless callback for a late response after timeout.
      scope[callback] = () => { delete scope[callback] }
      if (error) { script.remove(); reject(error) }
      else { delete scope[callback]; resolve(scope.BMap!) }
    }
    const timer = setTimeout(() => finish(new Error('百度地图加载失败，位置列表仍可查看')), 20_000)
    scope[callback] = () => finish(scope.BMap?.Map && scope.BMap?.Convertor ? undefined : new Error('百度地图加载失败，位置列表仍可查看'))
    script.onerror = () => finish(new Error('百度地图加载失败，位置列表仍可查看'))
    script.async = true
    script.referrerPolicy = 'strict-origin-when-cross-origin'
    script.src = `https://api.map.baidu.com/api?${new URLSearchParams({ v: '4.0', ak: key.trim(), callback })}`
    document.head.appendChild(script)
  })
  loading = { key, promise }
  void promise.catch(() => { if (loading?.promise === promise) loading = undefined })
  return promise
}

/** Record/device observations are WGS84, matching the mobile location contract.
 * Use Baidu's converter, in batches of at most ten; never plot unconverted GPS points.
 * The caller owns the cache so closing a day/account discards location data.
 */
export async function convertBaiduPoints(sdk: BaiduMaps, points: readonly BaiduPoint[], cache: Map<string, BaiduPoint>, signal: AbortSignal): Promise<BaiduPoint[]> {
  const key = (point: BaiduPoint) => `${point.lng},${point.lat}`
  const pending = [...new Map(points.filter(point => !cache.has(key(point))).map(point => [key(point), point])).values()]
  for (let offset = 0; offset < pending.length; offset += 10) {
    signal.throwIfAborted()
    const batch = pending.slice(offset, offset + 10)
    const converted = await new Promise<BaiduPoint[]>((resolve, reject) => {
      let settled = false
      const finish = (value?: BaiduPoint[], error?: unknown) => {
        if (settled) return
        settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort)
        if (error) reject(error); else resolve(value!)
      }
      const abort = () => finish(undefined, signal.reason)
      const timer = setTimeout(() => finish(undefined, new Error('地图坐标转换失败，请重试')), 15_000)
      signal.addEventListener('abort', abort, { once: true })
      try {
        new sdk.Convertor().translate(batch.map(point => new sdk.Point(point.lng, point.lat)), 1, 5, result => {
          if (result.status !== 0 || result.points?.length !== batch.length || result.points.some(point => !Number.isFinite(point.lat) || !Number.isFinite(point.lng))) {
            finish(undefined, new Error('地图坐标转换失败，请重试'))
          } else finish(result.points)
        })
      } catch { finish(undefined, new Error('地图坐标转换失败，请重试')) }
    })
    signal.throwIfAborted()
    batch.forEach((point, index) => cache.set(key(point), converted[index]!))
  }
  signal.throwIfAborted()
  return points.map(point => cache.get(key(point))!)
}
