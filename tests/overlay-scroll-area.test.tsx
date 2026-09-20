// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeOverlayScrollArea, overlayScrollbarGeometry } from '../src/client/ArkmeOverlayScrollArea.js'

let host: HTMLDivElement, root: Root, viewport: HTMLDivElement, area: HTMLElement, thumb: HTMLElement
let height = 200, contentHeight = 1000
let observers: Array<{ callback: () => void; disconnect: ReturnType<typeof vi.fn> }>
const forwarded = createRef<HTMLDivElement>()
const onScroll = vi.fn()

async function measure() {
  await act(async () => {
    observers.forEach(observer => observer.callback())
    vi.advanceTimersByTime(20)
  })
}
async function pointer(type: string, y = 0, pointerId = 1, target = thumb) {
  await act(async () => {
    const event = new MouseEvent(type, { bubbles: true, clientY: y, button: 0 })
    Object.defineProperty(event, 'pointerId', { value: pointerId })
    target.dispatchEvent(event)
    vi.advanceTimersByTime(20)
  })
}
async function key(key: string) {
  await act(async () => {
    thumb.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    vi.advanceTimersByTime(20)
  })
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  observers = []
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn()
    observe = vi.fn()
    constructor(callback: () => void) { observers.push({ callback, disconnect: this.disconnect }) }
  })
  height = 200; contentHeight = 1000
  onScroll.mockClear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<ArkmeOverlayScrollArea ref={forwarded} role="tree" aria-label="测试会话" onScroll={onScroll}>
    <button role="treeitem">发给自己</button>
  </ArkmeOverlayScrollArea>))
  viewport = forwarded.current!
  area = viewport.parentElement!
  thumb = area.querySelector('[role="scrollbar"]')!
  Object.defineProperties(viewport, {
    clientHeight: { get: () => height, configurable: true },
    scrollHeight: { get: () => contentHeight, configurable: true },
  })
  const captures = new Set<number>()
  thumb.setPointerCapture = vi.fn(id => { captures.add(id) })
  thumb.hasPointerCapture = vi.fn(id => captures.has(id))
  thumb.releasePointerCapture = vi.fn(id => { captures.delete(id) })
  await measure()
})
afterEach(async () => {
  await act(async () => root.unmount())
  expect(observers.every(observer => observer.disconnect.mock.calls.length === 1)).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
  host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})

describe('non-layout directory scrollbar', () => {
  it('bounds thumb size and position for empty, small and large lists', () => {
    expect(overlayScrollbarGeometry(200, 100, 0)).toEqual({ range: 0, height: 196, travel: 0, top: 2 })
    expect(overlayScrollbarGeometry(200, 100000, -10).height).toBe(24)
    expect(overlayScrollbarGeometry(200, 100000, -10).top).toBe(2)
    const bottom = overlayScrollbarGeometry(200, 1000, 2000)
    expect(bottom.top + bottom.height).toBeCloseTo(198)
    expect(overlayScrollbarGeometry(0, 0, 0)).toEqual({ range: 0, height: 0, travel: 0, top: 2 })
  })

  it('keeps the original native viewport ref, semantics, scroll callbacks and one overlaid sibling', async () => {
    expect(viewport.getAttribute('role')).toBe('tree')
    expect(viewport.style.scrollbarWidth).toBe('none')
    expect(viewport.style.width).toBe('100%')
    expect(area.style.position).toBe('relative')
    expect(thumb.getAttribute('aria-controls')).toBe(viewport.id)
    expect(thumb.parentElement).toBe(area)
    expect(thumb.hidden).toBe(false)
    expect(thumb.getAttribute('aria-valuemax')).toBe('800')
    await act(async () => { viewport.scrollTop = 350; viewport.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20) })
    expect(onScroll).toHaveBeenCalledOnce()
    expect(thumb.getAttribute('aria-valuenow')).toBe('350')
  })

  it('handles list growth, shrinkage and a hidden retained viewport without changing width', async () => {
    contentHeight = 100; await measure(); expect(thumb.hidden).toBe(true)
    contentHeight = 1000; await measure(); expect(thumb.hidden).toBe(false)
    height = 0; await measure(); expect(thumb.hidden).toBe(true)
    height = 200; await measure(); expect(thumb.hidden).toBe(false)
    expect(viewport.style.width).toBe('100%')
    expect(viewport.style.paddingRight).toBe('')
  })

  it('shows on hover and scroll, fades after leaving, and remains visible while keyboard focused', async () => {
    await pointer('pointerenter', 0, 1, area)
    expect(area.dataset.arkmeScrollVisible).toBe('true')
    await act(async () => vi.advanceTimersByTime(2000))
    expect(area.dataset.arkmeScrollVisible).toBe('true')
    await pointer('pointerleave', 0, 1, area)
    await act(async () => vi.advanceTimersByTime(1000))
    expect(area.dataset.arkmeScrollVisible).toBe('false')
    await act(async () => { thumb.focus(); vi.advanceTimersByTime(2000) })
    expect(area.dataset.arkmeScrollVisible).toBe('true')
    await act(async () => { thumb.blur(); vi.advanceTimersByTime(1000) })
    expect(area.dataset.arkmeScrollVisible).toBe('false')
  })

  it('captures thumb drags, clamps at both ends and releases on cancel without activating a row', async () => {
    await pointer('pointerdown', 10)
    expect(thumb.setPointerCapture).toHaveBeenCalledWith(1)
    await pointer('pointermove', 1000, 2); expect(viewport.scrollTop).toBe(0)
    await pointer('pointermove', 1000); expect(viewport.scrollTop).toBe(800)
    await pointer('pointermove', -1000); expect(viewport.scrollTop).toBe(0)
    await pointer('pointercancel')
    expect(thumb.releasePointerCapture).toHaveBeenCalledWith(1)
    expect(area.dataset.arkmeScrollDragging).toBeUndefined()
    await pointer('pointermove', 1000); expect(viewport.scrollTop).toBe(0)
  })

  it('supports keyboard and wheel scrolling over the thumb', async () => {
    await key('End'); expect(viewport.scrollTop).toBe(800)
    await key('PageUp'); expect(viewport.scrollTop).toBe(600)
    await key('ArrowUp'); expect(viewport.scrollTop).toBe(560)
    await key('Home'); expect(viewport.scrollTop).toBe(0)
    await key('ArrowDown'); expect(viewport.scrollTop).toBe(40)
    await key('PageDown'); expect(viewport.scrollTop).toBe(240)
    await act(async () => {
      thumb.dispatchEvent(new WheelEvent('wheel', { deltaY: 2, deltaMode: 1, cancelable: true }))
      vi.advanceTimersByTime(20)
    })
    expect(viewport.scrollTop).toBe(272)
    expect(thumb.getAttribute('aria-valuenow')).toBe('272')
  })
})
