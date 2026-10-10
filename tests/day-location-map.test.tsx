// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/day-location-reader.js', () => ({ readDayLocations: mocks.read }))
import { ArkmeDayLocationMap } from '../src/client/ArkmeDayLocationMap.js'

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
