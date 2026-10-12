// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cancelConversationFollow, followConversationBottom, isConversationFollowing } from '../src/client/conversation-bottom-follow.js'
import { arkmeConversationViewport } from '../src/client/conversation-viewport.js'
afterEach(() => vi.restoreAllMocks())
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
it('uses one frame owner, retargets arrivals, and persists bottom intent throughout the animation', () => {
  const f = fixture()
  try {
    followConversationBottom(f.body)
    expect(f.body.scrollTop).toBe(500)
    for (let i = 0; i < 6; i++) {
      const before = f.body.scrollTop
      f.grow(); followConversationBottom(f.body)
      expect(f.frames.size).toBe(1)
      f.frame()
      expect(f.body.scrollTop).toBeGreaterThan(before)
      expect(f.body.scrollTop).toBeLessThan(f.body.scrollHeight - 500)
      expect(arkmeConversationViewport(f.body).stickToBottom).toBe(true)
    }
    for (let i = 0; i < 60; i++) f.frame()
    expect(f.body.scrollTop).toBe(1600)
    expect(f.frames.size).toBe(0)
    expect(isConversationFollowing(f.body)).toBe(true)
    f.grow(); followConversationBottom(f.body)
    expect(f.frames.size).toBe(1)
    for (let i = 0; i < 40; i++) f.frame()
    expect(f.body.scrollTop).toBe(1700)
  } finally { cancelConversationFollow(f.body) }
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
