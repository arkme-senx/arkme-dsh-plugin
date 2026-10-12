// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cancelConversationFollow, followConversationBottom, isConversationFollowing } from '../src/client/conversation-bottom-follow.js'
import { arkmeConversationViewport } from '../src/client/conversation-viewport.js'
import { observeConversationResize } from '../src/client/conversation-resize-anchor.js'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function fixture() {
  let now = 0, height = 1500
  const frames = new Map<number, FrameRequestCallback>()
  let serial = 0
  vi.spyOn(window.performance, 'now').mockImplementation(() => now)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++serial, callback); return serial })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  const body = document.createElement('div'); body.scrollTop = 500
  Object.defineProperties(body, { scrollHeight: { get: () => height }, clientHeight: { value: 500 } })
  return { body, frames, grow: () => { height += 100 }, frame: () => {
    now += 16
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now))
  } }
}
it('pins every arrival before paint, without a follow-up animation or duplicate listeners', () => {
  const f = fixture()
  const listen = vi.spyOn(f.body, 'addEventListener')
  try {
    followConversationBottom(f.body)
    expect(f.body.scrollTop).toBe(1000)
    for (let i = 0; i < 100; i++) {
      f.grow(); followConversationBottom(f.body)
      expect(f.body.scrollTop).toBe(f.body.scrollHeight - 500)
      const firstPaint = f.body.scrollTop
      f.frame()
      expect(f.body.scrollTop).toBe(firstPaint)
      expect(arkmeConversationViewport(f.body).stickToBottom).toBe(true)
    }
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    expect(listen).toHaveBeenCalledTimes(4)
    expect(f.frames.size).toBe(0)
    expect(isConversationFollowing(f.body)).toBe(true)
  } finally { cancelConversationFollow(f.body) }
})
it('aligns delayed layout before paint and stops when the reader scrolls into history', () => {
  const f = fixture()
  let resize = () => {}
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  const content = { getBoundingClientRect: () => ({ height: f.body.scrollHeight }) } as HTMLElement
  const dispose = observeConversationResize(f.body, undefined, content)
  try {
    followConversationBottom(f.body)
    dispose.commit(true)
    f.grow(); resize()
    expect(f.body.scrollTop).toBe(1100)
    f.frame()
    expect(f.body.scrollTop).toBe(1100)
    f.body.dispatchEvent(new Event('wheel'))
    f.body.scrollTop = 100; f.body.dispatchEvent(new Event('scroll'))
    f.grow(); resize(); f.frame()
    expect(f.body.scrollTop).toBe(100)
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
  } finally { dispose(); cancelConversationFollow(f.body) }
})
it.each(['wheel', 'touchstart', 'pointerdown', 'keydown'])('yields immediately to %s and leaves the reading position alone', type => {
  const f = fixture()
  followConversationBottom(f.body); f.frame()
  const interrupted = vi.fn()
  f.body.addEventListener('scroll', interrupted)
  f.body.dispatchEvent(new Event(type))
  expect(interrupted).toHaveBeenCalledOnce()
  f.body.scrollTop = 100; f.grow(); f.frame()
  expect(f.body.scrollTop).toBe(100)
  expect(isConversationFollowing(f.body)).toBe(false)
  expect(f.frames.size).toBe(0)
  expect(arkmeConversationViewport(f.body).stickToBottom).toBe(false)
})
it('cancels all work on scope disposal', () => {
  const f = fixture()
  const remove = vi.spyOn(f.body, 'removeEventListener')
  const dispatch = vi.spyOn(f.body, 'dispatchEvent')
  followConversationBottom(f.body); cancelConversationFollow(f.body)
  expect(f.frames.size).toBe(0)
  expect(remove).toHaveBeenCalledTimes(4)
  expect(dispatch).not.toHaveBeenCalled()
})
