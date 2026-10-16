// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { captureMessageDeletion, ConfirmedMessageDeletions, type MessageDeletionMotion } from '../src/client/message-deletion-feedback.js'

let viewport: HTMLDivElement, motion: MessageDeletionMotion | undefined
const animations: Array<{ node: Element; frames: Keyframe[]; options: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn> }> = []
const rect = (top: number, height = 90, left = 20, width = 380) => ({ top, bottom: top + height, left, right: left + width, width, height, x: left, y: top, toJSON() {} })
function row(id: string, top: number, version = 1) {
  const element = document.createElement('li')
  Object.assign(element.dataset, { arkmeConversationRow: id, arkmeMessageItemUid: id, arkmeMessageVersion: String(version) })
  element.innerHTML = `<div class="arkme-timed-bubble" style="background: rgb(235, 238, 246); border-radius: 12px"><p id="text-${id}">消息 ${id}</p><img alt="测试图片" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div>`
  element.getBoundingClientRect = () => rect(top)
  element.firstElementChild!.getBoundingClientRect = () => rect(top, 70)
  viewport.append(element)
  return element
}
beforeEach(() => {
  vi.useFakeTimers(); animations.length = 0
  viewport = document.createElement('div'); document.body.append(viewport)
  viewport.getBoundingClientRect = () => rect(0, 600, 0, 600)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('Animation', class {})
  Element.prototype.animate = function (frames, options) {
    const animation = { node: this, frames: frames as Keyframe[], options: options as KeyframeAnimationOptions, cancel: vi.fn() }
    animations.push(animation)
    return animation as unknown as Animation
  }
})
afterEach(() => { motion?.cancel(); motion = undefined; viewport.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); delete (Element.prototype as Partial<Element>).animate })

it('retains failures, rejects stale pagination, and allows a newer restored owner version', () => {
  const owner = new ConfirmedMessageDeletions()
  owner.accept({ items: [
    { recordUid: 'a', version: 4, result: 'deleted' }, { recordUid: 'b', version: 2, result: 'unknown' },
    { recordUid: 'c', version: 2, result: 'rejected', message: '版本冲突' }, { recordUid: 'd', version: 2, result: 'not_attempted' },
  ] })
  for (const recordVersion of [undefined, 1, 3, 4]) expect(owner.keeps({ itemUid: 'a', ...(recordVersion === undefined ? {} : { recordVersion }) })).toBe(false)
  for (const itemUid of ['b', 'c', 'd']) expect(owner.keeps({ itemUid })).toBe(true)
  expect(owner.keeps({ itemUid: 'a', recordVersion: 5 })).toBe(true)
  owner.accept({ items: [{ recordUid: 'a', version: 3, result: 'deleted' }] })
  expect(owner.keeps({ itemUid: 'a', recordVersion: 4 })).toBe(false)
  expect(new ConfirmedMessageDeletions().keeps({ itemUid: 'a' })).toBe(true)
})

it('captures only visible confirmed bubbles, with their text/media, then moves survivors and cleans up', () => {
  const first = row('a', 40), survivor = row('b', 160), offscreen = row('c', 900)
  motion = captureMessageDeletion(viewport, item => item.itemUid !== 'b')
  const layer = document.querySelector<HTMLElement>('[data-arkme-deletion-effect]')!
  expect(layer.getAttribute('aria-hidden')).toBe('true')
  expect(layer.inert).toBe(true); expect(layer.style.pointerEvents).toBe('none')
  expect(layer.textContent).toContain('消息 a'); expect(layer.textContent).not.toContain('消息 c')
  expect(layer.querySelectorAll('img').length).toBeGreaterThan(1)
  expect(layer.querySelectorAll('[data-arkme-deletion-fragment]').length).toBeGreaterThan(1)
  expect(layer.querySelectorAll('#text-a')).toHaveLength(0)
  const ids = [...layer.querySelectorAll('[id]')].map(node => node.id)
  expect(new Set(ids).size).toBe(ids.length)
  first.remove(); offscreen.remove(); survivor.getBoundingClientRect = () => rect(40)
  motion.afterRemoval(); motion.afterRemoval()
  expect(animations.filter(animation => animation.node === survivor.firstElementChild)).toHaveLength(1)
  expect(animations.some(animation => animation.node === survivor)).toBe(false)
  expect(animations.find(animation => animation.node === survivor.firstElementChild)?.frames[0]?.transform).toBe('translate(0px, 120px)')
  expect(viewport.textContent).toContain('消息 b')
  vi.advanceTimersByTime(450)
  expect(document.querySelector('[data-arkme-deletion-effect]')).toBeNull()
  expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true)
})

it('does not animate a newer record with the same ID', () => {
  row('a', 40, 5)
  const owner = new ConfirmedMessageDeletions(); owner.accept({ items: [{ recordUid: 'a', version: 4, result: 'deleted' }] })
  motion = captureMessageDeletion(viewport, item => !owner.keeps(item)); motion.afterRemoval()
  expect(document.querySelectorAll('[data-arkme-deletion-fragment]')).toHaveLength(0)
  expect(animations).toHaveLength(0)
})

it.each(['scroll', 'wheel', 'resize', 'scope'])('immediately releases visual copies on %s without undoing deletion', event => {
  const selected = row('a', 40)
  motion = captureMessageDeletion(viewport, () => true); selected.remove(); motion.afterRemoval()
  if (event === 'scope') motion.cancel()
  else if (event === 'resize') window.dispatchEvent(new Event('resize'))
  else { if (event === 'scroll') viewport.scrollTop = 20; viewport.dispatchEvent(new Event(event)) }
  expect(document.querySelector('[data-arkme-deletion-effect]')).toBeNull()
  expect(viewport.children).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
})

it('uses a short fade without translation or neighbor motion for reduced motion', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const first = row('a', 40), second = row('b', 160)
  motion = captureMessageDeletion(viewport, item => item.itemUid === 'a')
  first.remove(); second.getBoundingClientRect = () => rect(40); motion.afterRemoval()
  expect(animations).toHaveLength(1)
  expect(animations[0]?.options.duration).toBe(110)
  expect(animations[0]?.frames).toEqual([{ opacity: 1 }, { opacity: 0 }])
  vi.advanceTimersByTime(120); expect(document.querySelector('[data-arkme-deletion-effect]')).toBeNull()
})

it('bounds fragments for large selections and does not clone active media playback', () => {
  for (let i = 0; i < 100; i++) row(String(i), i * 5)
  viewport.querySelector('.arkme-timed-bubble')!.insertAdjacentHTML('beforeend', '<video autoplay src="file:private"><source src="file:private"></video>')
  motion = captureMessageDeletion(viewport, () => true)
  const layer = document.querySelector('[data-arkme-deletion-effect]')!
  expect(layer.querySelectorAll('[data-arkme-deletion-fragment]').length).toBeLessThanOrEqual(120)
  expect(layer.querySelectorAll('video[src], video[autoplay], source[src]')).toHaveLength(0)
  motion.cancel(); expect(vi.getTimerCount()).toBe(0)
})

it('degrades harmlessly if Web Animations is unavailable', () => {
  row('a', 40); motion = captureMessageDeletion(viewport, () => true)
  delete (Element.prototype as Partial<Element>).animate
  motion.afterRemoval(); expect(document.querySelector('[data-arkme-deletion-effect]')).toBeNull()
})
