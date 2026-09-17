// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { watchConversationMenuScrollbars } from '../src/client/conversation-menu-scrollbars.js'
import { CONVERSATION_MENU_LAYOUT, CONVERSATION_SELECTOR_CSS } from '../src/client/conversation-selector-style.js'

let stop: (() => void) | undefined
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { stop?.(); stop = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers() })

function mount() {
  const menu = document.createElement('div'), list = document.createElement('div')
  menu.append(list); document.body.append(menu)
  vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 330, top: 20, bottom: 580 } as DOMRect)
  stop = watchConversationMenuScrollbars(menu, list)
  return { menu, list, state: () => menu.getAttribute('data-arkme-menu-scrollbars') }
}

it('reveals on entry and lingers for exactly the native DSH 2 seconds without changing geometry', () => {
  const { menu, list, state } = mount()
  expect(state()).toBe('quiet')
  expect(list.hasAttribute('data-arkme-menu-scroll')).toBe(true)
  menu.dispatchEvent(new Event('pointerenter'))
  expect(state()).toBe('visible')
  menu.dispatchEvent(new Event('pointerleave'))
  vi.advanceTimersByTime(CONVERSATION_MENU_LAYOUT.scrollbarLingerMs - 1)
  expect(state()).toBe('visible')
  vi.advanceTimersByTime(1)
  expect(state()).toBe('quiet')
  expect(menu.style.cssText).toBe('')
  expect(list.style.cssText).toBe('')
  expect(CONVERSATION_SELECTOR_CSS).toContain('scrollbar-gutter: stable')
})

it('cancels hiding on reentry and checks pointer geometry around portalled menus', () => {
  const { menu, state } = mount()
  menu.dispatchEvent(new Event('pointerenter'))
  document.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 100 }))
  vi.advanceTimersByTime(1900)
  document.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 100 }))
  vi.advanceTimersByTime(2100)
  expect(state()).toBe('visible')
  document.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 100 }))
  vi.advanceTimersByTime(2000)
  expect(state()).toBe('quiet')
})

it('keeps the same affordance while dragging topics and cleans up pending timers on close', () => {
  const { menu, list, state } = mount()
  menu.dispatchEvent(new Event('dragenter'))
  expect(state()).toBe('visible')
  document.dispatchEvent(new MouseEvent('dragover', { clientX: 500, clientY: 100 }))
  stop!(); stop = undefined
  vi.advanceTimersByTime(2000)
  menu.dispatchEvent(new Event('pointerenter'))
  expect(state()).toBeNull()
  expect(list.hasAttribute('data-arkme-menu-scroll')).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})
