// @vitest-environment jsdom
import { act, useLayoutEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeConversationMemoryCache } from '../src/client/conversation-memory-cache.js'
import {
  arkmeConversationViewport, useConversationViewport,
  type ArkmeConversationViewportRestore,
} from '../src/client/conversation-viewport.js'

// jsdom has no layout: model the browser's scroll clamp and row geometry while
// keeping React host mutations, effects, refs and scroll events real.
let host: HTMLDivElement
let root: Root
let store: ArkmeConversationMemoryCache
let scrollTop: number
let viewportHeight: number
let pageHeight: number
let restoreIntent: { current: boolean | undefined }
let pending: { current: ArkmeConversationViewportRestore | undefined }
const rowCount: Record<string, number> = { A: 30, B: 12 }
function Harness({ selected = 'A', active = true, hold = false }: { selected?: string; active?: boolean; hold?: boolean }) {
  const [rendered, setRendered] = useState(selected)
  const bodyRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!hold) {
      pending.current = { sourceKey: selected, viewport: store.getViewport(selected) }
      setRendered(selected)
    }
  }, [selected, hold])
  const remember = useConversationViewport({ active, sourceKey: selected, renderedSourceKey: rendered,
    bodyRef, store, pendingRestore: pending, restoreIntent })
  return <div ref={bodyRef} data-viewport={rendered} onScroll={remember}>
    {Array.from({ length: rowCount[rendered]! }, (_, index) => <div key={`${rendered}-${index}`}
      data-arkme-conversation-row={`message:${rendered}-${index}`} data-row-index={index}>{rendered}:{index}</div>)}
  </div>
}
function render(props: Parameters<typeof Harness>[0] = {}) { act(() => root.render(<Harness {...props} />)) }
function scroll(top: number) {
  const body = host.firstElementChild as HTMLDivElement
  body.scrollTop = top
  act(() => body.dispatchEvent(new Event('scroll')))
}
function maximum() { return Math.max(0, (host.firstElementChild?.children.length ?? 0) * pageHeight - viewportHeight) }
function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, left: 0, right: 800, width: 800, height, x: 0, y: top, toJSON: () => ({}) }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  restoreIntent = { current: undefined }
  store = new ArkmeConversationMemoryCache(); pending = { current: undefined }
  scrollTop = 0; viewportHeight = 500; pageHeight = 100; rowCount.B = 12
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function () {
    scrollTop = Math.max(0, Math.min(scrollTop, maximum())); return scrollTop
  })
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (top) {
    scrollTop = Math.max(0, Math.min(top, maximum()))
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () { return this.children.length * pageHeight })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => viewportHeight)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.hasAttribute('data-viewport') ? rect(0, viewportHeight)
      : rect(Number(this.dataset.rowIndex) * pageHeight - scrollTop, pageHeight)
  })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('conversation viewport ownership', () => {
  it.each([0, 12, 40])('preserves history through ten cold/warm switches to %s rows', count => {
    rowCount.B = count
    render(); scroll(730)
    const saved = store.getViewport('A')
    expect(saved?.anchorId).toBe('message:A-7')
    for (let turn = 0; turn < 10; turn++) {
      render({ selected: 'B' }); scroll(Math.min(230, maximum()))
      render()
      expect(scrollTop).toBe(730)
      expect(store.getViewport('A')).toEqual(saved)
    }
  })

  it('keeps a bottom-pinned conversation pinned after returning to taller content', () => {
    render(); scroll(maximum()); expect(store.getViewport('A')?.stickToBottom).toBe(true)
    render({ selected: 'B' }); pageHeight = 120; render()
    expect(scrollTop).toBe(maximum())
  })

  it('keeps the saved message offset when rows resize while away', () => {
    render(); scroll(730); render({ selected: 'B' }); pageHeight = 120; render()
    expect(scrollTop).toBe(870)
    expect(store.getViewport('A')?.anchorOffset).toBe(-30)
  })

  it('ignores hidden scroll events and restores reading on reactivation', () => {
    render(); scroll(730); const saved = store.getViewport('A')
    viewportHeight = 0; render({ active: false }); scroll(0)
    expect(store.getViewport('A')).toEqual(saved)
    viewportHeight = 500; render(); expect(scrollTop).toBe(730)
  })

  it('does not overwrite a snapshot or consume a restore while the viewport has zero height', () => {
    render(); scroll(730)
    viewportHeight = 0
    pending.current = { sourceKey: 'A', viewport: store.getViewport('A') }
    render(); scroll(0)
    expect(pending.current).toBeDefined()
    expect(store.getViewport('A')?.scrollTop).toBe(730)
    viewportHeight = 500; render(); expect(scrollTop).toBe(730)
  })

  it('does not persist old rows under the selected destination before its timeline commits', () => {
    render(); scroll(730); const saved = store.getViewport('A')
    render({ selected: 'B', hold: true }); scroll(200)
    expect(store.getViewport('B')).toBeUndefined()
    expect(store.getViewport('A')).toEqual(saved)
    render({ selected: 'B' }); render(); expect(scrollTop).toBe(730)
  })

  it('does not read a replacement DOM during unmount cleanup', () => {
    render(); scroll(730); const saved = store.getViewport('A')
    act(() => root.render(<div>different page</div>))
    expect(store.getViewport('A')).toEqual(saved)
  })

  it('honors explicit latest navigation over remembered history', () => {
    render(); scroll(730); render({ active: false })
    pending.current = { sourceKey: 'A', viewport: undefined }
    render(); expect(scrollTop).toBe(maximum())
  })

  it('keeps explicit newer-page navigation separate from restoring the saved anchor', () => {
    render(); scroll(730)
    pending.current = { sourceKey: 'A', viewport: store.getViewport('A'), newerPageStartAnchorId: 'message:A-15' }
    render(); expect(scrollTop).toBe(1500)
  })

  it('passes explicit follow intent to deferred layout without treating clamped history as latest', () => {
    render()
    expect(restoreIntent.current).toBe(true)
    pending.current = { sourceKey: 'A', viewport: { scrollTop: 9000, stickToBottom: false } }
    render()
    expect(scrollTop).toBe(maximum())
    expect(restoreIntent.current).toBe(false)
    pending.current = { sourceKey: 'A', viewport: undefined, newerPageStartAnchorId: 'message:A-29' }
    render()
    expect(restoreIntent.current).toBe(false)
    restoreIntent.current = undefined
    render()
    expect(restoreIntent.current).toBeUndefined()
  })

  it('clamps the pixel fallback when the saved message was removed', () => {
    render()
    pending.current = { sourceKey: 'A', viewport: { scrollTop: 9000, stickToBottom: false, anchorId: 'message:removed', anchorOffset: 0 } }
    render(); expect(scrollTop).toBe(maximum())
  })

  it('preserves a historical message when content reflows in the current timeline', () => {
    render(); scroll(730)
    pending.current = { sourceKey: 'A', viewport: store.getViewport('A') }
    pageHeight = 120; render()
    expect(scrollTop).toBe(870)
    expect(store.getViewport('A')?.anchorId).toBe('message:A-7')
  })

  it('keeps a pending request for a different conversation unconsumed', () => {
    render(); scroll(730)
    pending.current = { sourceKey: 'B', viewport: undefined }
    render(); expect(pending.current?.sourceKey).toBe('B'); expect(scrollTop).toBe(730)
  })

  it('uses the saved pixel fallback when an explicit newer-page row is absent', () => {
    render(); scroll(730)
    pending.current = { sourceKey: 'A', viewport: store.getViewport('A'), newerPageStartAnchorId: 'message:missing' }
    render(); expect(scrollTop).toBe(730)
  })

  it('retains history across rerenders without a replacement or restore request', () => {
    render(); scroll(730); const saved = store.getViewport('A')
    render(); render()
    expect(scrollTop).toBe(730)
    expect(store.getViewport('A')).toEqual(saved)
  })

  it('cannot restore a previous account snapshot after the cache owner clears it', () => {
    render(); scroll(730)
    act(() => root.render(<div>signed out</div>))
    store.clear()
    render()
    expect(scrollTop).toBe(maximum())
    expect(store.getViewport('A')?.anchorId).toBeUndefined()
  })

  it('keeps forced history capture separate from the near-bottom policy', () => {
    render(); scroll(maximum())
    const body = host.firstElementChild as HTMLDivElement
    expect(arkmeConversationViewport(body).stickToBottom).toBe(true)
    expect(arkmeConversationViewport(body, true)).toMatchObject({ stickToBottom: false, anchorId: 'message:A-25' })
  })
})
