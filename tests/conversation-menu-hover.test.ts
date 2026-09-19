// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { conversationMenuHoverBridge, watchConversationMenuHover, type ConversationMenuHoverRequest } from '../src/client/conversation-menu-layer.js'

const cardRect = { left: 20, right: 300, top: 100, bottom: 164 }
const menuRect = { left: 308, right: 628, top: 80, bottom: 600 }
let stop: (() => void) | undefined
afterEach(() => { stop?.(); stop = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers() })

function fixture() {
  vi.useFakeTimers()
  const card = document.createElement('button'), menu = document.createElement('div'), outside = document.createElement('button')
  document.body.append(card, menu, outside)
  vi.spyOn(card, 'getClientRects').mockReturnValue([cardRect] as unknown as DOMRectList)
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(cardRect as DOMRect)
  let request!: ConversationMenuHoverRequest
  const close = vi.fn()
  const open = vi.fn((value: ConversationMenuHoverRequest) => { request = value; return true })
  stop = watchConversationMenuHover(card, {
    open, close, position: vi.fn(), contains: target => menu.contains(target as Node | null), bounds: () => [menuRect],
  })
  const pointer = (target: Element, type: string, x: number, y: number, relatedTarget: EventTarget | null = null) => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, relatedTarget }))
  }
  const enter = () => { pointer(card, 'pointerenter', 100, 130); vi.advanceTimersByTime(200) }
  return { card, menu, outside, close, open, pointer, enter, request: () => request }
}

it('closes on the same event when leaving for another card, without a grace timer', () => {
  const f = fixture(); f.enter()
  f.pointer(f.card, 'pointerleave', 120, 170, f.outside)
  expect(f.close).toHaveBeenCalledOnce()
  expect(f.card.getAttribute('aria-expanded')).toBe('false')
  expect(vi.getTimerCount()).toBe(0)
})

it('preserves only the narrow card/menu passage and closes as soon as the pointer leaves it', () => {
  const f = fixture(); f.enter()
  f.pointer(f.card, 'pointerleave', 304, 130, document.body)
  vi.advanceTimersByTime(1000)
  expect(f.close).not.toHaveBeenCalled()
  f.pointer(f.menu, 'pointerover', 312, 130)
  expect(f.close).not.toHaveBeenCalled()
  f.pointer(document.body, 'pointermove', 304, 200)
  expect(f.close).toHaveBeenCalledOnce()
})

it('permits returning across the passage and closes immediately outside a menu', () => {
  const f = fixture(); f.enter()
  f.request().checkPointer(null, { x: 304, y: 130 })
  f.pointer(f.card, 'pointerover', 298, 130)
  expect(f.close).not.toHaveBeenCalled()
  f.request().checkPointer(document.body, { x: 700, y: 400 })
  expect(f.close).toHaveBeenCalledOnce()
})

it('handles a window relatedTarget without throwing or retaining the popup', () => {
  const f = fixture(); f.enter()
  expect(() => f.request().checkPointer(window, { x: -1, y: -1 })).not.toThrow()
  expect(f.close).toHaveBeenCalledOnce()
})

it('cancels a quick pass-through and preserves keyboard entry and Escape', () => {
  const f = fixture()
  f.pointer(f.card, 'pointerenter', 100, 130); vi.advanceTimersByTime(100)
  f.pointer(f.card, 'pointerleave', 100, 170, f.outside); vi.advanceTimersByTime(500)
  expect(f.open).not.toHaveBeenCalled()
  f.card.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(f.request().focusMenu).toBe(true)
  f.card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(f.close).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(f.card)
})

it('restricts the bridge to adjacent horizontal edges, including left-flipped menus', () => {
  expect(conversationMenuHoverBridge(cardRect, menuRect)).toEqual({ left: 300, right: 308, top: 100, bottom: 164 })
  expect(conversationMenuHoverBridge(cardRect, { left: -308, right: 12, top: 80, bottom: 600 }))
    .toEqual({ left: 12, right: 20, top: 100, bottom: 164 })
  expect(conversationMenuHoverBridge(cardRect, { ...menuRect, top: 200 })).toBeUndefined()
  expect(conversationMenuHoverBridge(cardRect, { ...menuRect, left: 400 })).toBeUndefined()
  expect(conversationMenuHoverBridge(cardRect, { ...menuRect, left: 250 })).toBeUndefined()
})
