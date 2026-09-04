import { createRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { clampNoteDetailWidth, NOTE_DETAIL_WIDTH_KEY, useResizableNoteDetail } from '../src/client/use-resizable-note-detail.js'

afterEach(() => vi.unstubAllGlobals())
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
