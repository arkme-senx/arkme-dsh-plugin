import { createRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { clampNoteDetailWidth, NOTE_DETAIL_WIDTH_KEY, useResizableNoteDetail } from '../src/client/use-resizable-note-detail.js'

afterEach(() => vi.unstubAllGlobals())

function mountResize(options: { storageThrows?: boolean; observer?: boolean } = {}) {
  const parent = { clientWidth: 1000 }
  const values = new Map<string, string>()
  const style = { cursor: 'default', userSelect: 'text' }
  let measure = () => {}
  const disconnect = vi.fn()
  const observe = vi.fn()
  const addEventListener = vi.fn()
  const removeEventListener = vi.fn()
  vi.stubGlobal('document', { body: { style } })
  vi.stubGlobal('window', { innerWidth: 1400, addEventListener, removeEventListener, localStorage: {
    getItem: (key: string) => { if (options.storageThrows) throw new Error('blocked'); return values.get(key) ?? null },
    setItem: (key: string, value: string) => { if (options.storageThrows) throw new Error('quota'); values.set(key, value) },
  } })
  vi.stubGlobal('ResizeObserver', options.observer === false ? undefined : class {
    constructor(callback: () => void) { measure = callback }
    observe = observe
    disconnect = disconnect
  })
  const ref = { current: { parentElement: parent, getBoundingClientRect: () => ({ width: resize.style.width }) } } as unknown as ReturnType<typeof createRef<HTMLElement>>
  let resize: ReturnType<typeof useResizableNoteDetail>
  function Harness() { resize = useResizableNoteDetail(ref); return resize.handle }
  let renderer: ReactTestRenderer
  act(() => { renderer = create(<Harness />) })
  const handle = () => renderer!.root.findByProps({ role: 'separator' })
  const down = () => act(() => handle().props.onPointerDown({ button: 0, pointerId: 1, clientX: 800, preventDefault() {}, currentTarget: { setPointerCapture() {} } }))
  const move = () => act(() => handle().props.onPointerMove({ pointerId: 1, clientX: 600 }))
  const key = (key: string) => act(() => handle().props.onKeyDown({ key, preventDefault() {} }))
  return { parent, values, style, handle, down, move, key, measure: () => act(measure), observe, disconnect,
    addEventListener, removeEventListener, width: () => resize!.style.width, unmount: () => act(() => renderer!.unmount()) }
}

it('tracks container resize, preserves preference and disconnects listeners', () => {
  const h = mountResize()
  h.key('End')
  expect(h.width()).toBe(600)
  h.parent.clientWidth = 240
  h.measure()
  expect(h.width()).toBe(240)
  h.parent.clientWidth = 1000
  h.measure()
  expect(h.width()).toBe(600)
  expect(h.observe).toHaveBeenCalledWith(h.parent)
  h.unmount()
  expect(h.disconnect).toHaveBeenCalledTimes(1)
  expect(h.removeEventListener).toHaveBeenCalledWith('resize', h.addEventListener.mock.calls[0]![1])
})

it.each(['onPointerCancel', 'onLostPointerCapture'])('%s ends only the active drag and allows the next drag', event => {
  const h = mountResize()
  h.down(); h.move()
  act(() => h.handle().props[event]({ pointerId: 2 }))
  expect(h.style.cursor).toBe('ew-resize')
  act(() => h.handle().props[event]({ pointerId: 1 }))
  expect(h.style).toEqual({ cursor: 'default', userSelect: 'text' })
  expect(h.values.get(NOTE_DETAIL_WIDTH_KEY)).toBe('600')
  h.key('Home'); h.down(); h.move()
  expect(h.width()).toBe(600)
  h.unmount()
  expect(h.style.cursor).toBe('default')
})

it('keeps drag and keyboard usable when optional storage fails', () => {
  const h = mountResize({ storageThrows: true })
  expect(h.width()).toBe(405)
  h.down(); h.move()
  act(() => h.handle().props.onPointerUp({ pointerId: 1 }))
  expect(h.width()).toBe(600)
  h.key('Home'); expect(h.width()).toBe(405)
  h.key('ArrowLeft'); expect(h.width()).toBe(425)
  h.key('ArrowRight'); expect(h.width()).toBe(405)
  h.key('End'); expect(h.width()).toBe(600)
  h.key('Enter'); expect(h.width()).toBe(405)
  h.unmount()
})

it('uses window resize as fallback without ResizeObserver', () => {
  const h = mountResize({ observer: false })
  h.parent.clientWidth = 300
  act(() => h.addEventListener.mock.calls[0]![1]())
  expect(h.width()).toBe(300)
  h.unmount()
})
it('constrains detail width while keeping small screens usable', () => {
  expect(clampNoteDetailWidth(100, 1000)).toBe(405)
  expect(clampNoteDetailWidth(2000, 1000)).toBe(600)
  expect(clampNoteDetailWidth(372, 240)).toBe(240)
  expect(clampNoteDetailWidth(NaN, 1000)).toBe(405)
  expect(clampNoteDetailWidth(900, 600)).toBe(405)
  expect(clampNoteDetailWidth(2000, 1200)).toBe(720)
})
it('drags left to widen, persists, resets and cleans up the cursor', () => {
  const values = new Map<string, string>()
  const style = { cursor: 'default', userSelect: 'text' }
  vi.stubGlobal('document', { body: { style } })
  vi.stubGlobal('window', { innerWidth: 1000, addEventListener: vi.fn(), removeEventListener: vi.fn(), localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } })
  const ref = createRef<HTMLElement>()
  let resize: ReturnType<typeof useResizableNoteDetail>
  function Harness() { resize = useResizableNoteDetail(ref); return resize.handle }
  let renderer: ReactTestRenderer
  act(() => { renderer = create(<Harness />) })
  const handle = () => renderer!.root.findByProps({ role: 'separator' })
  act(() => handle().props.onPointerDown({ button: 0, pointerId: 1, clientX: 700, preventDefault() {}, currentTarget: { setPointerCapture() {} } }))
  expect(style.cursor).toBe('ew-resize')
  act(() => handle().props.onPointerMove({ pointerId: 2, clientX: 500 }))
  expect(resize!.style.width).toBe(405)
  act(() => handle().props.onPointerMove({ pointerId: 1, clientX: 500 }))
  expect(resize!.style.width).toBe(600)
  act(() => handle().props.onPointerUp({ pointerId: 1 }))
  expect(style.cursor).toBe('default')
  expect(values.get(NOTE_DETAIL_WIDTH_KEY)).toBe('600')
  act(() => renderer!.unmount())
  act(() => { renderer = create(<Harness />) })
  expect(resize!.style.width).toBe(600)
  act(() => handle().props.onDoubleClick())
  expect(resize!.style.width).toBe(405)
  act(() => handle().props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} }))
  expect(resize!.style.width).toBe(425)
  act(() => handle().props.onPointerDown({ button: 0, pointerId: 3, clientX: 600, preventDefault() {}, currentTarget: { setPointerCapture() {} } }))
  act(() => renderer!.unmount())
  expect(style).toEqual({ cursor: 'default', userSelect: 'text' })
})
