// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeRichComposerInput } from '../src/client/ArkmeRichComposerInput.js'
import { COMPOSER_HEIGHT_KEY, useResizableComposer } from '../src/client/use-resizable-composer.js'

let root: Root
let host: HTMLDivElement
let available: number
let overhead: number
let resize: () => void

function Harness({ markdown }: { markdown: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const messages = useRef<HTMLDivElement>(null)
  const sizing = useResizableComposer(container, 'conversation', messages)
  return <>
    <div ref={messages} data-geometry="messages" />
    <div ref={container} data-geometry="composer">
      {sizing.handle}
      <ArkmeRichComposerInput markdownEnabled={markdown} className="arkme-conversation-textarea"
        value="" mentions={[]} emojis={[]} maxLength={20000} placeholder="快记" ariaLabel="快记" disabled={false}
        style={{ minHeight: 38, overflowY: 'auto', ...sizing.editorStyle }}
        onTextChange={() => {}} onMarkdownChange={() => {}} />
    </div>
  </>
}

function editorBox(): HTMLElement { return host.querySelector('.arkme-conversation-textarea')! }
function editorHeight(): number { return parseFloat(editorBox().style.height) || 38 }
function separator(): HTMLElement { return host.querySelector('[role="separator"]')! }
function key(value: string) {
  act(() => separator().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })))
}
function pointer(type: string, clientY: number) {
  const event = new MouseEvent(type, { button: 0, clientY, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  act(() => separator().dispatchEvent(event))
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  available = 614.25
  overhead = 65
  window.localStorage.removeItem(COMPOSER_HEIGHT_KEY)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  // jsdom has no layout. Model the measured browser geometry: the Markdown
  // wrapper resizes while its empty contenteditable remains one 21px line.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = this.dataset.geometry === 'composer' ? editorHeight() + overhead
      : this.dataset.geometry === 'messages' ? available - editorHeight() - overhead
      : this.classList.contains('arkme-conversation-textarea') ? editorHeight()
      : this.hasAttribute('contenteditable') ? 21 : 0
    return new DOMRect(0, 0, 400, height)
  })
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return Math.round(this.getBoundingClientRect().height)
  })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  window.localStorage.removeItem(COMPOSER_HEIGHT_KEY)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('composer resize geometry', () => {
  it.each([false, true])('stays at the same maximum after repeated layout measurements (Markdown: %s)', async markdown => {
    await act(async () => root.render(<Harness markdown={markdown} />))
    key('End')
    const maximum = editorHeight()
    expect(maximum).toBeGreaterThan(300)
    const heights: number[] = []
    for (let frame = 0; frame < 12; frame++) {
      act(() => resize())
      heights.push(editorHeight())
    }
    expect(heights).toEqual(Array(12).fill(maximum))
  })

  it.each([false, true])('starts dragging and keyboard resizing from the displayed box (Markdown: %s)', async markdown => {
    window.localStorage.setItem(COMPOSER_HEIGHT_KEY, '160')
    await act(async () => root.render(<Harness markdown={markdown} />))
    Object.defineProperty(separator(), 'setPointerCapture', { value: vi.fn() })
    pointer('pointerdown', 300)
    pointer('pointermove', 290)
    pointer('pointerup', 290)
    expect(editorHeight()).toBe(170)
    key('ArrowUp')
    expect(editorHeight()).toBe(190)
    pointer('pointerdown', 300)
    pointer('pointermove', 320)
    pointer('pointerup', 320)
    expect(editorHeight()).toBe(170)
    expect(window.localStorage.getItem(COMPOSER_HEIGHT_KEY)).toBe('170')
  })

  it('keeps a restored oversized preference stable with fractional viewport dimensions', async () => {
    window.localStorage.setItem(COMPOSER_HEIGHT_KEY, '900')
    await act(async () => root.render(<Harness markdown={false} />))
    const maximum = editorHeight()
    const heights: number[] = []
    for (let frame = 0; frame < 12; frame++) {
      act(() => resize())
      heights.push(editorHeight())
    }
    expect(heights).toEqual(Array(12).fill(maximum))
  })

  it('updates the maximum for window and toolbar changes without feeding back on itself', async () => {
    await act(async () => root.render(<Harness markdown />))
    key('End')
    const initialMaximum = editorHeight()
    available -= 100
    act(() => resize())
    const smallerWindow = editorHeight()
    expect(smallerWindow).toBeLessThan(initialMaximum)
    overhead += 40
    act(() => resize())
    const tallerToolbar = editorHeight()
    expect(tallerToolbar).toBeLessThan(smallerWindow)
    for (let frame = 0; frame < 12; frame++) act(() => resize())
    expect(editorHeight()).toBe(tallerToolbar)
    available += 100
    overhead -= 40
    act(() => resize())
    expect(editorHeight()).toBe(initialMaximum)
    key('Enter')
    expect(editorBox().style.height).toBe('')
    expect(window.localStorage.getItem(COMPOSER_HEIGHT_KEY)).toBeNull()
  })
})
