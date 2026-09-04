import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeConversationResize, resizedConversationScrollTop } from '../src/client/conversation-resize-anchor.js'

afterEach(() => vi.unstubAllGlobals())
describe('composer and message viewport resize', () => {
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
})
