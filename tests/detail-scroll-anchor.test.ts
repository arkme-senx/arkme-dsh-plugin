// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { observeDetailScrollAnchor } from '../src/client/detail-scroll-anchor.js'

let pane: HTMLDivElement, row: HTMLDivElement, stop: (() => void) | undefined
let height: number, documentTop: number, resize: () => void
const frames = new Map<number, FrameRequestCallback>()
let id = 0
const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(0) }
beforeEach(() => {
  height = 1800; documentTop = 600
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++id, fn); return id })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
  vi.stubGlobal('ResizeObserver', class {
    constructor(fn: () => void) { resize = fn }
    observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn()
  })
  pane = document.createElement('div'); row = document.createElement('div')
  row.setAttribute('data-arkme-detail-scroll-anchor', 'reply:stable-human')
  pane.append(row); document.body.append(pane)
  Object.defineProperties(pane, { clientHeight: { get: () => 400 }, scrollHeight: { get: () => height } })
  pane.getBoundingClientRect = () => new DOMRect(0, 100, 360, 400)
  row.getBoundingClientRect = () => new DOMRect(0, 100 + documentTop - pane.scrollTop, 360, 900)
})
afterEach(() => { stop?.(); stop = undefined; pane.remove(); frames.clear(); vi.unstubAllGlobals() })
it('preserves the visible reply offset when content above it expands', () => {
  pane.scrollTop = 700; stop = observeDetailScrollAnchor(pane)
  documentTop += 180; height += 180
  resize(); resize(); expect(frames.size).toBe(1); flush()
  expect(pane.scrollTop).toBe(880)
  expect(row.getBoundingClientRect().top).toBe(0)
})
it('keeps a bottom reader at the bottom as the pending reply becomes full text', () => {
  pane.scrollTop = 1400; stop = observeDetailScrollAnchor(pane)
  height += 300; resize(); flush()
  expect(pane.scrollTop).toBe(1700)
})
it('respects scrolling up while a layout update is pending', () => {
  pane.scrollTop = 1400; stop = observeDetailScrollAnchor(pane)
  resize()
  pane.scrollTop = 650; pane.dispatchEvent(new Event('scroll'))
  height += 300; resize(); flush()
  expect(pane.scrollTop).toBe(650)
})
it('does not scroll to the bottom merely because the detail first loads', () => {
  pane.scrollTop = 0; stop = observeDetailScrollAnchor(pane)
  resize(); flush()
  expect(pane.scrollTop).toBe(0)
})
it('finds the same row identity after an authoritative node replacement', async () => {
  pane.scrollTop = 700; stop = observeDetailScrollAnchor(pane)
  const replacement = document.createElement('div')
  replacement.setAttribute('data-arkme-detail-scroll-anchor', 'reply:stable-human')
  replacement.getBoundingClientRect = () => new DOMRect(0, 100 + documentTop - pane.scrollTop, 360, 900)
  row.replaceWith(replacement); documentTop += 80; height += 80
  await Promise.resolve(); flush()
  expect(pane.scrollTop).toBe(780)
})
it('releases pending work, observers and native anchoring ownership', async () => {
  pane.style.overflowAnchor = 'auto'
  stop = observeDetailScrollAnchor(pane); resize()
  expect(pane.style.overflowAnchor).toBe('none')
  stop(); stop = undefined
  expect(frames.size).toBe(0); expect(pane.style.overflowAnchor).toBe('auto')
  row.append('late content'); await Promise.resolve()
  expect(frames.size).toBe(0)
})
