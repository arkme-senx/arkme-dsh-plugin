// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { watchHarnessSurfaceViewport } from '../src/client/harness-surface-viewport.js'
import { conversationMenuLayer, conversationMenuPosition } from '../src/client/conversation-menu-layer.js'

let stop: (() => void) | undefined
afterEach(() => { stop?.(); stop = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
const flush = async () => { await Promise.resolve(); vi.advanceTimersByTime(32); await Promise.resolve() }
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} })

function fixture(visible = true) {
  vi.useFakeTimers()
  vi.stubGlobal('innerWidth', 1400)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  document.body.innerHTML = '<main style="overflow:hidden"><span id="seat"></span></main>'
  const seat = document.querySelector<HTMLElement>('#seat')!
  vi.spyOn(seat, 'getBoundingClientRect').mockReturnValue(rect(356, 0, 1044, 1000))
  const surface = document.createElement('section')
  surface.setAttribute('data-arkme-visible', String(visible))
  surface.style.cssText = 'position:fixed;inset:0;width:100%;height:100%'
  const frame = document.createElement('iframe')
  frame.style.cssText = 'width:100%;height:100%'
  surface.append(frame)
  conversationMenuLayer(document).append(surface)
  const native = frame.contentDocument!
  native.body.innerHTML = '<main data-arkme-session-frame><div data-arkme-session-column></div><textarea>草稿</textarea><div data-rightbar-col></div></main>'
  const column = native.querySelector<HTMLElement>('[data-arkme-session-column]')!
  vi.spyOn(column, 'getBoundingClientRect').mockReturnValue(rect(346, 120, 320, 560))
  vi.spyOn(column, 'getClientRects').mockReturnValue([rect(346, 120, 320, 560)] as unknown as DOMRectList)
  stop = watchHarnessSurfaceViewport(surface, frame, seat)
  return { seat, surface, frame, native, column }
}

it('uses the same top-level host and leaves the clipped workspace without moving native nodes', async () => {
  const { surface, frame, native, column } = fixture()
  const draft = native.querySelector('textarea')
  expect(surface.closest('main')).toBeNull()
  expect(conversationMenuLayer(document)).toBe(surface.parentElement)
  const frameStyle = frame.style.cssText
  const bounds = native.documentElement.style.cssText
  column.setAttribute('data-arkme-session-open', '')
  await flush()
  expect(surface.style.clipPath).toContain('M 346 120 H 666 V 680')
  const shadow = document.querySelector<HTMLElement>('[data-arkme-harness-menu-shadow]')!
  expect(shadow.style.left).toBe('346px')
  expect(shadow.style.pointerEvents).toBe('none') // Shadow never blocks the underlying card.
  expect(shadow.style.boxShadow).not.toBe('none')
  expect(surface.style.clipPath).toContain('M 356 0 H 1400 V 1000')
  expect(frame.style.cssText).toBe(frameStyle)
  expect(native.documentElement.style.cssText).toBe(bounds)
  column.removeAttribute('data-arkme-session-open')
  await flush()
  expect(surface.style.clipPath).not.toContain('M 346 120')
  expect(shadow.isConnected).toBe(false)
  expect(native.querySelector('textarea')).toBe(draft)
  expect(native.documentElement.style.cssText).toBe(bounds)
})

it('exposes only the menu while DSH is inactive, without activating or reloading its conversation', async () => {
  const { surface, frame, native, column } = fixture(false)
  expect(surface.style.visibility).toBe('hidden')
  column.setAttribute('data-arkme-session-open', '')
  await flush()
  expect(surface.style.visibility).toBe('visible')
  expect(surface.style.clipPath).not.toContain('M 356 0 H 1400')
  expect(native.documentElement.hasAttribute('data-arkme-session-preview')).toBe(true)
  expect(surface.getAttribute('data-arkme-visible')).toBe('false')
  column.removeAttribute('data-arkme-session-open')
  await flush()
  expect(surface.style.visibility).toBe('hidden')
  expect(frame.contentDocument).toBe(native)
})

it.each([true, false])('keeps list shadow below overlapping native menus without double painting (DSH visible: %s)', async visible => {
  const { surface, frame, native, column } = fixture(visible)
  column.setAttribute('data-arkme-session-open', '')
  await flush()
  const shadow = document.querySelector<HTMLElement>('[data-arkme-harness-menu-shadow]')!
  const before = shadow.style.clipPath
  const frameStyle = frame.style.cssText
  const menus = [rect(640, 180, 218, 128), rect(800, 210, 218, 128)].map(bounds => {
    const menu = native.createElement('div')
    menu.setAttribute('role', 'menu')
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(bounds)
    vi.spyOn(menu, 'getClientRects').mockReturnValue([bounds] as unknown as DOMRectList)
    native.body.append(menu)
    return menu
  })
  await flush()
  expect(Number(shadow.style.zIndex)).toBeLessThan(Number(surface.style.zIndex))
  expect(shadow.style.pointerEvents).toBe('none')
  // The external shadow fills only the iframe's unpainted regions. Overlapping
  // action menus must not create holes that re-enable the shadow over them.
  const paths = [...shadow.style.clipPath.matchAll(/M (-?[\d.]+) (-?[\d.]+) H (-?[\d.]+) V (-?[\d.]+) H -?[\d.]+ Z/g)]
  const paints = (x: number, y: number) => paths.some(match => {
    const [left, top, right, bottom] = match.slice(1).map(Number)
    return x - 346 > left! && x - 346 < right! && y - 120 > top! && y - 120 < bottom!
  })
  expect(paints(680, 200)).toBe(false)
  expect(paints(820, 250)).toBe(false)
  expect(paints(690, 600)).toBe(!visible)
  expect(frame.style.cssText).toBe(frameStyle)
  expect(surface.getAttribute('data-arkme-visible')).toBe(String(visible))
  menus.forEach(menu => menu.remove())
  await flush()
  expect(shadow.style.clipPath).toBe(before)
})

it('shares right-side placement, left-side fallback and viewport clamping for both menus', () => {
  expect(conversationMenuPosition(rect(58, 120, 280, 52), 320, 560, { width: 1400, height: 1000 })).toEqual({ left: 346, top: 120 })
  expect(conversationMenuPosition(rect(500, 700, 280, 52), 320, 560, { width: 900, height: 800 })).toEqual({ left: 172, top: 228 })
  expect(conversationMenuPosition(rect(10, 0, 200, 52), 280, 400, { width: 304, height: 424 })).toEqual({ left: 12, top: 12 })
})

it('keeps the native shell visible if the optional dropdown adapter stops recognizing its layout', async () => {
  const { native, surface } = fixture()
  const content = native.querySelector<HTMLElement>('[data-arkme-session-frame]')!
  content.removeAttribute('data-arkme-session-frame')
  await flush()
  expect(surface.style.visibility).toBe('visible')
  expect(content.hasAttribute('data-arkme-harness-content-frame')).toBe(true)
  expect(surface.style.clipPath).toContain('M 356 0 H 1400 V 1000')
  stop?.(); stop = undefined
  expect(content.hasAttribute('data-arkme-harness-content-frame')).toBe(false)
})
