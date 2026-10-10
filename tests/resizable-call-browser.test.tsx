import { type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { callBrowserWidthBounds, CALL_BROWSER_WIDTH_KEY, useResizableCallBrowser } from '../src/client/use-resizable-call-browser.js'

afterEach(() => vi.unstubAllGlobals())

function mountResize(storageThrows = false) {
  const surface = { clientWidth: 1000 }
  const values = new Map<string, string>()
  const style = { cursor: 'default', userSelect: 'text' }
  let measure = () => {}
  const disconnect = vi.fn()
  const removeEventListener = vi.fn()
  vi.stubGlobal('document', { body: { style } })
  vi.stubGlobal('window', { innerWidth: 1400, addEventListener: vi.fn(), removeEventListener, localStorage: {
    getItem: (key: string) => { if (storageThrows) throw new Error('blocked'); return values.get(key) ?? null },
    setItem: (key: string, value: string) => { if (storageThrows) throw new Error('quota'); values.set(key, value) },
  } })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { measure = callback }
    observe = vi.fn()
    disconnect = disconnect
  })
  const ref = { current: surface } as unknown as RefObject<HTMLElement>
  let resize!: ReturnType<typeof useResizableCallBrowser>
  function Harness() { resize = useResizableCallBrowser(ref); return resize.handle }
  let renderer!: ReactTestRenderer
  const mount = () => act(() => { renderer = create(<Harness />) })
  mount()
  const handle = () => renderer.root.findByProps({ role: 'separator' })
  const down = () => act(() => handle().props.onPointerDown({ button: 0, pointerId: 1, clientX: 400, preventDefault() {}, currentTarget: { setPointerCapture() {} } }))
  const move = (x: number, id = 1) => act(() => handle().props.onPointerMove({ pointerId: id, clientX: x }))
  const key = (key: string) => act(() => handle().props.onKeyDown({ key, preventDefault() {} }))
  return { surface, values, style, handle, down, move, key, measure: () => act(measure), disconnect,
    removeEventListener, width: () => resize.width, mount, unmount: () => act(() => renderer.unmount()) }
}

it('drags right to widen, persists on finish and restores after remount', () => {
  const h = mountResize()
  h.down(); h.move(500, 2)
  expect(h.width()).toBe(326)
  h.move(500)
  expect(h.width()).toBe(426)
  expect(h.style).toEqual({ cursor: 'ew-resize', userSelect: 'none' })
  act(() => h.handle().props.onPointerUp({ pointerId: 1 }))
  expect(h.values.get(CALL_BROWSER_WIDTH_KEY)).toBe('426')
  expect(h.style).toEqual({ cursor: 'default', userSelect: 'text' })
  h.unmount(); h.mount()
  expect(h.width()).toBe(426)
  act(() => h.handle().props.onDoubleClick())
  expect(h.width()).toBe(326)
  h.unmount()
})

it('protects detail space and restores the preference after a temporary window shrink', () => {
  const h = mountResize()
  h.key('End'); expect(h.width()).toBe(520)
  h.surface.clientWidth = 700; h.measure()
  expect(h.width()).toBe(349)
  h.surface.clientWidth = 1000; h.measure()
  expect(h.width()).toBe(520)
  h.key('Home'); expect(h.width()).toBe(240)
  h.key('ArrowRight'); expect(h.width()).toBe(256)
  h.key('ArrowLeft'); expect(h.width()).toBe(240)
  h.key('Enter'); expect(h.width()).toBe(326)
  h.unmount()
  expect(h.disconnect).toHaveBeenCalled()
  expect(h.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
  expect(callBrowserWidthBounds(0)).toEqual({ min: 0, max: 0 })
})

it.each(['onPointerCancel', 'onLostPointerCapture'])('cleans up %s and works without storage', event => {
  const h = mountResize(true)
  h.down(); h.move(2000)
  expect(h.width()).toBe(520)
  act(() => h.handle().props[event]({ pointerId: 2 }))
  expect(h.style.cursor).toBe('ew-resize')
  act(() => h.handle().props[event]({ pointerId: 1 }))
  expect(h.style.cursor).toBe('default')
  h.down(); h.move(350)
  expect(h.width()).toBe(470)
  h.unmount()
  expect(h.style).toEqual({ cursor: 'default', userSelect: 'text' })
})
