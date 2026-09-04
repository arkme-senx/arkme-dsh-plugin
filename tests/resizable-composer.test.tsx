import { createRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clampComposerHeight, COMPOSER_HEIGHT_KEY, useResizableComposer } from '../src/client/use-resizable-composer.js'

afterEach(() => vi.unstubAllGlobals())
describe('resizable composer', () => {
  it('clamps invalid values and bounds', () => {
    expect(clampComposerHeight(NaN, 300)).toBe(38)
    expect(clampComposerHeight(900, 300)).toBe(300)
    expect(clampComposerHeight(-1, 20)).toBe(38)
  })
  it('drags upward, persists, restores the cursor and resets on double click', () => {
    const storage = new Map<string, string>()
    const body = { style: { cursor: 'default', userSelect: 'text' } }
    vi.stubGlobal('document', { body })
    vi.stubGlobal('window', {
      innerHeight: 900, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    })
    const ref = createRef<HTMLDivElement>()
    let value: ReturnType<typeof useResizableComposer>
    function Harness() { value = useResizableComposer(ref); return value.handle }
    let renderer: ReactTestRenderer
    act(() => { renderer = create(<Harness />) })
    const handle = () => renderer!.root.findByProps({ role: 'separator' })
    const event = { button: 0, pointerId: 1, clientY: 300, preventDefault: vi.fn(), currentTarget: { setPointerCapture: vi.fn() } }
    act(() => handle().props.onPointerDown(event))
    expect(body.style.cursor).toBe('ns-resize')
    act(() => handle().props.onPointerMove({ pointerId: 2, clientY: 50 }))
    expect(value!.editorStyle.height).toBeUndefined()
    act(() => handle().props.onPointerMove({ pointerId: 1, clientY: 200 }))
    expect(value!.editorStyle.height).toBe(138)
    act(() => handle().props.onPointerUp({ pointerId: 1 }))
    expect(storage.get(COMPOSER_HEIGHT_KEY)).toBe('138')
    expect(body.style).toEqual({ cursor: 'default', userSelect: 'text' })
    act(() => renderer!.unmount())
    act(() => { renderer = create(<Harness />) })
    expect(value!.editorStyle.height).toBe(138)
    act(() => handle().props.onDoubleClick())
    expect(value!.editorStyle.height).toBeUndefined()
    expect(storage.has(COMPOSER_HEIGHT_KEY)).toBe(false)
    act(() => renderer!.unmount())
  })
})
