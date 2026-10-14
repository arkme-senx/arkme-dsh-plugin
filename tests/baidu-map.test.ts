// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { convertBaiduPoints, type BaiduMaps, type BaiduPoint } from '../src/client/baidu-map.js'

const translate = vi.fn()
const sdk = {
  Point: class { constructor(public lng: number, public lat: number) {} },
  Convertor: class { translate = translate },
} as unknown as BaiduMaps

afterEach(() => { vi.useRealTimers(); vi.resetModules(); vi.clearAllMocks(); document.head.innerHTML = ''; delete (window as any).BMap })

it('loads only on demand, shares the SDK request, and requires an explicit browser key', async () => {
  const { loadBaiduMaps } = await import('../src/client/baidu-map.js')
  await expect(loadBaiduMaps('')).rejects.toThrow('尚未配置')
  expect(document.querySelector('script')).toBeNull()
  const first = loadBaiduMaps('browser-test-key'), second = loadBaiduMaps('browser-test-key')
  expect(first).toBe(second)
  const script = document.querySelector('script')!
  const url = new URL(script.src)
  expect(url.origin).toBe('https://api.map.baidu.com')
  expect(url.searchParams.get('v')).toBe('4.0')
  expect(script.referrerPolicy).toBe('strict-origin-when-cross-origin')
  ;(window as any).BMap = { ...sdk, Map: class {} }
  ;(window as any)[url.searchParams.get('callback')!]()
  await expect(first).resolves.toBe((window as any).BMap)
  await expect(loadBaiduMaps('changed-key')).rejects.toThrow('刷新页面')
})

it('allows retry after network failure or timeout and ignores a late failed-attempt callback', async () => {
  vi.useFakeTimers()
  const { loadBaiduMaps } = await import('../src/client/baidu-map.js')
  const failed = loadBaiduMaps('browser-test-key')
  const rejected = expect(failed).rejects.toThrow('加载失败')
  const callback = new URL(document.querySelector('script')!.src).searchParams.get('callback')!
  await vi.advanceTimersByTimeAsync(20_000); await rejected
  const retry = loadBaiduMaps('browser-test-key')
  const secondRejected = expect(retry).rejects.toThrow('加载失败')
  ;(window as any)[callback]()
  expect(document.querySelectorAll('script')).toHaveLength(1)
  document.querySelector('script')!.dispatchEvent(new Event('error'))
  await secondRejected
})

it('converts GPS to Baidu in bounded batches, deduplicates, and reuses only a caller-owned cache', async () => {
  translate.mockImplementation((points, from, to, callback) => {
    expect([from, to]).toEqual([1, 5])
    callback({ status: 0, points: points.map((point: BaiduPoint) => ({ lng: point.lng + .01, lat: point.lat + .01 })) })
  })
  const points = Array.from({ length: 23 }, (_, i) => ({ lng: 116 + i / 1000, lat: 39 }))
  const cache = new Map<string, BaiduPoint>()
  const result = await convertBaiduPoints(sdk, [...points, points[0]!], cache, new AbortController().signal)
  expect(translate.mock.calls.map(call => call[0].length)).toEqual([10, 10, 3])
  expect(result[0]).toEqual({ lng: 116.01, lat: 39.01 })
  expect(result.at(-1)).toBe(result[0])
  await convertBaiduPoints(sdk, points, cache, new AbortController().signal)
  expect(translate).toHaveBeenCalledTimes(3)
})

it('does not cache or display failed, malformed, or cancelled conversions', async () => {
  const cache = new Map<string, BaiduPoint>(), points = [{ lng: 116, lat: 39 }]
  for (const response of [{ status: 240 }, { status: 0, points: [] }, { status: 0, points: [{ lng: NaN, lat: 39 }] }]) {
    translate.mockImplementation((_points, _from, _to, callback) => callback(response))
    await expect(convertBaiduPoints(sdk, points, cache, new AbortController().signal)).rejects.toThrow('坐标转换失败')
  }
  let callback!: (value: unknown) => void
  translate.mockImplementation((_points, _from, _to, done) => { callback = done })
  const controller = new AbortController(), pending = convertBaiduPoints(sdk, points, cache, controller.signal)
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  callback({ status: 0, points })
  expect(cache.size).toBe(0)
})

it('runs at most two coordinate batches concurrently instead of serializing the whole map', async () => {
  const completions: (() => void)[] = []
  translate.mockImplementation((points, _from, _to, callback) => { completions.push(() => callback({ status: 0, points })) })
  const points = Array.from({ length: 30 }, (_, i) => ({ lng: 116 + i / 1000, lat: 39 }))
  const result = convertBaiduPoints(sdk, points, new Map(), new AbortController().signal)
  expect(translate).toHaveBeenCalledTimes(2)
  completions[0]!(); await Promise.resolve()
  expect(translate).toHaveBeenCalledTimes(3)
  completions[1]!(); completions[2]!()
  await expect(result).resolves.toHaveLength(30)
})
