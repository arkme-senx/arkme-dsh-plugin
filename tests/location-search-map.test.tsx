// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBaiduMapMock } from './fixtures/baidu-map-mock.js'
import { ArkmeLocationSearchMap } from '../src/client/ArkmeLocationSearchMap.js'
import { resetLocationMapSessions } from '../src/client/location-map-session.js'
import { ArkmeLocationCaptureError } from '../src/client/record-capture-location.js'
const mocks = vi.hoisted(() => ({ load: vi.fn(), locate: vi.fn() }))
vi.mock('../src/client/baidu-map.js', async original => ({ ...await original<object>(), loadBaiduMaps: mocks.load }))
vi.mock('../src/client/record-capture-location.js', async original => ({ ...await original<object>(), requestArkmeRecordLocation: mocks.locate }))
beforeEach(() => {
  mocks.locate.mockReset()
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

const locationProps = { account: 'test:location', browserAk: 'test', initialViewport: { bounds: { swLat: 38, swLon: 115, neLat: 40, neLon: 117 }, zoom: 12 },
  markers: [{ key: 'history', source: 'quick_note' as const, latitude: 39, longitude: 116, count: 1, label: '示例', preview: '' }], onViewport: vi.fn(), onSelect: vi.fn() }
async function mountLocationMap() {
  const mock = createBaiduMapMock(); mocks.load.mockResolvedValue(mock.sdk)
  const element = document.createElement('div'); document.body.append(element)
  const root = createRoot(element)
  await act(async () => root.render(<ArkmeLocationSearchMap {...locationProps} />))
  return { ...mock, element, root,
    button: () => element.querySelector<HTMLButtonElement>('.arkme-location-locate')!,
    close: async () => { await act(async () => root.unmount()); element.remove() },
  }
}
it('locates only on click, converts GPS coordinates, displays a distinct marker and can recenter again', async () => {
  const view = await mountLocationMap()
  try {
    expect(mocks.locate).not.toHaveBeenCalled()
    expect(view.element.querySelector('.arkme-location-current-position')).toBeNull()
    expect(view.button().previousElementSibling?.getAttribute('aria-label')).toBe('缩小地图')
    mocks.locate.mockResolvedValue({ latitude: 30, longitude: 120, capturedAtMillis: 1 })
    await act(async () => view.button().click())
    expect(view.map.centerAndZoom).toHaveBeenLastCalledWith({ lat: 30.01, lng: 120.01 }, 16)
    expect(view.element.querySelector('.arkme-location-current-position')?.getAttribute('aria-label')).toBe('当前位置')
    expect(view.element.querySelectorAll('.arkme-location-pin')).toHaveLength(1)
    mocks.locate.mockResolvedValue({ latitude: 31, longitude: 121, capturedAtMillis: 2 })
    await act(async () => view.button().click())
    expect(view.map.centerAndZoom).toHaveBeenLastCalledWith({ lat: 31.01, lng: 121.01 }, 16)
    expect(view.element.querySelectorAll('.arkme-location-current-position')).toHaveLength(1)
    expect(locationProps.onSelect).not.toHaveBeenCalled()
  } finally { await view.close() }
})
it('keeps the viewport on permission denial and allows a successful retry', async () => {
  const view = await mountLocationMap()
  try {
    const initialCalls = view.map.centerAndZoom.mock.calls.length
    mocks.locate.mockRejectedValue(new ArkmeLocationCaptureError('denied', 'denied'))
    await act(async () => view.button().click())
    expect(view.map.centerAndZoom).toHaveBeenCalledTimes(initialCalls)
    expect(view.element.querySelector('[role="alert"]')?.textContent).toContain('请在系统或浏览器设置中允许位置访问后重试')
    expect(view.element.querySelector('.arkme-location-current-position')).toBeNull()
    expect(view.button().disabled).toBe(false)
    mocks.locate.mockResolvedValue({ latitude: 30, longitude: 120 })
    await act(async () => view.element.querySelector<HTMLButtonElement>('[role="alert"] button')!.click())
    expect(view.element.querySelector('[role="alert"]')).toBeNull()
    expect(view.element.querySelector('.arkme-location-current-position')).not.toBeNull()
  } finally { await view.close() }
})
it('coalesces rapid clicks and ignores pending geolocation after switching accounts', async () => {
  const view = await mountLocationMap()
  let resolve!: (value: unknown) => void
  mocks.locate.mockReturnValue(new Promise(done => { resolve = done }))
  try {
    await act(async () => { view.button().click(); view.button().click() })
    expect(mocks.locate).toHaveBeenCalledTimes(1)
    expect(view.button().disabled).toBe(true)
    expect(view.button().getAttribute('aria-busy')).toBe('true')
    await act(async () => view.root.render(<ArkmeLocationSearchMap {...locationProps} account="test:other" />))
    const calls = view.map.centerAndZoom.mock.calls.length
    await act(async () => resolve({ latitude: 30, longitude: 120 }))
    expect(view.map.centerAndZoom).toHaveBeenCalledTimes(calls)
    expect(view.element.querySelector('.arkme-location-current-position')).toBeNull()
    expect(view.button().disabled).toBe(false)
  } finally { await view.close() }
})
it('ignores a late result after closing and does not retain the current position on reopening', async () => {
  const view = await mountLocationMap()
  let resolve!: (value: unknown) => void
  mocks.locate.mockReturnValue(new Promise(done => { resolve = done }))
  await act(async () => view.button().click())
  await view.close()
  const calls = view.map.centerAndZoom.mock.calls.length
  await act(async () => resolve({ latitude: 30, longitude: 120 }))
  expect(view.map.centerAndZoom).toHaveBeenCalledTimes(calls)
  const next = await mountLocationMap()
  try {
    expect(next.element.querySelector('.arkme-location-current-position')).toBeNull()
    expect(next.button().disabled).toBe(false)
  } finally { await next.close() }
})
it('does not pan to raw GPS coordinates if Baidu conversion fails', async () => {
  const view = await mountLocationMap()
  try {
    const calls = view.map.centerAndZoom.mock.calls.length
    vi.spyOn(view.sdk.Convertor.prototype, 'translate').mockImplementation((_points, _from, _to, callback) => callback({ status: 1 }))
    mocks.locate.mockResolvedValue({ latitude: 30, longitude: 120 })
    await act(async () => view.button().click())
    expect(view.map.centerAndZoom).toHaveBeenCalledTimes(calls)
    expect(view.element.querySelector('.arkme-location-current-position')).toBeNull()
    expect(view.element.querySelector('[role="alert"]')?.textContent).toContain('暂时无法定位到当前位置')
  } finally { await view.close() }
})
afterEach(() => { resetLocationMapSessions(); vi.unstubAllGlobals() })
it.each(['wheel','pointerdown'])('never auto-fits a late batch after %s, even when the map SDK stops bubbling',async eventType=>{
  const mock=createBaiduMapMock();mocks.load.mockResolvedValue(mock.sdk)
  const element=document.createElement('div');document.body.append(element)
  const root=createRoot(element)
  const props={...locationProps,initialViewport:{bounds:{swLat:-85,swLon:-180,neLat:85,neLon:180},zoom:3},fitWhileLoading:true}
  try {
    await act(async()=>root.render(<ArkmeLocationSearchMap {...props} markers={[]} />))
    const centers=mock.map.centerAndZoom.mock.calls.length
    const sdkCanvas=element.querySelector('.arkme-location-canvas')!.firstElementChild!
    sdkCanvas.addEventListener(eventType,event=>event.stopPropagation())
    await act(async()=>sdkCanvas.dispatchEvent(new Event(eventType,{bubbles:true})))
    await act(async()=>root.render(<ArkmeLocationSearchMap {...props} />))
    expect(element.querySelectorAll('.arkme-location-pin')).toHaveLength(1)
    expect(mock.map.centerAndZoom).toHaveBeenCalledTimes(centers)
    expect(mock.map.setViewport).not.toHaveBeenCalled()
    expect(mock.sdk.Map).toHaveBeenCalledTimes(1)
  } finally {await act(async()=>root.unmount());element.remove()}
})
it('clears the initial theme timeout when map tiles finish loading asynchronously',async()=>{
  vi.useFakeTimers()
  const mock=createBaiduMapMock();mocks.load.mockResolvedValue(mock.sdk)
  mock.map.centerAndZoom.mockImplementation(()=>{})
  const element=document.createElement('div');document.body.append(element)
  const root=createRoot(element)
  try {
    await act(async()=>root.render(<ArkmeLocationSearchMap {...locationProps} />))
    expect(element.textContent).toContain('正在加载百度地图…')
    await act(async()=>mock.events.get('tilesloaded')?.())
    await act(async()=>vi.advanceTimersByTime(20_001))
    expect(element.textContent).not.toContain('百度地图加载失败')
    expect(element.querySelector('.arkme-location-canvas')?.getAttribute('data-map-ready')).toBe('true')
  } finally {await act(async()=>root.unmount());element.remove();resetLocationMapSessions();vi.useRealTimers()}
})
it('reuses the Baidu map and converted points on reopening, and destroys them on account switch', async () => {
  const mock = createBaiduMapMock(); mocks.load.mockResolvedValue(mock.sdk)
  const convert = vi.spyOn(mock.sdk.Convertor.prototype, 'translate')
  const props = { account: 'test:one', browserAk: 'test', initialViewport: { bounds: { swLat: 38, swLon: 115, neLat: 40, neLon: 117 }, zoom: 12 },
    markers: [{ key: 'one', source: 'quick_note' as const, latitude: 39, longitude: 116, count: 1, label: '示例', preview: '' }], onViewport: vi.fn(), onSelect: vi.fn() }
  const mount = document.createElement('div'); document.body.append(mount)
  let root = createRoot(mount)
  try {
    await act(async () => root.render(<ArkmeLocationSearchMap {...props} />))
    const canvas = mount.querySelector('.arkme-location-canvas')!.firstElementChild
    const calls = convert.mock.calls.length
    const themeCalls = mock.map.setMapStyle.mock.calls.length
    expect(mount.querySelectorAll('.arkme-location-pin')).toHaveLength(1)
    await act(async () => root.unmount())
    expect(mock.map.destroy).not.toHaveBeenCalled()
    root = createRoot(mount)
    await act(async () => root.render(<ArkmeLocationSearchMap {...props} />))
    expect(mount.querySelector('.arkme-location-canvas')!.firstElementChild).toBe(canvas)
    expect(mock.sdk.Map).toHaveBeenCalledTimes(1)
    expect(convert).toHaveBeenCalledTimes(calls)
    expect(mock.map.setMapStyle).toHaveBeenCalledTimes(themeCalls)
    expect(mock.map.centerAndZoom).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
    resetLocationMapSessions('test:two')
    expect(mock.map.destroy).toHaveBeenCalledTimes(1)
  } finally { mount.remove() }
})
it('updates the live map theme in place, stops observing when closed and refreshes a retained canvas on reopen', async () => {
  document.body.setAttribute('data-ds-dark-theme', '')
  const view = await mountLocationMap()
  let closed = false
  try {
    expect(view.map.setMapStyle.mock.calls[0]?.[0].styleJson.length).toBeGreaterThan(0)
    expect(view.map.setMapStyle.mock.invocationCallOrder[0]).toBeLessThan(view.map.centerAndZoom.mock.invocationCallOrder[0]!)
    const centered = view.map.centerAndZoom.mock.calls.length
    const fitted = view.map.setViewport.mock.calls.length
    await act(async () => { document.body.removeAttribute('data-ds-dark-theme') })
    expect(view.map.setMapStyle).toHaveBeenLastCalledWith({ styleJson: [] })
    expect(view.element.querySelector('.arkme-location-canvas')?.getAttribute('data-map-ready')).toBe('false')
    await act(async () => view.events.get('tilesloaded')?.())
    expect(view.element.querySelector('.arkme-location-canvas')?.getAttribute('data-map-ready')).toBe('true')
    expect(view.map.centerAndZoom).toHaveBeenCalledTimes(centered)
    expect(view.map.setViewport).toHaveBeenCalledTimes(fitted)
    expect(view.sdk.Map).toHaveBeenCalledTimes(1)
    await view.close(); closed = true
    const themed = view.map.setMapStyle.mock.calls.length
    await act(async () => { document.body.setAttribute('data-ds-dark-theme', '') })
    expect(view.map.setMapStyle).toHaveBeenCalledTimes(themed)
    mocks.load.mockResolvedValue(view.sdk)
    const mount = document.createElement('div'); document.body.append(mount)
    const root = createRoot(mount)
    try {
      await act(async () => root.render(<ArkmeLocationSearchMap {...locationProps} />))
      expect(view.map.setMapStyle.mock.calls.at(-1)?.[0].styleJson.length).toBeGreaterThan(0)
      expect(view.sdk.Map).toHaveBeenCalledTimes(1)
      expect(view.map.centerAndZoom).toHaveBeenCalledTimes(centered)
    } finally { await act(async () => root.unmount()); mount.remove() }
  } finally {
    if (!closed) await view.close()
    document.body.removeAttribute('data-ds-dark-theme')
  }
})
