import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, useLayoutEffect } from 'react'
import { act, create } from 'react-test-renderer'
import { observeConversationResize, resizedConversationScrollTop, useConversationResizeAnchor } from '../src/client/conversation-resize-anchor.js'

afterEach(() => vi.unstubAllGlobals())
describe('composer and message viewport resize', () => {
  it('does not lose the bottom when React commits before the resize delivery', () => {
    let resized = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback }
      observe() {}
      disconnect = disconnect
    })
    let height = 2000
    const body = { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600,
      addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const ref = { current: body as unknown as HTMLDivElement }
    const content = { current: { getBoundingClientRect: () => ({ height }) } as HTMLElement }
    function Harness({ grown }: { grown: boolean }) {
      useLayoutEffect(() => {
        if (grown) { height += 85; body.scrollHeight += 85 }
      }, [grown])
      useConversationResizeAnchor(ref, 'chat', undefined, false, content)
      return null
    }
    let renderer: ReturnType<typeof create>
    act(() => { renderer = create(createElement(Harness, { grown: false })) })
    act(() => { renderer.update(createElement(Harness, { grown: true })) })
    expect(body.scrollTop).toBe(1485)
    resized()
    expect(body.scrollTop).toBe(1485)
    expect(disconnect).not.toHaveBeenCalled()
    act(() => { renderer.unmount() })
    expect(disconnect).toHaveBeenCalledOnce()
  })
  it.each([false, true])('follows delayed message growth from the bottom (scroll delivered first: %s)', scrollFirst => {
    let resized = () => {}
    let scrolled = () => {}
    let height = 2000
    const observe = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback }
      observe = observe
      disconnect() {}
    })
    const body = { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600,
      addEventListener: vi.fn((_name, listener) => { scrolled = listener }), removeEventListener: vi.fn() }
    const content = { getBoundingClientRect: () => ({ height }) }
    const cleanup = observeConversationResize(body as unknown as HTMLElement, undefined, content as unknown as HTMLElement)
    resized()
    height += 500; body.scrollHeight += 500
    if (scrollFirst) scrolled()
    resized()
    expect(body.scrollTop).toBe(1900)
    expect(observe.mock.calls.map(([node]) => node)).toEqual([body, content])
    // Moving up cancels following, including another image finishing its layout.
    body.scrollTop = 300; scrolled()
    height += 300; body.scrollHeight += 300; resized()
    expect(body.scrollTop).toBe(300)
    // Returning to the bottom enables following again.
    body.scrollTop = 2200; scrolled()
    height += 200; body.scrollHeight += 200; resized()
    expect(body.scrollTop).toBe(2400)
    cleanup()
  })

  it('resets pre-selection bottom metrics after the selected message anchor is restored', () => {
    let resized = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback }
      observe() {}
      disconnect = disconnect
    })
    const body = { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600,
      addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const ref = { current: body as unknown as HTMLDivElement }
    function Harness({ selecting }: { selecting: boolean }) {
      useLayoutEffect(() => {
        if (selecting) Object.assign(body, { scrollTop: 1520, scrollHeight: 2400, clientHeight: 700 })
      }, [selecting])
      useConversationResizeAnchor(ref, 'chat', undefined, selecting)
      return null
    }
    let renderer: ReturnType<typeof create>
    act(() => { renderer = create(createElement(Harness, { selecting: false })) })
    act(() => { renderer.update(createElement(Harness, { selecting: true })) })
    expect(disconnect).toHaveBeenCalledOnce()
    resized()
    expect(body.scrollTop).toBe(1520)
    act(() => { renderer.unmount() })
  })
  it('rebases after history paging or locating and disconnects on leaving the conversation', () => {
    let resized = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback }
      observe() {}
      disconnect = disconnect
    })
    let height = 2000
    const content = { current: { getBoundingClientRect: () => ({ height }) } as HTMLElement }
    const body = { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600,
      addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const ref = { current: body as unknown as HTMLDivElement }
    const restoreIntent = { current: undefined as boolean | undefined }
    function Harness({ revision, active = true }: { revision: number; active?: boolean }) {
      useLayoutEffect(() => {
        if (revision === 1) {
          height = 3000
          Object.assign(body, { scrollTop: 700, scrollHeight: height })
          restoreIntent.current = false
        }
      }, [revision])
      useConversationResizeAnchor(ref, active ? 'chat' : undefined, undefined, false, content, restoreIntent)
      return null
    }
    let renderer: ReturnType<typeof create>
    act(() => { renderer = create(createElement(Harness, { revision: 0 })) })
    act(() => { renderer.update(createElement(Harness, { revision: 1 })) })
    expect(disconnect).not.toHaveBeenCalled()
    height += 500; body.scrollHeight += 500; resized()
    expect(body.scrollTop).toBe(700)
    act(() => { renderer.update(createElement(Harness, { revision: 1, active: false })) })
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(body.removeEventListener).toHaveBeenCalledTimes(1)
    act(() => { renderer.unmount() })
  })
  it('raises bottom messages by exactly the lost viewport height, and follows reset', () => {
    expect(resizedConversationScrollTop({ scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 }, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 400 })).toBe(1600)
    expect(resizedConversationScrollTop({ scrollTop: 1600, scrollHeight: 2000, clientHeight: 400 }, { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600 })).toBe(1400)
  })
  it('preserves history reading, clamps short lists, and respects near-bottom tolerance', () => {
    expect(resizedConversationScrollTop({ scrollTop: 500, scrollHeight: 2000, clientHeight: 600 }, { scrollTop: 500, scrollHeight: 2000, clientHeight: 400 })).toBe(500)
    expect(resizedConversationScrollTop({ scrollTop: 0, scrollHeight: 100, clientHeight: 600 }, { scrollTop: 0, scrollHeight: 100, clientHeight: 400 })).toBe(0)
    expect(resizedConversationScrollTop({ scrollTop: 1350, scrollHeight: 2000, clientHeight: 600 }, { scrollTop: 1350, scrollHeight: 2000, clientHeight: 400 })).toBe(1600)
  })
  it('handles scroll-before-resize ordering and cleans up observers', () => {
    let resized = () => {}
    let scrolled = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback }
      observe() {}
      disconnect = disconnect
    })
    const body = { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600,
      addEventListener: vi.fn((_name, listener) => { scrolled = listener }), removeEventListener: vi.fn() }
    const cleanup = observeConversationResize(body as unknown as HTMLElement)
    body.clientHeight = 400
    scrolled()
    resized()
    expect(body.scrollTop).toBe(1600)
    body.scrollTop = 500
    scrolled()
    body.clientHeight = 300
    resized()
    expect(body.scrollTop).toBe(500)
    cleanup()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(body.removeEventListener).toHaveBeenCalledWith('scroll', scrolled)
  })
  it('follows a growing end accessory only near the bottom, without undoing timeline anchors', () => {
    let resized = () => {}
    let height = 0
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback }
      observe = observe
      disconnect = disconnect
    })
    const body = { scrollTop: 1400, scrollHeight: 2000, clientHeight: 600,
      addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const accessory = { getBoundingClientRect: () => ({ height }) }
    const cleanup = observeConversationResize(body as unknown as HTMLElement, accessory as unknown as HTMLElement)
    expect(observe.mock.calls.map(([node]) => node)).toEqual([body, accessory])
    resized() // initial delivery must not move the viewport
    expect(body.scrollTop).toBe(1400)
    height = 120; body.scrollHeight += 120; resized()
    expect(body.scrollTop).toBe(1520)
    height = 0; body.scrollHeight -= 120; resized()
    expect(body.scrollTop).toBe(1400)
    body.scrollTop = 400
    height = 120; body.scrollHeight += 120; resized()
    expect(body.scrollTop).toBe(400)
    // A concurrent older-page prepend has already restored its own anchor.
    body.scrollTop += 1000; body.scrollHeight += 1000
    height = 0; body.scrollHeight -= 120; resized()
    expect(body.scrollTop).toBe(1400)
    // Non-accessory content changes belong to the timeline's existing owner.
    body.scrollTop = 2520; body.scrollHeight = 3240; resized()
    expect(body.scrollTop).toBe(2520)
    cleanup()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
