// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBaiduMapMock } from './fixtures/baidu-map-mock.js'
const mocks = vi.hoisted(() => ({ read: vi.fn(), load: vi.fn() }))
vi.mock('../src/client/baidu-map.js', async importOriginal => ({ ...await importOriginal<object>(), loadBaiduMaps: mocks.load }))
vi.mock('../src/client/day-location-reader.js', () => ({ readDayLocations: mocks.read }))
import { ArkmeDayLocationMap, DayLocationMapCanvas } from '../src/client/ArkmeDayLocationMap.js'

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  mocks.load.mockResolvedValue(createBaiduMapMock().sdk)
})

afterEach(() => { vi.unstubAllGlobals() })

it('keeps partial locations visible, links selection, cancels on close, and restores focus', async () => {
  const trigger = document.createElement('button'), mount = document.createElement('div')
  document.body.append(trigger, mount); trigger.focus()
  const point = { id: 'point', recordedAtMillis: 1000, location: { source: 'device', latitude: 31.2, longitude: 121.4, label: '公共地点示例' } }
  let signal!: AbortSignal
  mocks.read.mockImplementation((_query, requestSignal, progress) => {
    signal = requestSignal
    progress({ points: [point], scanned: 1, failed: 0, complete: false })
    return new Promise(() => {})
  })
  const root = createRoot(mount), close = vi.fn()
  try {
    await act(async () => { root.render(<ArkmeDayLocationMap query={{ accountScope: 'test', bucketDate: '2026-10-08', timezone: 'Asia/Shanghai' }} onClose={close} />) })
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(document.activeElement).toBe(dialog)
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-location-record="point"]')!.click() })
    expect(document.querySelector('.arkme-day-map-pin')?.getAttribute('aria-pressed')).toBe('true')
    await act(async () => { [...dialog.querySelectorAll('button')].find(button => button.textContent === '停止加载')!.click() })
    expect(signal.aborted).toBe(true)
    expect(dialog.textContent).toContain('尚未加载完整')
    expect(dialog.textContent).toContain('公共地点示例')
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(close).toHaveBeenCalledOnce()
  } finally {
    await act(async () => { root.unmount() })
    expect(document.activeElement).toBe(trigger)
    trigger.remove(); mount.remove()
  }
})

it('uses converted points, links grouped markers, preserves manual viewing during streaming, and destroys the map', async () => {
  const mock = createBaiduMapMock(); mocks.load.mockResolvedValue(mock.sdk)
  const mount = document.createElement('div'); document.body.append(mount)
  const root = createRoot(mount), selected = vi.fn()
  const points = ['one', 'same', 'two'].map((id, i) => ({ id, recordedAtMillis: 1000, location: { source: 'device' as const, latitude: 39, longitude: i === 2 ? 116.1 : 116, label: '公共地点' } }))
  try {
    await act(async () => { root.render(<DayLocationMapCanvas points={points} onSelect={selected} browserAk="test" />) })
    expect(mount.querySelectorAll('.arkme-day-map-pin')).toHaveLength(2)
    expect(mock.map.centerAndZoom.mock.calls[0]).toEqual([{ lng: 116.01, lat: 39.01 }, 16])
    await act(async () => { mount.querySelector<HTMLButtonElement>('.arkme-day-map-pin')!.click() })
    expect(selected).toHaveBeenCalledWith('one')
    await act(async () => { root.render(<DayLocationMapCanvas points={points} selectedId="same" onSelect={selected} browserAk="test" />) })
    expect(mount.querySelector('.arkme-day-map-pin')?.getAttribute('aria-pressed')).toBe('true')
    const centered = mock.map.centerAndZoom.mock.calls.length, fitted = mock.map.setViewport.mock.calls.length
    await act(async () => { root.render(<DayLocationMapCanvas points={[...points, { ...points[2]!, id: 'streamed' }]} selectedId="same" onSelect={selected} browserAk="test" />) })
    expect(mock.map.centerAndZoom).toHaveBeenCalledTimes(centered)
    expect(mock.map.setViewport).toHaveBeenCalledTimes(fitted)
    await act(async () => { [...mount.querySelectorAll('button')].find(button => button.textContent === '显示全部')!.click() })
    expect(mock.map.setViewport).toHaveBeenCalledTimes(fitted + 1)
  } finally { await act(async () => root.unmount()); mount.remove() }
  expect(mock.map.destroy).toHaveBeenCalledOnce()
  expect(mock.events.size).toBe(0)
})

it('never creates a map when SDK loading completes after unmount', async () => {
  let resolve!: (value: unknown) => void
  const mock = createBaiduMapMock()
  mocks.load.mockImplementation(() => new Promise(done => { resolve = done }))
  const mount = document.createElement('div'); document.body.append(mount)
  const root = createRoot(mount)
  await act(async () => { root.render(<DayLocationMapCanvas points={[]} onSelect={() => {}} />) })
  await act(async () => { root.unmount(); resolve(mock.sdk) })
  expect(mock.sdk.Map).not.toHaveBeenCalled()
  mount.remove()
})

it('leaves recorded locations selectable when Baidu is unavailable and supports retry', async () => {
  mocks.load.mockRejectedValueOnce(new Error('百度地图加载失败，位置列表仍可查看'))
  mocks.read.mockImplementation(async (_query, _signal, progress) => {
    const snapshot = { points: [{ id: 'point', recordedAtMillis: 1000, location: { source: 'device', latitude: 39, longitude: 116, label: '公共地点示例' } }], scanned: 1, failed: 0, complete: true }
    progress(snapshot); return snapshot
  })
  const mount = document.createElement('div'); document.body.append(mount)
  const root = createRoot(mount)
  try {
    await act(async () => root.render(<ArkmeDayLocationMap query={{ accountScope: 'test', bucketDate: '2026-10-11', timezone: 'Asia/Shanghai' }} onClose={() => {}} />))
    expect(document.querySelector('.arkme-day-map-status')?.textContent).toContain('百度地图加载失败')
    await act(async () => document.querySelector<HTMLButtonElement>('[data-location-record="point"]')!.click())
    expect(document.querySelector('.arkme-day-map-selected')?.textContent).toContain('公共地点示例')
    expect(document.querySelector('.arkme-day-map-selected')?.textContent).toContain('39.00000, 116.00000')
    await act(async () => document.querySelector<HTMLButtonElement>('.arkme-day-map-status button')!.click())
    expect(document.querySelector('.arkme-day-map-pin')?.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.arkme-day-map-status')).toBeNull()
  } finally { await act(async () => root.unmount()); mount.remove() }
})
