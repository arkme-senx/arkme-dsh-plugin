// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachRegionMarquee } from '../src/client/selection/region-marquee.js'

const rect = (left: number, top: number, width: number, height: number) => new DOMRect(left, top, width, height)
let viewport: HTMLDivElement
let cleanup: () => void
let commit: ReturnType<typeof vi.fn>
let paint: ReturnType<typeof vi.fn>
let top: number
function pointer(type: string, x: number, y: number, target: EventTarget = viewport, extra: object = {}) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true })
  Object.defineProperties(event, Object.fromEntries(Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true, ...extra }).map(([key, value]) => [key, { value }])))
  target.dispatchEvent(event)
  return event
}
function add(key: string, y: number) {
  const element = document.createElement('div'); element.dataset.key = key; viewport.append(element)
  element.getBoundingClientRect = () => rect(30, y - top, 100, 30)
  return element
}
beforeEach(() => {
  vi.useFakeTimers()
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange()
    range.getClientRects = () => [rect(30, 40, 100, 30)] as unknown as DOMRectList
    return range
  })
  viewport = document.createElement('div'); document.body.append(viewport)
  viewport.getBoundingClientRect = () => rect(20, 20, 200, 200)
  top = 0
  Object.defineProperties(viewport, {
    clientWidth: { value: 200 }, clientHeight: { value: 200 }, scrollHeight: { value: 1000 },
    scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(800, value)) } },
  })
  add('own', 40); add('other', 90); add('bot-no-action-ref', 140)
  commit = vi.fn(); paint = vi.fn()
  cleanup = attachRegionMarquee(viewport, {
    canStart: () => true,
    getItems: () => [...viewport.querySelectorAll<HTMLElement>('[data-key]')].map(element => ({ key: element.dataset.key!, element })),
    onCommit: commit, onRect: paint,
  }).dispose
})
afterEach(() => { cleanup(); viewport.remove(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('region marquee DOM interaction', () => {
  it('selects all intersected keys on release, clips both axes and supports reverse drag', () => {
    pointer('pointerdown', 210, 210); pointer('pointermove', -50, -60, document)
    expect(commit).not.toHaveBeenCalled()
    expect(paint.mock.lastCall?.[0]).toMatchObject({ left: 20, top: 20, right: 210, bottom: 210 })
    pointer('pointerup', -50, -60, document)
    expect([...commit.mock.calls[0]![0]]).toEqual(['own', 'other', 'bot-no-action-ref'])
    expect(paint.mock.lastCall?.[0]).toBeUndefined()
  })
  it('does not commit clicks, tiny drags, empty hits or drags started outside the viewport', () => {
    pointer('pointerdown', 25, 25); pointer('pointerup', 26, 26, document)
    pointer('pointerdown', 200, 30); pointer('pointermove', 210, 200); pointer('pointerup', 210, 200)
    pointer('pointerdown', 0, 0); pointer('pointermove', 200, 200); pointer('pointerup', 200, 200)
    expect(commit).not.toHaveBeenCalled()
  })
  it.each(['button', 'a', 'input', 'textarea', 'video', 'audio', 'select', 'img'])('preserves %s interactions', tag => {
    const element = document.createElement(tag); viewport.append(element)
    pointer('pointerdown', 25, 25, element); pointer('pointermove', 200, 200); pointer('pointerup', 200, 200)
    expect(commit).not.toHaveBeenCalled()
  })
  it('preserves text and editable content while allowing blank row space', () => {
    const element = add('text', 40); element.textContent = 'selectable text'
    pointer('pointerdown', 35, 45, element); pointer('pointermove', 180, 180); pointer('pointerup', 180, 180)
    expect(commit).not.toHaveBeenCalled()
    element.setAttribute('contenteditable', 'true')
    pointer('pointerdown', 35, 45, element); pointer('pointermove', 180, 180); pointer('pointerup', 180, 180)
    expect(commit).not.toHaveBeenCalled()
  })
  it.each([{ pointerType: 'touch' }, { pointerType: 'pen' }, { buttons: 2 }, { isPrimary: false }])('ignores non-primary mouse gestures %j', extra => {
    pointer('pointerdown', 25, 25, viewport, extra); pointer('pointermove', 180, 180); pointer('pointerup', 180, 180)
    expect(commit).not.toHaveBeenCalled()
  })
  it.each(['pointercancel', 'blur', 'resize', 'hidden', 'Escape', 'dispose'])('cancels %s without committing or continuing scroll', reason => {
    pointer('pointerdown', 25, 25); pointer('pointermove', 180, 250, document)
    if (reason === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    else if (reason === 'dispose') cleanup()
    else if (reason === 'blur' || reason === 'resize') window.dispatchEvent(new Event(reason))
    else if (reason === 'hidden') { vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange')) }
    else pointer('pointercancel', 180, 250, document)
    const stopped = top; vi.advanceTimersByTime(200)
    pointer('pointerup', 180, 250, document)
    expect(top).toBe(stopped); expect(commit).not.toHaveBeenCalled()
    expect(paint.mock.lastCall?.[0]).toBeUndefined()
  })
  it('scrolls only its viewport and retains encountered rows when they leave the viewport', () => {
    add('later', 260)
    pointer('pointerdown', 25, 25); pointer('pointermove', 180, 250, document)
    vi.advanceTimersByTime(400)
    expect(top).toBeGreaterThan(100)
    pointer('pointerup', 180, 250, document)
    expect([...commit.mock.calls[0]![0]]).toEqual(expect.arrayContaining(['own', 'other', 'bot-no-action-ref', 'later']))
  })
  it('does not truncate at a business action limit or discard encountered keys when DOM rows disappear', () => {
    for (let i = 0; i < 120; i++) add(`item-${i}`, 70)
    pointer('pointerdown', 25, 25); pointer('pointermove', 180, 180)
    viewport.querySelector('[data-key="own"]')!.remove()
    pointer('pointerup', 180, 180)
    expect(commit.mock.calls[0]![0].size).toBe(123)
    expect(commit.mock.calls[0]![0].has('own')).toBe(true)
  })
  it('suppresses only the click generated by a completed drag', () => {
    const click = vi.fn(); viewport.addEventListener('click', click)
    pointer('pointerdown', 25, 25); pointer('pointermove', 180, 180); pointer('pointerup', 180, 180)
    const clickEvent = new MouseEvent('click', { bubbles: true, detail: 1 })
    Object.defineProperty(clickEvent, 'pointerId', { value: 1 })
    viewport.dispatchEvent(clickEvent)
    expect(click).not.toHaveBeenCalled()
    pointer('pointerdown', 25, 25); pointer('pointerup', 25, 25)
    viewport.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(click).toHaveBeenCalledTimes(1)
  })
  it('coalesces high-frequency moves and ignores cancellation of another pointer', () => {
    pointer('pointerdown', 25, 25); pointer('pointermove', 180, 180)
    paint.mockClear()
    for (let i = 0; i < 100; i++) pointer('pointermove', 180 + i % 10, 180)
    expect(paint).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20)
    expect(paint).toHaveBeenCalledTimes(1)
    pointer('pointercancel', 180, 180, document, { pointerId: 2 })
    pointer('pointerup', 180, 180)
    expect(commit).toHaveBeenCalledTimes(1)
  })
  it('ignores the scrollbar and cancels a lost mouse release without committing', () => {
    pointer('pointerdown', 220, 25); pointer('pointermove', 180, 180); pointer('pointerup', 180, 180)
    expect(commit).not.toHaveBeenCalled()
    pointer('pointerdown', 25, 25); pointer('pointermove', 180, 180)
    pointer('pointermove', 180, 180, document, { buttons: 0 })
    pointer('pointerup', 180, 180)
    expect(commit).not.toHaveBeenCalled()
  })

  it('suppresses the delayed release click after Escape but never an unrelated button click', () => {
    const clicked = vi.fn(); viewport.addEventListener('click', clicked)
    pointer('pointerdown', 25, 25); pointer('pointermove', 180, 180)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    vi.advanceTimersByTime(500)
    pointer('pointerup', 180, 180)
    const releaseClick = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
    Object.defineProperty(releaseClick, 'pointerId', { value: 1 })
    viewport.dispatchEvent(releaseClick)
    expect(clicked).not.toHaveBeenCalled()
    const button = document.createElement('button'); document.body.append(button)
    const action = vi.fn(); button.addEventListener('click', action)
    pointer('pointerdown', 0, 0, button); button.click()
    expect(action).toHaveBeenCalledTimes(1)
    button.remove()
  })
  it('does not infer business deletion from a row unmount during scrolling', () => {
    pointer('pointerdown', 25, 25); pointer('pointermove', 180, 180)
    viewport.querySelector('[data-key="own"]')!.remove()
    pointer('pointerup', 180, 180)
    expect(commit.mock.calls[0]![0].has('own')).toBe(true)
  })

  it('does not swallow a new intentional click after a missed release', () => {
    const clicked = vi.fn(); viewport.addEventListener('click', clicked)
    pointer('pointerdown', 25, 25); pointer('pointermove', 180, 180)
    pointer('pointerdown', 25, 25); pointer('pointerup', 25, 25)
    const click = new MouseEvent('click', { bubbles: true, detail: 1 })
    Object.defineProperty(click, 'pointerId', { value: 1 })
    viewport.dispatchEvent(click)
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()
  })

})

it('does not consume Escape before the drag threshold is reached', () => {
  pointer('pointerdown', 25, 25)
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  const keyboard = vi.fn()
  window.addEventListener('keydown', keyboard)
  document.dispatchEvent(escape)
  window.removeEventListener('keydown', keyboard)
  expect(escape.defaultPrevented).toBe(false)
  expect(keyboard).toHaveBeenCalledOnce()
  pointer('pointermove', 180, 180); pointer('pointerup', 180, 180)
  expect(commit).not.toHaveBeenCalled()
})

it('preserves ordinary selection before the threshold and blocks it only during an active marquee', () => {
  pointer('pointerdown', 25, 25)
  const selectionStart = new Event('selectstart', { bubbles: true, cancelable: true })
  viewport.dispatchEvent(selectionStart)
  expect(selectionStart.defaultPrevented).toBe(false)
  pointer('pointermove', 180, 180)
  const activeSelectionStart = new Event('selectstart', { bubbles: true, cancelable: true })
  viewport.dispatchEvent(activeSelectionStart)
  expect(activeSelectionStart.defaultPrevented).toBe(true)
  pointer('pointerup', 180, 180)
  const afterRelease = new Event('selectstart', { bubbles: true, cancelable: true })
  viewport.dispatchEvent(afterRelease)
  expect(afterRelease.defaultPrevented).toBe(false)
})
it.each(['Escape', 'dispose'])('releases native selection interception after %s', reason => {
  pointer('pointerdown', 25, 25)
  if (reason === 'dispose') cleanup()
  else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const selectionStart = new Event('selectstart', { bubbles: true, cancelable: true })
  viewport.dispatchEvent(selectionStart)
  expect(selectionStart.defaultPrevented).toBe(false)
})
it('does not intercept native selection starting over message text', () => {
  const element = add('native-text', 40); element.textContent = 'selectable text'
  pointer('pointerdown', 35, 45, element)
  const selectionStart = new Event('selectstart', { bubbles: true, cancelable: true })
  element.dispatchEvent(selectionStart)
  expect(selectionStart.defaultPrevented).toBe(false)
})

it.each([false, true])('clears an existing native range only when it belongs to the viewport: outside=%s', outside => {
  const element = document.createElement('p'); element.textContent = 'previously selected text'
  ;(outside ? document.body : viewport).append(element)
  const range = document.createRange(); range.selectNodeContents(element)
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
  pointer('pointerdown', 25, 25)
  expect(selection.toString()).toBe('previously selected text')
  pointer('pointermove', 180, 180); pointer('pointerup', 180, 180)
  expect(selection.toString()).toBe(outside ? 'previously selected text' : '')
  selection.removeAllRanges(); element.remove()
})

it('starts in registered blank space while clipping the anchor and rectangle to the viewport', () => {
  cleanup()
  const area = document.createElement('footer'); const boundary = document.createElement('div')
  area.append(boundary); document.body.append(area)
  area.getBoundingClientRect = () => rect(20, 220, 200, 100)
  boundary.getBoundingClientRect = () => rect(30, 250, 180, 70)
  cleanup = attachRegionMarquee(viewport, { canStart: () => true, getStartArea: () => ({ element: area, boundary }),
    getItems: () => [...viewport.children].map(element => ({ key: (element as HTMLElement).dataset.key!, element: element as HTMLElement })),
    onCommit: commit, onRect: paint }).dispose
  boundary.textContent = 'native selection in the start surface'
  const range = document.createRange(); range.selectNodeContents(boundary)
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
  pointer('pointerdown', 25, 225, area); pointer('pointermove', 180, 100, document)
  expect(window.getSelection()!.toString()).toBe('')
  expect(paint.mock.calls.at(-1)![0].bottom).toBe(220)
  pointer('pointerup', 180, 100, document)
  expect(commit).toHaveBeenCalledOnce()
  area.remove()
})
it.each(['button', 'input', 'separator', 'below-boundary', 'outside'])('does not claim %s in or beside a registered start area', kind => {
  cleanup()
  const area = document.createElement('footer'); const boundary = document.createElement('div')
  const target = document.createElement(kind === 'button' || kind === 'input' ? kind : 'div')
  if (kind === 'separator') target.setAttribute('role', 'separator')
  area.append(boundary, target); document.body.append(area)
  area.getBoundingClientRect = () => rect(20, 220, 200, 100)
  boundary.getBoundingClientRect = () => rect(30, 250, 180, 70)
  cleanup = attachRegionMarquee(viewport, { canStart: () => true, getStartArea: () => ({ element: area, boundary }),
    getItems: () => [], onCommit: commit, onRect: paint }).dispose
  paint.mockClear()
  pointer('pointerdown', 25, kind === 'below-boundary' ? 260 : 225, kind === 'outside' ? document.body : target)
  pointer('pointermove', 180, 100, document); pointer('pointerup', 180, 100, document)
  expect(commit).not.toHaveBeenCalled()
  expect(paint).not.toHaveBeenCalled()
  area.remove()
})
