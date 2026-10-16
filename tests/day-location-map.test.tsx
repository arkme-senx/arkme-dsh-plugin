// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBaiduMapMock } from './fixtures/baidu-map-mock.js'
const mocks = vi.hoisted(() => ({ read: vi.fn(), load: vi.fn(), call: vi.fn(), auth: { auth: { status: 'authenticated', userId: 42, environment: 'test' }, config: { baiduMapBrowserAk: 'test' } } }))
vi.mock('../src/client/baidu-map.js', async original => ({ ...await original<object>(), loadBaiduMaps: mocks.load }))
vi.mock('../src/client/day-location-reader.js', () => ({ readDayLocations: mocks.read }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { subscribe: () => () => {}, getSnapshot: () => mocks.auth } }))
vi.mock('../src/client/ArkmeNoteDetails.js', () => ({ ArkmeTimelineDetailDrawer: () => <div data-record-detail /> }))
import { ArkmeDayLocationMap } from '../src/client/ArkmeDayLocationMap.js'
import { dayLocationCache } from '../src/client/day-location-cache.js'
import { locationSearchCache } from '../src/client/location-search-cache.js'
import { resetLocationMapSessions } from '../src/client/location-map-session.js'
const query = { accountScope: 'test:42', bucketDate: '2026-10-13', timezone: 'Asia/Shanghai', mode: 'activities' as const, kind: 'all' as const, includeBackground: false }
const point = { id: 'point', recordedAtMillis: 1000, location: { source: 'device', latitude: 39, longitude: 116, label: '公共地点示例' }, record: { title: '当天记录示例' } }
const data = { points: [point], scanned: 1, failed: 0, complete: true }
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  mocks.read.mockReset().mockImplementation(async (_query, _signal, progress) => { progress(data); return data })
  mocks.load.mockResolvedValue(createBaiduMapMock().sdk)
  mocks.call.mockReset().mockResolvedValue({ markers: [{ key: 'all', latitude: 30, longitude: 114, source: 'quick_note', count: 2, label: '全部日期地点' }], truncated: false })
  dayLocationCache.activate('test:42'); dayLocationCache.invalidate(true)
  locationSearchCache.activate('test:42'); locationSearchCache.invalidate(true)
})
afterEach(() => { dayLocationCache.invalidate(true); resetLocationMapSessions(); vi.unstubAllGlobals() })
async function mountDay() {
  const trigger = document.createElement('button'), mount = document.createElement('div')
  document.body.append(trigger, mount); trigger.focus()
  const root = createRoot(mount), close = vi.fn()
  await act(async () => root.render(<ArkmeDayLocationMap query={query} onClose={close} />))
  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="当天位置"]')!
  return { root, dialog, close, dispose: async () => { await act(async () => root.unmount()); expect(document.activeElement).toBe(trigger); trigger.remove(); mount.remove() } }
}
function clickText(dialog: HTMLElement, text: string) { [...dialog.querySelectorAll('button')].find(button => button.textContent === text)!.click() }
it('uses a full map, opens records only in the bottom sheet and preserves focus on close', async () => {
  const view = await mountDay()
  try {
    expect(document.activeElement).toBe(view.dialog)
    expect(view.dialog.querySelector('.arkme-location-records')).toBeNull()
    expect(view.dialog.querySelector('.arkme-location-filters')).toBeNull()
    expect(view.dialog.querySelector('.arkme-location-locate')).not.toBeNull()
    await act(async () => view.dialog.querySelector<HTMLButtonElement>('.arkme-location-pin')!.click())
    expect(view.dialog.querySelector('.arkme-location-records')?.textContent).toContain('当天记录示例')
    await act(async () => view.dialog.querySelector('.arkme-location-view')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(view.dialog.querySelector('.arkme-location-records')).toBeNull(); expect(view.close).not.toHaveBeenCalled()
    await act(async () => view.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(view.close).toHaveBeenCalledOnce()
  } finally { await view.dispose() }
})
it('switches to all locations and returns to the selected day without reading it again', async () => {
  const view = await mountDay()
  try {
    await act(async () => clickText(view.dialog, '查看所有位置'))
    expect(view.dialog.textContent).toContain('全部日期')
    expect(view.dialog.querySelector('.arkme-location-pin')?.getAttribute('aria-label')).toContain('全部日期地点')
    await act(async () => clickText(view.dialog, '返回 2026-10-13'))
    expect(view.dialog.querySelector<HTMLInputElement>('[aria-label="位置日期"]')!.value).toBe('2026-10-13')
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(view.dialog.querySelector('.arkme-location-pin')?.getAttribute('aria-label')).toContain('公共地点示例')
  } finally { await view.dispose() }
})
it('shows partial results immediately and shares the pending scan when the day is reopened', async () => {
  let finish!: (value: unknown) => void
  mocks.read.mockImplementation((_q, _s, progress) => { progress({ ...data, complete: false }); return new Promise(resolve => { finish = resolve }) })
  const first = await mountDay()
  expect(first.dialog.querySelectorAll('.arkme-location-pin')).toHaveLength(1)
  await first.dispose()
  const next = await mountDay()
  try {
    expect(mocks.read).toHaveBeenCalledTimes(1)
    await act(async () => finish(data))
    expect(next.dialog.textContent).not.toContain('正在更新…')
  } finally { await next.dispose() }
})
it('keeps a usable map for an empty date and never shows the previous date records', async () => {
  const view = await mountDay()
  try {
    mocks.read.mockImplementation(async (_q, _s, progress) => { const empty = { ...data, points: [], complete: true }; progress(empty); return empty })
    const input = view.dialog.querySelector<HTMLInputElement>('[aria-label="位置日期"]')!
    await act(async () => { Simulate.change(input, { target: { value: '2026-10-14' } } as any) })
    expect(mocks.read.mock.calls.at(-1)?.[0]).toEqual({ bucketDate: '2026-10-14', timezone: 'Asia/Shanghai' })
    expect(view.dialog.textContent).toContain('当天暂无位置记录')
    expect(view.dialog.querySelector('.arkme-location-map')).not.toBeNull()
    expect(view.dialog.querySelectorAll('.arkme-location-pin')).toHaveLength(0)
  } finally { await view.dispose() }
})
it('clears cached records and selection on privacy invalidation and leaves map fallback usable', async () => {
  mocks.load.mockRejectedValue(new Error('百度地图加载失败'))
  const view = await mountDay()
  try {
    await act(async () => view.dialog.querySelector<HTMLButtonElement>('.arkme-location-fallback button')!.click())
    expect(view.dialog.querySelector('.arkme-location-records')?.textContent).toContain('当天记录示例')
    mocks.read.mockImplementation(() => new Promise(() => {}))
    await act(async () => locationSearchCache.invalidate(true))
    expect(view.dialog.querySelector('.arkme-location-records')).toBeNull()
    expect(view.dialog.textContent).not.toContain('当天记录示例')
  } finally { await view.dispose() }
})
it('renders only a small record page and loads more without reading locations again', async () => {
  mocks.read.mockImplementation(async (_q, _s, progress) => {
    const many = { ...data, scanned: 30, points: Array.from({ length: 30 }, (_, i) => ({ ...point, id: `point-${i}` })) }
    progress(many); return many
  })
  const view = await mountDay()
  try {
    await act(async () => view.dialog.querySelector<HTMLButtonElement>('.arkme-location-pin')!.click())
    expect(view.dialog.querySelectorAll('.arkme-location-record')).toHaveLength(6)
    await act(async () => clickText(view.dialog, '加载更多'))
    expect(view.dialog.querySelectorAll('.arkme-location-record')).toHaveLength(26)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  } finally { await view.dispose() }
})
