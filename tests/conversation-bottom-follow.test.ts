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
  return { body, frames, grow: () => { height += 100 }, frame: (millis = 16) => {
    now += millis
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now))
  } }
}
it('moves retained rows continuously instead of snapping an entire incoming row in one frame', () => {
  const f = fixture()
  f.body.scrollTop = 1000
  f.grow(); followConversationBottom(f.body)
  expect(f.body.scrollTop).toBe(1000)
  f.frame()
  expect(f.body.scrollTop).toBeGreaterThan(1000)
  expect(f.body.scrollTop).toBeLessThan(1050)
  expect(isConversationFollowing(f.body)).toBe(true)
  for (let i = 0; i < 12; i++) f.frame()
  expect(f.body.scrollTop).toBe(1100)
  expect(f.frames.size).toBe(0)
  cancelConversationFollow(f.body)
})
it('keeps one frame and one listener set while retargeting continuous arrivals', () => {
  const f = fixture()
  f.body.scrollTop = 1000
  const listen = vi.spyOn(f.body, 'addEventListener')
  try {
    followConversationBottom(f.body)
    for (let i = 0; i < 100; i++) {
      f.grow(); followConversationBottom(f.body)
      const before = f.body.scrollTop
      followConversationBottom(f.body)
      expect(f.body.scrollTop).toBe(before)
      expect(f.frames.size).toBe(1)
      f.frame()
      expect(f.body.scrollTop).toBeGreaterThan(before)
      expect(arkmeConversationViewport(f.body).stickToBottom).toBe(true)
    }
    for (let i = 0; i < 2000 && f.frames.size; i++) f.frame()
    expect(f.body.scrollTop).toBe(f.body.scrollHeight - 500)
    expect(listen).toHaveBeenCalledTimes(4)
    expect(f.frames.size).toBe(0)
    expect(isConversationFollowing(f.body)).toBe(true)
  } finally { cancelConversationFollow(f.body) }
})
it('finishes on time even when resize and commit repeat the unchanged target each frame', () => {
  const f = fixture(); f.body.scrollTop = 1000
  f.grow(); followConversationBottom(f.body)
  for (let i = 0; i < 14; i++) { followConversationBottom(f.body); f.frame() }
  expect(f.body.scrollTop).toBe(1100)
  expect(f.frames.size).toBe(0)
  cancelConversationFollow(f.body)
})
it('does not skip the motion when commit or an unrelated main-thread task delays a frame', () => {
  const f = fixture(); f.body.scrollTop = 1000
  f.grow(); followConversationBottom(f.body)
  f.frame(140)
  expect(f.body.scrollTop).toBeGreaterThan(1000)
  expect(f.body.scrollTop).toBeLessThan(1040)
  const previous = f.body.scrollTop
  f.frame(100)
  expect(f.body.scrollTop - previous).toBeLessThan(40)
  for (let i = 0; i < 12; i++) f.frame()
  expect(f.body.scrollTop).toBe(1100)
  expect(f.frames.size).toBe(0)
  cancelConversationFollow(f.body)
})
it.each([2, 3])('bounds the motion of %i coalesced rows even when a frame is delayed', count => {
  const f = fixture(); f.body.scrollTop = 1000
  for (let i = 0; i < count; i++) f.grow()
  followConversationBottom(f.body)
  for (let i = 0; i < 60 && f.frames.size; i++) {
    const previous = f.body.scrollTop
    f.frame(i === 1 ? 120 : 16)
    expect(f.body.scrollTop - previous).toBeLessThanOrEqual(36)
  }
  expect(f.body.scrollTop).toBe(1000 + count * 100)
  expect(f.frames.size).toBe(0)
  cancelConversationFollow(f.body)
})
it('honors reduced motion without leaving any animation work', () => {
  const f = fixture(); f.body.scrollTop = 1000
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  f.grow(); followConversationBottom(f.body)
  expect(f.body.scrollTop).toBe(1100)
  expect(f.frames.size).toBe(0)
  cancelConversationFollow(f.body)
})
it('retargets delayed layout continuously and stops when the reader scrolls into history', () => {
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
    f.body.scrollTop = 1000
    followConversationBottom(f.body)
    dispose.commit(true)
    f.grow(); resize()
    expect(f.body.scrollTop).toBe(1000)
    for (let i = 0; i < 14; i++) f.frame()
    expect(f.body.scrollTop).toBe(1100)
    f.body.dispatchEvent(new Event('wheel'))
    f.body.scrollTop = 100; f.body.dispatchEvent(new Event('scroll'))
    f.grow(); resize(); f.frame()
    expect(f.body.scrollTop).toBe(100)
    expect(f.frames.size).toBe(0)
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
it('rebases an active motion after a retained window slides without replaying old coordinates', () => {
  const f = fixture(); f.body.scrollTop = 1000
  f.grow(); followConversationBottom(f.body); f.frame()
  f.body.scrollTop -= 100
  const afterSlide = f.body.scrollTop
  followConversationBottom(f.body, true); f.frame()
  expect(f.body.scrollTop).toBeGreaterThan(afterSlide)
  expect(f.body.scrollTop).toBeLessThan(afterSlide + 50)
  for (let i = 0; i < 60 && f.frames.size; i++) f.frame()
  expect(f.body.scrollTop).toBe(1100)
  cancelConversationFollow(f.body)
})

it('gives latest motion exclusive anchoring and restores the browser history anchor on input', () => {
  const f = fixture(); f.body.scrollTop = 1000
  followConversationBottom(f.body)
  expect(f.body.style.overflowAnchor).toBe('none')
  f.grow(); followConversationBottom(f.body)
  for (let i = 0; i < 14; i++) f.frame()
  // Keep ownership between arrivals, not only while an animation frame is queued.
  expect(f.body.style.overflowAnchor).toBe('none')
  f.body.dispatchEvent(new Event('wheel'))
  expect(f.body.style.overflowAnchor).toBe('')
  expect(isConversationFollowing(f.body)).toBe(false)
})
it('restores an existing inline anchor policy on scope disposal without leaking it into another conversation', () => {
  const f = fixture(); f.body.style.setProperty('overflow-anchor', 'auto', 'important')
  followConversationBottom(f.body)
  expect(f.body.style.overflowAnchor).toBe('none')
  cancelConversationFollow(f.body)
  expect(f.body.style.overflowAnchor).toBe('auto')
  expect(f.body.style.getPropertyPriority('overflow-anchor')).toBe('important')
})
