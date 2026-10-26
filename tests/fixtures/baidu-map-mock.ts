import { vi } from 'vitest'
import type { BaiduMaps, BaiduPoint } from '../../src/client/baidu-map.js'
export function createBaiduMapMock() {
  const events = new Map<string, () => void>()
  const map = {
    setMapStyle: vi.fn(),
    centerAndZoom: vi.fn(() => { events.get('tilesloaded')?.() }),
    setViewport: vi.fn(), pointToPixel: vi.fn(() => ({ x: 150, y: 120 })),
    getZoom: vi.fn(() => 16), setZoom: vi.fn(), panBy: vi.fn(),
    enableScrollWheelZoom: vi.fn(), checkResize: vi.fn(), destroy: vi.fn(),
    addEventListener: vi.fn((name: string, callback: () => void) => { events.set(name, callback) }),
    removeEventListener: vi.fn((name: string) => { events.delete(name) }),
  }
  const sdk = {
    Map: vi.fn(function () { return map }),
    Point: class { constructor(public lng: number, public lat: number) {} },
    Convertor: class {
      translate(points: BaiduPoint[], _from: number, _to: number, callback: (value: unknown) => void) {
        callback({ status: 0, points: points.map(point => ({ lng: point.lng + .01, lat: point.lat + .01 })) })
      }
    },
  } as unknown as BaiduMaps
  return { sdk, map, events }
}
