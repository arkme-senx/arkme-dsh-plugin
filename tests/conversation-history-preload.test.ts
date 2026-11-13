import { afterEach, expect, it, vi } from 'vitest'
import { ConversationHistoryPreload, observeConversationHistory } from '../src/client/conversation-history-preload.js'

afterEach(() => vi.unstubAllGlobals())

it.each(['top', 'bottom'] as const)('uses two viewport heights at the %s edge and discards stale callbacks', edge => {
  const callbacks: IntersectionObserverCallback[] = []
  const margins: string[] = []
  const disconnect = vi.fn()
  let resized!: () => void
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
      callbacks.push(callback)
      margins.push(options.rootMargin!)
    }
    observe() {}
    disconnect = disconnect
  })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe() {}
    disconnect = disconnect
  })
  const root = { clientHeight: 600 }
  const near = vi.fn()
  const stop = observeConversationHistory(root as HTMLElement, {} as HTMLElement, near, edge)
  root.clientHeight = 900
  resized()
  const notify = (callback: IntersectionObserverCallback) => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
  notify(callbacks[0]!)
  notify(callbacks[1]!)
  stop()
  notify(callbacks[1]!)
  expect(margins).toEqual(edge === 'top' ? ['1200px 0px 0px', '1800px 0px 0px'] : ['0px 0px 1200px', '0px 0px 1800px'])
  expect(near.mock.calls).toEqual([[true]])
  expect(disconnect).toHaveBeenCalledTimes(3)
})

it('chains advancing pages while the reserve is low and bounds duplicate or zero-growth reads', () => {
  const preload = new ConversationHistoryPreload()
  expect(preload.shouldRequest('first', 2000)).toBe(true)
  expect(preload.shouldRequest('first', 2000)).toBe(false)
  expect(preload.shouldRequest('second', 2100)).toBe(true)
  expect(preload.shouldRequest('third', 2100)).toBe(true)
  expect(preload.shouldRequest('fourth', 2100)).toBe(false)
  preload.leaveThreshold()
  expect(preload.shouldRequest('fourth', 2100)).toBe(true)
})
